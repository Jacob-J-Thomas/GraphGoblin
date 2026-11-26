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

    func invoke(dataDirectory: String, releaseBinary: String? = nil) -> InstallerResult {
        LauncherInstaller.run([
            checkout, releaseBinary ?? launcher, node, "--", "--app-name", name,
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

    var target: String { applications.path + "/" + name }

    /// Other hosted suites may add or remove their own stages concurrently. This bundle's name is
    /// unique, so a stage holding it can only have come from this fixture's installer runs.
    func stagesHoldingBundle() throws -> [String] {
        try applications.names().filter { entry in
            guard entry.hasPrefix(InstallationFiles.stagePrefix),
                  let stage = try? applications.child(entry) else { return false }
            return (try? stage.named(name)) != nil
        }.sorted()
    }

    func receiptsNamingBundle() throws -> [String] {
        try receipts.directory.names().filter { file in
            guard file.hasSuffix(".json") else { return false }
            let id = String(file.dropLast(".json".count))
            return (try? InstallationReceipt.read(from: receipts.directory, id: id))?.name == name
        }.sorted()
    }

    /// Installs through the public installer with the ordinary private data directory.
    func installOrdinary() throws -> (installed: VerifiedInstallation, receipt: InstallationReceipt) {
        let result = invoke(dataDirectory: store)
        try #require(result.exitCode == 0)
        try #require(result.output == "GraphGoblin was installed in Applications.")
        let installed = try InstallationFiles.verify(bundlePath: target, staged: false)
        let receipt = try InstallationReceipt.read(from: receipts.directory, id: installed.contents.id)
        try #require(receipt.name == name && receipt.stageName == nil && receipt.staged == nil)
        try #require(receipt.installed == installed.contents.witness)
        try #require(installed.contents.configuration.dataDirectory == store)
        return (installed, receipt)
    }

    func removeInstallation(_ receipt: InstallationReceipt) throws {
        try removeBundle(from: applications, witness: receipt.installed)
        try receipts.discard(receipt)
        try #require(try stagesHoldingBundle().isEmpty)
        try #require(try receiptsNamingBundle().isEmpty)
        try scratch.requireAnchored()
        try FileManager.default.removeItem(atPath: scratch.path)
    }

    /// The refused reinstall left the original receipt file, its bytes, the target and every stage alone.
    func requireUntouched(receipt file: OwnedDescriptor, bytes: Data, id: String, bundle: FileIdentity) throws {
        try receipts.directory.match(id + ".json", file, privateMode: true)
        try #require(try receipts.bytes(id) == bytes)
        try #require(try receiptsNamingBundle() == [id + ".json"])
        try #require(try applications.child(name).identity == bundle)
        try #require(try stagesHoldingBundle().isEmpty)
        try #require(try scratch.names().isEmpty)
    }
}

private let destinationRefusal = "The Applications destination could not be authorized for this installation."

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

    enum PublicModes: String, CaseIterable, Sendable {
        case privateControl, executable, plist, both
    }

    /// Inspection admits a 0755 executable and a 0644 plist. Cleanup of the replaced bundle must use
    /// the same rule; the configuration remains private. Each step replaces the bundle the previous
    /// step published, so every mode is cleaned from a genuine public installation.
    @Test func reinstallRemovesTheReplacedBundleUnderItsAdmittedModes() throws {
        let fixture = try HostedInstaller()
        var (installed, receipt) = try fixture.installOrdinary()
        let id = installed.contents.id
        for modes in PublicModes.allCases {
            let previous = try fixture.applications.child(fixture.name)
            let contents = try previous.child("Contents")
            let executable = try contents.child("MacOS").openRegular("GraphGoblin")
            let plist = try contents.openRegular("Info.plist")
            let config = try contents.child("Resources").openRegular("launcher.json", privateMode: true)
            let publicExecutable = modes == .executable || modes == .both
            let publicPlist = modes == .plist || modes == .both
            try #require(fchmod(executable.fd, publicExecutable ? 0o755 : 0o700) == 0)
            try #require(fchmod(plist.fd, publicPlist ? 0o644 : 0o600) == 0)
            let admitted = try InstallationFiles.verify(bundlePath: fixture.target, staged: false)
            try #require(admitted.contents.witness == receipt.installed, "\(modes)")

            let reinstalled = fixture.invoke(dataDirectory: fixture.store)
            try #require(reinstalled.exitCode == 0, "\(modes)")
            try #require(reinstalled.output == "GraphGoblin was installed in Applications.", "\(modes)")
            installed = try InstallationFiles.verify(bundlePath: fixture.target, staged: false)
            let final = try InstallationReceipt.read(from: fixture.receipts.directory, id: id)
            try #require(installed.contents.id == id && installed.name == fixture.name)
            try #require(installed.contents.bundleID == AppName.bundleID(name: fixture.name, id: id))
            try #require(final.applications == fixture.applications.identity)
            try #require(final.stageName == nil && final.staged == nil)
            try #require(final.installed == installed.contents.witness)
            try #require(final.installed.bundle != receipt.installed.bundle)
            try #require(try fixture.receiptsNamingBundle() == [id + ".json"])
            // The replaced bundle's files were unlinked and its stage removed, not left for recovery.
            for file in [executable, plist, config] {
                try #require(try file.metadata().st_nlink == 0, "\(modes)")
            }
            try #require(try fixture.stagesHoldingBundle().isEmpty, "\(modes)")
            try #require(try fixture.scratch.names().isEmpty)
            receipt = final
        }
        try fixture.removeInstallation(receipt)
    }

    /// A public configuration or a group-writable file is not admitted, so a reinstall refuses before
    /// it writes a pending receipt, creates a stage or touches the target.
    @Test func nonAdmittedModesRefuseBeforeReceiptOrTargetChange() throws {
        let fixture = try HostedInstaller()
        let (installed, receipt) = try fixture.installOrdinary()
        let id = installed.contents.id
        let receiptFile = try fixture.receipts.directory.openRegular(id + ".json", privateMode: true)
        let receiptBytes = try fixture.receipts.bytes(id)
        let bundle = try fixture.applications.child(fixture.name)
        let contents = try bundle.child("Contents")
        let cases: [(String, OwnedDescriptor, mode_t, mode_t)] = [
            ("public configuration", try contents.child("Resources").openRegular("launcher.json", privateMode: true),
             0o644, 0o600),
            ("group-writable executable", try contents.child("MacOS").openRegular("GraphGoblin"), 0o775, 0o700),
            ("group-writable plist", try contents.openRegular("Info.plist"), 0o664, 0o600)
        ]
        for (label, file, refused, restored) in cases {
            try #require(fchmod(file.fd, refused) == 0)
            #expect(throws: FileRefusal.self, "\(label)") {
                try InstallationFiles.verify(bundlePath: fixture.target, staged: false)
            }
            let stopped = fixture.invoke(dataDirectory: fixture.store)
            try #require(stopped.exitCode == 1, "\(label)")
            try #require(stopped.output == destinationRefusal, "\(label)")
            try fixture.requireUntouched(receipt: receiptFile, bytes: receiptBytes, id: id, bundle: bundle.identity)
            try #require(fchmod(file.fd, restored) == 0)
            let verified = try InstallationFiles.verify(bundlePath: fixture.target, staged: false)
            try #require(verified.contents.witness == installed.contents.witness, "\(label)")
        }
        try fixture.removeInstallation(receipt)
    }

    /// A harmless read entry naming no real principal on the plist or on an interior directory refuses
    /// ordinary installed verification and a public reinstall. Clearing it restores the same bundle.
    @Test func managedObjectACLRefusesVerificationAndReinstall() throws {
        let fixture = try HostedInstaller()
        let (installed, receipt) = try fixture.installOrdinary()
        let id = installed.contents.id
        let receiptFile = try fixture.receipts.directory.openRegular(id + ".json", privateMode: true)
        let receiptBytes = try fixture.receipts.bytes(id)
        let bundle = try fixture.applications.child(fixture.name)
        let contents = try bundle.child("Contents")
        let objects: [(String, OwnedDescriptor)] = [
            ("Info.plist", try contents.openRegular("Info.plist")), ("MacOS", try contents.child("MacOS").handle)
        ]
        for (label, handle) in objects {
            try attachHarmlessACL(handle.fd)
            #expect(throws: FileRefusal.self, "\(label)") {
                try InstallationFiles.verify(bundlePath: fixture.target, staged: false)
            }
            let stopped = fixture.invoke(dataDirectory: fixture.store)
            try #require(stopped.exitCode == 1, "\(label)")
            try #require(stopped.output == destinationRefusal, "\(label)")
            try fixture.requireUntouched(receipt: receiptFile, bytes: receiptBytes, id: id, bundle: bundle.identity)
            try clearACL(handle.fd)
            let verified = try InstallationFiles.verify(bundlePath: fixture.target, staged: false)
            try #require(verified.contents.witness == installed.contents.witness, "\(label)")
        }
        try fixture.removeInstallation(receipt)
    }

    /// On the hosted case-insensitive Applications volume, a data directory spelled as a different-case
    /// alias of a not-yet-installed target, or a path inside that alias, names the bundle itself.
    @Test func alternateCaseAliasOfAFreshTargetIsRefused() throws {
        let fixture = try HostedInstaller()
        // A case-sensitive volume has no alias to refuse; its distinct-sibling rule is covered through the
        // semantics seam in ProspectiveOverlapTests. This test needs, and checks for, the insensitive volume.
        try #require(try LauncherInstaller.caseSensitiveNames(fixture.applications) == false)
        let alias = fixture.applications.path + "/" + fixture.name.lowercased()
        try #require(alias != fixture.target)
        for dataDirectory in [alias, alias + "/store"] {
            let refused = fixture.invoke(dataDirectory: dataDirectory)
            try #require(refused.exitCode == 1, "\(dataDirectory)")
            try #require(refused.output == destinationRefusal, "\(dataDirectory)")
            try #require(try fixture.applications.named(fixture.name) == nil)
            try #require(try fixture.stagesHoldingBundle().isEmpty)
            try #require(try fixture.receiptsNamingBundle().isEmpty)
            try #require(try fixture.scratch.names().isEmpty)
        }
        // An input the comparison cannot evaluate component by component refuses; it never admits.
        let release = URL(fileURLWithPath: fixture.launcher)
        let uncomparable = release.deletingLastPathComponent().path + "/./" + release.lastPathComponent
        let unresolved = fixture.invoke(dataDirectory: fixture.store, releaseBinary: uncomparable)
        try #require(unresolved.exitCode == 1)
        try #require(unresolved.output == destinationRefusal)
        try #require(try fixture.applications.named(fixture.name) == nil)
        try #require(try fixture.stagesHoldingBundle().isEmpty)
        try #require(try fixture.receiptsNamingBundle().isEmpty)

        let sibling = alias + " data"
        let admitted = fixture.invoke(dataDirectory: sibling)
        try #require(admitted.exitCode == 0)
        try #require(admitted.output == "GraphGoblin was installed in Applications.")
        let installed = try InstallationFiles.verify(bundlePath: fixture.target, staged: false)
        try #require(installed.contents.configuration.dataDirectory == sibling)
        try #require(try fixture.applications.named(URL(fileURLWithPath: sibling).lastPathComponent) == nil)
        let receipt = try InstallationReceipt.read(from: fixture.receipts.directory, id: installed.contents.id)
        try #require(receipt.installed == installed.contents.witness && receipt.stageName == nil)
        try fixture.removeInstallation(receipt)
    }
}
