import Darwin
import Foundation
import Synchronization
import LaunchContract
@testable import LauncherEngine
import Testing

@Suite struct EngineContractsTests {
    private final class DiagnosticRecords: Sendable {
        private let values = Mutex<[Data]>([])

        func append(_ data: Data) { values.withLock { $0.append(data) } }

        var snapshot: [Data] { values.withLock { $0 } }
    }

    @Test func exactHeadlessEnvelopes() {
        let cases: [(LaunchOutcome, Int32, String, UInt16?)] = [
            (.openManagement(port: 1, mode: .running), 0, "open-management-running", 1),
            (.openManagement(port: 65535, mode: .observingShutdown), 0, "open-management-observe-shutdown", 65535),
            (.installationInvalid, 10, "installation-invalid", nil),
            (.runtimeUnavailable, 11, "runtime-unavailable", nil),
            (.assetsUnavailable, 12, "assets-unavailable", nil),
            (.keySourceUnavailable, 13, "key-source-unavailable", nil),
            (.portInUse(port: 45123), 20, "port-in-use", 45123),
            (.storeBlocked, 21, "store-blocked", nil),
            (.cannotVerify, 22, "cannot-verify", nil),
            (.launchBusy, 23, "launch-busy", nil),
            (.releaseUnconfirmed, 24, "release-unconfirmed", nil),
            (.diagnosticsUnavailable, 25, "diagnostics-unavailable", nil),
            (.startFailed, 30, "start-failed", nil),
            (.childExited, 31, "child-exited", nil),
            (.startTimedOut, 32, "start-timed-out", nil),
            (.startupUnverified, 33, "startup-unverified", nil),
            (.cancelled, 40, "cancelled", nil),
            (.unexpected, 70, "unexpected", nil)
        ]
        for (outcome, code, name, port) in cases {
            let output = HeadlessResult(outcome)
            let field = port.map { ",\"port\":" + String($0) } ?? ""
            #expect(output.bytes == Data(("{\"version\":1,\"code\":\"" + name + "\"" + field + "}\n").utf8))
            #expect(output.exitCode == code)
        }
        #expect(HeadlessResult.installationValid.bytes == Data("{\"version\":1,\"code\":\"installation-valid\"}\n".utf8))
        #expect(HeadlessResult.usage.bytes == Data("{\"version\":1,\"code\":\"usage\"}\n".utf8))
        #expect(HeadlessResult.usage.exitCode == 64)
    }

    @Test func swiftAndDarwinUnsignedIdentityVectors() throws {
        let vectors: [(dev_t, ino_t, String, String)] = [
            (0, 0, "0", "0"),
            (16777228, 16777228, "16777228", "16777228"),
            (Int32.max, 9007199254740993, "2147483647", "9007199254740993"),
            (Int32.min, 9223372036854775807, "18446744071562067968", "9223372036854775807"),
            (-1, 9223372036854775808, "18446744073709551615", "9223372036854775808"),
            (-1, 9223372036854775809, "18446744073709551615", "9223372036854775809"),
            (-1, UInt64.max, "18446744073709551615", "18446744073709551615")
        ]
        for (device, inode, deviceText, inodeText) in vectors {
            let text = try admissionDocument(path: "/private/logs α", identity: FileIdentity(device: device, inode: inode))
            let object = try strictObject(Data(text.utf8), required: ["version", "root", "device", "inode"])
            #expect(jsonInteger(object["version"], range: 1...1) == 1)
            #expect(object["root"] as? String == "/private/logs α")
            #expect(object["device"] as? String == deviceText)
            #expect(object["inode"] as? String == inodeText)
        }
        #expect(throws: FileRefusal.self) {
            try admissionDocument(path: "/" + String(repeating: "x", count: 4096),
                                  identity: FileIdentity(device: 0, inode: 0))
        }
    }

    @Test func commitAndQuitBothOrders() {
        let budget = AttemptTime(seconds: 1)
        let interrupted = AttemptState()
        #expect(interrupted.begin())
        #expect(!interrupted.begin())
        interrupted.requestQuit()
        #expect(!interrupted.commit(before: budget))
        #expect(!interrupted.didCommit)

        let committed = AttemptState()
        #expect(committed.begin())
        #expect(committed.commit(before: budget))
        committed.requestQuit()
        #expect(committed.quitting)
        #expect(committed.didCommit)
        #expect(!committed.commit(before: budget))
        #expect(!AttemptState().commit(before: AttemptTime(end: 0)))
    }

    @Test func runtimeAndClosedConfig() throws {
        #expect(LaunchInputs.runtimeSupported("darwin,arm64,22.22.2"))
        #expect(LaunchInputs.runtimeSupported("darwin,arm64,22.23.0"))
        for record in ["darwin,x64,22.22.2", "linux,arm64,22.22.2", "darwin,arm64,22.22.1",
                       "darwin,arm64,23.0.0", "darwin,arm64,22.22.2-beta", "darwin,arm64,22.022.2"] {
            #expect(!LaunchInputs.runtimeSupported(record))
        }
        let record = #"{"version":1,"checkout":"/checkout","node":"/node","dataDirectory":"/data α%#?","port":4747,"requireAPIKey":false,"ollamaEnabled":true}"#
        let parsed = try LauncherConfiguration(data: Data(record.utf8))
        #expect(parsed.databaseURI == "file:///data%20%CE%B1%25%23%3F/graphgoblin.db")
        let secret = record.replacingOccurrences(of: #""version":1"#, with: #""version":1,"GG_MASTER_KEY":"secret""#)
        let booleanPort = record.replacingOccurrences(of: "4747", with: "true")
        let numericFlag = record.replacingOccurrences(of: "false", with: "0")
        for rejected in [secret, booleanPort, numericFlag] {
            #expect(throws: FileRefusal.self) { try LauncherConfiguration(data: Data(rejected.utf8)) }
        }
    }

    @Test func failedIdentityHelperSpawnIsAnObservationFailure() throws {
        let scratch = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: scratch, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: scratch) }
        let root = try Directory(path: canonicalPath(scratch.path))
        let node = root.path + "/fixture-node"
        try writeAll(root.createFile("fixture-node", mode: 0o700),
                     Data("#!/bin/sh\nprintf '%s\\n' 'darwin,arm64,22.22.2'\n".utf8))
        for relative in [
            "apps/api/dist/main.js", "apps/api/dist/instance-identity.js", "apps/api/dist/macos-log/guard.js",
            "apps/api/dist/managed-log/guard.js", "apps/api/dist/managed-log/gateway-log-writer.js",
            "apps/web/dist/index.html", "apps/web/dist-goblin/index.html"
        ] {
            let path = URL(fileURLWithPath: root.path + "/" + relative)
            try FileManager.default.createDirectory(at: path.deletingLastPathComponent(), withIntermediateDirectories: true)
            try Data("export const MACOS_LAUNCHER_LOG_PROTOCOL = 1;\n".utf8).write(to: path)
        }
        let config = try LauncherConfiguration(
            checkout: root.path, node: node, dataDirectory: root.path + "/store", port: 4747,
            requireAPIKey: false, ollamaEnabled: false, codexBinary: nil, claudeBinary: nil
        )
        let witness = BundleWitness(bundle: root.identity, executable: "", plist: "", configuration: "")
        let contents = BundleContents(id: "", bundleID: AppName.standardBundleID, witness: witness, configuration: config)
        let inputs = try LaunchInputs(VerifiedInstallation(home: root.path, name: AppName.standard, contents: contents))
        try normalizeChildStatusDisposition()
        let limit = OperationLimit(time: AttemptTime(seconds: 3), quitting: { false })
        try inputs.verifyRuntime(limit)
        try FileManager.default.removeItem(atPath: node)

        do {
            _ = try inputs.fingerprint(limit)
            Issue.record("The removed executable must prevent starting the identity helper")
        } catch {
            let failure = classifyAttemptFailure(error, didCommit: false)
            #expect(HeadlessResult(failure.outcome).exitCode == 22)
            #expect(failure.childCategory == nil)
        }
    }

    @Test func failureClassificationDistinguishesCommittedSpawnAndLocalSetup() {
        let before = classifyAttemptFailure(ChildSpawnError.noChild, didCommit: false)
        #expect(HeadlessResult(before.outcome).exitCode == 22)
        #expect(before.childCategory == nil)
        let after = classifyAttemptFailure(ChildSpawnError.noChild, didCommit: true)
        #expect(HeadlessResult(after.outcome).exitCode == 30)
        #expect(after.childCategory == "spawn-failed")

        let localSetup = FileRefusal.system(EACCES)
        #expect(HeadlessResult(classifyAttemptFailure(localSetup, didCommit: false).outcome).exitCode == 70)
        #expect(HeadlessResult(classifyAttemptFailure(localSetup, didCommit: true).outcome).exitCode == 33)
        #expect(HeadlessResult(classifyAttemptFailure(OperationRefusal.deadline, didCommit: false).outcome).exitCode == 22)
        #expect(HeadlessResult(classifyAttemptFailure(OperationRefusal.deadline, didCommit: true).outcome).exitCode == 32)
    }

    @Test func expiredGatewayDeadlineStillRecordsTerminalFailure() {
        let engine = NativeLaunchEngine(bundlePath: "/unused")
        let records = DiagnosticRecords()
        let limit = OperationLimit(time: AttemptTime(end: 0), quitting: { false })
        do {
            try limit.check()
            Issue.record("A gateway action must not proceed after its deadline")
        } catch {
            let failure = classifyAttemptFailure(error, didCommit: true)
            engine.writeFailureDiagnostic(failure.outcome, stage: "starting", childCategory: failure.childCategory) { bytes in
                records.append(bytes)
            }
        }
        let written = records.snapshot
        #expect(written == [Data("stage=starting outcome=start-timed-out\n".utf8)])
    }

    @Test func cancelledAndQuittingAttemptsSkipFinalDiagnostics() {
        let engine = NativeLaunchEngine(bundlePath: "/unused")
        let records = DiagnosticRecords()
        engine.writeFailureDiagnostic(.cancelled, stage: "checking", childCategory: nil) { bytes in
            records.append(bytes)
        }
        engine.requestQuit()
        engine.writeFailureDiagnostic(.storeBlocked, stage: "waiting-for-store", childCategory: nil) { bytes in
            records.append(bytes)
        }
        #expect(records.snapshot.isEmpty)
    }

    @Test func healthRequiresUniqueCorrectHeadersAndExactBody() throws {
        let fingerprint = String(repeating: "a", count: 64)
        let headers = "X-GraphGoblin-Instance: \(fingerprint)\r\nX-GraphGoblin-Pid: 123\r\n"
            + "X-GraphGoblin-Phase: awaiting-choice\r\nContent-Length: 15"
        func response(_ headers: String, body: String = #"{"status":"ok"}"#) throws -> HTTPResponse {
            try HTTPResponse.parse(Data(("HTTP/1.1 200 OK\r\n" + headers + "\r\n\r\n" + body).utf8), bodyCap: 1024)
        }
        let valid = try HealthIdentity.parse(response(headers))
        #expect(valid?.fingerprint == fingerprint)
        #expect(valid?.pid == 123)
        #expect(valid?.phase == .awaitingChoice)
        #expect(try HealthIdentity.parse(response("Content-Length: 15")) == nil)
        #expect(throws: OperationRefusal.self) {
            try response(headers + "\r\nx-graphgoblin-pid: 123")
        }
        #expect(throws: OperationRefusal.self) {
            try HealthIdentity.parse(response(headers.replacingOccurrences(of: "123", with: "0")))
        }
        #expect(throws: OperationRefusal.self) {
            try HealthIdentity.parse(response(headers, body: #"{"status":"no"}"#))
        }
        #expect(GatewayPhase.ready.mode == nil)
    }
}
