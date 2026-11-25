import Darwin
import Foundation
@testable import LauncherEngine
import Testing

@Suite struct NativeFilesTests {
    @Test func directoryRefusalsLeaveExistingEntriesIntact() throws {
        let scratch = try TemporaryEngineDirectory()
        defer { scratch.remove() }
        let root = scratch.root
        let child = try root.createDirectory("owned")
        #expect(try root.ensureDirectory("owned").identity == child.identity)
        #expect(try root.named("absent") == nil)

        #expect(throws: FileRefusal.self) { try canonicalPath("relative") }
        #expect(throws: FileRefusal.self) { try Directory(path: "relative") }
        #expect(throws: FileRefusal.self) { try Directory(path: root.path + "/./owned") }
        #expect(throws: FileRefusal.self) { try root.named("../owned") }
        #expect(throws: FileRefusal.self) { try root.createDirectory("owned/unsafe") }
        #expect(throws: FileRefusal.self) { try root.createFile("owned/unsafe") }
        do {
            _ = try root.createDirectory("owned")
            Issue.record("An exclusive directory create replaced an existing directory")
        } catch FileRefusal.system(let code) {
            #expect(code == EEXIST)
        }

        try #require(fchmod(child.fd, 0o755) == 0)
        defer { _ = fchmod(child.fd, 0o700) }
        try child.requireOwnedDirectory()
        #expect(throws: FileRefusal.self) { try child.requireOwnedDirectory(privateMode: true) }
        #expect(try root.child("owned").identity == child.identity)
        #expect(try root.names() == ["owned"])
        #expect(try child.names().isEmpty)
    }

    @Test func namedFileCannotFollowAnInodeReplacement() throws {
        let scratch = try TemporaryEngineDirectory()
        defer { scratch.remove() }
        let root = scratch.root
        let original = Data("original".utf8)
        let replacement = Data("replacement".utf8)
        try writeAll(root.createFile("slot"), original)
        let open = try root.openRegular("slot", privateMode: true)
        let openIdentity = FileIdentity(try open.metadata())
        try root.match("slot", open, privateMode: true)
        try #require(renameat(root.fd, "slot", root.fd, "retired") == 0)
        let fresh = try root.createFile("slot")
        try writeAll(fresh, replacement)

        #expect(FileIdentity(try fresh.metadata()) != openIdentity)
        #expect(throws: FileRefusal.self) { try root.match("slot", open, privateMode: true) }
        try root.match("retired", open, privateMode: true)
        #expect(try readBounded(open, maximum: original.count) == original)
        #expect(try readBounded(root.openRegular("slot"), maximum: replacement.count) == replacement)
        #expect(try root.names() == ["slot", "retired"])
    }

    @Test func boundedIOAndDescriptorPermissionsPreserveBytesAndIdentity() throws {
        let scratch = try TemporaryEngineDirectory()
        defer { scratch.remove() }
        let root = scratch.root
        let bytes = Data("abc".utf8)
        let file = try root.createFile("record")
        try writeAll(file, bytes)
        let identity = FileIdentity(try file.metadata())
        let exactHash = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        #expect(try readBounded(root.openRegular("record"), maximum: 3) == bytes)
        #expect(try fileSHA256(root.openRegular("record"), cap: 3) == exactHash)
        #expect(throws: FileRefusal.self) { try readBounded(root.openRegular("record"), maximum: 2) }
        #expect(throws: FileRefusal.self) { try fileSHA256(root.openRegular("record"), cap: 2) }

        let writeOnly = try OwnedDescriptor(openat(root.fd, "record", O_WRONLY | O_NOFOLLOW | O_CLOEXEC))
        let readOnly = try root.openRegular("record")
        let refused: [() throws -> Void] = [
            { _ = try readBounded(writeOnly, maximum: 3) },
            { _ = try fileSHA256(writeOnly, cap: 3) },
            { try writeAll(readOnly, Data("edit".utf8)) }
        ]
        for operation in refused {
            do {
                try operation()
                Issue.record("A descriptor operation accepted the wrong access mode")
            } catch FileRefusal.system(let code) {
                #expect(code == EBADF)
            }
        }
        #expect(try root.named("record").map(FileIdentity.init) == identity)
        #expect(try readBounded(root.openRegular("record"), maximum: 3) == bytes)
        #expect(try root.names() == ["record"])
    }
}
