import Darwin
import Foundation
@testable import LauncherEngine
@testable import LauncherInstaller
import Testing

private let enabled = ProcessInfo.processInfo.environment["GG_MACOS_COVERAGE_FIXTURE_ROOT"] != nil

private struct HostedInstaller {
    let scratch: Directory
    let applications: Directory
    let receipts: ReceiptStore
    let checkout: String
    let launcher: String
    let node: String
    let name: String
    let id: String

    var store: String { scratch.path + "/store" }

    init() throws {
        let environment = ProcessInfo.processInfo.environment
        try #require(environment["GITHUB_ACTIONS"] == "true")
        let runner = try canonicalPath(#require(environment["RUNNER_TEMP"]))
        let path = try #require(environment["GG_MACOS_COVERAGE_FIXTURE_ROOT"])
        try #require(try canonicalPath(path) == path)
        try #require(path.hasPrefix(runner + "/"))
        let root = try Directory(path: path)
        try root.requireOwnedDirectory(privateMode: true)
        let checkout = try #require(environment["GG_MACOS_COVERAGE_REPO"])
        let launcher = try #require(environment["GG_MACOS_COVERAGE_LAUNCHER"])
        let node = try #require(environment["GG_MACOS_COVERAGE_NODE"])
        try #require(try canonicalPath(checkout) == checkout)
        try #require(try canonicalExecutable(launcher) == launcher)
        try #require(try canonicalExecutable(node) == node)
        let id = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
        let name = "GraphGoblin Installer Coverage \(id).app"
        let home = try authenticatedHome()
        let applications = try InstallationFiles.applications(home: home, create: true)
        let receipts = ReceiptStore(directory: try InstallationFiles.receipts(home: home, create: true))
        try #require(try applications.named(name) == nil)
        try #require(try receipts.directory.named(id + ".json") == nil)
        scratch = try root.createDirectory("installer-" + id)
        self.checkout = checkout
        self.launcher = launcher
        self.node = node
        self.id = id
        self.name = name
        self.applications = applications
        self.receipts = receipts
    }

    func invoke(dataDirectory: String) -> InstallerResult {
        LauncherInstaller.run([
            checkout, launcher, node, "--", "--app-name", name,
            "--data-dir", dataDirectory, "--port", "56325", "--disable-ollama"
        ], environment: [:])
    }

    func assemble(in parent: Directory, requireAPIKey: Bool) throws -> BundleWitness {
        let contents = try parent.createDirectory(name).createDirectory("Contents")
        let bin = try contents.createDirectory("MacOS")
        let resources = try contents.createDirectory("Resources")
        let source = try OwnedDescriptor(open(launcher, O_RDONLY | O_CLOEXEC | O_NOFOLLOW))
        try writeAll(bin.createFile("GraphGoblin", mode: 0o700), readBounded(source, maximum: 64 * 1024 * 1024))
        let plist = try PropertyListSerialization.data(fromPropertyList: [
            "CFBundleExecutable": "GraphGoblin", "CFBundleIdentifier": AppName.bundleID(name: name, id: id),
            InstallationFiles.idKey: id
        ], format: .xml, options: 0)
        try writeAll(contents.createFile("Info.plist"), plist)
        let configuration = try LauncherConfiguration(
            checkout: checkout, node: node, dataDirectory: store, port: 56325,
            requireAPIKey: requireAPIKey, ollamaEnabled: false, codexBinary: nil, claudeBinary: nil
        )
        try writeAll(resources.createFile("launcher.json"), configuration.encode())
        return try InstallationFiles.inspect(parent.child(name)).witness
    }

    func removeBundle(from parent: Directory, witness: BundleWitness) throws {
        try parent.requireAnchored()
        let bundle = try parent.child(name)
        try #require(try InstallationFiles.inspect(bundle).witness == witness)
        try FileManager.default.removeItem(atPath: bundle.path)
    }
}

@Suite(.enabled(if: enabled, "Requires a disposable hosted native coverage fixture"), .serialized)
struct InstallerRecoveryTests {
    @Test func heldApplicationsLockRefusesInstallWithoutCreatingADestination() throws {
        let fixture = try HostedInstaller()
        try #require(flock(fixture.applications.fd, LOCK_EX | LOCK_NB) == 0)
        defer { _ = flock(fixture.applications.fd, LOCK_UN) }

        let refused = fixture.invoke(dataDirectory: fixture.store)
        try #require(refused.exitCode == 1)
        try #require(refused.output == "The Applications destination could not be authorized for this installation.")
        try #require(try fixture.applications.named(fixture.name) == nil)
        try #require(try fixture.receipts.directory.named(fixture.id + ".json") == nil)
        try #require(try fixture.scratch.names().isEmpty)
        try fixture.scratch.requireAnchored()
        try FileManager.default.removeItem(atPath: fixture.scratch.path)
    }

    enum Interruption: String, CaseIterable, Sendable {
        case beforeExchange, afterExchange, staleStage, staleInstalled
    }

    @Test(arguments: Interruption.allCases)
    func interruptionRetryRequiresTheExactRemainingBundle(_ interruption: Interruption) throws {
        let fixture = try HostedInstaller()
        let stageName = InstallationFiles.stagePrefix + fixture.id
        let stage = try fixture.applications.createDirectory(stageName)
        let prior = try fixture.assemble(in: fixture.applications, requireAPIKey: false)
        let candidate = try fixture.assemble(in: stage, requireAPIKey: true)
        func stale(_ witness: BundleWitness) -> BundleWitness {
            BundleWitness(bundle: witness.bundle, executable: String(repeating: "0", count: 64),
                          plist: witness.plist, configuration: witness.configuration)
        }
        let pending = InstallationReceipt(
            id: fixture.id, name: fixture.name, applications: fixture.applications.identity,
            installed: interruption == .staleInstalled ? stale(prior) : prior,
            staged: interruption == .staleStage ? stale(candidate) : candidate, stageName: stageName
        )
        try fixture.receipts.write(pending, replacing: nil)
        let file = fixture.id + ".json"
        let receiptFile = try fixture.receipts.directory.openRegular(file, privateMode: true)
        if interruption == .afterExchange {
            let publisher = BundlePublisher(applications: fixture.applications, stage: stage, name: fixture.name,
                                            previous: prior, candidate: candidate)
            try #require(publisher.publish() == .published)
        }
        let beforeAtTarget = interruption == .afterExchange ? candidate : prior
        let beforeAtStage = interruption == .afterExchange ? prior : candidate
        let targetPath = fixture.applications.path + "/" + fixture.name
        let stagedPath = stage.path + "/" + fixture.name
        if interruption == .afterExchange || interruption == .staleStage {
            #expect(throws: FileRefusal.self) { try InstallationFiles.verify(bundlePath: stagedPath, staged: true) }
        } else {
            let validated = try InstallationFiles.verify(bundlePath: stagedPath, staged: true)
            #expect(validated.contents.witness == candidate)
        }
        if interruption == .staleInstalled {
            #expect(throws: FileRefusal.self) { try InstallationFiles.verify(bundlePath: targetPath, staged: false) }
        }
        func verifyUnchanged() throws {
            try fixture.receipts.directory.match(file, receiptFile, privateMode: true)
            try #require(try fixture.receipts.bytes(fixture.id) == pending.encode())
            try #require(try InstallationFiles.inspect(fixture.applications.child(fixture.name)).witness == beforeAtTarget)
            try #require(try InstallationFiles.inspect(stage.child(fixture.name)).witness == beforeAtStage)
            try #require(try fixture.scratch.names().isEmpty)
        }

        let final: InstallationReceipt
        if interruption == .staleStage || interruption == .staleInstalled {
            let stopped = fixture.invoke(dataDirectory: fixture.store)
            try #require(stopped.exitCode == 1)
            let expected = interruption == .staleStage
                ? "Publication could not be verified. Installer recovery is required."
                : "The Applications destination could not be authorized for this installation."
            try #require(stopped.output == expected)
            try verifyUnchanged()
            final = pending
        } else {
            let overlapping = targetPath + "/inside"
            let stopped = fixture.invoke(dataDirectory: overlapping)
            try #require(stopped.exitCode == 1)
            try #require(stopped.output == "The Applications destination could not be authorized for this installation.")
            try verifyUnchanged()

            let recovered = fixture.invoke(dataDirectory: fixture.store)
            try #require(recovered.exitCode == 0)
            try #require(recovered.output == "GraphGoblin was installed in Applications.")
            final = try InstallationReceipt.read(from: fixture.receipts.directory, id: fixture.id)
            let installed = try InstallationFiles.verify(bundlePath: targetPath, staged: false)
            try #require(final.stageName == nil && final.staged == nil)
            try #require(final.installed.bundle != beforeAtTarget.bundle)
            try #require(final.installed == installed.contents.witness)
            try #require(installed.contents.configuration.dataDirectory == fixture.store)
            try #require(try fixture.scratch.names().isEmpty)
            #expect(throws: FileRefusal.self) { try InstallationFiles.verify(bundlePath: targetPath, staged: true) }
        }
        let expectedAtTarget = final.stageName == nil ? final.installed : beforeAtTarget
        try fixture.removeBundle(from: fixture.applications, witness: expectedAtTarget)
        try fixture.removeBundle(from: stage, witness: beforeAtStage)
        try #require(try fixture.applications.child(stageName).identity == stage.identity)
        try #require(unlinkat(fixture.applications.fd, stageName, AT_REMOVEDIR) == 0)
        try fixture.receipts.discard(final)
        try fixture.scratch.requireAnchored()
        try FileManager.default.removeItem(atPath: fixture.scratch.path)
    }
}
