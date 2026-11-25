@testable import LauncherPresentation

/// Records every rendering request instead of drawing it.
///
/// `terminateApplication()` mirrors AppKit by asking the lifecycle (the delegate path)
/// whether to terminate, so controller-initiated exits exercise the same re-entrant call.
@MainActor
final class ScriptedSurface: PresentationSurface {
    enum Call: Equatable {
        case showProgress(ProgressContent, ProgressActivation)
        case updateProgress(ProgressContent)
        case hideProgress
        case closeProgress
        case showAlert(AlertContent)
        case raiseAlert
        case closeAlert
        case announce(String)
        case pasteboard(String)
        case terminate
        case replyToTermination
    }

    weak var lifecycle: (any PresentationLifecycle)?
    private(set) var calls: [Call] = []
    private(set) var terminationDecisions: [TerminationDecision] = []
    private(set) var progressOnScreen = false
    private(set) var alertOnScreen: AlertContent?

    func showProgress(_ content: ProgressContent, activation: ProgressActivation) {
        calls.append(.showProgress(content, activation))
        progressOnScreen = true
    }

    func updateProgress(_ content: ProgressContent) {
        calls.append(.updateProgress(content))
    }

    func hideProgress() {
        calls.append(.hideProgress)
        progressOnScreen = false
    }

    func closeProgress() {
        calls.append(.closeProgress)
        progressOnScreen = false
    }

    func showAlert(_ content: AlertContent) {
        calls.append(.showAlert(content))
        alertOnScreen = content
    }

    func raiseAlert() {
        calls.append(.raiseAlert)
    }

    func closeAlert() {
        calls.append(.closeAlert)
        alertOnScreen = nil
    }

    func announce(_ text: String) {
        calls.append(.announce(text))
    }

    func writeToPasteboard(_ text: String) {
        calls.append(.pasteboard(text))
    }

    func terminateApplication() {
        calls.append(.terminate)
        if let decision = lifecycle?.terminationRequested() {
            terminationDecisions.append(decision)
        }
    }

    func replyToTermination() {
        calls.append(.replyToTermination)
    }

    // MARK: - Queries

    func count(_ call: Call) -> Int {
        calls.filter { $0 == call }.count
    }

    func index(of call: Call) -> Int? {
        calls.firstIndex(of: call)
    }

    var alertsShown: [AlertContent] {
        calls.compactMap { call -> AlertContent? in
            guard case .showAlert(let alert) = call else { return nil }
            return alert
        }
    }

    var progressShows: [ProgressActivation] {
        calls.compactMap { call -> ProgressActivation? in
            guard case .showProgress(_, let activation) = call else { return nil }
            return activation
        }
    }

    var progressUpdates: [ProgressContent] {
        calls.compactMap { call -> ProgressContent? in
            guard case .updateProgress(let content) = call else { return nil }
            return content
        }
    }

    var announcements: [String] {
        calls.compactMap { call -> String? in
            guard case .announce(let text) = call else { return nil }
            return text
        }
    }

    /// The choices offered by the failure window currently on screen, if any.
    var choicesOnScreen: [AlertChoice] {
        guard let alert = alertOnScreen else { return [] }
        return alert.buttons.map { $0.choice }
    }

    var pasteboardWrites: [String] {
        calls.compactMap { call -> String? in
            guard case .pasteboard(let text) = call else { return nil }
            return text
        }
    }

    var terminated: Bool {
        calls.contains(.terminate)
    }

    var replied: Bool {
        calls.contains(.replyToTermination)
    }
}
