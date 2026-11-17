import Darwin
import Foundation
import LaunchContract
@testable import LauncherEngine
import Testing

struct EngineCheckout {
    let root: Directory
    let api: Directory
    let web: Directory
    let goblin: Directory

    init(parent: Directory, main: String = "", helper: String = "") throws {
        root = try parent.createDirectory("checkout")
        let apps = try root.createDirectory("apps")
        api = try apps.createDirectory("api").createDirectory("dist")
        let webApp = try apps.createDirectory("web")
        web = try webApp.createDirectory("dist")
        goblin = try webApp.createDirectory("dist-goblin")
        let logs = try api.createDirectory("macos-log")
        let managed = try api.createDirectory("managed-log")
        try writeAll(api.createFile("main.js"), Data(
            ("export const MACOS_LAUNCHER_LOG_PROTOCOL = 1;\n" + main).utf8
        ))
        try writeAll(api.createFile("instance-identity.js"), Data(("// fixture helper\n" + helper).utf8))
        try writeAll(logs.createFile("guard.js"), Data("// macOS guard\n".utf8))
        try writeAll(managed.createFile("guard.js"), Data("// managed guard\n".utf8))
        try writeAll(managed.createFile("gateway-log-writer.js"), Data("// managed writer\n".utf8))
        try writeAll(web.createFile("index.html"), LoopbackTests.app)
        try writeAll(goblin.createFile("index.html"), LoopbackTests.goblin)
        try writeAll(root.createFile("package.json"), Data(#"{"type":"module"}"#.utf8))
    }

    func makeExecutable(_ script: String, name: String = "fixture-node") throws -> String {
        try writeAll(root.createFile(name, mode: 0o700), Data(("#!/bin/sh\n" + script + "\n").utf8))
        return root.path + "/" + name
    }
}

@Suite struct LaunchInputsTests {
    private func fixture(
        _ script: String = "printf '%s\\n' 'darwin,arm64,22.22.2'",
        run: (TemporaryEngineDirectory, EngineCheckout, LauncherConfiguration) throws -> Void
    ) throws {
        let scratch = try TemporaryEngineDirectory()
        defer { scratch.remove() }
        let checkout = try EngineCheckout(parent: scratch.root)
        let node = try checkout.makeExecutable(script)
        let config = try LauncherConfiguration(
            checkout: checkout.root.path, node: node, dataDirectory: scratch.root.path + "/store α%",
            port: 45123, requireAPIKey: true, ollamaEnabled: false,
            codexBinary: node, claudeBinary: node
        )
        try run(scratch, checkout, config)
    }

    private func inputs(_ scratch: TemporaryEngineDirectory, _ config: LauncherConfiguration) throws -> LaunchInputs {
        let witness = BundleWitness(bundle: scratch.root.identity, executable: "", plist: "", configuration: "")
        let contents = BundleContents(id: "", bundleID: AppName.standardBundleID, witness: witness, configuration: config)
        return try LaunchInputs(VerifiedInstallation(home: scratch.root.path, name: AppName.standard, contents: contents))
    }

    private func expectLaunchRefusal(_ code: String, perform: () throws -> Void) {
        do {
            try perform()
            Issue.record("Expected refusal \(code)")
        } catch let refusal as LaunchRefusal {
            #expect(HeadlessResult(refusal.outcome).code == code)
        } catch {
            Issue.record("Expected closed launch refusal \(code), received \(error)")
        }
    }

    @Test func launchInputsBindClosedEnvironmentAndExactShellBytes() throws {
        try fixture { scratch, checkout, config in
            let inputs = try inputs(scratch, config)
            #expect(inputs.main == checkout.api.path + "/main.js")
            #expect(inputs.helper == checkout.api.path + "/instance-identity.js")
            #expect(inputs.appHTML == LoopbackTests.app)
            #expect(inputs.goblinHTML == LoopbackTests.goblin)
            let command = inputs.gateway(admission: "verified-admission")
            #expect(command.executable == config.node)
            #expect(command.arguments == [inputs.main])
            #expect(command.cwd == checkout.root.path)
            let expected = [
                "HOME": scratch.root.path,
                "PATH": checkout.root.path + ":/usr/bin:/bin:/usr/sbin:/sbin",
                "GG_HOST": "127.0.0.1",
                "GG_PORT": "45123",
                "GG_DATA_DIR": config.dataDirectory,
                "GG_DB_URL": config.databaseURI,
                "GG_WEB_DIST": checkout.web.path,
                "GG_GOBLIN_DIST": checkout.goblin.path,
                "GG_REQUIRE_API_KEY": "true",
                "GG_OLLAMA_ENABLED": "false",
                "GG_CODEX_BINARY": config.node,
                "GG_CLAUDE_BINARY": config.node,
                "GG_MACOS_LAUNCHER_LOG_ADMISSION": "verified-admission"
            ]
            let env = command.environment.filter { !["LANG", "TMPDIR"].contains($0.key) }
            #expect(env == expected)
            #expect(command.environment["LANG"]?.isEmpty == false)
            if let tmp = command.environment["TMPDIR"] {
                #expect(try canonicalPath(tmp) == tmp)
                try Directory(path: tmp).requireOwnedDirectory(privateMode: true)
            }
            let encoded = try LauncherConfiguration(data: config.encode())
            #expect(encoded.checkout == config.checkout)
            #expect(encoded.node == config.node)
            #expect(encoded.dataDirectory == config.dataDirectory)
            #expect(encoded.port == 45123)
            #expect(encoded.requireAPIKey)
            #expect(!encoded.ollamaEnabled)
            #expect(encoded.codexBinary == config.node)
            #expect(encoded.claudeBinary == config.node)
        }
    }

    @Test func missingAndForeignBuiltInputsHaveClosedRefusals() throws {
        try fixture { scratch, checkout, config in
            let goblin = checkout.goblin.path + "/index.html"
            try FileManager.default.removeItem(atPath: goblin)
            expectLaunchRefusal("assets-unavailable") { _ = try inputs(scratch, config) }
            try #require(symlink(checkout.web.path + "/index.html", goblin) == 0)
            expectLaunchRefusal("assets-unavailable") { _ = try inputs(scratch, config) }
            try #require(unlink(goblin) == 0)
            try writeAll(checkout.goblin.createFile("index.html"), LoopbackTests.goblin)

            let markerless = checkout.api.path + "/main.js"
            try Data("export const unrelated = 1;\n".utf8).write(to: URL(fileURLWithPath: markerless))
            expectLaunchRefusal("installation-invalid") { _ = try inputs(scratch, config) }
            try FileManager.default.removeItem(atPath: config.node)
            expectLaunchRefusal("runtime-unavailable") { _ = try inputs(scratch, config) }
        }
    }

    @Test func absentEmptyAndKeyedStoresAreReadOnlyWhileKeylessContentIsRefused() throws {
        try fixture { scratch, _, config in
            let inputs = try inputs(scratch, config)
            let name = URL(fileURLWithPath: config.dataDirectory).lastPathComponent
            try inputs.requireLocalKey()
            #expect(try scratch.root.named(name) == nil)
            let store = try scratch.root.createDirectory(name)
            try inputs.requireLocalKey()
            #expect(try store.names().isEmpty)
            let bytes = Data("existing database bytes".utf8)
            let database = try store.createFile("graphgoblin.db")
            try writeAll(database, bytes)
            let identity = FileIdentity(try database.metadata())
            expectLaunchRefusal("key-source-unavailable") { try inputs.requireLocalKey() }
            #expect(try store.names() == ["graphgoblin.db"])
            #expect(try store.named("graphgoblin.db").map(FileIdentity.init) == identity)
            #expect(try readBounded(store.openRegular("graphgoblin.db"), maximum: 128) == bytes)

            try #require(symlinkat("graphgoblin.db", store.fd, "master.key") == 0)
            expectLaunchRefusal("key-source-unavailable") { try inputs.requireLocalKey() }
            try #require(unlinkat(store.fd, "master.key", 0) == 0)
            let key = try store.createFile("master.key")
            let keyBytes = Data(repeating: 42, count: 32)
            try writeAll(key, keyBytes)
            try inputs.requireLocalKey()
            #expect(try readBounded(store.openRegular("master.key"), maximum: 32) == keyBytes)

            try #require(linkat(store.fd, "graphgoblin.db", store.fd, "alias", 0) == 0)
            expectLaunchRefusal("key-source-unavailable") { try inputs.requireLocalKey() }
            #expect(try store.names() == ["graphgoblin.db", "alias", "master.key"])
            #expect(try store.named("alias").map(FileIdentity.init) == identity)
        }
    }

    @Test(arguments: [
        "printf '%s\\n' 'darwin,arm64,22.22.1'",
        "printf '%s' 'darwin,arm64,22.22.2'",
        "printf 'darwin,arm64,22.22.2\\r\\n'",
        "printf 'darwin,arm64,22.22.2\\nsecond\\n'",
        "printf '\\377\\n'",
        "printf '\\n'",
        "printf '%s\\n' 'darwin,arm64,22.22.2'; printf '%s' diagnostic >&2",
        "printf '%s\\n' 'darwin,arm64,22.22.2'; exit 7"
    ])
    func runtimeRefusesPartialMalformedNoisyAndFailedHelpers(script: String) throws {
        try fixture(script) { scratch, _, config in
            let inputs = try inputs(scratch, config)
            try normalizeChildStatusDisposition()
            let limit = OperationLimit(time: AttemptTime(seconds: 3), quitting: { false })
            expectLaunchRefusal("runtime-unavailable") { try inputs.verifyRuntime(limit) }
        }
    }

    @Test func cancellationAndDeadlineFollowOperationRules() throws {
        try fixture { scratch, _, config in
            let inputs = try inputs(scratch, config)
            let cancelled = OperationLimit(time: AttemptTime(seconds: 3), quitting: { true })
            let expired = OperationLimit(time: AttemptTime(seconds: 0), quitting: { false })
            do {
                try inputs.verifyRuntime(cancelled)
                Issue.record("A cancelled runtime probe must stop before work")
            } catch OperationRefusal.cancelled {}
            do {
                try inputs.verifyRuntime(expired)
                Issue.record("An expired runtime probe must report the attempt deadline")
            } catch OperationRefusal.deadline {}
            do {
                _ = try inputs.fingerprint(cancelled)
                Issue.record("A cancelled fingerprint must preserve cancellation")
            } catch OperationRefusal.cancelled {}
            expectLaunchRefusal("cannot-verify") { _ = try inputs.fingerprint(expired) }
        }
    }

    @Test func fingerprintIsExactlyOneLowercaseHexRecord() throws {
        let fingerprint = LoopbackTests.fingerprint
        try fixture("printf '%s\\n' '\(fingerprint)'") { scratch, _, config in
            let inputs = try inputs(scratch, config)
            try normalizeChildStatusDisposition()
            let limit = OperationLimit(time: AttemptTime(seconds: 3), quitting: { false })
            #expect(try inputs.fingerprint(limit) == fingerprint)
        }
        for output in [fingerprint.uppercased(), String(fingerprint.dropLast()), "\(fingerprint)\nextra"] {
            try fixture("printf '%s\\n' '\(output)'") { scratch, _, config in
                let inputs = try inputs(scratch, config)
                let limit = OperationLimit(time: AttemptTime(seconds: 3), quitting: { false })
                expectLaunchRefusal("cannot-verify") { _ = try inputs.fingerprint(limit) }
            }
        }
    }

    @Test func storeObservationsAcceptOnlyExactFreeOrAuthorizedLeasePaths() throws {
        let free = #"printf '%s\n' '{"state":"free"}'"#
        try fixture(free) { scratch, _, config in
            let inputs = try inputs(scratch, config)
            try normalizeChildStatusDisposition()
            let limit = OperationLimit(time: AttemptTime(seconds: 3), quitting: { false })
            guard case .free = try inputs.storeState(limit) else {
                Issue.record("Exact free record must attest a free store")
                return
            }
        }
        for suffix in ["graphgoblin.lock", "graphgoblin.db.graphgoblin.lock",
                       "graphgoblin.lock.reclaim", "graphgoblin.db.graphgoblin.lock.reclaim"] {
            let script = #"printf '{"state":"held","path":"%s/%s","detail":"owned"}\n' "$GG_DATA_DIR" '"#
                + suffix + "'"
            try fixture(script) { scratch, _, config in
                let inputs = try inputs(scratch, config)
                let limit = OperationLimit(time: AttemptTime(seconds: 3), quitting: { false })
                guard case .held = try inputs.storeState(limit) else {
                    Issue.record("Each authorized lock and reclaim path must attest a held store")
                    return
                }
            }
        }
        for record in [
            #"{"state":"free","path":"/unexpected"}"#, #"{"state":"new"}"#,
            #"{"state":"held","path":"/elsewhere/graphgoblin.lock","detail":"owner"}"#,
            #"{"state":"held","path":"/elsewhere","detail":""}"#,
            #"{"state":"held","detail":"owner"}"#
        ] {
            try fixture("printf '%s\\n' '\(record)'") { scratch, _, config in
                let inputs = try inputs(scratch, config)
                let limit = OperationLimit(time: AttemptTime(seconds: 3), quitting: { false })
                #expect(throws: OperationRefusal.self) { try inputs.storeState(limit) }
            }
        }
    }
}
