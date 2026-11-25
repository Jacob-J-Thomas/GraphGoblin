import Darwin
import Foundation
@testable import LauncherEngine
@testable import LauncherInstaller
import Testing

/// Attaches one read entry naming a fresh random principal, so the entry allows or denies nobody real.
/// Only use it on disposable objects the test created.
func attachHarmlessACL(_ fd: Int32, tag: acl_tag_t = ACL_EXTENDED_ALLOW) throws {
    var list: acl_t? = acl_init(1)
    defer { if let list { _ = acl_free(UnsafeMutableRawPointer(list)) } }
    var entry: acl_entry_t?
    try #require(list != nil)
    try #require(acl_create_entry(&list, &entry) == 0)
    let created = try #require(entry)
    try #require(acl_set_tag_type(created, tag) == 0)
    let principal = UUID().uuid
    let qualified = withUnsafeBytes(of: principal) { acl_set_qualifier(created, $0.baseAddress) }
    try #require(qualified == 0)
    var permissions: acl_permset_t?
    try #require(acl_get_permset(created, &permissions) == 0)
    let granted = try #require(permissions)
    try #require(acl_add_perm(granted, ACL_READ_DATA) == 0)
    try #require(acl_set_permset(created, granted) == 0)
    try #require(acl_set_fd_np(fd, list, ACL_TYPE_EXTENDED) == 0)
    let state = try classifyACL(fd)
    let expected: ACLClassification = tag == ACL_EXTENDED_ALLOW ? .allowsAccess : .denyOnly
    try #require(state == expected)
}

/// Replaces the object's ACL with an empty list; the classifier must then report absent or empty.
func clearACL(_ fd: Int32) throws {
    let empty: acl_t? = acl_init(0)
    defer { if let empty { _ = acl_free(UnsafeMutableRawPointer(empty)) } }
    try #require(empty != nil)
    try #require(acl_set_fd_np(fd, empty, ACL_TYPE_EXTENDED) == 0)
    let state = try classifyACL(fd)
    try #require(state == .absent || state == .empty)
}

@Suite struct PublisherTests {
    private struct Fixture {
        let root: Directory
        let applications: Directory
        let stage: Directory
        let receipts: Directory
        let name = "GraphGoblin QA α.app"
        let id = "0123456789abcd0123456789abcd0123"

        init(_ parent: Directory) throws {
            root = parent
            applications = try parent.createDirectory("Applications")
            stage = try applications.createDirectory(InstallationFiles.stagePrefix + "12345678901234567890123456789012")
            receipts = try parent.createDirectory("Receipts")
        }

        func bundle(in parent: Directory, marker: String) throws -> BundleWitness {
            let app = try parent.createDirectory(name)
            let contents = try app.createDirectory("Contents")
            let executable = try contents.createDirectory("MacOS")
            let resources = try contents.createDirectory("Resources")
            let plist = try PropertyListSerialization.data(fromPropertyList: [
                "CFBundleExecutable": "GraphGoblin", "CFBundleIdentifier": AppName.bundleID(name: name, id: id),
                InstallationFiles.idKey: id
            ], format: .xml, options: 0)
            let config = try LauncherConfiguration(checkout: root.path, node: "/bin/sh", dataDirectory: root.path,
                                                   port: 45124, requireAPIKey: false, ollamaEnabled: false,
                                                   codexBinary: nil, claudeBinary: nil)
            try writeAll(executable.createFile("GraphGoblin", mode: 0o700), Data(marker.utf8))
            try writeAll(contents.createFile("Info.plist"), plist)
            try writeAll(resources.createFile("launcher.json"), config.encode())
            return try InstallationFiles.inspect(app).witness
        }

        func withPublisher(previous: BundleWitness?, candidate: BundleWitness) -> BundlePublisher {
            BundlePublisher(applications: applications, stage: stage, name: name, previous: previous, candidate: candidate)
        }

        func witness(_ parent: Directory) throws -> BundleWitness? {
            guard try parent.named(name) != nil else { return nil }
            return try InstallationFiles.inspect(parent.child(name)).witness
        }
    }

    private func fixture(_ run: (Fixture) throws -> Void) throws {
        let tmp = try canonicalPath(FileManager.default.temporaryDirectory.path)
        let parent = try Directory(path: tmp)
        let root = try parent.createDirectory("graphgoblin-installer-test-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(atPath: root.path) }
        try run(Fixture(root))
    }

    @Test func absentDestinationUsesExclusivePublish() throws {
        try fixture { fixture in
            let candidate = try fixture.bundle(in: fixture.stage, marker: "candidate")
            let result = fixture.withPublisher(previous: nil, candidate: candidate).publish()
            #expect(result == .published)
            #expect(try fixture.witness(fixture.applications) == candidate)
            #expect(try fixture.witness(fixture.stage) == nil)
        }
    }

    @Test func rollbackToVerifiedAbsence() throws {
        try fixture { fixture in
            let candidate = try fixture.bundle(in: fixture.stage, marker: "candidate")
            let result = fixture.withPublisher(previous: nil, candidate: candidate).publish { false }
            #expect(result == .targetAbsentVerified)
            let message = InstallerResult.publicationFailed(result)
            #expect(message.exitCode == 1)
            #expect(message.output == "Publication failed. The installation destination was verified absent.")
            #expect(try fixture.witness(fixture.applications) == nil)
            #expect(try fixture.witness(fixture.stage) == candidate)
        }
    }

    @Test func signedWitnessesSurviveActualExchangeAndRollback() throws {
        try fixture { fixture in
            let prior = try fixture.bundle(in: fixture.applications, marker: "prior")
            let candidate = try fixture.bundle(in: fixture.stage, marker: "candidate")
            let publisher = fixture.withPublisher(previous: prior, candidate: candidate)
            let stable = InstallationReceipt(id: fixture.id, name: fixture.name,
                                             applications: fixture.applications.identity, installed: prior)
            let pending = InstallationReceipt(
                id: fixture.id, name: fixture.name, applications: fixture.applications.identity,
                installed: prior, staged: candidate, stageName: fixture.stage.path.components(separatedBy: "/").last
            )
            let records = ReceiptStore(directory: fixture.receipts)
            try records.write(stable, replacing: nil)
            try records.write(pending, replacing: stable.encode())
            let read = try InstallationReceipt.read(from: fixture.receipts, id: fixture.id)
            #expect(read.authorizesInstalled(prior))
            #expect(read.authorizesInstalled(candidate))
            let rolledBack = publisher.publish { false }
            #expect(rolledBack == .previousInstallVerified)
            let message = InstallerResult.publicationFailed(rolledBack)
            #expect(message.exitCode == 1)
            #expect(message.output == "Publication failed. The previous installation was verified.")
            #expect(try fixture.witness(fixture.applications) == prior)
            #expect(try fixture.witness(fixture.stage) == candidate)
            #expect(publisher.publish() == .published)
            #expect(try fixture.witness(fixture.applications) == candidate)
            #expect(try fixture.witness(fixture.stage) == prior)
        }
    }

    @Test func unverifiableDestinationLeavesForeignEntryAndCandidate() throws {
        try fixture { fixture in
            let candidate = try fixture.bundle(in: fixture.stage, marker: "candidate")
            let foreign = try fixture.applications.createFile(fixture.name)
            let foreignBytes = Data("foreign".utf8)
            try writeAll(foreign, foreignBytes)
            let before = FileIdentity(try foreign.metadata())
            let result = fixture.withPublisher(previous: nil, candidate: candidate).publish()
            #expect(result == .recoveryRequired)
            let message = InstallerResult.publicationFailed(result)
            #expect(message.exitCode == 1)
            #expect(message.output == "Publication could not be verified. Installer recovery is required.")
            let stillForeign = try fixture.applications.openRegular(fixture.name)
            #expect(FileIdentity(try stillForeign.metadata()) == before)
            #expect(try readBounded(stillForeign, maximum: 64) == foreignBytes)
            #expect(try fixture.witness(fixture.stage) == candidate)
        }
    }

    @Test func staleReceiptReplacementAndDiscardPreserveExactWitnessAndBytes() throws {
        try fixture { fixture in
            let prior = try fixture.bundle(in: fixture.applications, marker: "prior")
            let candidate = try fixture.bundle(in: fixture.stage, marker: "candidate")
            let records = ReceiptStore(directory: fixture.receipts)
            let stable = InstallationReceipt(id: fixture.id, name: fixture.name,
                                             applications: fixture.applications.identity, installed: prior)
            let pending = InstallationReceipt(
                id: fixture.id, name: fixture.name, applications: fixture.applications.identity,
                installed: prior, staged: candidate, stageName: URL(fileURLWithPath: fixture.stage.path).lastPathComponent
            )
            try records.write(stable, replacing: nil)
            let filename = fixture.id + ".json"
            let existing = try fixture.receipts.named(filename)
            let before = try #require(existing)
            let bytes = try stable.encode()

            #expect(throws: FileRefusal.self) { try records.write(pending, replacing: Data("stale".utf8)) }
            #expect(throws: FileRefusal.self) { try records.write(pending, replacing: nil) }
            #expect(throws: FileRefusal.self) { try records.discard(pending) }
            #expect(try records.bytes(fixture.id) == bytes)
            #expect(try fixture.receipts.named(filename).map(FileIdentity.init) == FileIdentity(before))
            #expect(try fixture.receipts.names() == [filename])
            #expect(try fixture.witness(fixture.applications) == prior)
            #expect(try fixture.witness(fixture.stage) == candidate)

            try records.discard(stable)
            #expect(try fixture.receipts.names().isEmpty)
            #expect(try fixture.witness(fixture.applications) == prior)
            #expect(try fixture.witness(fixture.stage) == candidate)
        }
    }

    @Test func alternateReceiptSchemasCannotAuthorizeAGenuineBundle() throws {
        try fixture { fixture in
            let installed = try fixture.bundle(in: fixture.applications, marker: "installed")
            let staged = try fixture.bundle(in: fixture.stage, marker: "staged")
            let stageName = URL(fileURLWithPath: fixture.stage.path).lastPathComponent
            let stable = InstallationReceipt(
                id: fixture.id, name: fixture.name, applications: fixture.applications.identity,
                installed: installed, staged: staged, stageName: stageName
            )
            let bytes = try stable.encode()
            let fileName = fixture.id + ".json"
            try writeAll(fixture.receipts.createFile(fileName), bytes)
            let verified = try InstallationReceipt.read(from: fixture.receipts, id: fixture.id)
            #expect(verified.authorizesInstalled(installed) && verified.authorizesInstalled(staged))
            #expect(throws: FileRefusal.self) { try InstallationReceipt.read(from: fixture.receipts, id: "../escape") }
            let malformedWitness = BundleWitness(
                bundle: installed.bundle, executable: "invalid-digest",
                plist: installed.plist, configuration: installed.configuration
            )
            let malformed: [InstallationReceipt] = [
                InstallationReceipt(
                    id: fixture.id, name: fixture.name, applications: fixture.applications.identity,
                    installed: malformedWitness
                ),
                InstallationReceipt(
                    id: fixture.id, name: fixture.name, applications: fixture.applications.identity,
                    installed: installed, staged: installed, stageName: stageName
                ),
                InstallationReceipt(
                    id: fixture.id, name: fixture.name, applications: fixture.applications.identity,
                    installed: installed, staged: staged
                ),
                InstallationReceipt(
                    id: fixture.id, name: fixture.name, applications: fixture.applications.identity,
                    installed: installed, staged: staged, stageName: InstallationFiles.stagePrefix + "bad"
                )
            ]
            let object = try #require(JSONSerialization.jsonObject(with: bytes) as? [String: Any])
            var wrongStage = object
            wrongStage["stageName"] = 1
            var wrongIdentity = object
            wrongIdentity["applications"] = ["inode": "1"]
            var wrongWitness = object
            wrongWitness["installed"] = ["bundle": ["device": "1", "inode": "2"]]
            let malformedObjects = try [wrongStage, wrongIdentity, wrongWitness].map {
                try JSONSerialization.data(withJSONObject: $0)
            }
            let records = try malformed.map { try $0.encode() } + malformedObjects
            for (index, altered) in records.enumerated() {
                let alternate = try fixture.root.createDirectory("Receipt\(index)")
                let file = try alternate.createFile(fileName)
                try writeAll(file, altered)
                let identity = FileIdentity(try file.metadata())
                #expect(throws: FileRefusal.self) { try InstallationReceipt.read(from: alternate, id: fixture.id) }
                #expect(try alternate.named(fileName).map(FileIdentity.init) == identity)
                #expect(try readBounded(alternate.openRegular(fileName), maximum: 16_384) == altered)
            }
            #expect(try ReceiptStore(directory: fixture.receipts).bytes(fixture.id) == bytes)
            #expect(try fixture.witness(fixture.applications) == installed)
            #expect(try fixture.witness(fixture.stage) == staged)
        }
    }

    @Test func bundleInspectionRefusesChangedLayoutAndMissingExecutionAuthority() throws {
        try fixture { fixture in
            let baseline = try fixture.bundle(in: fixture.applications, marker: "installed")
            let bundle = try fixture.applications.child(fixture.name)
            let contents = try bundle.child("Contents")
            let binaryDirectory = try contents.child("MacOS")
            let binary = try binaryDirectory.openRegular("GraphGoblin")
            let binaryIdentity = FileIdentity(try binary.metadata())
            for parent in [contents, binaryDirectory] {
                let extra = try parent.createFile("foreign")
                let bytes = Data("unrelated".utf8)
                try writeAll(extra, bytes)
                #expect(throws: FileRefusal.self) { try InstallationFiles.inspect(bundle) }
                #expect(try parent.named("foreign").map(FileIdentity.init) == FileIdentity(try extra.metadata()))
                #expect(try readBounded(parent.openRegular("foreign"), maximum: 32) == bytes)
                try #require(unlinkat(parent.fd, "foreign", 0) == 0)
                #expect(try InstallationFiles.inspect(bundle).witness == baseline)
            }
            try #require(fchmod(binary.fd, 0o600) == 0)
            #expect(throws: FileRefusal.self) { try InstallationFiles.inspect(bundle) }
            #expect(try binaryDirectory.named("GraphGoblin").map(FileIdentity.init) == binaryIdentity)
            #expect(try readBounded(binaryDirectory.openRegular("GraphGoblin"), maximum: 32) == Data("installed".utf8))
            try #require(fchmod(binary.fd, 0o700) == 0)
            #expect(try InstallationFiles.inspect(bundle).witness == baseline)

            let witness = try contents.openRegular("Info.plist")
            let original = try readBounded(witness, maximum: 16_384)
            let plist = try #require(
                PropertyListSerialization.propertyList(from: original, options: [], format: nil) as? [String: Any]
            )
            var modified = plist
            modified.removeValue(forKey: "CFBundleIdentifier")
            let incomplete = try PropertyListSerialization.data(fromPropertyList: modified, format: .xml, options: 0)
            let writable = try contents.openRegular("Info.plist", write: true)
            try #require(ftruncate(writable.fd, 0) == 0)
            try writeAll(writable, incomplete)
            #expect(throws: FileRefusal.self) { try InstallationFiles.inspect(bundle) }
            #expect(try readBounded(contents.openRegular("Info.plist"), maximum: 16_384) == incomplete)
            try contents.match("Info.plist", witness, privateMode: true)
            #expect(try binaryDirectory.named("GraphGoblin").map(FileIdentity.init) == binaryIdentity)
        }
    }

    @Test func bundleInspectionRefusesAnyACLEntryOnEveryManagedObject() throws {
        try fixture { fixture in
            let baseline = try fixture.bundle(in: fixture.applications, marker: "installed")
            let bundle = try fixture.applications.child(fixture.name)
            let contents = try bundle.child("Contents")
            let binaries = try contents.child("MacOS")
            let resources = try contents.child("Resources")
            let managed: [(String, OwnedDescriptor)] = [
                ("bundle", bundle.handle), ("Contents", contents.handle), ("MacOS", binaries.handle),
                ("Resources", resources.handle), ("GraphGoblin", try binaries.openRegular("GraphGoblin")),
                ("Info.plist", try contents.openRegular("Info.plist")),
                ("launcher.json", try resources.openRegular("launcher.json", privateMode: true))
            ]
            let identities = try managed.map { FileIdentity(try $0.1.metadata()) }
            for (label, handle) in managed {
                let initial = try classifyACL(handle.fd)
                #expect(initial == .absent || initial == .empty, "\(label)")
                // Deny-only lists are tolerated on ancestors only; a managed object refuses both kinds.
                for tag in [ACL_EXTENDED_ALLOW, ACL_EXTENDED_DENY] {
                    try attachHarmlessACL(handle.fd, tag: tag)
                    #expect(throws: FileRefusal.self, "\(label)") { try InstallationFiles.inspect(bundle) }
                    try clearACL(handle.fd)
                    #expect(try InstallationFiles.inspect(bundle).witness == baseline, "\(label)")
                }
            }
            #expect(try managed.map { FileIdentity(try $0.1.metadata()) } == identities)
            #expect(try fixture.applications.child(fixture.name).identity == baseline.bundle)
        }
    }

    @Test func closedArgumentsAndNames() throws {
        let command = try InstallerOptions.parse([
            "--app-name", "GraphGoblin QA a\u{0301}.app", "--port", "65535",
            "--disable-ollama", "--require-api-key", "--node", "/path with space/node"
        ])
        guard case .install(let options) = command else { Issue.record("Expected installer options"); return }
        #expect(options.appName == "GraphGoblin QA á.app")
        #expect(options.port == 65535)
        #expect(options.requireAPIKey)
        #expect(!options.ollamaEnabled)
        for args in [
            ["--port", "+12"], ["--port", "0"], ["--port", "65536"], ["--app-name", "../GraphGoblin.app"],
            ["--node", "relative"], ["--port", "123", "--port", "124"], ["--help", "--disable-ollama"],
            ["--app-name=GraphGoblin.app"], ["--app-name", "GraphGoblin \u{202E}.app"],
            ["--disable-ollama", "--disable-ollama"]
        ] {
            #expect(throws: InstallerRefusal.self) { try InstallerOptions.parse(args) }
        }
    }

    @Test func platformBootstrapAndTerminalUsageAreClosed() throws {
        let prefix = ["/fixture/checkout", "/fixture/release", "", "--"]
        let help = LauncherInstaller.run(prefix + ["--help"], environment: [:])
        #expect(help.exitCode == 0)
        #expect(help.output == InstallerOptions.usage)

        for arguments in [
            prefix + ["--port"],
            prefix + ["--data-dir", "relative"],
            prefix + ["--node", "/node", "--node", "/second-node"],
            prefix + ["--help", "--require-api-key"]
        ] {
            let result = LauncherInstaller.run(arguments, environment: [:])
            #expect(result.exitCode == 64)
            #expect(result.output == InstallerOptions.usage)
        }
        for arguments in [
            [], ["/fixture/checkout", "/fixture/release", ""],
            ["relative", "/fixture/release", "", "--"],
            ["/fixture/checkout", "relative", "", "--"],
            ["/fixture/checkout", "/fixture/release", "relative", "--"],
            ["/fixture/checkout", "/fixture/release", "", "--help"]
        ] {
            let result = LauncherInstaller.run(arguments, environment: [:])
            #expect(result.exitCode == 1)
            #expect(result.output == "The candidate bundle could not be staged and verified.")
        }

        let parsed = try InstallerOptions.parse([
            "--app-name", "GraphGoblin.app", "--data-dir", "/fixture/store",
            "--codex-binary", "/fixture/codex", "--claude-binary", "/fixture/claude"
        ])
        guard case .install(let options) = parsed else {
            Issue.record("Explicit alternate binary paths should parse as installer configuration")
            return
        }
        #expect(options.appName == "GraphGoblin.app")
        #expect(options.dataDirectory == "/fixture/store")
        #expect(options.codexBinary == "/fixture/codex")
        #expect(options.claudeBinary == "/fixture/claude")
    }
}
