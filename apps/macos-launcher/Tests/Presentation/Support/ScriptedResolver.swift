import LaunchContract

/// Scripts the `resolveShowLog` closure and the opaque action it may return.
///
/// Each resolve call suspends until the test settles it. The returned action counts its
/// invocations and, when `holdsActions` is set, suspends until `releaseAction()`.
@MainActor
final class ScriptedResolver {
    private(set) var resolveCount = 0
    private(set) var actionInvocations = 0
    private(set) var actionsCompleted = 0
    var holdsActions = false

    private var pending: [CheckedContinuation<Bool, Never>] = []
    private var actionGate: CheckedContinuation<Void, Never>?

    var isResolving: Bool {
        !pending.isEmpty
    }

    func makeResolver() -> @MainActor () async -> ShowLogAction? {
        return { [self] in
            await self.resolve()
        }
    }

    func resolve() async -> ShowLogAction? {
        resolveCount += 1
        let offer = await withCheckedContinuation { (continuation: CheckedContinuation<Bool, Never>) in
            pending.append(continuation)
        }
        return offer ? makeAction() : nil
    }

    /// Settles the oldest pending resolve, with an action or with `nil`.
    func settle(offeringAction: Bool) {
        guard !pending.isEmpty else { return }
        pending.removeFirst().resume(returning: offeringAction)
    }

    func releaseAction() {
        actionGate?.resume()
        actionGate = nil
    }

    private func makeAction() -> ShowLogAction {
        return { [self] in
            self.actionInvocations += 1
            if self.holdsActions {
                await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                    self.actionGate = continuation
                }
            }
            self.actionsCompleted += 1
        }
    }
}
