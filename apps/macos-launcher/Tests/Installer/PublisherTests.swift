import Darwin
import Foundation
import LauncherEngine
@testable import LauncherInstaller
import Testing

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
            #expect(publisher.publish { false } == .previousInstallVerified)
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
            #expect(fixture.withPublisher(previous: nil, candidate: candidate).publish() == .recoveryRequired)
            let stillForeign = try fixture.applications.openRegular(fixture.name)
            #expect(FileIdentity(try stillForeign.metadata()) == before)
            #expect(try readBounded(stillForeign, maximum: 64) == foreignBytes)
            #expect(try fixture.witness(fixture.stage) == candidate)
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
}
