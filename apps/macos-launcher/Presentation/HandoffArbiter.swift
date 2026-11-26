import LaunchContract
import Synchronization

/// Settles one browser submission exactly once against its monotonic completion deadline.
///
/// A callback is judged by the instant it was observed, not by when the main actor gets to
/// it, so a callback observed before the deadline wins even if the deadline timer is
/// delivered first. Any observation at or after the deadline settles as `unconfirmed`.
/// Every later observation or expiry returns `nil`.
final class HandoffArbiter<Instant: InstantProtocol>: Sendable {
    let deadline: Instant
    private let settled = Mutex(false)

    init(deadline: Instant) {
        self.deadline = deadline
    }

    /// Records a translated native callback observed at `instant`.
    /// Returns the terminal outcome if this observation settled the submission.
    func observe(_ outcome: BrowserOutcome, at instant: Instant) -> BrowserOutcome? {
        settle(instant < deadline ? outcome : .unconfirmed)
    }

    /// Records the deadline timer firing at `instant`.
    /// Returns `.unconfirmed` if the deadline has passed and nothing settled first.
    func expire(at instant: Instant) -> BrowserOutcome? {
        guard instant >= deadline else { return nil }
        return settle(.unconfirmed)
    }

    private func settle(_ outcome: BrowserOutcome) -> BrowserOutcome? {
        settled.withLock { isSettled in
            if isSettled {
                return nil
            }
            isSettled = true
            return outcome
        }
    }
}
