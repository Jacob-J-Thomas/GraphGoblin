import Darwin
import Dispatch
import Foundation
import LaunchContract
import Synchronization
@testable import LauncherEngine
import Testing

/// An attempt step that blocks in one real call on an engine worker thread, as a file access held
/// for a macOS decision does, until the test opens it. It then tries the same spawn commitment the
/// engine makes.
///
/// Only the engine worker ever waits here. The test signals the call and polls for its return with
/// `Task.sleep`, so a stranded case never holds a Swift concurrency thread that other cases need.
private final class StrandedStep: @unchecked Sendable {
    private let gate = DispatchSemaphore(value: 0)
    private let lock = NSLock()
    private var opened = false
    private var openedWithoutAnswer = false
    private var committed: Bool?

    /// `cleanup` runs once the blocked call returns, as the step then releases what it holds.
    func block(_ state: AttemptState, _ time: AttemptTime, cleanup: () -> Void = {}) -> LaunchOutcome {
        gate.wait()
        let started = state.commit(before: time)
        cleanup()
        lock.withLock { committed = started }
        return started ? .openManagement(port: 1, mode: .running) : .unexpected
    }

    /// Lets the blocked call return. It never waits and signals only once, so every case also
    /// calls it from `defer`: no step outlives its case blocked, whatever the case recorded.
    func open(withoutAnswer: Bool = false) {
        let first: Bool = lock.withLock {
            guard !opened else { return false }
            opened = true
            openedWithoutAnswer = withoutAnswer
            return true
        }
        if first { gate.signal() }
    }

    /// Whether the case had to open the step because no answer came while it was blocked.
    var rescued: Bool { lock.withLock { openedWithoutAnswer } }

    /// The commitment the step could still make, once its blocked call has returned.
    private var returned: Bool? { lock.withLock { committed } }

    /// Opens the blocked call and reports whether the step could still commit a start, or nil if
    /// its call has not returned within `limit`. The wait holds no thread.
    func release(within limit: Duration = .seconds(10)) async -> Bool? {
        open()
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: limit)
        while true {
            if let value = returned { return value }
            guard clock.now < deadline else { return nil }
            do {
                try await Task.sleep(for: .milliseconds(5))
            } catch {
                return returned
            }
        }
    }
}

/// A descriptor closed exactly once: by the stranded step's own return or, failing that, teardown.
private final class Holder: @unchecked Sendable {
    let descriptor: Int32
    private let lock = NSLock()
    private var isOpen = true

    init(_ descriptor: Int32) { self.descriptor = descriptor }

    func close() {
        let first: Bool = lock.withLock {
            defer { isOpen = false }
            return isOpen
        }
        if first { _ = Darwin.close(descriptor) }
    }
}

private final class Evaluations: Sendable {
    private let count = Mutex(0)

    func record() { count.withLock { $0 += 1 } }

    var total: Int { count.withLock { $0 } }
}

/// The two public completion forms: the presentation awaits, `--ensure-gateway` blocks.
enum BoundForm: CaseIterable, Sendable {
    case awaited
    case blocking
}

/// The cases run one at a time, as the product runs one attempt per process. Each drives the
/// process-wide engine worker and watchdog queues, and four of them deliberately strand an engine
/// worker thread, so running them together would make sibling cases compete for that shared pool
/// inside the real-time margins measured here. Other suites still run in parallel with this one.
@Suite(.serialized) struct AttemptBoundTests {
    private static let grace: UInt64 = 100_000_000
    /// Far longer than any step here needs, so only the step itself can answer within it.
    private static let longGrace: UInt64 = 10_000_000_000
    /// After this, a case opens its stranded step itself, so a missing answer fails the case on its
    /// outcome instead of hanging the run. It exceeds every bound asserted here.
    private static let rescueAfter: Duration = .seconds(12)

    private func budget(milliseconds: UInt64) -> AttemptTime {
        AttemptTime(end: DispatchTime.now().uptimeNanoseconds + milliseconds * 1_000_000)
    }

    /// Runs `body` on its own thread, as the headless entry's main thread waits, so the
    /// blocking form never occupies a shared executor thread.
    private func onThread(_ body: @escaping @Sendable () -> LaunchOutcome) async -> LaunchOutcome {
        await withCheckedContinuation { continuation in
            Thread.detachNewThread { continuation.resume(returning: body()) }
        }
    }

    private func answer(
        _ form: BoundForm, time: AttemptTime, state: AttemptState, grace: UInt64,
        work: @escaping @Sendable () -> LaunchOutcome
    ) async -> LaunchOutcome {
        switch form {
        case .awaited:
            return await NativeLaunchEngine.bounded(time: time, state: state, grace: grace, work: work)
        case .blocking:
            return await onThread {
                NativeLaunchEngine.boundedBlocking(time: time, state: state, grace: grace, work: work)
            }
        }
    }

    /// Answers `form` for an attempt whose step stays blocked in `step` until the answer arrives.
    private func answerStranded(
        _ form: BoundForm, step: StrandedStep, time: AttemptTime, state: AttemptState,
        sourceLocation: SourceLocation = #_sourceLocation,
        cleanup: @escaping @Sendable () -> Void = {}
    ) async -> LaunchOutcome {
        let rescue = Task {
            try await Task.sleep(for: Self.rescueAfter)
            step.open(withoutAnswer: true)
        }
        defer { rescue.cancel() }
        let outcome = await answer(form, time: time, state: state, grace: Self.grace) {
            step.block(state, time, cleanup: cleanup)
        }
        if step.rescued {
            Issue.record("No answer arrived while the step was blocked; the case opened it after \(Self.rescueAfter)",
                         sourceLocation: sourceLocation)
        }
        return outcome
    }

    /// Returns `outcome` only once the budget has passed, as a last check held by macOS does.
    private func late(_ outcome: LaunchOutcome, after time: AttemptTime) -> @Sendable () -> LaunchOutcome {
        {
            while !time.expired { time.pause(milliseconds: 5) }
            return outcome
        }
    }

    @Test(arguments: BoundForm.allCases)
    func blockedStepIsAnsweredAfterItsBudgetAndCannotStartAfterwards(form: BoundForm) async {
        let clock = ContinuousClock()
        let started = clock.now
        let state = AttemptState()
        #expect(state.begin())
        let time = budget(milliseconds: 150)
        let step = StrandedStep()
        defer { step.open() }

        let outcome = await answerStranded(form, step: step, time: time, state: state)
        let elapsed = clock.now - started

        #expect(HeadlessResult(outcome).code == "cannot-verify")
        // The answer never cuts the attempt's own budget short, and it does arrive.
        #expect(elapsed >= .milliseconds(240))
        #expect(elapsed < .seconds(10))
        let released = await step.release()
        #expect(released == false)
        #expect(!state.didCommit)
    }

    @Test(arguments: BoundForm.allCases)
    func committedStepThatBlocksIsReportedAsUnverified(form: BoundForm) async {
        let state = AttemptState()
        #expect(state.begin())
        let time = budget(milliseconds: 150)
        #expect(state.commit(before: time))
        let step = StrandedStep()
        defer { step.open() }

        let outcome = await answerStranded(form, step: step, time: time, state: state)

        // A committed spawn may still complete, so the answer never claims there is no child.
        #expect(HeadlessResult(outcome).code == "startup-unverified")
        let released = await step.release()
        #expect(released == false)
        #expect(state.didCommit)
    }

    @Test(arguments: BoundForm.allCases)
    func quitBeforeTheBlockedStepAnswersIsCancelled(form: BoundForm) async {
        let state = AttemptState()
        #expect(state.begin())
        state.requestQuit()
        let time = budget(milliseconds: 100)
        let step = StrandedStep()
        defer { step.open() }

        let outcome = await answerStranded(form, step: step, time: time, state: state)

        #expect(HeadlessResult(outcome).code == "cancelled")
        let released = await step.release()
        #expect(released == false)
    }

    @Test(arguments: BoundForm.allCases)
    func strandedStepKeepsWhatItHoldsUntilItsCallReturns(form: BoundForm) async throws {
        let path = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).path
        let descriptor = open(path, O_RDWR | O_CREAT | O_EXCL | O_CLOEXEC, 0o600)
        try #require(descriptor >= 0)
        defer { _ = unlink(path) }
        // The step's own return closes this; teardown closes it only if the step never returned.
        let holder = Holder(descriptor)
        defer { holder.close() }
        try #require(flock(holder.descriptor, LOCK_EX | LOCK_NB) == 0)
        let competitor = open(path, O_RDWR | O_CLOEXEC)
        try #require(competitor >= 0)
        defer { _ = close(competitor) }
        let state = AttemptState()
        #expect(state.begin())
        let time = budget(milliseconds: 100)
        let step = StrandedStep()
        defer { step.open() }

        let outcome = await answerStranded(form, step: step, time: time, state: state) { holder.close() }
        let whileStranded = flock(competitor, LOCK_EX | LOCK_NB)
        let issue = errno

        #expect(HeadlessResult(outcome).code == "cannot-verify")
        // The answer neither stops the stranded thread nor releases its lock; only the
        // thread's own return, or the process exiting, does.
        #expect(whileStranded == -1 && issue == EWOULDBLOCK)
        let released = await step.release()
        #expect(released == false)
        #expect(flock(competitor, LOCK_EX | LOCK_NB) == 0)
    }

    @Test(arguments: BoundForm.allCases, [false, true])
    func successAfterTheBudgetIsNotHandedOffDuringGrace(form: BoundForm, committed: Bool) async {
        let clock = ContinuousClock()
        let started = clock.now
        let state = AttemptState()
        #expect(state.begin())
        let time = budget(milliseconds: 100)
        if committed { #expect(state.commit(before: time)) }

        let outcome = await answer(form, time: time, state: state, grace: Self.longGrace,
                                   work: late(.openManagement(port: 45123, mode: .running), after: time))

        // Only the step can answer this early, and grace does not admit its late success. A
        // committed child verified too late is the closed start timeout; the watchdog would
        // instead have reported startup-unverified.
        #expect(clock.now - started < .seconds(10))
        #expect(HeadlessResult(outcome).code == (committed ? "start-timed-out" : "cannot-verify"))
        #expect(state.didCommit == committed)
    }

    @Test(arguments: BoundForm.allCases)
    func quitDuringTheLastCheckCancelsTheHandoff(form: BoundForm) async {
        let state = AttemptState()
        #expect(state.begin())
        let time = budget(milliseconds: 5_000)

        let outcome = await answer(form, time: time, state: state, grace: Self.grace) {
            state.requestQuit()
            return .openManagement(port: 45123, mode: .running)
        }

        #expect(HeadlessResult(outcome).code == "cancelled")
    }

    @Test(arguments: BoundForm.allCases)
    func successInsideTheBudgetIsHandedOffUnchanged(form: BoundForm) async {
        let state = AttemptState()
        #expect(state.begin())
        let time = budget(milliseconds: 5_000)

        let outcome = await answer(form, time: time, state: state, grace: Self.grace) {
            .openManagement(port: 45123, mode: .observingShutdown)
        }

        #expect(HeadlessResult(outcome).bytes
                == Data(#"{"version":1,"code":"open-management-observe-shutdown","port":45123}"#.utf8) + Data([10]))
    }

    @Test(arguments: BoundForm.allCases)
    func failureDuringGraceKeepsItsClosedOutcome(form: BoundForm) async {
        let state = AttemptState()
        #expect(state.begin())
        let time = budget(milliseconds: 100)

        let outcome = await answer(form, time: time, state: state, grace: Self.longGrace,
                                   work: late(.storeBlocked, after: time))

        // Grace serves the step's own failure; the watchdog would have reported cannot-verify.
        #expect(HeadlessResult(outcome).code == "store-blocked")
    }

    @Test(arguments: BoundForm.allCases)
    func returningStepAnswersAndTheLaterWatchdogChangesNothing(form: BoundForm) async throws {
        let state = AttemptState()
        #expect(state.begin())
        // The step returns at once. The budget only has to outlast an engine worker picking the
        // step up under parallel load, so the watchdog fires after the answer instead of racing it.
        let time = budget(milliseconds: 1_000)
        let grace: UInt64 = 50_000_000

        let outcome = await answer(form, time: time, state: state, grace: grace) {
            .portInUse(port: 45123)
        }

        #expect(HeadlessResult(outcome).code == "port-in-use")
        #expect(HeadlessResult(outcome).exitCode == 20)
        // The watchdog fires against an answered attempt here. A second delivery would trap or
        // overwrite the answer.
        try await Task.sleep(nanoseconds: time.remaining + grace + 300_000_000)
    }

    @Test func handoffIsAdmittedOnlyInsideTheBudgetAndBeforeQuit() {
        let live = AttemptTime(seconds: 5)
        let past = AttemptTime(end: 0)
        let success = LaunchOutcome.openManagement(port: 45123, mode: .running)
        func code(_ outcome: LaunchOutcome) -> String { HeadlessResult(outcome).code }

        let fresh = AttemptState()
        #expect(fresh.begin())
        #expect(code(fresh.admit(success, within: live)) == "open-management-running")
        #expect(code(fresh.admit(success, within: past)) == "cannot-verify")
        #expect(code(fresh.admit(.storeBlocked, within: past)) == "store-blocked")
        #expect(code(fresh.abandoned) == "cannot-verify")

        let committed = AttemptState()
        #expect(committed.begin())
        #expect(committed.commit(before: live))
        #expect(code(committed.admit(success, within: live)) == "open-management-running")
        #expect(code(committed.admit(success, within: past)) == "start-timed-out")
        #expect(code(committed.admit(.childExited, within: past)) == "child-exited")
        #expect(code(committed.abandoned) == "startup-unverified")

        committed.requestQuit()
        #expect(code(committed.admit(success, within: live)) == "cancelled")
        #expect(code(committed.admit(success, within: past)) == "cancelled")
        #expect(code(committed.admit(.startupUnverified, within: live)) == "startup-unverified")
        #expect(code(committed.abandoned) == "cancelled")
    }

    @Test func bothPublicFormsAnswerTheEngineAttemptOnce() async {
        let missing = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true).path

        let headless = NativeLaunchEngine(bundlePath: missing)
        let headlessFirst = await onThread { headless.runHeadless() }
        let presentedSecond = await headless.run { _ in }
        #expect(HeadlessResult(headlessFirst).code == "installation-invalid")
        #expect(HeadlessResult(presentedSecond).code == "unexpected")

        let presented = NativeLaunchEngine(bundlePath: missing)
        let presentedFirst = await presented.run { _ in }
        let headlessSecond = await onThread { presented.runHeadless() }
        #expect(HeadlessResult(presentedFirst).code == "installation-invalid")
        #expect(HeadlessResult(headlessSecond).code == "unexpected")
    }

    @Test func onlyTheFirstAnswerIsEvaluated() async {
        let evaluations = Evaluations()
        let outcome: LaunchOutcome = await withCheckedContinuation {
            (continuation: CheckedContinuation<LaunchOutcome, Never>) in
            let answer = SingleAnswer { continuation.resume(returning: $0) }
            answer.resume {
                evaluations.record()
                return .storeBlocked
            }
            answer.resume {
                evaluations.record()
                return .cannotVerify
            }
        }
        #expect(HeadlessResult(outcome).code == "store-blocked")
        #expect(evaluations.total == 1)
    }
}
