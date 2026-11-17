import AppKit
import Foundation
import LaunchContract
@testable import LauncherPresentation

/// A GitHub-hosted runner: a fresh virtual machine with its own logged-in Quartz session that
/// is discarded after the job. Only there may tests order launcher windows on screen, activate
/// an application, write the general pasteboard or start a GUI child process. A developer's
/// own session never qualifies, so nothing on it is shown, focused or overwritten.
enum DisposableGUISession {
    static var isAvailable: Bool {
        let environment = ProcessInfo.processInfo.environment
        return WindowServerSession.isAvailable
            && environment["GITHUB_ACTIONS"] == "true"
            && environment["RUNNER_ENVIRONMENT"] == "github-hosted"
    }
}

/// The launcher windows this test process currently has on screen, found through the public
/// `NSApplication.windows` list rather than the surface's private references.
@MainActor
enum LiveWindows {
    static var progressPanels: [ProgressPanel] {
        NSApplication.shared.windows.compactMap { $0 as? ProgressPanel }.filter { $0.isVisible }
    }

    static var failurePanels: [FailurePanel] {
        NSApplication.shared.windows.compactMap { $0 as? FailurePanel }.filter { $0.isVisible }
    }

    /// Takes every launcher window off screen, so a failed assertion cannot leave one behind
    /// for the next test's window count.
    static func closeAll() {
        for panel in progressPanels {
            panel.close()
        }
        for panel in failurePanels {
            panel.close()
        }
    }
}

/// Real AppKit rendering for in-process composition. Every call reaches a real `AppKitSurface`
/// except the two that end the process: `NSApplication.terminate(_:)` and the termination reply
/// would end the shared test runner, so they are recorded here instead. Like AppKit, a
/// termination request is put to the lifecycle (the delegate path). `ChildCompositionTests`
/// exercises the real two in a tracked child process.
@MainActor
final class TerminationGuardSurface: PresentationSurface {
    let rendering: AppKitSurface
    weak var lifecycle: (any PresentationLifecycle)?
    private(set) var terminationRequests = 0
    private(set) var terminationDecisions: [TerminationDecision] = []
    private(set) var terminationReplies = 0

    init() {
        rendering = AppKitSurface()
    }

    func showProgress(_ content: ProgressContent, activation: ProgressActivation) {
        rendering.showProgress(content, activation: activation)
    }

    func updateProgress(_ content: ProgressContent) {
        rendering.updateProgress(content)
    }

    func hideProgress() {
        rendering.hideProgress()
    }

    func closeProgress() {
        rendering.closeProgress()
    }

    func showAlert(_ content: AlertContent) {
        rendering.showAlert(content)
    }

    func raiseAlert() {
        rendering.raiseAlert()
    }

    func closeAlert() {
        rendering.closeAlert()
    }

    func announce(_ text: String) {
        rendering.announce(text)
    }

    func writeToPasteboard(_ text: String) {
        rendering.writeToPasteboard(text)
    }

    func terminateApplication() {
        terminationRequests += 1
        if let decision = lifecycle?.terminationRequested() {
            terminationDecisions.append(decision)
        }
    }

    func replyToTermination() {
        terminationReplies += 1
    }
}

/// The real controller driving real launcher windows, with a scripted engine, browser opener,
/// Show Log resolver and manual clock.
@MainActor
final class LiveHarness {
    let engine: ScriptedLaunchEngine
    let opener: ScriptedBrowserOpener
    let resolver: ScriptedResolver
    let clock: ManualClock
    let surface: TerminationGuardSurface
    let controller: LaunchPresentationController<ManualClock>

    init() {
        let engine = ScriptedLaunchEngine()
        let opener = ScriptedBrowserOpener()
        let resolver = ScriptedResolver()
        let clock = ManualClock()
        let surface = TerminationGuardSurface()
        let controller = LaunchPresentationController(
            engine: engine,
            resolveShowLog: resolver.makeResolver(),
            opener: opener,
            surface: surface,
            clock: clock
        )
        surface.rendering.events = controller
        surface.lifecycle = controller
        self.engine = engine
        self.opener = opener
        self.resolver = resolver
        self.clock = clock
        self.surface = surface
        self.controller = controller
    }

    func start() async {
        controller.start()
        await engine.waitUntilRunning()
    }

    func emit(_ stage: LaunchStage) async {
        engine.emit(stage)
        await drainMainActor()
    }

    func finishEngine(with outcome: LaunchOutcome) async {
        engine.complete(with: outcome)
        await waitUntil("the engine outcome to reach the controller") {
            self.controller.runReturned
        }
    }

    func waitForTimer(at offset: Duration) async {
        await waitUntil("a timer at \(offset)") {
            self.clock.hasSleeper(until: offset)
        }
    }

    /// Lets the 1 s threshold pass and returns the one progress panel then on screen.
    func showDelayedPanel() async -> ProgressPanel? {
        await waitForTimer(at: .seconds(1))
        clock.advance(by: .seconds(1))
        await waitUntil("the delayed panel") {
            LiveWindows.progressPanels.count == 1
        }
        return LiveWindows.progressPanels.first
    }
}

/// The general pasteboard's plain text before a test, put back afterwards.
@MainActor
struct PasteboardSnapshot {
    private let text: String?

    init() {
        text = NSPasteboard.general.string(forType: .string)
    }

    func restore() {
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        if let text {
            pasteboard.setString(text, forType: .string)
        }
    }
}
