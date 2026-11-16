@testable import LauncherPresentation

/// Records lifecycle calls from the AppKit delegate.
@MainActor
final class LifecycleProbe: PresentationLifecycle {
    var starts = 0
    var reopens = 0
    var decision: TerminationDecision = .now

    func start() {
        starts += 1
    }

    func reopenRequested() {
        reopens += 1
    }

    func terminationRequested() -> TerminationDecision {
        decision
    }
}

/// Collects window callbacks in AppKit construction checks.
@MainActor
final class CallbackRecorder {
    var hides = 0
    var choices: [AlertChoice] = []
}
