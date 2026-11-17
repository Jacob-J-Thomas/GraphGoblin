import Foundation
import LauncherEngine

struct InstallerOptions {
    var appName = AppName.standard
    var node: String?
    var dataDirectory: String?
    var port: UInt16 = 4747
    var requireAPIKey = false
    var ollamaEnabled = true
    var codexBinary: String?
    var claudeBinary: String?

    static let usage = """
        Usage: scripts/install-macos-launcher.sh [--app-name BASENAME.app] [--node ABS_PATH]
               [--data-dir ABS_PATH] [--port N] [--require-api-key] [--disable-ollama]
               [--codex-binary ABS_PATH] [--claude-binary ABS_PATH]
               scripts/install-macos-launcher.sh --help
        """

    enum Command {
        case help
        case install(InstallerOptions)
    }

    static func parse(_ arguments: [String]) throws -> Command {
        if arguments == ["--help"] { return .help }
        var options = Self()
        var seen = Set<String>()
        var index = 0
        while index < arguments.count {
            let flag = arguments[index]
            index += 1
            guard seen.insert(flag).inserted else { throw InstallerRefusal.usage }
            switch flag {
            case "--require-api-key":
                options.requireAPIKey = true
            case "--disable-ollama":
                options.ollamaEnabled = false
            case "--app-name", "--node", "--data-dir", "--port", "--codex-binary", "--claude-binary":
                guard index < arguments.count else { throw InstallerRefusal.usage }
                let value = arguments[index]
                index += 1
                if flag == "--app-name" {
                    do {
                        options.appName = try AppName.normalize(value)
                    } catch {
                        throw InstallerRefusal.usage
                    }
                } else if flag == "--port" {
                    guard !value.isEmpty, value.utf8.allSatisfy({ (48...57).contains($0) }),
                          let port = UInt16(value), port > 0 else { throw InstallerRefusal.usage }
                    options.port = port
                } else {
                    guard absolutePath(value) else { throw InstallerRefusal.usage }
                    switch flag {
                    case "--node": options.node = value
                    case "--data-dir": options.dataDirectory = value
                    case "--codex-binary": options.codexBinary = value
                    case "--claude-binary": options.claudeBinary = value
                    default: throw InstallerRefusal.usage
                    }
                }
            default:
                throw InstallerRefusal.usage
            }
        }
        return .install(options)
    }
}

enum InstallerRefusal: Error, Equatable {
    case usage
    case runtime
    case setup
    case assets
    case key
    case helper
    case destination
    case staging

    var text: String {
        switch self {
        case .usage: InstallerOptions.usage
        case .runtime: "Choose a native Apple Silicon Node 22.22.2 or later within major 22 with --node."
        case .setup: "Check the saved checkout and built apps/api/dist entries, then install again."
        case .assets: "Build both apps/web/dist and apps/web/dist-goblin before installing."
        case .key: "This installer requires the local database and its data-directory master.key, or a fresh store."
        case .helper: "The built API identity helper could not be verified. Rebuild the checkout and check the local runtime."
        case .destination: "The Applications destination could not be authorized for this installation."
        case .staging: "The candidate bundle could not be staged and verified."
        }
    }
}

package struct InstallerResult {
    package let output: String
    package let exitCode: Int32

    fileprivate init(_ output: String, _ exitCode: Int32) {
        self.output = output
        self.exitCode = exitCode
    }

    static func success(_ text: String) -> Self { Self(text, 0) }

    static func refused(_ reason: InstallerRefusal) -> Self {
        Self(reason.text, reason == .usage ? 64 : 1)
    }

    static func publicationFailed(_ verified: PublishDisposition) -> Self {
        let message: String
        switch verified {
        case .previousInstallVerified: message = "Publication failed. The previous installation was verified."
        case .targetAbsentVerified: message = "Publication failed. The installation destination was verified absent."
        case .recoveryRequired: message = "Publication could not be verified. Installer recovery is required."
        case .published: message = "Publication could not be verified. Installer recovery is required."
        }
        return Self(message, 1)
    }
}
