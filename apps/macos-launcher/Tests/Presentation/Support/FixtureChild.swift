import Darwin
import Foundation
import Synchronization
import Testing

/// One finished run of the `PresentationFixture` child process.
struct FixtureRun: Sendable {
    static let markerPrefix = "gg-fixture: "
    static let elapsedPrefix = "fixture.quit-elapsed-ms="

    let launchError: String?
    let timedOut: Bool
    /// Foundation signalled the child's termination and itself reports it no longer running.
    /// Only then are `exitedNormally` and `status` read from the process.
    let exitObserved: Bool
    let streamsClosed: Bool
    let exitedNormally: Bool
    let status: Int32
    let stdout: String
    let stderr: String

    /// Every marker the child wrote, in order.
    var markers: [String] {
        stdout.split(separator: "\n").compactMap { line in
            line.hasPrefix(Self.markerPrefix) ? String(line.dropFirst(Self.markerPrefix.count)) : nil
        }
    }

    /// The markers without the measured Quit timing.
    var events: [String] {
        markers.filter { !$0.hasPrefix(Self.elapsedPrefix) }
    }

    /// Milliseconds from the simulated Quit to `NSApplication.willTerminateNotification`.
    var quitToTerminationMilliseconds: Int? {
        markers.first { $0.hasPrefix(Self.elapsedPrefix) }.flatMap { Int($0.dropFirst(Self.elapsedPrefix.count)) }
    }

    var diagnostics: String {
        """
        launchError=\(launchError ?? "none") timedOut=\(timedOut) exitObserved=\(exitObserved) \
        streamsClosed=\(streamsClosed) exitedNormally=\(exitedNormally) status=\(status)
        stdout:
        \(stdout)
        stderr:
        \(stderr)
        """
    }

    /// The child ended by its own exit with status 0 within the deadline, and both of its
    /// output streams reached end of file.
    func expectCleanExit(sourceLocation: SourceLocation = #_sourceLocation) {
        #expect(launchError == nil, "\(diagnostics)", sourceLocation: sourceLocation)
        #expect(!timedOut, "\(diagnostics)", sourceLocation: sourceLocation)
        #expect(streamsClosed, "\(diagnostics)", sourceLocation: sourceLocation)
        #expect(exitedNormally, "\(diagnostics)", sourceLocation: sourceLocation)
        #expect(status == 0, "\(diagnostics)", sourceLocation: sourceLocation)
    }
}

/// Starts the `PresentationFixture` executable as a directly tracked child and collects its
/// result. Only that child is ever signalled, and only while Foundation still reports it running.
enum FixtureLaunch {
    /// Built next to the test bundle, as the implicit product of its executable target.
    static var executableURL: URL {
        Bundle(for: EventsProbe.self).bundleURL
            .deletingLastPathComponent()
            .appendingPathComponent("PresentationFixture", isDirectory: false)
    }

    static func run(_ scenario: String, timeout: Duration = .seconds(30)) async throws -> FixtureRun {
        try #require(["cancelled", "progress-menu-quit", "panel-quit-grace", "failure-ok"].contains(scenario))
        let url = executableURL
        try #require(
            FileManager.default.isExecutableFile(atPath: url.path),
            "The PresentationFixture executable target is not built next to the test bundle: \(url.path)"
        )
        return await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                continuation.resume(returning: runToEnd(url: url, arguments: [scenario], timeout: timeout))
            }
        }
    }

    /// Blocks a dispatch thread (never the cooperative pool) until the child has exited and
    /// both streams are closed, or the deadline and each bounded cleanup phase after it have
    /// passed. A child whose exit was not observed by then is reported as such, and its
    /// termination reason and status are never read.
    private static func runToEnd(url: URL, arguments: [String], timeout: Duration) -> FixtureRun {
        let process = Process()
        process.executableURL = url
        process.arguments = arguments
        // The coverage collector owns this fresh private directory. Keep one normal-exit
        // profile per serialized scenario, outside SwiftPM's own merge directory.
        var environment = ProcessInfo.processInfo.environment
        if let profiles = environment["GG_MACOS_COVERAGE_PRESENTATION_PROFILES"] {
            environment["LLVM_PROFILE_FILE"] = URL(fileURLWithPath: profiles, isDirectory: true)
                .appendingPathComponent(arguments[0] + ".profraw").path
        }
        process.environment = environment
        process.standardInput = FileHandle.nullDevice
        let output = Pipe()
        let errors = Pipe()
        process.standardOutput = output
        process.standardError = errors
        let exited = DispatchSemaphore(value: 0)
        process.terminationHandler = { _ in
            exited.signal()
        }
        do {
            try process.run()
        } catch {
            return FixtureRun(
                launchError: String(describing: error), timedOut: false, exitObserved: false,
                streamsClosed: false, exitedNormally: false, status: -1, stdout: "", stderr: ""
            )
        }

        let collected = CollectedStreams()
        let reads = DispatchGroup()
        let descriptors = [output.fileHandleForReading.fileDescriptor, errors.fileHandleForReading.fileDescriptor]
        for (index, descriptor) in descriptors.enumerated() {
            reads.enter()
            DispatchQueue.global(qos: .userInitiated).async {
                collected.store(readToEnd(descriptor), at: index)
                reads.leave()
            }
        }

        var timedOut = false
        var signalled = exited.wait(timeout: .now() + dispatchInterval(timeout)) == .success
        if !signalled {
            timedOut = true
            if process.isRunning {
                process.terminate()
            }
            signalled = exited.wait(timeout: .now() + .seconds(5)) == .success
            if !signalled {
                if process.isRunning {
                    kill(process.processIdentifier, SIGKILL)
                }
                signalled = exited.wait(timeout: .now() + .seconds(5)) == .success
            }
        }
        // The termination handler alone is not taken as proof of exit: Foundation must also
        // report the child no longer running, which is when its reason and status are readable.
        let exitObserved = signalled && runningEnds(process, within: .seconds(5))
        if !exitObserved {
            // Foundation may still be tracking the child and may still call the termination
            // handler: keep the process alive rather than release it under either.
            _ = Unmanaged.passRetained(process)
        }
        let readsFinished = reads.wait(timeout: .now() + .seconds(5)) == .success
        if !readsFinished {
            // A reader is still blocked on these descriptors: keep them open rather than let
            // their numbers be reused under it.
            _ = Unmanaged.passRetained(output)
            _ = Unmanaged.passRetained(errors)
        }
        let streams = collected.snapshot()
        return FixtureRun(
            launchError: nil,
            timedOut: timedOut,
            exitObserved: exitObserved,
            streamsClosed: readsFinished && streams.allSatisfy { $0.reachedEOF },
            exitedNormally: exitObserved ? process.terminationReason == .exit : false,
            status: exitObserved ? process.terminationStatus : -1,
            stdout: String(decoding: streams[0].bytes, as: UTF8.self),
            stderr: String(decoding: streams[1].bytes, as: UTF8.self)
        )
    }

    /// Waits at most `interval` for Foundation's own record of the child to show it no longer
    /// running. Reads that record only; never reaps or signals anything itself.
    private static func runningEnds(_ process: Process, within interval: DispatchTimeInterval) -> Bool {
        let deadline = DispatchTime.now() + interval
        while process.isRunning {
            guard DispatchTime.now() < deadline else { return false }
            usleep(1_000)
        }
        return true
    }

    private static func readToEnd(_ descriptor: Int32) -> FixtureStream {
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 16_384)
        while true {
            let count = buffer.withUnsafeMutableBytes { Darwin.read(descriptor, $0.baseAddress, $0.count) }
            if count > 0 {
                guard data.count + count <= 1_048_576 else {
                    return FixtureStream(bytes: data, reachedEOF: false)
                }
                data.append(contentsOf: buffer[0..<count])
            } else if count < 0, errno == EINTR {
                continue
            } else {
                return FixtureStream(bytes: data, reachedEOF: count == 0)
            }
        }
    }

    private static func dispatchInterval(_ duration: Duration) -> DispatchTimeInterval {
        let (seconds, attoseconds) = duration.components
        return .milliseconds(Int(seconds) * 1_000 + Int(attoseconds / 1_000_000_000_000_000))
    }
}

struct FixtureStream: Sendable {
    let bytes: Data
    let reachedEOF: Bool
}

final class CollectedStreams: Sendable {
    private let streams = Mutex<[FixtureStream]>([
        FixtureStream(bytes: Data(), reachedEOF: false),
        FixtureStream(bytes: Data(), reachedEOF: false)
    ])

    func store(_ data: FixtureStream, at index: Int) {
        streams.withLock { $0[index] = data }
    }

    func snapshot() -> [FixtureStream] {
        streams.withLock { $0 }
    }
}
