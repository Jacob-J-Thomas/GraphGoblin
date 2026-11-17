import Darwin
import Dispatch
import Foundation
@testable import LauncherEngine
import Testing

@Suite struct ChildTests {
    @Test func nulInArgumentsOrEnvironmentIsRefusedBeforeSpawning() throws {
        try normalizeChildStatusDisposition()
        let scratch = try TemporaryEngineDirectory()
        defer { scratch.remove() }
        let cwd = scratch.root.path
        let program = #"printf '%s|%s\n' "$1" "$CANARY" > spawned"#
        let arguments = ["-c", program, "fixture"]
        for (argument, environment) in [("visible\0hidden", "intact"), ("visible", "intact\0hidden")] {
            do {
                _ = try captureReadOnly(
                    executable: "/bin/sh", arguments: arguments + [argument],
                    cwd: cwd, environment: ["CANARY": environment], time: AttemptTime(seconds: 3)
                )
                Issue.record("The helper accepted an embedded NUL")
            } catch ChildSpawnError.noChild {
                #expect(try scratch.root.named("spawned") == nil)
            }
        }
        let valid = try captureReadOnly(
            executable: "/bin/sh", arguments: arguments + ["visible"],
            cwd: cwd, environment: ["CANARY": "intact"], time: AttemptTime(seconds: 3)
        )
        #expect(valid.exitCode == 0)
        #expect(valid.stdout.isEmpty && valid.stderr.isEmpty)
        #expect(try readBounded(scratch.root.openRegular("spawned"), maximum: 64)
                == Data("visible|intact\n".utf8))
        #expect(try scratch.root.names() == ["spawned"])
    }

    @Test func twoStreamsAndVerifiedExit() throws {
        try normalizeChildStatusDisposition()
        let output = try captureReadOnly(
            executable: "/bin/sh", arguments: ["-c", "printf 'out\\n'; printf 'err\\n' >&2; exit 7"],
            cwd: "/private/tmp", environment: [:], time: AttemptTime(seconds: 3), requireExitZero: false
        )
        #expect(output.exitCode == 7)
        #expect(output.stdout == Data("out\n".utf8))
        #expect(output.stderr == Data("err\n".utf8))
        #expect(throws: OperationRefusal.self) {
            try captureReadOnly(executable: "/bin/sh", arguments: ["-c", "exit 7"], cwd: "/private/tmp",
                                environment: [:], time: AttemptTime(seconds: 3))
        }
    }

    @Test func overflowingHeaderAndHangingHelperAreBounded() async throws {
        try normalizeChildStatusDisposition()
        let options: [String] = ["-c", "while :; do printf 'xxxxxxxxxxxxxxxxxxxxxxxxxxxx'; done"]
        #expect(throws: OperationRefusal.self) {
            try captureReadOnly(executable: "/bin/sh", arguments: options, cwd: "/private/tmp",
                                environment: [:], time: AttemptTime(seconds: 3))
        }
        let scratch = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: scratch, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: scratch) }
        let pidFile = scratch.appendingPathComponent("pid")
        let state = AttemptState()
        async let result = withCheckedContinuation { (done: CheckedContinuation<Bool, Never>) in
            DispatchQueue.global().async {
                do {
                    _ = try captureReadOnly(
                        executable: "/bin/sh",
                        arguments: ["-c", #"printf '%s\n' "$$" > "$1"; while :; do :; done"#, "capture", pidFile.path],
                        cwd: "/private/tmp", environment: [:], time: AttemptTime(seconds: 5), quitting: { state.quitting }
                    )
                    done.resume(returning: false)
                } catch OperationRefusal.cancelled {
                    done.resume(returning: true)
                } catch {
                    done.resume(returning: false)
                }
            }
        }
        var ownedPID: pid_t?
        for _ in 0..<100 {
            if let data = try? String(contentsOf: pidFile, encoding: .utf8),
               let pid = pid_t(data.trimmingCharacters(in: .whitespacesAndNewlines)), pid > 0 {
                ownedPID = pid
                break
            }
            try await Task.sleep(for: .milliseconds(20))
        }
        state.requestQuit()
        let cancelled = await result
        #expect(cancelled)
        let child = try #require(ownedPID)
        // Production reaps this exact process; both kernel observations are independent of the reported outcome.
        #expect(kill(child, 0) == -1)
        var status: Int32 = 0
        let waited = waitpid(child, &status, WNOHANG)
        let cause = errno
        #expect(waited == -1)
        #expect(cause == ECHILD)
    }
}
