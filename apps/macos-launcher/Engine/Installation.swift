import CoreFoundation
import CryptoKit
import Darwin
import Foundation

package func strictObject(_ data: Data, required: Set<String>, optional: Set<String> = []) throws -> [String: Any] {
    guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
          required.isSubset(of: Set(object.keys)), Set(object.keys).isSubset(of: required.union(optional)) else {
        throw FileRefusal.invalid
    }
    return object
}

package func jsonInteger(_ value: Any?, range: ClosedRange<Int>) -> Int? {
    guard let number = value as? NSNumber, CFGetTypeID(number) == CFNumberGetTypeID(),
          let integer = Int(number.stringValue), range.contains(integer) else { return nil }
    return integer
}

package func jsonBoolean(_ value: Any?) -> Bool? {
    guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else {
        return nil
    }
    return number.boolValue
}

package func canonicalProspectiveDirectory(_ path: String) throws -> String {
    guard absolutePath(path) else { throw FileRefusal.invalid }
    let clean = URL(fileURLWithPath: path).standardizedFileURL.path
    var ancestor = clean
    var suffix: [String] = []
    while true {
        var metadata = stat()
        if lstat(ancestor, &metadata) == 0 {
            let physical = try canonicalPath(ancestor)
            _ = try Directory(path: physical)
            let result = suffix.reversed().reduce(physical) {
                $0 == "/" ? "/" + $1 : $0 + "/" + $1
            }
            return result
        }
        guard errno == ENOENT && ancestor != "/" else { throw FileRefusal.system(errno) }
        let url = URL(fileURLWithPath: ancestor)
        guard safeComponent(url.lastPathComponent) else { throw FileRefusal.invalid }
        suffix.append(url.lastPathComponent)
        ancestor = url.deletingLastPathComponent().path
    }
}

package func canonicalExecutable(_ path: String) throws -> String {
    let resolved = try canonicalPath(path)
    var metadata = stat()
    guard lstat(resolved, &metadata) == 0, fileKind(metadata, S_IFREG),
          access(resolved, X_OK) == 0 else { throw FileRefusal.invalid }
    return resolved
}

package struct LauncherConfiguration: Sendable {
    package let checkout: String
    package let node: String
    package let dataDirectory: String
    package let port: UInt16
    package let requireAPIKey: Bool
    package let ollamaEnabled: Bool
    package let codexBinary: String?
    package let claudeBinary: String?

    package init(
        checkout: String, node: String, dataDirectory: String, port: UInt16,
        requireAPIKey: Bool, ollamaEnabled: Bool, codexBinary: String?, claudeBinary: String?
    ) throws {
        guard port != 0 else { throw FileRefusal.invalid }
        self.checkout = try canonicalPath(checkout)
        self.node = try canonicalExecutable(node)
        self.dataDirectory = try canonicalProspectiveDirectory(dataDirectory)
        self.port = port
        self.requireAPIKey = requireAPIKey
        self.ollamaEnabled = ollamaEnabled
        self.codexBinary = try codexBinary.map(canonicalExecutable)
        self.claudeBinary = try claudeBinary.map(canonicalExecutable)
    }

    init(data: Data) throws {
        let object = try strictObject(data, required: [
            "version", "checkout", "node", "dataDirectory", "port", "requireAPIKey", "ollamaEnabled"
        ], optional: ["codexBinary", "claudeBinary"])
        guard jsonInteger(object["version"], range: 1...1) != nil,
              let checkout = object["checkout"] as? String,
              let node = object["node"] as? String,
              let directory = object["dataDirectory"] as? String,
              let port = jsonInteger(object["port"], range: 1...65_535),
              let requireAPIKey = jsonBoolean(object["requireAPIKey"]),
              let ollamaEnabled = jsonBoolean(object["ollamaEnabled"]) else {
            throw FileRefusal.invalid
        }
        let codexBinary = object["codexBinary"] as? String
        let claudeBinary = object["claudeBinary"] as? String
        guard (object["codexBinary"] == nil || codexBinary != nil),
              (object["claudeBinary"] == nil || claudeBinary != nil),
              ([checkout, node, directory] + [codexBinary, claudeBinary].compactMap { $0 })
                  .allSatisfy(absolutePath) else { throw FileRefusal.invalid }
        self.checkout = checkout
        self.node = node
        self.dataDirectory = directory
        self.port = UInt16(port)
        self.requireAPIKey = requireAPIKey
        self.ollamaEnabled = ollamaEnabled
        self.codexBinary = codexBinary
        self.claudeBinary = claudeBinary
    }

    package func encode() throws -> Data {
        var object: [String: Any] = [
            "version": 1, "checkout": checkout, "node": node, "dataDirectory": dataDirectory,
            "port": Int(port), "requireAPIKey": requireAPIKey, "ollamaEnabled": ollamaEnabled
        ]
        if let codexBinary { object["codexBinary"] = codexBinary }
        if let claudeBinary { object["claudeBinary"] = claudeBinary }
        return try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .withoutEscapingSlashes])
    }

    package var database: String {
        dataDirectory == "/" ? "/graphgoblin.db" : dataDirectory + "/graphgoblin.db"
    }

    package var databaseURI: String {
        // Encode path bytes independently of Foundation's default URL escaping.
        let encoded = database.utf8.map { byte -> String in
            if (65...90).contains(byte) || (97...122).contains(byte) || (48...57).contains(byte)
                || [45, 46, 47, 95, 126].contains(byte) {
                return String(UnicodeScalar(byte))
            }
            return String(format: "%%%02X", byte)
        }.joined()
        return "file://" + encoded
    }
}

package enum AppName {
    package static let standard = "GraphGoblin.app"
    package static let standardBundleID = "com.graphgoblin.launcher"

    package static func normalize(_ raw: String) throws -> String {
        let name = raw.precomposedStringWithCanonicalMapping
        if name == standard { return name }
        let prefix = "GraphGoblin "
        let extensionName = ".app"
        guard name.hasPrefix(prefix), name.hasSuffix(extensionName), name.utf8.count <= 120 else {
            throw FileRefusal.invalid
        }
        let suffix = String(name.dropFirst(prefix.count).dropLast(extensionName.count))
        let allowed = CharacterSet.letters
            .union(.nonBaseCharacters).union(.decimalDigits)
            .union(CharacterSet(charactersIn: " -_"))
        guard !suffix.isEmpty, suffix.first != " ", suffix.last != " ",
              suffix.unicodeScalars.allSatisfy(allowed.contains) else { throw FileRefusal.invalid }
        return name
    }

    package static func bundleID(name: String, id: String) -> String {
        name == standard ? standardBundleID : standardBundleID + ".instance." + id
    }
}

package struct BundleWitness: Codable, Equatable, Sendable {
    package let bundle: FileIdentity
    package let executable: String
    package let plist: String
    package let configuration: String

    fileprivate var valid: Bool {
        bundle.isCanonical && [executable, plist, configuration].allSatisfy { asciiHex($0, count: 64) }
    }
}

package struct InstallationReceipt: Codable, Sendable {
    package let version: Int
    package let id: String
    package let name: String
    package let applications: FileIdentity
    package let installed: BundleWitness
    package let staged: BundleWitness?
    package let stageName: String?

    package init(id: String, name: String, applications: FileIdentity,
                 installed: BundleWitness, staged: BundleWitness? = nil, stageName: String? = nil) {
        self.version = 1
        self.id = id
        self.name = name
        self.applications = applications
        self.installed = installed
        self.staged = staged
        self.stageName = stageName
    }

    package static func read(from receipts: Directory, id: String) throws -> InstallationReceipt {
        guard asciiHex(id, count: 32) else { throw FileRefusal.invalid }
        let filename = id + ".json"
        let file = try receipts.openRegular(filename, privateMode: true)
        try requireSafeACL(file, ancestor: false)
        let bytes = try readBounded(file, maximum: 16_384)
        try receipts.match(filename, file, privateMode: true)
        try receipts.requireAnchored()
        let object = try strictObject(bytes, required: ["version", "id", "name", "applications", "installed"],
                                      optional: ["staged", "stageName"])
        try validateIdentityObject(object["applications"])
        try validateWitnessObject(object["installed"])
        if let pending = object["staged"] { try validateWitnessObject(pending) }
        if let stageName = object["stageName"], !(stageName is String) { throw FileRefusal.invalid }
        let receipt = try JSONDecoder().decode(Self.self, from: bytes)
        guard try receipt.encode() == bytes,
              receipt.version == 1, receipt.id == id, receipt.applications.isCanonical,
              try AppName.normalize(receipt.name) == receipt.name,
              receipt.installed.valid else { throw FileRefusal.invalid }
        if let other = receipt.staged {
            guard other.valid, other.bundle != receipt.installed.bundle, receipt.stageName != nil else {
                throw FileRefusal.invalid
            }
        }
        if let stage = receipt.stageName {
            guard stage.hasPrefix(InstallationFiles.stagePrefix),
                  asciiHex(String(stage.dropFirst(InstallationFiles.stagePrefix.count)), count: 32) else {
                throw FileRefusal.invalid
            }
        }
        return receipt
    }

    private static func validateIdentityObject(_ value: Any?) throws {
        guard let identity = value as? [String: Any], Set(identity.keys) == ["device", "inode"] else {
            throw FileRefusal.invalid
        }
    }

    private static func validateWitnessObject(_ value: Any?) throws {
        guard let witness = value as? [String: Any],
              Set(witness.keys) == ["bundle", "executable", "plist", "configuration"] else {
            throw FileRefusal.invalid
        }
        try validateIdentityObject(witness["bundle"])
    }

    package func encode() throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(self)
    }

    package func authorizesInstalled(_ witness: BundleWitness) -> Bool {
        witness == installed || witness == staged
    }
}

package struct BundleContents: Sendable {
    package let id: String
    package let bundleID: String
    package let witness: BundleWitness
    package let configuration: LauncherConfiguration
}

package struct VerifiedInstallation: Sendable {
    package let home: String
    package let name: String
    package let contents: BundleContents
}

package enum InstallationFiles {
    package static let stagePrefix = ".graphgoblin-launcher-stage-"
    package static let idKey = "GraphGoblinInstallationID"

    package static func applications(home: String, create: Bool = false) throws -> Directory {
        let owner = try Directory(path: home)
        try owner.requireOwnedDirectory()
        let result = try create ? owner.ensureDirectory("Applications") : owner.child("Applications")
        try result.requireOwnedDirectory()
        return result
    }

    package static func receipts(home: String, create: Bool = false) throws -> Directory {
        var current = try Directory(path: home)
        try current.requireOwnedDirectory()
        for name in ["Library", "Application Support", "GraphGoblin", "LauncherInstalls"] {
            current = try create ? current.ensureDirectory(name) : current.child(name)
            try current.requireOwnedDirectory(privateMode: name == "LauncherInstalls")
            try requireSafeACL(current.handle, ancestor: name != "LauncherInstalls")
        }
        return current
    }

    package static func inspect(_ bundle: Directory) throws -> BundleContents {
        try bundle.requireOwnedDirectory()
        guard try bundle.names() == ["Contents"] else { throw FileRefusal.invalid }
        let contents = try bundle.child("Contents")
        try contents.requireOwnedDirectory()
        guard try contents.names() == ["Info.plist", "MacOS", "Resources"] else { throw FileRefusal.invalid }
        let macOS = try contents.child("MacOS")
        let resources = try contents.child("Resources")
        try macOS.requireOwnedDirectory()
        try resources.requireOwnedDirectory()
        guard try macOS.names() == ["GraphGoblin"], try resources.names() == ["launcher.json"] else {
            throw FileRefusal.invalid
        }
        let executable = try macOS.openRegular("GraphGoblin")
        let executableDigest = try fileSHA256(executable)
        guard try executable.metadata().st_mode & 0o100 != 0 else { throw FileRefusal.invalid }
        try macOS.match("GraphGoblin", executable, privateMode: false)

        let plist = try contents.openRegular("Info.plist")
        let plistBytes = try readBounded(plist, maximum: 16_384)
        try contents.match("Info.plist", plist, privateMode: false)
        guard let properties = try PropertyListSerialization.propertyList(
            from: plistBytes, options: [], format: nil
        ) as? [String: Any],
              properties["CFBundleExecutable"] as? String == "GraphGoblin",
              let id = properties[idKey] as? String, asciiHex(id, count: 32),
              let bundleID = properties["CFBundleIdentifier"] as? String else { throw FileRefusal.invalid }
        let config = try resources.openRegular("launcher.json", privateMode: true)
        let configBytes = try readBounded(config, maximum: 32_768)
        try resources.match("launcher.json", config, privateMode: true)
        return BundleContents(id: id, bundleID: bundleID, witness: BundleWitness(
            bundle: bundle.identity, executable: executableDigest, plist: digest(plistBytes),
            configuration: digest(configBytes)
        ), configuration: try LauncherConfiguration(data: configBytes))
    }

    private static func digest(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    package static func verify(bundlePath: String, staged: Bool) throws -> VerifiedInstallation {
        let home = try authenticatedHome()
        let applications = try applications(home: home)
        let actual = try Directory(path: bundlePath)
        let opened = try inspect(actual)
        let records = try receipts(home: home)
        let receipt = try InstallationReceipt.read(from: records, id: opened.id)
        guard receipt.applications == applications.identity,
              opened.bundleID == AppName.bundleID(name: receipt.name, id: opened.id) else {
            throw FileRefusal.invalid
        }
        if staged {
            guard let stageName = receipt.stageName else { throw FileRefusal.invalid }
            let stage = try applications.child(stageName)
            try stage.requireOwnedDirectory(privateMode: true)
            guard try stage.child(receipt.name).identity == actual.identity,
                  (receipt.staged ?? receipt.installed) == opened.witness else { throw FileRefusal.invalid }
        } else {
            guard try applications.child(receipt.name).identity == actual.identity,
                  receipt.authorizesInstalled(opened.witness) else { throw FileRefusal.invalid }
        }
        try actual.requireAnchored()
        try applications.requireAnchored()
        return VerifiedInstallation(home: home, name: receipt.name, contents: opened)
    }
}
