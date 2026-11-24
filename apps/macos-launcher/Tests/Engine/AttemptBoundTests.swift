import Darwin
import Dispatch
import Foundation
import LaunchContract
import Synchronization
@testable import LauncherEngine
import Testing

/// An attempt step that blocks in one call, as a file access held for a macOS decision does,
/// until the test releases it. It then tries the same spawn commitment the engine makes.
private final class StrandedStep: @unchecked Sendable {
    private let gate = DispatchSemaphore(value: 0)
    private let finished = DispatchSemaphore(value: 0)
    private let committed = Mutex<Bool?>(nil)

    /// `cleanup` runs once the blocked call returns, as the step then releases what it holds.
    func block(_ state: AttemptState, _ time: AttemptTime, cleanup: () -> Void = {}) -> LaunchOutcome {
        gate.wait()
        let started = state.commit(before: time)
        committed.withLock { $0 = started }
        cleanup()
        finished.signal()
        return started ? .openManagement(port: 1, mode: .running) : .unexpected
    }

    /// Releases the blocked call and reports whether the step could still commit a start.
    func release() -> Bool? {
        gate.signal()
        guard finished.wait(timeout: .now() + .seconds(5)) == .success else { return nil }
        return committed.withLock { $0 }
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

@Suite struct AttemptBoundTests {
    private static let grace: UInt64 = 100_000_000
    /// Far longer than any step here needs, so only the step itself can answer within it.
    private static let longGrace: UInt64 = 10_000_000_000

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

        let outcome = await answer(form, time: time, state: state, grace: Self.grace) {
            step.block(state, time)
        }
        let elapsed = clock.now - started

        #expect(HeadlessResult(outcome).code == "cannot-verify")
        // The answer never cuts the attempt's own budget short, and it does arrive.
        #expect(elapsed >= .milliseconds(240))
        #expect(elapsed < .seconds(10))
        #expect(step.release() == false)
        #expect(!state.didCommit)
    }

    @Test(arguments: BoundForm.allCases)
    func committedStepThatBlocksIsReportedAsUnverified(form: BoundForm) async {
        let state = AttemptState()
        #expect(state.begin())
        let time = budget(milliseconds: 150)
        #expect(state.commit(before: time))
        let step = StrandedStep()

        let outcome = await answer(form, time: time, state: state, grace: Self.grace) {
            step.block(state, time)
        }

        // A committed spawn may still complete, so the answer never claims there is no child.
        #expect(HeadlessResult(outcome).code == "startup-unverified")
        #expect(step.release() == false)
        #expect(state.didCommit)
    }

    @Test(arguments: BoundForm.allCases)
    func quitBeforeTheBlockedStepAnswersIsCancelled(form: BoundForm) async {
        let state = AttemptState()
        #expect(state.begin())
        state.requestQuit()
        let time = budget(milliseconds: 100)
        let step = StrandedStep()

        let outcome = await answer(form, time: time, state: state, grace: Self.grace) {
            step.block(state, time)
        }

        #expect(HeadlessResult(outcome).code == "cancelled")
        #expect(step.release() == false)
    }

    @Test(arguments: BoundForm.allCases)
    func strandedStepKeepsWhatItHoldsUntilItsCallReturns(form: BoundForm) async throws {
        let path = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).path
        let holder = open(path, O_RDWR | O_CREAT | O_EXCL | O_CLOEXEC, 0o600)
        try #require(holder >= 0)
        defer { _ = unlink(path) }
        try #require(flock(holder, LOCK_EX | LOCK_NB) == 0)
        let competitor = open(path, O_RDWR | O_CLOEXEC)
        try #require(competitor >= 0)
        defer { _ = close(competitor) }
        let state = AttemptState()
        #expect(state.begin())
        let time = budget(milliseconds: 100)
        let step = StrandedStep()

        let outcome = await answer(form, time: time, state: state, grace: Self.grace) {
            step.block(state, time) { _ = close(holder) }
        }
        let whileStranded = flock(competitor, LOCK_EX | LOCK_NB)
        let issue = errno

        #expect(HeadlessResult(outcome).code == "cannot-verify")
        // The answer neither stops the stranded thread nor releases its lock; only the
        // thread's own return, or the process exiting, does.
        #expect(whileStranded == -1 && issue == EWOULDBLOCK)
        #expect(step.release() == false)
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
        let time = budget(milliseconds: 50)

        let outcome = await answer(form, time: time, state: state, grace: 50_000_000) {
            .portInUse(port: 45123)
        }

        #expect(HeadlessResult(outcome).code == "port-in-use")
        #expect(HeadlessResult(outcome).exitCode == 20)
        // The watchdog fires against an answered attempt here. A second delivery would trap or
        // overwrite the answer.
        try await Task.sleep(for: .milliseconds(300))
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
