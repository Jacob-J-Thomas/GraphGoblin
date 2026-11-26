import Darwin
import Foundation
import LaunchContract

package struct HeadlessResult: Sendable {
    package let code: String
    package let exitCode: Int32
    let port: UInt16?

    private init(_ code: String, _ exitCode: Int32, port: UInt16? = nil) {
        self.code = code
        self.exitCode = exitCode
        self.port = port
    }

    package static let usage = Self("usage", 64)
    package static let installationValid = Self("installation-valid", 0)

    package init(_ outcome: LaunchOutcome) {
        switch outcome {
        case .openManagement(let port, .running): self.init("open-management-running", 0, port: port)
        case .openManagement(let port, .observingShutdown): self.init("open-management-observe-shutdown", 0, port: port)
        case .installationInvalid: self.init("installation-invalid", 10)
        case .runtimeUnavailable: self.init("runtime-unavailable", 11)
        case .assetsUnavailable: self.init("assets-unavailable", 12)
        case .keySourceUnavailable: self.init("key-source-unavailable", 13)
        case .portInUse(let port): self.init("port-in-use", 20, port: port)
        case .storeBlocked: self.init("store-blocked", 21)
        case .cannotVerify: self.init("cannot-verify", 22)
        case .launchBusy: self.init("launch-busy", 23)
        case .releaseUnconfirmed: self.init("release-unconfirmed", 24)
        case .diagnosticsUnavailable: self.init("diagnostics-unavailable", 25)
        case .startFailed: self.init("start-failed", 30)
        case .childExited: self.init("child-exited", 31)
        case .startTimedOut: self.init("start-timed-out", 32)
        case .startupUnverified: self.init("startup-unverified", 33)
        case .cancelled: self.init("cancelled", 40)
        case .unexpected: self.init("unexpected", 70)
        }
    }

    package var bytes: Data {
        let portField = port.map { ",\"port\":\($0)" } ?? ""
        return Data(("{\"version\":1,\"code\":\"\(code)\"\(portField)}\n").utf8)
    }

    package func printAndExit() -> Never {
        bytes.withUnsafeBytes { buffer in
            var offset = 0
            while offset < buffer.count {
                let written = write(STDOUT_FILENO, buffer.baseAddress!.advanced(by: offset), buffer.count - offset)
                if written < 0 && errno == EINTR { continue }
                guard written > 0 else { break }
                offset += written
            }
        }
        exit(exitCode)
    }
}
