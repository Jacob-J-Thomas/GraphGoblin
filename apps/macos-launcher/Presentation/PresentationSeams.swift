import LaunchContract

/// Private routing identity for the single attempt a process makes.
final class AttemptToken: Sendable {}

/// How the application should answer a termination request.
enum TerminationDecision: Equatable, Sendable {
    /// Exit now.
    case now
    /// Wait for `PresentationSurface.replyToTermination()`.
    case later
}

/// How the progress panel is brought forward.
enum ProgressActivation: Equatable, Sendable {
    /// Automatic display after the delay: take key focus only while the app is already active.
    case ifAppActive
    /// The user reopened the app: activate it and make the panel key.
    case activate
}

/// Application lifecycle callbacks, delivered by the AppKit delegate.
@MainActor
protocol PresentationLifecycle: AnyObject {
    func start()
    func reopenRequested()
    func terminationRequested() -> TerminationDecision
}

/// User actions from presentation windows. Quit is not here: every Quit path goes through
/// `NSApplication.terminate(_:)` and arrives as `terminationRequested()`.
@MainActor
protocol PresentationEvents: AnyObject {
    func hideRequested()
    func alertChoiceMade(_ choice: AlertChoice)
}

/// The AppKit boundary. The controller decides what to show; the surface only renders it.
@MainActor
protocol PresentationSurface: AnyObject {
    func showProgress(_ content: ProgressContent, activation: ProgressActivation)
    func updateProgress(_ content: ProgressContent)
    func hideProgress()
    func closeProgress()
    func showAlert(_ content: AlertContent)
    func raiseAlert()
    func closeAlert()
    func announce(_ text: String)
    func writeToPasteboard(_ text: String)
    func terminateApplication()
    func replyToTermination()
}

/// One default-browser submission of the fixed management address.
///
/// The completion may be called on any thread, more than once or never. The controller
/// arbitrates it against its own deadline and attempt token.
@MainActor
protocol BrowserOpening {
    func openManagement(
        _ address: ManagementAddress,
        completion: @escaping @Sendable (BrowserOutcome) -> Void
    )
}
