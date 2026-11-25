import Darwin
import Foundation

enum StoreState {
    case free
    case held
}

struct LaunchInputs: Sendable {
    let installation: VerifiedInstallation
    let environment: [String: String]
    let main: String
    let helper: String
    let appHTML: Data
    let goblinHTML: Data

    var config: LauncherConfiguration { installation.contents.configuration }

    init(_ installation: VerifiedInstallation) throws {
        self.installation = installation
        let config = installation.contents.configuration
        do {
            guard try canonicalPath(config.checkout) == config.checkout,
                  try canonicalProspectiveDirectory(config.dataDirectory) == config.dataDirectory else {
                throw FileRefusal.invalid
            }
            _ = try Directory(path: config.checkout)
        } catch {
            throw LaunchRefusal(.installationInvalid)
        }
        do {
            guard try canonicalExecutable(config.node) == config.node else {
                throw FileRefusal.invalid
            }
        } catch {
            throw LaunchRefusal(.runtimeUnavailable)
        }
        for binary in [config.codexBinary, config.claudeBinary].compactMap({ $0 }) {
            guard (try? canonicalExecutable(binary)) == binary else { throw LaunchRefusal(.installationInvalid) }
        }

        let distribution = config.checkout + "/apps/api/dist"
        main = try Self.requireBuiltFile(distribution + "/main.js")
        helper = try Self.requireBuiltFile(distribution + "/instance-identity.js")
        let marker = Data("export const MACOS_LAUNCHER_LOG_PROTOCOL = 1;".utf8)
        guard let entry = try? OwnedDescriptor(open(main, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC))
        else { throw LaunchRefusal(.installationInvalid) }
        var prefix = [UInt8](repeating: 0, count: 4_096)
        let count = prefix.withUnsafeMutableBytes { read(entry.fd, $0.baseAddress, $0.count) }
        guard count > 0, Data(prefix.prefix(count)).range(of: marker) != nil else {
            throw LaunchRefusal(.installationInvalid)
        }
        for relative in ["macos-log/guard.js", "managed-log/guard.js", "managed-log/gateway-log-writer.js"] {
            _ = try Self.requireBuiltFile(distribution + "/" + relative)
        }

        let web = config.checkout + "/apps/web/dist"
        let goblin = config.checkout + "/apps/web/dist-goblin"
        do {
            appHTML = try Self.shell(web + "/index.html")
            goblinHTML = try Self.shell(goblin + "/index.html")
        } catch {
            throw LaunchRefusal(.assetsUnavailable)
        }

        var env = [
            "HOME": installation.home,
            "PATH": URL(fileURLWithPath: config.node).deletingLastPathComponent().path + ":/usr/bin:/bin:/usr/sbin:/sbin",
            "LANG": Self.locale(),
            "GG_HOST": "127.0.0.1",
            "GG_PORT": String(config.port),
            "GG_DATA_DIR": config.dataDirectory,
            "GG_WEB_DIST": web,
            "GG_GOBLIN_DIST": goblin,
            "GG_DB_URL": config.databaseURI,
            "GG_REQUIRE_API_KEY": config.requireAPIKey ? "true" : "false",
            "GG_OLLAMA_ENABLED": config.ollamaEnabled ? "true" : "false"
        ]
        if let temp = Self.temporaryDirectory() { env["TMPDIR"] = temp }
        if let codex = config.codexBinary { env["GG_CODEX_BINARY"] = codex }
        if let claude = config.claudeBinary { env["GG_CLAUDE_BINARY"] = claude }
        environment = env
    }

    private static func locale() -> String {
        let raw = ProcessInfo.processInfo.environment["LANG"] ?? ""
        let valid = !raw.isEmpty && raw.utf8.count <= 64 && raw.utf8.allSatisfy {
            (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) || [95, 46, 64, 45].contains($0)
        }
        return valid ? raw : "en_US.UTF-8"
    }

    private static func temporaryDirectory() -> String? {
        let key = Int32(_CS_DARWIN_USER_TEMP_DIR)
        let capacity = confstr(key, nil, 0)
        guard capacity > 0, capacity <= 4_096 else { return nil }
        var result = [CChar](repeating: 0, count: capacity)
        let length = result.withUnsafeMutableBufferPointer { confstr(key, $0.baseAddress, $0.count) }
        guard length == capacity,
              let value = result.withUnsafeBufferPointer({ String(validatingCString: $0.baseAddress!) }),
              let physical = try? canonicalPath(value),
              let directory = try? Directory(path: physical),
              (try? directory.requireOwnedDirectory(privateMode: true)) != nil else { return nil }
        return physical
    }

    private static func requireBuiltFile(_ path: String) throws -> String {
        do {
            var info = stat()
            guard try canonicalPath(path) == path, lstat(path, &info) == 0,
                  fileKind(info, S_IFREG), info.st_size > 0, access(path, R_OK) == 0 else {
                throw FileRefusal.invalid
            }
            return path
        } catch {
            throw LaunchRefusal(.installationInvalid)
        }
    }

    private static func shell(_ path: String) throws -> Data {
        let file = try OwnedDescriptor(open(try requireBuiltFile(path), O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC))
        let data = try readBounded(file, maximum: 1_048_576)
        guard !data.isEmpty else { throw FileRefusal.invalid }
        return data
    }

    func requireLocalKey() throws {
        do {
            var info = stat()
            if lstat(config.dataDirectory, &info) != 0 {
                guard errno == ENOENT, try canonicalProspectiveDirectory(config.dataDirectory) == config.dataDirectory
                else { throw FileRefusal.invalid }
                return
            }
            let directory = try Directory(path: config.dataDirectory)
            try directory.requireOwnedDirectory()
            if let entry = try directory.named("graphgoblin.db") {
                guard fileKind(entry, S_IFREG), entry.st_uid == geteuid(), entry.st_nlink == 1 else {
                    throw FileRefusal.invalid
                }
            }
            if let key = try directory.named("master.key") {
                let handle = try OwnedDescriptor(openat(
                    directory.fd, "master.key", O_EVTONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC
                ))
                let actual = try handle.metadata()
                guard fileKind(actual, S_IFREG), actual.st_uid == geteuid(),
                      FileIdentity(actual) == FileIdentity(key),
                      try directory.named("master.key").map(FileIdentity.init) == FileIdentity(actual) else {
                    throw FileRefusal.invalid
                }
            } else {
                guard try directory.names().isEmpty else { throw FileRefusal.invalid }
            }
            try directory.requireAnchored()
        } catch {
            throw LaunchRefusal(.keySourceUnavailable)
        }
    }

    func verifyRuntime(_ limit: OperationLimit) throws {
        let expression = #"process.stdout.write(process.platform + "," + process.arch + "," + process.versions.node + "\n")"#
        do {
            let line = try capture(["-e", expression], limit: limit)
            guard Self.runtimeSupported(line) else { throw OperationRefusal.invalid }
        } catch OperationRefusal.cancelled {
            throw OperationRefusal.cancelled
        } catch OperationRefusal.deadline {
            throw OperationRefusal.deadline
        } catch {
            throw LaunchRefusal(.runtimeUnavailable)
        }
    }

    static func runtimeSupported(_ line: String) -> Bool {
        let parts = line.split(separator: ",", omittingEmptySubsequences: false)
        guard parts.count == 3, parts[0] == "darwin", parts[1] == "arm64" else { return false }
        let version = parts[2].split(separator: ".", omittingEmptySubsequences: false)
        guard version.count == 3, version[0] == "22",
              let minor = Int(version[1]), let patch = Int(version[2]),
              String(minor) == version[1], String(patch) == version[2], patch >= 0 else { return false }
        return minor > 22 || (minor == 22 && patch >= 2)
    }

    func fingerprint(_ limit: OperationLimit) throws -> String {
        do {
            let line = try capture([helper], limit: limit)
            guard asciiHex(line, count: 64) else { throw OperationRefusal.invalid }
            return line
        } catch OperationRefusal.cancelled {
            throw OperationRefusal.cancelled
        } catch {
            throw LaunchRefusal(.cannotVerify)
        }
    }

    func storeState(_ limit: OperationLimit) throws -> StoreState {
        let line = try capture([helper, "--store-state"], limit: limit)
        let record = try strictObject(Data(line.utf8), required: ["state"], optional: ["path", "detail"])
        if record["state"] as? String == "free", record.count == 1 { return .free }
        if record["state"] as? String == "held", let path = record["path"] as? String,
           let detail = record["detail"] as? String, !detail.isEmpty {
            let directory = config.dataDirectory
            let writer = (directory == "/" ? "" : directory) + "/graphgoblin.lock"
            let database = config.database + ".graphgoblin.lock"
            if [writer, database, writer + ".reclaim", database + ".reclaim"].contains(path) {
                return .held
            }
        }
        throw OperationRefusal.invalid
    }

    private func capture(_ arguments: [String], limit: OperationLimit) throws -> String {
        let result = try captureReadOnly(executable: config.node, arguments: arguments,
                                         cwd: config.checkout, environment: environment, time: limit.time,
                                         quitting: limit.quitting)
        guard result.stderr.isEmpty, result.stdout.last == 10,
              !result.stdout.dropLast().contains(10), !result.stdout.contains(13),
              let line = String(data: result.stdout.dropLast(), encoding: .utf8), !line.isEmpty else {
            throw OperationRefusal.invalid
        }
        return line
    }

    func gateway(admission: String) -> SpawnCommand {
        var env = environment
        env["GG_MACOS_LAUNCHER_LOG_ADMISSION"] = admission
        return SpawnCommand(executable: config.node, arguments: [main], cwd: config.checkout, environment: env)
    }
}
