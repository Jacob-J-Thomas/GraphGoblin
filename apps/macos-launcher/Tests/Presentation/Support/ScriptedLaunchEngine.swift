import LaunchContract
import Synchronization

/// A scripted `LaunchEngine`: counts `run` and `requestQuit`, emits progress on demand and
/// completes only when the test says so (or never).
final class ScriptedLaunchEngine: LaunchEngine {
    private struct State {
        var runCount = 0
        var quitCount = 0
        var progress: (@Sendable (LaunchStage) -> Void)?
        var completion: CheckedContinuation<LaunchOutcome, Never>?
        var earlyOutcome: LaunchOutcome?
        var runWaiters: [CheckedContinuation<Void, Never>] = []
    }

    private let state = Mutex(State())

    var runCount: Int {
        state.withLock { $0.runCount }
    }

    var quitCount: Int {
        state.withLock { $0.quitCount }
    }

    func run(progress: @escaping @Sendable (LaunchStage) -> Void) async -> LaunchOutcome {
        let waiters: [CheckedContinuation<Void, Never>] = state.withLock { current in
            current.runCount += 1
            current.progress = progress
            let waiting = current.runWaiters
            current.runWaiters.removeAll()
            return waiting
        }
        for waiter in waiters {
            waiter.resume()
        }
        return await withCheckedContinuation { (continuation: CheckedContinuation<LaunchOutcome, Never>) in
            let early: LaunchOutcome? = state.withLock { current in
                if let outcome = current.earlyOutcome {
                    current.earlyOutcome = nil
                    return outcome
                }
                current.completion = continuation
                return nil
            }
            if let early {
                continuation.resume(returning: early)
            }
        }
    }

    func requestQuit() {
        state.withLock { $0.quitCount += 1 }
    }

    /// Suspends until `run` has been entered.
    func waitUntilRunning() async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            let running: Bool = state.withLock { current in
                if current.runCount > 0 {
                    return true
                }
                current.runWaiters.append(continuation)
                return false
            }
            if running {
                continuation.resume()
            }
        }
    }

    /// Calls the progress callback the presentation passed to `run`, on the calling thread.
    func emit(_ stage: LaunchStage) {
        let progress = state.withLock { $0.progress }
        progress?(stage)
    }

    /// Returns `outcome` from `run`.
    func complete(with outcome: LaunchOutcome) {
        let completion: CheckedContinuation<LaunchOutcome, Never>? = state.withLock { current in
            if let waiting = current.completion {
                current.completion = nil
                return waiting
            }
            current.earlyOutcome = outcome
            return nil
        }
        completion?.resume(returning: outcome)
    }
}
