import Synchronization

/// A monotonic test clock that only moves when the test advances it.
///
/// Sleepers resume when `advance(by:)` reaches their deadline, in deadline order, and throw
/// `CancellationError` if their task is cancelled first. A sleep whose deadline has already
/// passed returns immediately, so registration order never matters.
/// `advanceWithoutResuming(by:)` moves time but holds due sleepers until `resumeDueSleepers()`,
/// so a test can run other work after a deadline while that deadline's timer has not run yet.
final class ManualClock: Clock {
    typealias Duration = Swift.Duration

    struct Instant: InstantProtocol {
        typealias Duration = Swift.Duration

        let offset: Swift.Duration

        func advanced(by duration: Swift.Duration) -> Instant {
            Instant(offset: offset + duration)
        }

        func duration(to other: Instant) -> Swift.Duration {
            other.offset - offset
        }

        static func < (lhs: Instant, rhs: Instant) -> Bool {
            lhs.offset < rhs.offset
        }
    }

    private struct Sleeper {
        let id: UInt64
        let deadline: Instant
        let continuation: CheckedContinuation<Void, any Error>
    }

    private struct State {
        var now = Instant(offset: .zero)
        var sleepers: [Sleeper] = []
        var nextID: UInt64 = 0
    }

    private let state = Mutex(State())

    var now: Instant {
        state.withLock { $0.now }
    }

    var minimumResolution: Swift.Duration {
        .zero
    }

    func sleep(until deadline: Instant, tolerance: Swift.Duration?) async throws {
        let id: UInt64 = state.withLock { current in
            current.nextID += 1
            return current.nextID
        }
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, any Error>) in
                let immediate: Result<Void, any Error>? = state.withLock { current in
                    if Task.isCancelled {
                        return .failure(CancellationError())
                    }
                    if deadline <= current.now {
                        return .success(())
                    }
                    current.sleepers.append(Sleeper(id: id, deadline: deadline, continuation: continuation))
                    return nil
                }
                if let immediate {
                    continuation.resume(with: immediate)
                }
            }
        } onCancel: {
            let cancelled: CheckedContinuation<Void, any Error>? = state.withLock { current in
                guard let index = current.sleepers.firstIndex(where: { $0.id == id }) else {
                    return nil
                }
                return current.sleepers.remove(at: index).continuation
            }
            cancelled?.resume(throwing: CancellationError())
        }
    }

    /// Moves time forward and resumes every sleeper whose deadline has been reached.
    func advance(by duration: Swift.Duration) {
        let due: [Sleeper] = state.withLock { current in
            current.now = current.now.advanced(by: duration)
            let now = current.now
            let ready = current.sleepers
                .filter { $0.deadline <= now }
                .sorted { $0.deadline < $1.deadline }
            current.sleepers.removeAll { $0.deadline <= now }
            return ready
        }
        for sleeper in due {
            sleeper.continuation.resume()
        }
    }

    /// Moves time forward without resuming any sleeper. A sleeper whose deadline is now reached
    /// stays registered, and still cancellable, until `resumeDueSleepers()` or the next
    /// `advance(by:)`: its timer is due but has not run.
    func advanceWithoutResuming(by duration: Swift.Duration) {
        state.withLock { current in
            current.now = current.now.advanced(by: duration)
        }
    }

    /// Resumes every sleeper whose deadline has already been reached, in deadline order.
    func resumeDueSleepers() {
        advance(by: .zero)
    }

    /// Whether a sleeper is currently registered for exactly this offset from the start.
    func hasSleeper(until offset: Swift.Duration) -> Bool {
        state.withLock { current in
            current.sleepers.contains { $0.deadline.offset == offset }
        }
    }
}
