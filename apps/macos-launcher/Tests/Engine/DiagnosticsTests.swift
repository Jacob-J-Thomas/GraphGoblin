import Darwin
import Foundation
@testable import LauncherEngine
import Testing

struct TemporaryEngineDirectory {
    let root: Directory

    init() throws {
        let temporary = try Directory(path: canonicalPath(FileManager.default.temporaryDirectory.path))
        root = try temporary.createDirectory("graphgoblin-engine-tests-" + UUID().uuidString)
    }

    func remove() {
        guard (try? root.requireAnchored()) != nil else { return }
        try? FileManager.default.removeItem(atPath: root.path)
    }
}

private struct DiagnosticFixture {
    let scratch: TemporaryEngineDirectory
    let directory: LogDirectory

    init() throws {
        let scratch = try TemporaryEngineDirectory()
        self.scratch = scratch
        let root = try scratch.root.createDirectory("logs")
        directory = LogDirectory(parent: scratch.root, root: root)
    }

    func write(_ name: String, _ bytes: Data, mode: mode_t = 0o600) throws -> FileIdentity {
        let file = try directory.root.createFile(name, mode: mode)
        try writeAll(file, bytes)
        return FileIdentity(try file.metadata())
    }

    func identity(_ name: String) throws -> FileIdentity? {
        try directory.root.named(name).map(FileIdentity.init)
    }

    func bytes(_ name: String) throws -> Data {
        try Data(contentsOf: URL(fileURLWithPath: directory.root.path + "/" + name))
    }
}

@Suite struct DiagnosticsTests {
    @Test func admitsMissingAndPrivateGatewaySlotsWithoutMutatingThem() throws {
        let fixture = try DiagnosticFixture()
        defer { fixture.scratch.remove() }

        let empty = try fixture.directory.gatewayAdmission()
        let object = try strictObject(Data(empty.utf8), required: ["version", "root", "device", "inode"])
        #expect(jsonInteger(object["version"], range: 1...1) == 1)
        #expect(object["root"] as? String == fixture.directory.root.path)
        #expect(object["device"] as? String == fixture.directory.root.identity.device)
        #expect(object["inode"] as? String == fixture.directory.root.identity.inode)
        #expect(try fixture.directory.root.names().isEmpty)

        let log = Data("old log\n".utf8)
        let active = try fixture.write("gateway.log", log)
        let previous = try fixture.write("gateway.log.1", log)
        _ = try fixture.directory.gatewayAdmission()
        #expect(try fixture.identity("gateway.log") == active)
        #expect(try fixture.identity("gateway.log.1") == previous)
        #expect(try fixture.bytes("gateway.log") == log)
        #expect(try fixture.bytes("gateway.log.1") == log)
    }

    @Test func repairsInterruptedAndInvalidUTF8TailsBeforeAppending() throws {
        let fixture = try DiagnosticFixture()
        defer { fixture.scratch.remove() }
        let prefix = Data("stage=checking outcome=cannot-verify\n".utf8)
        let next = Data("stage=starting outcome=child-exited\n".utf8)
        let invalidUTF8 = Data([0xC3, 0x28, 0x0A]) + Data("later complete record\n".utf8)
        let active = try fixture.write("launcher.log", prefix + invalidUTF8)
        let previous = try fixture.write("launcher.log.1", prefix + Data("interrupted".utf8))
        let unrelated = try fixture.write("keep", invalidUTF8)

        try fixture.directory.appendLauncherRecord(next)

        #expect(try fixture.bytes("launcher.log") == prefix + next)
        #expect(try fixture.bytes("launcher.log.1") == prefix)
        #expect(try fixture.bytes("keep") == invalidUTF8)
        #expect(try fixture.identity("launcher.log") == active)
        #expect(try fixture.identity("launcher.log.1") == previous)
        #expect(try fixture.identity("keep") == unrelated)
    }

    @Test func recordLimitAndRotationBoundaryPreserveInodesAndBytes() throws {
        let fixture = try DiagnosticFixture()
        defer { fixture.scratch.remove() }
        let maximumRecord = Data(repeating: 97, count: 4_095) + Data([10])
        let tooLong = maximumRecord + Data([10])
        #expect(throws: FileRefusal.self) { try fixture.directory.appendLauncherRecord(tooLong) }
        #expect(try fixture.directory.root.names().isEmpty)

        try fixture.directory.appendLauncherRecord(maximumRecord)
        let existing = try fixture.identity("launcher.log")
        let active = try #require(existing)
        #expect(try fixture.bytes("launcher.log") == maximumRecord)

        let exact = (0..<63).reduce(into: Data()) { bytes, _ in
            bytes.append(maximumRecord)
        }
        let descriptor = try fixture.directory.root.openRegular("launcher.log", write: true, privateMode: true)
        let appendOffset = off_t(maximumRecord.count)
        try #require(lseek(descriptor.fd, appendOffset, SEEK_SET) == appendOffset)
        try writeAll(descriptor, exact)
        let atCap = maximumRecord + exact
        #expect(atCap.count == 262_144)
        #expect(try fixture.identity("launcher.log.1") == nil)

        let newRecord = Data("after rotation\n".utf8)
        try fixture.directory.appendLauncherRecord(newRecord)
        #expect(try fixture.identity("launcher.log.1") == active)
        #expect(try fixture.identity("launcher.log") != active)
        #expect(try fixture.bytes("launcher.log.1") == atCap)
        #expect(try fixture.bytes("launcher.log") == newRecord)
        let metadata = try fixture.directory.root.named("launcher.log")
        let newMetadata = try #require(metadata)
        #expect(newMetadata.st_mode & 0o777 == 0o600)
    }

    @Test func oversizedPriorSlotIsRepairedAndReplacedByExactCappedActiveSlot() throws {
        let fixture = try DiagnosticFixture()
        defer { fixture.scratch.remove() }
        let record = Data(repeating: 97, count: 4_095) + Data([10])
        var capped = Data()
        for _ in 0..<64 { capped.append(record) }
        let active = try fixture.write("launcher.log", capped + record)
        let previous = try fixture.write("launcher.log.1", Data("previous complete\npartial".utf8))
        let message = Data("new active\n".utf8)

        try fixture.directory.appendLauncherRecord(message)

        #expect(try fixture.identity("launcher.log.1") == active)
        #expect(try fixture.identity("launcher.log") != previous)
        #expect(try fixture.bytes("launcher.log.1") == capped)
        #expect(try fixture.bytes("launcher.log") == message)
    }

    enum UnsafeSlot: String, CaseIterable {
        case symlink, hardlink, permissive
    }

    @Test(arguments: UnsafeSlot.allCases)
    func refusingUnsafeSlotsLeavesThemAndUnrelatedFilesIntact(kind: UnsafeSlot) throws {
        let fixture = try DiagnosticFixture()
        defer { fixture.scratch.remove() }
        let original = Data("foreign log bytes\n".utf8)
        let preserved = try fixture.write("keep", original)
        let directory = fixture.directory.root
        for slot in ["gateway.log.1", "launcher.log.1"] {
            switch kind {
            case .symlink:
                try #require(symlinkat("keep", directory.fd, slot) == 0)
            case .hardlink:
                try #require(linkat(directory.fd, "keep", directory.fd, slot, 0) == 0)
            case .permissive:
                _ = try fixture.write(slot, original)
                try #require(chmod(directory.path + "/" + slot, 0o644) == 0)
            }
        }
        let gateway = try fixture.identity("gateway.log.1")
        let launcher = try fixture.identity("launcher.log.1")
        let priorGateway = try #require(gateway)
        let priorLauncher = try #require(launcher)
        #expect(throws: FileRefusal.self) { try fixture.directory.gatewayAdmission() }
        #expect(throws: FileRefusal.self) { try fixture.directory.appendLauncherRecord(Data("new\n".utf8)) }
        #expect(try directory.names() == ["keep", "gateway.log.1", "launcher.log.1"])
        #expect(try fixture.identity("gateway.log.1") == priorGateway)
        #expect(try fixture.identity("launcher.log.1") == priorLauncher)
        #expect(try fixture.identity("keep") == preserved)
        #expect(try fixture.bytes("gateway.log.1") == original)
        #expect(try fixture.bytes("launcher.log.1") == original)
        #expect(try fixture.bytes("keep") == original)
    }

    @Test func replacedRootAndLockedParentCannotReceiveRecords() throws {
        let fixture = try DiagnosticFixture()
        defer { fixture.scratch.remove() }
        let log = fixture.directory
        let oldBytes = Data("old\n".utf8)
        let written = try fixture.write("launcher.log", oldBytes)
        let record = Data("new record\n".utf8)

        try withExtendedLifetime(try OwnedDescriptor(open(log.parent.path, O_RDONLY | O_DIRECTORY))) { lock in
            try #require(flock(lock.fd, LOCK_EX | LOCK_NB) == 0)
            #expect(throws: FileRefusal.self) { try log.appendLauncherRecord(record) }
            #expect(try fixture.bytes("launcher.log") == oldBytes)
        }

        try #require(renameat(log.parent.fd, "logs", log.parent.fd, "retired") == 0)
        let replacement = try log.parent.createDirectory("logs")
        #expect(replacement.identity != log.root.identity)
        try writeAll(replacement.createFile("keep"), record)
        #expect(throws: FileRefusal.self) { try log.gatewayAdmission() }
        #expect(throws: FileRefusal.self) { try log.appendLauncherRecord(record) }
        let retired = try log.parent.child("retired")
        #expect(retired.identity == log.root.identity)
        #expect(try retired.named("launcher.log").map(FileIdentity.init) == written)
        #expect(try readBounded(retired.openRegular("launcher.log"), maximum: 4_096) == oldBytes)
        #expect(try replacement.names() == ["keep"])
        #expect(try readBounded(replacement.openRegular("keep"), maximum: 4_096) == record)
    }
}
