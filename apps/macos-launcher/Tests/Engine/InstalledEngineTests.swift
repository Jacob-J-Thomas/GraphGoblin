import Darwin
import Foundation
import LaunchContract
import Synchronization
@testable import LauncherEngine
import Testing

/// Only the hosted fixture driver may authorize tests that reach the real account's
/// Applications and Library trees. Everything below those roots has a fresh alternate ID.
private struct HostedEngineFixture: Sendable {
    let root: Directory
    let launcher: String
    let node: String

    static var enabled: Bool {
        ProcessInfo.processInfo.environment["GG_MACOS_COVERAGE_FIXTURE_ROOT"] != nil
    }

    init() throws {
        let env = ProcessInfo.processInfo.environment
        try #require(env["GITHUB_ACTIONS"] == "true")
        let rootPath = try #require(env["GG_MACOS_COVERAGE_FIXTURE_ROOT"])
        let runnerTemp = try canonicalPath(#require(env["RUNNER_TEMP"]))
        try #require(try canonicalPath(rootPath) == rootPath)
        try #require(rootPath.hasPrefix(runnerTemp + "/"))
        root = try Directory(path: rootPath)
        try root.requireOwnedDirectory(privateMode: true)
        launcher = try #require(env["GG_MACOS_COVERAGE_LAUNCHER"])
        node = try #require(env["GG_MACOS_COVERAGE_NODE"])
        try #require(try canonicalExecutable(launcher) == launcher)
        try #require(try canonicalExecutable(node) == node)
    }
}

private struct BoundEngineInstallation: Sendable {
    let home: String
    let root: Directory
    let applications: Directory
    let receipts: Directory
    let parent: Directory
    let bundle: Directory
    let receipt: InstallationReceipt
    let contents: BundleContents

    init(
        hosted: HostedEngineFixture, port: UInt16, staged: Bool = false, main: String = "",
        helper: String = #"""
            if (process.argv[2] === '--store-state') {
              process.stdout.write('{"state":"free"}\n')
            } else {
              process.stdout.write('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n')
            }
            """#
    ) throws {
        try #require(port != 4747 && port != 4748)
        let id = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
        let name = "GraphGoblin Engine Coverage \(id).app"
        let stageName = staged ? InstallationFiles.stagePrefix + id : nil
        home = try authenticatedHome()
        root = try hosted.root.createDirectory("engine-" + id)
        let checkout = try EngineCheckout(parent: root, main: main, helper: helper)
        applications = try InstallationFiles.applications(home: home, create: true)
        receipts = try InstallationFiles.receipts(home: home, create: true)
        if let stageName {
            parent = try applications.createDirectory(stageName)
        } else {
            parent = applications
        }
        bundle = try parent.createDirectory(name)
        let contentsDirectory = try bundle.createDirectory("Contents")
        let binaries = try contentsDirectory.createDirectory("MacOS")
        let resources = try contentsDirectory.createDirectory("Resources")
        let executable = try OwnedDescriptor(open(hosted.launcher, O_RDONLY | O_CLOEXEC | O_NOFOLLOW))
        let executableBytes = try readBounded(executable, maximum: 64 * 1024 * 1024)
        try #require(executableBytes.prefix(8).elementsEqual([0xCF, 0xFA, 0xED, 0xFE, 0x0C, 0, 0, 0x01]))
        try writeAll(binaries.createFile("GraphGoblin", mode: 0o700), executableBytes)
        let plist = try PropertyListSerialization.data(fromPropertyList: [
            "CFBundleExecutable": "GraphGoblin",
            "CFBundleIdentifier": AppName.bundleID(name: name, id: id),
            InstallationFiles.idKey: id
        ], format: .xml, options: 0)
        try writeAll(contentsDirectory.createFile("Info.plist"), plist)
        let configuration = try LauncherConfiguration(
            checkout: checkout.root.path, node: hosted.node, dataDirectory: root.path + "/store",
            port: port, requireAPIKey: false, ollamaEnabled: false, codexBinary: nil, claudeBinary: nil
        )
        try writeAll(resources.createFile("launcher.json"), configuration.encode())
        contents = try InstallationFiles.inspect(bundle)
        receipt = InstallationReceipt(id: id, name: name, applications: applications.identity,
                                      installed: contents.witness, stageName: stageName)
        try writeAll(receipts.createFile(id + ".json"), receipt.encode())
    }

    func engine() -> NativeLaunchEngine { NativeLaunchEngine(bundlePath: bundle.path) }

    func logDirectory(create: Bool) throws -> LogDirectory {
        try LogDirectory.open(for: VerifiedInstallation(home: home, name: receipt.name, contents: contents),
                              create: create)
    }

    func clean(logRoots: [Directory] = []) throws {
        try root.requireAnchored()
        try parent.requireAnchored()
        try receipts.requireAnchored()
        let record = try InstallationReceipt.read(from: receipts, id: receipt.id)
        try #require(try receipt.encode() == record.encode())
        try #require(try InstallationFiles.inspect(parent.child(receipt.name)).witness == contents.witness)
        for logRoot in logRoots {
            try logRoot.requireAnchored()
            let leaf = URL(fileURLWithPath: logRoot.path).lastPathComponent
            try #require(leaf == receipt.id || leaf == receipt.id + "-retired")
            try FileManager.default.removeItem(atPath: logRoot.path)
        }
        try FileManager.default.removeItem(atPath: bundle.path)
        try #require(unlinkat(receipts.fd, receipt.id + ".json", 0) == 0)
        if let stageName = receipt.stageName {
            try #require(unlinkat(applications.fd, stageName, AT_REMOVEDIR) == 0)
        }
        try FileManager.default.removeItem(atPath: root.path)
    }
}

private final class EngineProgress: Sendable {
    private let stages = Mutex<[String]>([])

    func append(_ stage: LaunchStage) {
        let name: String
        switch stage {
        case .checking: name = "checking"
        case .waitingForOtherLaunch: name = "waiting-for-other-launch"
        case .waitingForStore: name = "waiting-for-store"
        case .waitingForRelease: name = "waiting-for-release"
        case .starting: name = "starting"
        }
        stages.withLock { $0.append(name) }
    }

    var values: [String] { stages.withLock { $0 } }
}

@Suite(.enabled(if: HostedEngineFixture.enabled, "Requires the disposable hosted native coverage fixture"), .serialized)
struct InstalledEngineTests {
    @Test func stagedValidationChecksExactReceiptAndLocalStoreWithoutWriting() throws {
        let hosted = try HostedEngineFixture()
        let port = try FixtureSocket()
        let fixture = try BoundEngineInstallation(hosted: hosted, port: port.port, staged: true)
        let engine = fixture.engine()
        let validation = engine.validateStaged()
        try #require(validation.exitCode == 0)
        try #require(validation.bytes == Data(#"{"version":1,"code":"installation-valid"}"#.utf8) + Data([10]))
        try #require(HeadlessResult(engine.runHeadless()).code == "installation-invalid")
        try #require(try fixture.root.named("store") == nil)

        let store = try fixture.root.createDirectory("store")
        let database = try store.createFile("graphgoblin.db")
        let original = Data("do not rewrite this database".utf8)
        try writeAll(database, original)
        let databaseIdentity = FileIdentity(try database.metadata())
        let refused = engine.validateStaged()
        try #require(refused.exitCode == 13)
        try #require(refused.bytes == Data(#"{"version":1,"code":"key-source-unavailable"}"#.utf8) + Data([10]))
        try #require(try store.names() == ["graphgoblin.db"])
        try #require(try store.named("graphgoblin.db").map(FileIdentity.init) == databaseIdentity)
        try #require(try readBounded(store.openRegular("graphgoblin.db"), maximum: 128) == original)
        try fixture.clean()
    }

    @Test func foreignHealthPreventsSpawnAndRecordsOnlyTheClosedRefusal() async throws {
        let hosted = try HostedEngineFixture()
        let health = LoopbackTests.health(fingerprint: String(repeating: "b", count: 64))
        let peer = try ScriptedLoopbackPeer([.bytes(health)])
        let fixture = try BoundEngineInstallation(
            hosted: hosted, port: peer.port, main: "throw new Error('must not run')"
        )
        let progress = EngineProgress()
        let engine = fixture.engine()
        let first = HeadlessResult(await engine.run { progress.append($0) })
        let log = try fixture.logDirectory(create: false)
        try #require(first.code == "port-in-use")
        try #require(first.exitCode == 20)
        try #require(first.bytes == Data("{\"version\":1,\"code\":\"port-in-use\",\"port\":\(peer.port)}\n".utf8))
        try #require(HeadlessResult(engine.runHeadless()).code == "unexpected")
        try #require(progress.values == ["checking"])
        let requests = try peer.requests()
        try #require(requests.count == 1)
        try #require(requests.first?.hasPrefix("GET /healthz ") == true)
        try #require(try fixture.root.named("store") == nil)
        try #require(try log.root.names() == ["launcher.log"])
        try #require(try readBounded(log.root.openRegular("launcher.log"), maximum: 4_096)
                     == Data("stage=checking outcome=port-in-use\n".utf8))
        try fixture.clean(logRoots: [log.root])
    }

    @Test func warmShutdownModeUsesBoundShellsWithoutStartingAChild() async throws {
        let hosted = try HostedEngineFixture()
        let peer = try ScriptedLoopbackPeer([
            .bytes(LoopbackTests.health()),
            .bytes(LoopbackTests.shell(LoopbackTests.app)), .bytes(LoopbackTests.shell(LoopbackTests.goblin)),
            .bytes(LoopbackTests.health(phase: "draining"))
        ])
        let fixture = try BoundEngineInstallation(
            hosted: hosted, port: peer.port, main: "throw new Error('must not run')"
        )
        let progress = EngineProgress()
        let result = HeadlessResult(await fixture.engine().run { progress.append($0) })
        try #require(result.exitCode == 0)
        try #require(result.code == "open-management-observe-shutdown")
        try #require(progress.values == ["checking"])
        let requests = try peer.requests()
        try #require(requests.compactMap { $0.split(separator: " ").dropFirst().first.map { String($0) } }
                     == ["/healthz", "/app/", "/goblin/", "/healthz"])
        try #require(try fixture.root.named("store") == nil)
        let authorization = await fixture.engine().authorizeShowLog()
        try #require(authorization == nil)
        try fixture.clean()
    }

    @Test func coldCommitBindsDirectChildAndWarmAttemptKeepsItsPID() async throws {
        let hosted = try HostedEngineFixture()
        let port = try FixtureSocket().port
        let token = UUID().uuidString
        let main = #"""
            import { appendFileSync, writeFileSync } from 'node:fs'
            import { createServer } from 'node:http'

            writeFileSync('spawn-pid', String(process.pid) + '\n', { mode: 0o600, flag: 'wx' })
            const server = createServer((request, response) => {
              appendFileSync('requests', request.method + ' ' + request.url + '\n', { mode: 0o600 })
              const reply = (code, type, body, fields = {}) => {
                response.writeHead(code, {
                  'content-type': type, 'content-length': Buffer.byteLength(body), ...fields
                })
                response.end(body)
              }
              if (request.url === '/healthz' && request.method === 'GET') {
                reply(200, 'application/json', '{"status":"ok"}', {
                  'x-graphgoblin-instance': 'a'.repeat(64),
                  'x-graphgoblin-pid': String(process.pid),
                  'x-graphgoblin-phase': 'running'
                })
              } else if (request.method === 'GET' && request.url === '/app/') {
                reply(200, 'text/html', '<html>management</html>')
              } else if (request.method === 'GET' && request.url === '/goblin/') {
                reply(200, 'text/html', '<html>Goblin</html>')
              } else if (request.url === '/fixture-drain' && request.method === 'POST'
                         && request.headers['x-fixture-control'] === '\#(token)') {
                reply(202, 'application/json', '{"closed":true}')
                server.close()
              } else {
                reply(404, 'text/plain', 'unexpected fixture request')
              }
            })
            const limit = setTimeout(() => server.close(), 15_000)
            limit.unref()
            server.once('close', () => clearTimeout(limit))
            server.listen(Number(process.env.GG_PORT), '127.0.0.1')
            """#
        let fixture = try BoundEngineInstallation(hosted: hosted, port: port, main: main)
        let cold = EngineProgress()
        let coldResult = HeadlessResult(await fixture.engine().run { cold.append($0) })
        try #require(coldResult.exitCode == 0)
        try #require(coldResult.code == "open-management-running")
        try #require(coldResult.bytes == Data("{\"version\":1,\"code\":\"open-management-running\",\"port\":\(port)}\n".utf8))
        try #require(cold.values == ["checking", "starting"])

        let checkout = try fixture.root.child("checkout")
        let witness = try checkout.openRegular("spawn-pid", privateMode: true)
        let pidBytes = try readBounded(witness, maximum: 32)
        let pidText = String(decoding: pidBytes, as: UTF8.self)
        let pid = try #require(Int32(pidText.dropLast()))
        try #require(pid > 0 && pidText == "\(pid)\n")
        let child = DirectChild(pid: pid)
        try #require(child.observe() == .running)

        let warm = EngineProgress()
        let warmResult = HeadlessResult(await fixture.engine().run { warm.append($0) })
        try #require(warmResult.bytes == coldResult.bytes)
        try #require(warm.values == ["checking"])
        try #require(child.observe() == .running)
        try checkout.match("spawn-pid", witness, privateMode: true)

        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 2
        config.timeoutIntervalForResource = 3
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel() }
        let base = "http://127.0.0.1:\(port)"
        let (identityBytes, identityResponse) = try await session.data(from: #require(URL(string: base + "/healthz")))
        let identity = try #require(identityResponse as? HTTPURLResponse)
        try #require(identity.statusCode == 200)
        try #require(identity.value(forHTTPHeaderField: "X-GraphGoblin-Instance") == LoopbackTests.fingerprint)
        try #require(identity.value(forHTTPHeaderField: "X-GraphGoblin-Pid") == String(pid))
        try #require(identityBytes == Data(#"{"status":"ok"}"#.utf8))
        try #require(child.observe() == .running)

        var stop = URLRequest(url: try #require(URL(string: base + "/fixture-drain")))
        stop.httpMethod = "POST"
        stop.setValue(token, forHTTPHeaderField: "X-Fixture-Control")
        let (stopBytes, stopResponse) = try await session.data(for: stop)
        try #require((stopResponse as? HTTPURLResponse)?.statusCode == 202)
        try #require(stopBytes == Data(#"{"closed":true}"#.utf8))
        let deadline = AttemptTime(seconds: 3)
        while child.observe() == .running && !deadline.expired { deadline.pause() }
        try #require(child.observe() == .exited(0))
        let trace = try readBounded(checkout.openRegular("requests", privateMode: true), maximum: 1_024)
        try #require(String(decoding: trace, as: UTF8.self) == """
            GET /healthz
            GET /app/
            GET /goblin/
            GET /healthz
            GET /healthz
            GET /app/
            GET /goblin/
            GET /healthz
            GET /healthz
            POST /fixture-drain

            """)
        let log = try fixture.logDirectory(create: false)
        try #require(try log.root.names().isEmpty)
        try #require(try fixture.root.named("store") == nil)
        try fixture.clean(logRoots: [log.root])
    }

    @Test func refusedDiagnosticsPreventChildCommitAndPreserveForeignGatewaySlot() async throws {
        let hosted = try HostedEngineFixture()
        let reservation = try FixtureSocket()
        let fixture = try BoundEngineInstallation(
            hosted: hosted, port: reservation.port, main: "throw new Error('must not run')"
        )
        let log = try fixture.logDirectory(create: true)
        let original = Data("foreign gateway slot\n".utf8)
        let kept = try log.root.createFile("keep")
        try writeAll(kept, original)
        try #require(symlinkat("keep", log.root.fd, "gateway.log.1") == 0)
        let symlink = try #require(log.root.named("gateway.log.1"))
        let progress = EngineProgress()
        let result = HeadlessResult(await fixture.engine().run { progress.append($0) })
        withExtendedLifetime(reservation) {}
        try #require(result.exitCode == 25)
        try #require(result.code == "diagnostics-unavailable")
        try #require(progress.values == ["checking"])
        try #require(try fixture.root.named("store") == nil)
        try #require(try log.root.named("gateway.log.1").map(FileIdentity.init) == FileIdentity(symlink))
        try #require(try readBounded(log.root.openRegular("keep"), maximum: 256) == original)
        try #require(try log.root.names() == ["keep", "gateway.log.1", "launcher.log"])
        try #require(try readBounded(log.root.openRegular("launcher.log"), maximum: 4_096)
                     == Data("stage=checking outcome=diagnostics-unavailable child=destination-unavailable\n".utf8))
        try fixture.clean(logRoots: [log.root])
    }

    @Test func outstandingShowLogAuthorizationCannotFollowAReplacementRoot() async throws {
        let hosted = try HostedEngineFixture()
        let socket = try FixtureSocket()
        let fixture = try BoundEngineInstallation(hosted: hosted, port: socket.port)
        let engine = fixture.engine()
        let absent = await engine.authorizeShowLog()
        try #require(absent == nil)
        let log = try fixture.logDirectory(create: true)
        let offered = await engine.authorizeShowLog()
        let authorization = try #require(offered)
        let verified = await engine.revalidateShowLog(authorization)
        try #require(verified?.path == log.root.path)
        let retiredName = fixture.receipt.id + "-retired"
        try #require(renameat(log.parent.fd, fixture.receipt.id, log.parent.fd, retiredName) == 0)
        let replacement = try log.parent.createDirectory(fixture.receipt.id)
        try #require(replacement.identity != log.root.identity)
        let stale = await engine.revalidateShowLog(authorization)
        try #require(stale == nil)
        let replacementOffer = await engine.authorizeShowLog()
        let renewed = try #require(replacementOffer)
        let verifiedReplacement = await engine.revalidateShowLog(renewed)
        try #require(verifiedReplacement?.path == replacement.path)
        let retired = try log.parent.child(retiredName)
        try #require(retired.identity == log.root.identity)
        try fixture.clean(logRoots: [replacement, retired])
    }

    @Test func quitDuringCooperatingLockWaitNeverCommitsOrWritesDiagnostics() async throws {
        let hosted = try HostedEngineFixture()
        let reservation = try FixtureSocket()
        let fixture = try BoundEngineInstallation(hosted: hosted, port: reservation.port)
        let installation = try InstallationFiles.verify(bundlePath: fixture.bundle.path, staged: false)
        let inputs = try LaunchInputs(installation)
        let lock = try CooperatingLocks.acquire(
            for: inputs, limit: OperationLimit(time: AttemptTime(seconds: 3), quitting: { false }),
            onContention: { Issue.record("Fixture's fresh launcher lock should be free") }
        )
        let engine = fixture.engine()
        let progress = EngineProgress()
        let outcome = await engine.run { stage in
            progress.append(stage)
            if case .waitingForOtherLaunch = stage { engine.requestQuit() }
        }
        withExtendedLifetime((reservation, lock)) {}
        try #require(HeadlessResult(outcome).exitCode == 40)
        try #require(progress.values == ["checking", "waiting-for-other-launch"])
        try #require(try fixture.root.named("store") == nil)
        let authorization = await engine.authorizeShowLog()
        try #require(authorization == nil)
        try fixture.clean()
    }

    @Test func quitWhileObservingHeldStoreOrReleasingPeerPreventsCommit() async throws {
        let hosted = try HostedEngineFixture()
        let reservation = try FixtureSocket()
        let held = try BoundEngineInstallation(hosted: hosted, port: reservation.port, helper: #"""
            const value = process.argv[2] === '--store-state' ? JSON.stringify({
              state: 'held', path: process.env.GG_DATA_DIR + '/graphgoblin.lock', detail: 'fixture owner'
            }) : 'a'.repeat(64)
            process.stdout.write(value + '\n')
            """#)
        let peer = try ScriptedLoopbackPeer([.bytes(LoopbackTests.health(phase: "ready"))])
        let releasing = try BoundEngineInstallation(hosted: hosted, port: peer.port)
        for (fixture, waiting) in [(held, "waiting-for-store"), (releasing, "waiting-for-release")] {
            let engine = fixture.engine()
            let progress = EngineProgress()
            let outcome = await engine.run { stage in
                progress.append(stage)
                switch stage {
                case .waitingForStore, .waitingForRelease: engine.requestQuit()
                default: break
                }
            }
            try #require(HeadlessResult(outcome).exitCode == 40)
            try #require(progress.values == ["checking", waiting])
            try #require(try fixture.root.named("store") == nil)
            let authorization = await engine.authorizeShowLog()
            try #require(authorization == nil)
            try fixture.clean()
        }
        withExtendedLifetime(reservation) {}
        let requests = try peer.requests()
        try #require(requests.count == 1)
        try #require(requests.first?.hasPrefix("GET /healthz ") == true)
    }

    @Test(arguments: [70, 71, 72, 73, 74, 75, 76, 143])
    func committedChildExitProducesItsBoundedDiagnosticCategory(code: Int) async throws {
        let hosted = try HostedEngineFixture()
        let reservation = try FixtureSocket()
        let action = code == 143 ? "process.kill(process.pid, 'SIGTERM')" : "process.exit(\(code))"
        let fixture = try BoundEngineInstallation(hosted: hosted, port: reservation.port, main: action)
        let progress = EngineProgress()
        let result = HeadlessResult(await fixture.engine().run { progress.append($0) })
        withExtendedLifetime(reservation) {}
        let categories = [
            70: "destination-in-use", 71: "destination-unavailable", 72: "import-failed-logged",
            73: "import-failed-unlogged", 74: "startup-failed-logged", 75: "startup-failed-unlogged",
            76: "unknown-child-exit", 143: "child-signaled"
        ]
        let diagnostic = "stage=starting outcome=child-exited child=" + (try #require(categories[code])) + "\n"
        try #require(result.code == "child-exited")
        try #require(result.exitCode == 31)
        try #require(progress.values == ["checking", "starting"])
        try #require(try fixture.root.named("store") == nil)
        let log = try fixture.logDirectory(create: false)
        try #require(try log.root.names() == ["launcher.log"])
        try #require(try readBounded(log.root.openRegular("launcher.log"), maximum: 4_096) == Data(diagnostic.utf8))
        try fixture.clean(logRoots: [log.root])
    }
}
