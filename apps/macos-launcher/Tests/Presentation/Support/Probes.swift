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

/// The receiver a real `AppKitSurface` reports window actions to, in place of the controller.
@MainActor
final class EventsProbe: PresentationEvents {
    private(set) var hides = 0
    private(set) var choices: [AlertChoice] = []

    func hideRequested() {
        hides += 1
    }

    func alertChoiceMade(_ choice: AlertChoice) {
        choices.append(choice)
    }
}
