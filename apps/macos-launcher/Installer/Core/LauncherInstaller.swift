import Darwin
import Foundation
import LauncherEngine

package enum LauncherInstaller {
    package static func run(_ arguments: [String], environment: [String: String]) -> InstallerResult {
        guard arguments.count >= 4, arguments[3] == "--",
              absolutePath(arguments[0]), absolutePath(arguments[1]),
              arguments[2].isEmpty || absolutePath(arguments[2])
        else { return .refused(.staging) }
        do {
            switch try InstallerOptions.parse(Array(arguments.dropFirst(4))) {
            case .help: return .success(InstallerOptions.usage)
            case .install(let options):
                return try install(
                    options, checkout: arguments[0], releaseBinary: arguments[1],
                    defaultNode: arguments[2], environment: environment
                )
            }
        } catch let error as InstallerRefusal {
            return .refused(error)
        } catch {
            return .refused(.staging)
        }
    }

    private static func install(
        _ options: InstallerOptions, checkout: String, releaseBinary: String,
        defaultNode: String, environment: [String: String]
    ) throws -> InstallerResult {
        guard environment["GG_MASTER_KEY"] == nil else { throw InstallerRefusal.key }
        let home = try authenticatedHome()
        let node = options.node ?? defaultNode
        guard (try? canonicalExecutable(node)) != nil else { throw InstallerRefusal.runtime }
        let config: LauncherConfiguration
        do {
            config = try LauncherConfiguration(
                checkout: checkout, node: node,
                dataDirectory: options.dataDirectory ?? home + "/.graphgoblin", port: options.port,
                requireAPIKey: options.requireAPIKey, ollamaEnabled: options.ollamaEnabled,
                codexBinary: options.codexBinary, claudeBinary: options.claudeBinary
            )
        } catch {
            throw InstallerRefusal.setup
        }
        if let databaseURL = environment["GG_DB_URL"] {
            guard let parts = URLComponents(string: databaseURL), parts.scheme == "file",
                  parts.user == nil, parts.password == nil, parts.port == nil, parts.query == nil,
                  parts.fragment == nil, parts.host == nil || parts.host == "" || parts.host == "localhost",
                  parts.path == config.database else { throw InstallerRefusal.key }
        }

        let applications: Directory
        do {
            applications = try InstallationFiles.applications(home: home, create: true)
            try requireSafeACL(applications.handle, ancestor: true)
            guard flock(applications.fd, LOCK_EX | LOCK_NB) == 0 else { throw FileRefusal.system(errno) }
        } catch {
            throw InstallerRefusal.destination
        }
        defer { _ = flock(applications.fd, LOCK_UN) }

        let receipts = ReceiptStore(directory: try InstallationFiles.receipts(home: home, create: true))
        let previous: (name: String, id: String, witness: BundleWitness, receiptBytes: Data)?
        do {
            previous = try existing(applications, requested: options.appName, receipts: receipts)
        } catch ExistingInstallationRefusal.recoveryRequired {
            return .publicationFailed(.recoveryRequired)
        } catch {
            throw InstallerRefusal.destination
        }
        let name = previous?.name ?? options.appName
        let id = previous?.id ?? installationID()
        let target = applications.path + "/" + name
        let inputs = [config.checkout, config.dataDirectory, config.node, releaseBinary]
            + [config.codexBinary, config.claudeBinary].compactMap { $0 }
        guard !inputs.contains(where: { overlapping(target, $0) }) else {
            throw InstallerRefusal.destination
        }

        let stageName = InstallationFiles.stagePrefix + installationID()
        guard !inputs.contains(where: { overlapping(applications.path + "/" + stageName, $0) })
        else { throw InstallerRefusal.destination }
        let stage = try applications.createDirectory(stageName)
        try requireSafeACL(stage.handle, ancestor: false)
        guard applications.identity.device == stage.identity.device else { throw InstallerRefusal.staging }

        let bundle = try assemble(stage, name: name, id: id, releaseBinary: releaseBinary, config: config)
        let witnessed = try InstallationFiles.inspect(bundle)
        let candidate = witnessed.witness
        let pending = InstallationReceipt(
            id: id, name: name, applications: applications.identity,
            installed: previous?.witness ?? candidate,
            staged: previous == nil ? nil : candidate, stageName: stageName
        )
        do {
            try receipts.write(pending, replacing: previous?.receiptBytes)
        } catch {
            // A lost publication readback can leave a recoverable complete stage.
            return .publicationFailed(.recoveryRequired)
        }

        do {
            try validateStage(bundle, home: home)
        } catch {
            do {
                try verifyOriginal(applications, name: name, witness: previous?.witness)
                if let previous {
                    let original = InstallationReceipt(id: id, name: name, applications: applications.identity,
                                                       installed: previous.witness)
                    try receipts.write(original, replacing: pending.encode())
                } else {
                    try receipts.discard(pending)
                }
                try discard(stage: stage, named: name, witness: candidate, applications: applications,
                            stageName: stageName)
                return .refused((error as? InstallerRefusal) ?? .staging)
            } catch {
                return .publicationFailed(.recoveryRequired)
            }
        }

        do {
            let rebound = try InstallationReceipt.read(from: receipts.directory, id: id)
            guard try rebound.encode() == pending.encode() else { throw FileRefusal.invalid }
        } catch {
            return .publicationFailed(.recoveryRequired)
        }
        let publisher = BundlePublisher(applications: applications, stage: stage, name: name,
                                        previous: previous?.witness, candidate: candidate)
        let result = publisher.publish()
        do {
            switch result {
            case .published:
                let final = InstallationReceipt(id: id, name: name, applications: applications.identity,
                                                installed: candidate)
                try receipts.write(final, replacing: pending.encode())
                try discard(stage: stage, named: name, witness: previous?.witness,
                            applications: applications, stageName: stageName)
                return .success("GraphGoblin was installed in Applications.")
            case .previousInstallVerified:
                guard let previous else { return .publicationFailed(.recoveryRequired) }
                let original = InstallationReceipt(id: id, name: name, applications: applications.identity,
                                                   installed: previous.witness)
                try receipts.write(original, replacing: pending.encode())
                try discard(stage: stage, named: name, witness: candidate,
                            applications: applications, stageName: stageName)
            case .targetAbsentVerified:
                try receipts.discard(pending)
                try discard(stage: stage, named: name, witness: candidate,
                            applications: applications, stageName: stageName)
            case .recoveryRequired:
                break
            }
        } catch {
            return .publicationFailed(.recoveryRequired)
        }
        return .publicationFailed(result)
    }

    private enum ExistingInstallationRefusal: Error {
        case recoveryRequired
    }

    private static func existing(
        _ applications: Directory, requested: String, receipts: ReceiptStore
    ) throws -> (name: String, id: String, witness: BundleWitness, receiptBytes: Data)? {
        guard try applications.named(requested) != nil else { return nil }
        let target = try applications.child(requested)
        if requested != AppName.standard, let standard = try applications.named(AppName.standard),
           target.identity == FileIdentity(standard) { throw FileRefusal.invalid }
        let contents = try InstallationFiles.inspect(target)
        let receipt = try InstallationReceipt.read(from: receipts.directory, id: contents.id)
        guard receipt.applications == applications.identity,
              receipt.authorizesInstalled(contents.witness),
              (requested == AppName.standard) == (receipt.name == AppName.standard),
              try applications.child(receipt.name).identity == target.identity,
              contents.bundleID == AppName.bundleID(name: receipt.name, id: contents.id) else {
            throw FileRefusal.invalid
        }
        if let oldStage = receipt.stageName, let other = receipt.staged {
            // Carry a previous interrupted replacement forward only from exact state.
            do {
                let stage = try applications.child(oldStage)
                try stage.requireOwnedDirectory(privateMode: true)
                let remaining = contents.witness == receipt.installed ? other : receipt.installed
                guard try InstallationFiles.inspect(stage.child(receipt.name)).witness == remaining else {
                    throw FileRefusal.invalid
                }
            } catch {
                throw ExistingInstallationRefusal.recoveryRequired
            }
        }
        let raw = try receipts.bytes(contents.id)
        guard try raw == receipt.encode() else { throw FileRefusal.invalid }
        return (receipt.name, contents.id, contents.witness, raw)
    }

    private static func assemble(
        _ stage: Directory, name: String, id: String, releaseBinary: String, config: LauncherConfiguration
    ) throws -> Directory {
        guard try canonicalExecutable(releaseBinary) == releaseBinary else { throw InstallerRefusal.staging }
        let source = try OwnedDescriptor(open(releaseBinary, O_RDONLY | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK))
        let metadata = try source.metadata()
        guard isOwnedFile(metadata, privateMode: false), metadata.st_size >= 32 else {
            throw InstallerRefusal.staging
        }
        let executableData = try readBounded(source, maximum: 64 * 1024 * 1024)
        guard executableData.count == metadata.st_size, isArm64MachExecutable(executableData) else {
            throw InstallerRefusal.staging
        }

        let bundle = try stage.createDirectory(name)
        let contents = try bundle.createDirectory("Contents")
        let executable = try contents.createDirectory("MacOS")
        let resources = try contents.createDirectory("Resources")
        let plist: [String: Any] = [
            "CFBundleDevelopmentRegion": "en", "CFBundleExecutable": "GraphGoblin",
            "CFBundleIdentifier": AppName.bundleID(name: name, id: id),
            "CFBundleInfoDictionaryVersion": "6.0", "CFBundleName": "GraphGoblin",
            "CFBundlePackageType": "APPL", "CFBundleVersion": "1", "CFBundleShortVersionString": "1.0",
            "LSMinimumSystemVersion": "15.0", "NSPrincipalClass": "NSApplication",
            "NSHighResolutionCapable": true, InstallationFiles.idKey: id
        ]
        try write(executable, name: "GraphGoblin", bytes: executableData, mode: 0o700)
        try write(contents, name: "Info.plist",
                  bytes: PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0))
        try write(resources, name: "launcher.json", bytes: config.encode())
        return bundle
    }

    private static func isArm64MachExecutable(_ binary: Data) -> Bool {
        // Thin native 64-bit Mach-O, CPU_TYPE_ARM64, MH_EXECUTE. SwiftPM builds --arch arm64.
        binary.prefix(8).elementsEqual([0xCF, 0xFA, 0xED, 0xFE, 0x0C, 0, 0, 0x01])
            && binary.dropFirst(12).prefix(4).elementsEqual([0x02, 0, 0, 0])
    }

    private static func write(_ target: Directory, name: String, bytes: Data, mode: mode_t = 0o600) throws {
        let file = try target.createFile(name, mode: mode)
        try requireSafeACL(file, ancestor: false)
        try writeAll(file, bytes)
        guard fsync(file.fd) == 0 else { throw FileRefusal.system(errno) }
        try target.match(name, file, privateMode: true)
    }

    private static func validateStage(_ bundle: Directory, home: String) throws {
        try normalizeChildStatusDisposition()
        let executable = bundle.path + "/Contents/MacOS/GraphGoblin"
        let environment = ["HOME": home, "PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "LANG": "en_US.UTF-8"]
        let validation: CapturedOutput
        do {
            validation = try captureReadOnly(
                executable: executable, arguments: ["--validate-installation"], cwd: bundle.path,
                environment: environment, time: AttemptTime(seconds: 62), requireExitZero: false
            )
        } catch {
            throw InstallerRefusal.staging
        }
        guard validation.stderr.isEmpty else { throw InstallerRefusal.staging }
        if validation.exitCode == 0, validation.stdout == HeadlessResult.installationValid.bytes { return }
        let expected: [(Int32, String, InstallerRefusal)] = [
            (10, "installation-invalid", .setup), (11, "runtime-unavailable", .runtime),
            (12, "assets-unavailable", .assets), (13, "key-source-unavailable", .key),
            (22, "cannot-verify", .helper)
        ]
        if let match = expected.first(where: {
            $0.0 == validation.exitCode &&
                validation.stdout == Data(("{\"version\":1,\"code\":\"" + $0.1 + "\"}\n").utf8)
        }) {
            throw match.2
        }
        throw InstallerRefusal.staging
    }

    private static func verifyOriginal(_ parent: Directory, name: String, witness: BundleWitness?) throws {
        try parent.requireAnchored()
        if let witness {
            guard try InstallationFiles.inspect(parent.child(name)).witness == witness else {
                throw FileRefusal.invalid
            }
        } else if try parent.named(name) != nil {
            throw FileRefusal.invalid
        }
    }

    private static func discard(stage: Directory, named: String, witness: BundleWitness?,
                                applications: Directory, stageName: String) throws {
        try applications.requireAnchored()
        try stage.requireAnchored()
        if let witness {
            let app = try stage.child(named)
            guard try InstallationFiles.inspect(app).witness == witness else { throw FileRefusal.invalid }
            let contents = try app.child("Contents")
            let executable = try contents.child("MacOS")
            let resources = try contents.child("Resources")
            try unlink(executable, "GraphGoblin")
            try unlink(resources, "launcher.json")
            try unlink(contents, "Info.plist")
            try removeDirectory(contents, "MacOS", executable.identity)
            try removeDirectory(contents, "Resources", resources.identity)
            try removeDirectory(app, "Contents", contents.identity)
            try removeDirectory(stage, named, app.identity)
        }
        try removeDirectory(applications, stageName, stage.identity)
    }

    private static func unlink(_ parent: Directory, _ name: String) throws {
        let file = try parent.openRegular(name, privateMode: true)
        try parent.match(name, file, privateMode: true)
        guard unlinkat(parent.fd, name, 0) == 0 else { throw FileRefusal.system(errno) }
    }

    private static func removeDirectory(_ parent: Directory, _ name: String, _ identity: FileIdentity) throws {
        guard try parent.child(name).identity == identity,
              unlinkat(parent.fd, name, AT_REMOVEDIR) == 0 else { throw FileRefusal.invalid }
    }

    private static func overlapping(_ a: String, _ b: String) -> Bool {
        a == b || a.hasPrefix(b == "/" ? "/" : b + "/") || b.hasPrefix(a + "/")
    }

    private static func installationID() -> String {
        UUID().uuidString.lowercased().replacingOccurrences(of: "-", with: "")
    }
}
