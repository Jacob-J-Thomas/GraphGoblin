import CryptoKit
import Darwin
import Dispatch
import Foundation
import LaunchContract

struct LaunchRefusal: Error {
    let outcome: LaunchOutcome
    init(_ outcome: LaunchOutcome) { self.outcome = outcome }
}

func classifyAttemptFailure(
    _ error: any Error, didCommit: Bool
) -> (outcome: LaunchOutcome, childCategory: String?) {
    if let refusal = error as? LaunchRefusal { return (refusal.outcome, nil) }
    if let operation = error as? OperationRefusal {
        switch operation {
        case .cancelled: return (.cancelled, nil)
        case .deadline: return (didCommit ? .startTimedOut : .cannotVerify, nil)
        case .invalid, .disconnected: return (didCommit ? .startupUnverified : .cannotVerify, nil)
        }
    }
    if let spawn = error as? ChildSpawnError {
        guard didCommit else { return (.cannotVerify, nil) }
        if case .noChild = spawn { return (.startFailed, "spawn-failed") }
        return (.startupUnverified, nil)
    }
    return (didCommit ? .startupUnverified : .unexpected, nil)
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

    /// Admits a management handoff only inside the budget and before Quit.
    ///
    /// A success whose last check returned after the budget or a Quit answers as the deadline or
    /// cancellation it reached instead. Every other outcome is already a closed failure and passes.
    func admit(_ outcome: LaunchOutcome, within time: AttemptTime) -> LaunchOutcome {
        guard case .openManagement = outcome else { return outcome }
        return lock.withLock { () -> LaunchOutcome in
            if quit { return .cancelled }
            guard time.expired else { return outcome }
            return classifyAttemptFailure(OperationRefusal.deadline, didCommit: committed).outcome
        }
    }

    /// The answer for a step still running after its budget and grace. Its commitment is final by
    /// then, but a committed spawn may still be completing, so it is never reported as absent.
    var abandoned: LaunchOutcome {
        lock.withLock { () -> LaunchOutcome in
            if quit { return .cancelled }
            return committed ? .startupUnverified : .cannotVerify
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

/// Delivers exactly one attempt outcome, from whichever of the step or its watchdog answers first.
final class SingleAnswer: @unchecked Sendable {
    private let lock = NSLock()
    private var pending: (@Sendable (LaunchOutcome) -> Void)?

    init(_ deliver: @escaping @Sendable (LaunchOutcome) -> Void) { pending = deliver }

    /// `make` runs only for the first caller; later callers change nothing.
    func resume(_ make: () -> LaunchOutcome) {
        let winner: (@Sendable (LaunchOutcome) -> Void)? = lock.withLock {
            defer { pending = nil }
            return pending
        }
        winner?(make())
    }
}

/// Holds the single answer for a caller that waits on its own thread.
private final class BlockingAnswer: @unchecked Sendable {
    private let lock = NSLock()
    private let ready = DispatchSemaphore(value: 0)
    private var outcome: LaunchOutcome?

    func deliver(_ value: LaunchOutcome) {
        lock.withLock { outcome = value }
        ready.signal()
    }

    func wait() -> LaunchOutcome {
        ready.wait()
        return lock.withLock { outcome! }
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
    private static let watchdog = DispatchQueue(label: "com.graphgoblin.launcher.watchdog")
    /// Nanoseconds after the budget in which a step may still deliver its own failure and bounded
    /// diagnostic. It is never admission time: a success that arrives then is not handed off.
    static let abandonGrace: UInt64 = 1_000_000_000
    private let bundlePath: String
    private let state = AttemptState()

    package init(bundlePath: String) { self.bundlePath = bundlePath }

    package func requestQuit() { state.requestQuit() }

    package func run(progress: @escaping @Sendable (LaunchStage) -> Void) async -> LaunchOutcome {
        let time = AttemptTime(seconds: 60)
        return await Self.bounded(time: time, state: state) {
            self.execute(time: time, progress: progress)
        }
    }

    /// `--ensure-gateway`: the same bounded attempt, answered on the calling thread.
    package func runHeadless() -> LaunchOutcome {
        let time = AttemptTime(seconds: 60)
        return Self.boundedBlocking(time: time, state: state) {
            self.execute(time: time, progress: { _ in })
        }
    }

    /// Answers with the attempt's own admitted outcome, or a conservative one once its budget has passed.
    ///
    /// Each step checks the budget between system calls, but one call can block outside it,
    /// for example a file access held for a macOS privacy decision. The watchdog then answers
    /// after the budget and `grace` from the attempt state alone, without I/O. The stranded step
    /// cannot make a new spawn commitment afterwards because that requires an unexpired budget;
    /// an already committed spawn may still finish. The commitment the watchdog reads is final.
    /// The step's own success is admitted only inside the
    /// budget and before Quit. Nothing stops the stranded thread: it keeps what it holds, such as
    /// its cooperating locks, until its call returns or the process exits.
    static func bounded(
        time: AttemptTime, state: AttemptState, grace: UInt64 = abandonGrace,
        work: @escaping @Sendable () -> LaunchOutcome
    ) async -> LaunchOutcome {
        await withCheckedContinuation { continuation in
            Self.answerOnce(time: time, state: state, grace: grace, work: work) {
                continuation.resume(returning: $0)
            }
        }
    }

    /// `bounded` for a synchronous caller, which waits for the same single answer.
    static func boundedBlocking(
        time: AttemptTime, state: AttemptState, grace: UInt64 = abandonGrace,
        work: @escaping @Sendable () -> LaunchOutcome
    ) -> LaunchOutcome {
        let answered = BlockingAnswer()
        Self.answerOnce(time: time, state: state, grace: grace, work: work) { answered.deliver($0) }
        return answered.wait()
    }

    private static func answerOnce(
        time: AttemptTime, state: AttemptState, grace: UInt64,
        work: @escaping @Sendable () -> LaunchOutcome, deliver: @escaping @Sendable (LaunchOutcome) -> Void
    ) {
        let answer = SingleAnswer(deliver)
        Self.workers.async {
            let outcome = work()
            answer.resume { state.admit(outcome, within: time) }
        }
        Self.watchdog.asyncAfter(deadline: DispatchTime(uptimeNanoseconds: time.end + grace)) {
            answer.resume { state.abandoned }
        }
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
        let reached: LaunchOutcome

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
            reached = try withExtendedLifetime(locks) {
                try observeAndStart(inputs, fingerprint: fingerprint, limit: limit,
                                    progress: publish, logDirectory: &logDirectory,
                                    childCategory: &childCategory)
            }
        } catch {
            let failure = classifyAttemptFailure(error, didCommit: state.didCommit)
            reached = failure.outcome
            childCategory = failure.childCategory ?? childCategory
        }
        // A usable observation or the key check after it can return beyond the budget, for
        // example when macOS holds a file access. Such a handoff is not admitted.
        let outcome = state.admit(reached, within: time)
        if let installation {
            let file = logDirectory
            writeFailureDiagnostic(outcome, stage: stageName, childCategory: childCategory) { record in
                guard let directory = file ?? (try? LogDirectory.open(for: installation, create: true))
                else { return }
                try? directory.appendLauncherRecord(record)
            }
        }
        return outcome
    }

    func writeFailureDiagnostic(
        _ outcome: LaunchOutcome, stage: String, childCategory: String?, append: @escaping @Sendable (Data) -> Void
    ) {
        let result = HeadlessResult(outcome)
        guard result.exitCode != 0, result.exitCode != 40, !state.quitting else { return }
        let record = "stage=\(stage) outcome=\(result.code)"
            + (childCategory.map { " child=" + $0 } ?? "") + "\n"
        let finished = DispatchSemaphore(value: 0)
        // The gateway attempt has ended. Only the best-effort write uses this tail.
        let deadline = DispatchTime.now() + .milliseconds(250)
        Self.diagnostics.async { [state] in
            defer { finished.signal() }
            guard !state.quitting, DispatchTime.now() < deadline else { return }
            append(Data(record.utf8))
        }
        while !state.quitting {
            let now = DispatchTime.now()
            guard now < deadline else { return }
            if finished.wait(timeout: min(deadline, now + .milliseconds(25))) == .success { return }
        }
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
                    guard !limit.time.expired else { return .startTimedOut }
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
