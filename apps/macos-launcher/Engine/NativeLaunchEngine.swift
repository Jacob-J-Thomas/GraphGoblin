import CryptoKit
import Darwin
import Dispatch
import Foundation
import LaunchContract

struct LaunchRefusal: Error {
    let outcome: LaunchOutcome
    init(_ outcome: LaunchOutcome) { self.outcome = outcome }
}

final class AttemptState: @unchecked Sendable {
    private let lock = NSLock()
    private var started = false
    private var quit = false
    private var committed = false

    func begin() -> Bool {
        lock.withLock {
            guard !started else { return false }
            started = true
            return true
        }
    }

    func requestQuit() { lock.withLock { quit = true } }
    var quitting: Bool { lock.withLock { quit } }
    var didCommit: Bool { lock.withLock { committed } }

    func commit(before time: AttemptTime) -> Bool {
        lock.withLock {
            guard started, !quit, !committed, !time.expired else { return false }
            committed = true
            return true
        }
    }
}

struct CooperatingLocks {
    let held: [OwnedDescriptor]

    static func acquire(
        for inputs: LaunchInputs, limit: OperationLimit, onContention: () -> Void
    ) throws -> Self {
        var anchorDirectory = try Directory(path: inputs.installation.home)
        try anchorDirectory.requireOwnedDirectory()
        try requireSafeACL(anchorDirectory.handle, ancestor: true)
        for name in ["Library", "Application Support", "GraphGoblin", "LauncherLocks"] {
            anchorDirectory = try anchorDirectory.ensureDirectory(name)
            try anchorDirectory.requireOwnedDirectory(privateMode: name == "LauncherLocks")
            try requireSafeACL(anchorDirectory.handle, ancestor: name != "LauncherLocks")
        }
        var handles: [OwnedDescriptor] = []
        let values = [
            ("directory", inputs.config.dataDirectory),
            ("database", inputs.config.database),
            ("port", String(inputs.config.port))
        ]
        for (scope, value) in values {
            try limit.check()
            let hash = SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
            let name = scope + "-" + hash
            let descriptor: OwnedDescriptor
            do {
                descriptor = try anchorDirectory.createFile(name)
            } catch FileRefusal.system(let code) where code == EEXIST {
                descriptor = try anchorDirectory.openRegular(name, write: true, privateMode: true)
            }
            try requireSafeACL(descriptor, ancestor: false)
            try anchorDirectory.match(name, descriptor, privateMode: true)
            while flock(descriptor.fd, LOCK_EX | LOCK_NB) != 0 {
                let issue = errno
                if issue == EINTR { try limit.check(); continue }
                guard issue == EWOULDBLOCK else { throw FileRefusal.system(issue) }
                onContention()
                if limit.time.expired { throw LaunchRefusal(.launchBusy) }
                if limit.quitting() { throw OperationRefusal.cancelled }
                limit.time.pause()
            }
            try anchorDirectory.requireAnchored()
            try anchorDirectory.match(name, descriptor, privateMode: true)
            handles.append(descriptor)
        }
        return Self(held: handles)
    }
}

package struct LogAuthorization: Sendable {
    fileprivate let installedBundle: FileIdentity
    fileprivate let installationID: String
    fileprivate let directory: FileIdentity
}

package final class NativeLaunchEngine: LaunchEngine {
    private static let workers = DispatchQueue(label: "com.graphgoblin.launcher.engine", attributes: .concurrent)
    private static let diagnostics = DispatchQueue(label: "com.graphgoblin.launcher.diagnostics")
    private let bundlePath: String
    private let state = AttemptState()

    package init(bundlePath: String) { self.bundlePath = bundlePath }

    package func requestQuit() { state.requestQuit() }

    package func run(progress: @escaping @Sendable (LaunchStage) -> Void) async -> LaunchOutcome {
        let time = AttemptTime(seconds: 60)
        return await withCheckedContinuation { continuation in
            Self.workers.async {
                continuation.resume(returning: self.execute(time: time, progress: progress))
            }
        }
    }

    package func runHeadless() -> LaunchOutcome {
        execute(time: AttemptTime(seconds: 60), progress: { _ in })
    }

    package func validateStaged() -> HeadlessResult {
        let limit = OperationLimit(time: AttemptTime(seconds: 60), quitting: { false })
        do {
            let installation = try readInstallation(staged: true)
            let inputs = try LaunchInputs(installation)
            try inputs.requireLocalKey()
            try normalizeChildStatusDisposition()
            try inputs.verifyRuntime(limit)
            _ = try inputs.fingerprint(limit)
            return .installationValid
        } catch let refusal as LaunchRefusal {
            return HeadlessResult(refusal.outcome)
        } catch {
            return HeadlessResult(.cannotVerify)
        }
    }

    package func authorizeShowLog() async -> LogAuthorization? {
        await withCheckedContinuation { continuation in
            Self.workers.async {
                guard let installation = try? self.readInstallation(staged: false),
                      let log = try? LogDirectory.open(for: installation, create: false) else {
                    continuation.resume(returning: nil)
                    return
                }
                continuation.resume(returning: LogAuthorization(
                    installedBundle: installation.contents.witness.bundle,
                    installationID: installation.contents.id, directory: log.root.identity
                ))
            }
        }
    }

    package func revalidateShowLog(_ authorization: LogAuthorization) async -> URL? {
        await withCheckedContinuation { continuation in
            Self.workers.async {
                guard let installation = try? self.readInstallation(staged: false),
                      installation.contents.witness.bundle == authorization.installedBundle,
                      installation.contents.id == authorization.installationID,
                      let log = try? LogDirectory.open(for: installation, create: false),
                      log.root.identity == authorization.directory else {
                    continuation.resume(returning: nil)
                    return
                }
                continuation.resume(returning: URL(fileURLWithPath: log.root.path, isDirectory: true))
            }
        }
    }

    private func readInstallation(staged: Bool) throws -> VerifiedInstallation {
        do {
            return try InstallationFiles.verify(bundlePath: bundlePath, staged: staged)
        } catch {
            throw LaunchRefusal(.installationInvalid)
        }
    }

    private func execute(time: AttemptTime, progress: @escaping @Sendable (LaunchStage) -> Void) -> LaunchOutcome {
        guard state.begin() else { return .unexpected }
        let limit = OperationLimit(time: time, quitting: { self.state.quitting })
        var stageName = ""
        func publish(_ stage: LaunchStage) {
            let name: String
            switch stage {
            case .checking: name = "checking"
            case .waitingForOtherLaunch: name = "waiting-for-other-launch"
            case .waitingForStore: name = "waiting-for-store"
            case .waitingForRelease: name = "waiting-for-release"
            case .starting: name = "starting"
            }
            guard name != stageName else { return }
            stageName = name
            progress(stage)
        }

        var installation: VerifiedInstallation?
        var logDirectory: LogDirectory?
        var childCategory: String?
        let outcome: LaunchOutcome

        do {
            try limit.check()
            publish(.checking)
            let opened = try readInstallation(staged: false)
            installation = opened
            let inputs = try LaunchInputs(opened)
            try normalizeChildStatusDisposition()
            try inputs.verifyRuntime(limit)
            let fingerprint = try inputs.fingerprint(limit)
            let locks = try CooperatingLocks.acquire(for: inputs, limit: limit) {
                publish(.waitingForOtherLaunch)
            }
            publish(.checking)
            outcome = try withExtendedLifetime(locks) {
                try observeAndStart(inputs, fingerprint: fingerprint, limit: limit,
                                    progress: publish, logDirectory: &logDirectory,
                                    childCategory: &childCategory)
            }
        } catch let refusal as LaunchRefusal {
            outcome = refusal.outcome
        } catch OperationRefusal.cancelled {
            outcome = .cancelled
        } catch ChildSpawnError.noChild {
            childCategory = "spawn-failed"
            outcome = .startFailed
        } catch {
            outcome = state.didCommit ? .startupUnverified : .cannotVerify
        }
        if let installation, HeadlessResult(outcome).exitCode != 0,
           HeadlessResult(outcome).exitCode != 40, !time.expired {
            let file = logDirectory
            let record = "stage=\(stageName) outcome=\(HeadlessResult(outcome).code)"
                + (childCategory.map { " child=" + $0 } ?? "") + "\n"
            let finished = DispatchSemaphore(value: 0)
            Self.diagnostics.async {
                defer { finished.signal() }
                guard let directory = file ?? (try? LogDirectory.open(for: installation, create: true))
                else { return }
                try? directory.appendLauncherRecord(Data(record.utf8))
            }
            _ = finished.wait(timeout: DispatchTime(uptimeNanoseconds:
                min(time.end, DispatchTime.now().uptimeNanoseconds + 250_000_000)))
        }
        return outcome
    }

    private func observeAndStart(
        _ inputs: LaunchInputs, fingerprint: String, limit: OperationLimit,
        progress: (LaunchStage) -> Void, logDirectory: inout LogDirectory?, childCategory: inout String?
    ) throws -> LaunchOutcome {
        let loopback = Loopback(port: inputs.config.port)
        func observe(expectedChild: pid_t? = nil) throws -> GatewayObservation {
            try loopback.observe(fingerprint: fingerprint, expectedChild: expectedChild,
                                 appHTML: inputs.appHTML, goblinHTML: inputs.goblinHTML, limit: limit)
        }
        var lastHeld = false
        var lastRelease = false
        var admission: String?
        while !limit.time.expired {
            try limit.check()
            switch try observe() {
            case .unrelated:
                return .portInUse(port: inputs.config.port)
            case .usable(let mode):
                try inputs.requireLocalKey()
                return .openManagement(port: inputs.config.port, mode: mode)
            case .lacksAssets:
                return .assetsUnavailable
            case .release:
                lastRelease = true
                progress(.waitingForRelease)
            case .ambiguous, .conflict:
                break
            case .refused:
                let state: StoreState
                do {
                    state = try inputs.storeState(limit)
                } catch OperationRefusal.cancelled {
                    throw OperationRefusal.cancelled
                } catch {
                    limit.time.pause()
                    continue
                }
                switch state {
                case .held:
                    lastHeld = true
                    if !lastRelease { progress(.waitingForStore) }
                case .free:
                    lastHeld = false
                    lastRelease = false
                    try inputs.requireLocalKey()
                    if admission == nil {
                        progress(.checking)
                        do {
                            let directory = try LogDirectory.open(for: inputs.installation, create: true)
                            logDirectory = directory
                            admission = try directory.gatewayAdmission()
                        } catch {
                            childCategory = "destination-unavailable"
                            return .diagnosticsUnavailable
                        }
                        // Refresh the port and store observations after acquiring log metadata.
                        continue
                    }
                    guard self.state.commit(before: limit.time) else {
                        return self.state.quitting ? .cancelled : .cannotVerify
                    }
                    progress(.starting)
                    let child = try inputs.gateway(admission: admission!).gateway()
                    defer { _ = child.observe() }
                    return try verifyChild(child, limit: limit, port: inputs.config.port,
                                           observe: observe, childCategory: &childCategory)
                }
            }
            limit.time.pause()
        }
        if state.quitting { return .cancelled }
        if lastRelease { return .releaseUnconfirmed }
        if lastHeld { return .storeBlocked }
        return .cannotVerify
    }

    private func verifyChild(
        _ child: DirectChild, limit: OperationLimit, port: UInt16,
        observe: (pid_t?) throws -> GatewayObservation, childCategory: inout String?
    ) throws -> LaunchOutcome {
        while !limit.time.expired {
            try limit.check()
            if let failure = classifyChild(child.observe(), category: &childCategory) { return failure }
            let observation = try observe(child.pid)
            if let failure = classifyChild(child.observe(), category: &childCategory) { return failure }
            switch observation {
            case .usable(let mode):
                return .openManagement(port: port, mode: mode)
            case .conflict, .unrelated:
                return .startupUnverified
            case .lacksAssets:
                return .assetsUnavailable
            case .refused, .ambiguous, .release:
                break
            }
            limit.time.pause()
        }
        if let failure = classifyChild(child.observe(), category: &childCategory) { return failure }
        return state.quitting ? .cancelled : .startTimedOut
    }

    private func classifyChild(_ observed: ChildStatus, category: inout String?) -> LaunchOutcome? {
        switch observed {
        case .running: return nil
        case .unknown: return .startupUnverified
        case .signaled:
            category = "child-signaled"
        case .exited(let code):
            switch code {
            case 70: category = "destination-in-use"
            case 71: category = "destination-unavailable"
            case 72: category = "import-failed-logged"
            case 73: category = "import-failed-unlogged"
            case 74: category = "startup-failed-logged"
            case 75: category = "startup-failed-unlogged"
            default: category = "unknown-child-exit"
            }
        }
        return .childExited
    }
}
