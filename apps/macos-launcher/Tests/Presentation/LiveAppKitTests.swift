import AppKit
import Foundation
import LaunchContract
import Testing
@testable import LauncherPresentation

/// Keeps the live and child-process suites from being skipped silently in hosted CI: on a
/// GitHub-hosted runner the disposable GUI session must be recognized.
@Suite("Hosted GUI session gate")
struct HostedSessionGateTests {
    static var isGitHubHosted: Bool {
        let environment = ProcessInfo.processInfo.environment
        return environment["GITHUB_ACTIONS"] == "true" && environment["RUNNER_ENVIRONMENT"] != "self-hosted"
    }

    @Test(
        "A GitHub-hosted runner is a disposable GUI session",
        .enabled(if: HostedSessionGateTests.isGitHubHosted, "Only GitHub-hosted runs must provide the session")
    )
    func hostedRunnerRecognized() {
        let environment = ProcessInfo.processInfo.environment
        #expect(environment["RUNNER_ENVIRONMENT"] == "github-hosted")
        #expect(WindowServerSession.isAvailable)
        #expect(DisposableGUISession.isAvailable)
    }
}

/// Real launcher windows ordered on screen in this test process: first the production surface on
/// its own, then (in `LiveCompositionTests.swift`) the controller driving it. Every test leaves no
/// launcher window on screen, and nothing here terminates or replies to termination of the test
/// runner. Serialized, because each test counts the windows on screen.
@MainActor
@Suite(
    "Live AppKit windows (disposable hosted GUI session only)",
    .serialized,
    .enabled(if: DisposableGUISession.isAvailable, "Windows go on screen only in a disposable hosted GUI session")
)
struct LiveAppKitTests {
    init() {
        _ = NSApplication.shared
    }

    @Test("Progress: one live panel, updated in place, reused after hide, replaced only after close")
    func progressPanelLifecycle() throws {
        defer { LiveWindows.closeAll() }
        let surface = AppKitSurface()
        let probe = EventsProbe()
        surface.events = probe

        // With no panel yet, update, hide and close create nothing.
        surface.updateProgress(PresentationCopy.progress(for: .checking))
        surface.hideProgress()
        surface.closeProgress()
        #expect(LiveWindows.progressPanels.isEmpty)

        surface.showProgress(PresentationCopy.progress(for: .checking), activation: .ifAppActive)
        #expect(LiveWindows.progressPanels.count == 1)
        let panel = try #require(LiveWindows.progressPanels.first)
        #expect(panel.controls.statusLabel.stringValue == "Checking GraphGoblin…")
        #expect(panel.controls.detailLabel.stringValue == PresentationCopy.waitingDetail)

        // Showing again and updating rewrite the same window.
        surface.showProgress(PresentationCopy.progress(for: .starting), activation: .activate)
        #expect(LiveWindows.progressPanels.count == 1)
        #expect(LiveWindows.progressPanels.first === panel)
        #expect(panel.controls.statusLabel.stringValue == "Starting GraphGoblin…")
        surface.updateProgress(PresentationCopy.handoffProgress)
        #expect(LiveWindows.progressPanels.first === panel)
        #expect(panel.controls.statusLabel.stringValue == PresentationCopy.handoffProgress.statusLine)
        #expect(panel.controls.detailLabel.stringValue == PresentationCopy.handoffDetail)

        // Hidden, the same window keeps receiving updates and comes back unchanged in identity.
        surface.hideProgress()
        #expect(!panel.isVisible)
        #expect(LiveWindows.progressPanels.isEmpty)
        surface.updateProgress(PresentationCopy.progress(for: .waitingForRelease))
        #expect(!panel.isVisible)
        #expect(panel.controls.statusLabel.stringValue == PresentationCopy.progress(for: .waitingForRelease).statusLine)
        surface.showProgress(PresentationCopy.progress(for: .waitingForRelease), activation: .activate)
        #expect(panel.isVisible)
        #expect(LiveWindows.progressPanels.count == 1)
        #expect(LiveWindows.progressPanels.first === panel)

        // Closed, the window is gone for good: later updates neither revive nor change it.
        surface.closeProgress()
        #expect(!panel.isVisible)
        #expect(LiveWindows.progressPanels.isEmpty)
        surface.updateProgress(PresentationCopy.progress(for: .checking))
        surface.hideProgress()
        surface.closeProgress()
        #expect(LiveWindows.progressPanels.isEmpty)
        #expect(panel.controls.statusLabel.stringValue == PresentationCopy.progress(for: .waitingForRelease).statusLine)

        // The next show builds a new window with the content it was given.
        surface.showProgress(PresentationCopy.progress(for: nil), activation: .ifAppActive)
        #expect(LiveWindows.progressPanels.count == 1)
        let replacement = try #require(LiveWindows.progressPanels.first)
        #expect(replacement !== panel)
        #expect(replacement.controls.statusLabel.stringValue == "Opening GraphGoblin…")
        #expect(!panel.isVisible)

        surface.closeProgress()
        #expect(LiveWindows.progressPanels.isEmpty)
        #expect(probe.hides == 0)
        #expect(probe.choices.isEmpty)
    }

    @Test("Failure windows: one at a time, raised in place, gone once closed")
    func failureWindowLifecycle() throws {
        defer { LiveWindows.closeAll() }
        let surface = AppKitSurface()
        let probe = EventsProbe()
        surface.events = probe

        surface.raiseAlert()
        surface.closeAlert()
        #expect(LiveWindows.failurePanels.isEmpty)

        let first = PresentationCopy.alert(for: .childExited, showLogAvailable: true)
        surface.showAlert(first)
        #expect(LiveWindows.failurePanels.count == 1)
        let firstPanel = try #require(LiveWindows.failurePanels.first)
        #expect(firstPanel.alertContent == first)
        #expect(firstPanel.controls.titleLabel.stringValue == first.title)
        #expect(firstPanel.controls.messageLabel.stringValue == first.message)
        #expect(firstPanel.controls.buttons.map { $0.title } == ["OK", "Show Log in Finder"])

        // A second alert replaces the first; the two are never on screen together.
        let address = try #require(ManagementAddress(port: 62241))
        let second = PresentationCopy.alert(for: .browserUnconfirmed(address), showLogAvailable: false)
        surface.showAlert(second)
        #expect(!firstPanel.isVisible)
        #expect(LiveWindows.failurePanels.count == 1)
        let secondPanel = try #require(LiveWindows.failurePanels.first)
        #expect(secondPanel !== firstPanel)
        #expect(secondPanel.alertContent == second)
        #expect(secondPanel.controls.messageLabel.stringValue.contains("http://127.0.0.1:62241/app/"))
        #expect(secondPanel.controls.buttons.map { $0.title } == ["OK", "Copy Address"])

        surface.raiseAlert()
        #expect(LiveWindows.failurePanels.count == 1)
        #expect(LiveWindows.failurePanels.first === secondPanel)

        surface.closeAlert()
        #expect(!secondPanel.isVisible)
        #expect(LiveWindows.failurePanels.isEmpty)
        surface.raiseAlert()
        surface.closeAlert()
        #expect(LiveWindows.failurePanels.isEmpty)
        #expect(probe.choices.isEmpty)
    }

    @Test("On live windows Return answers the failure window's OK, and other keys choose nothing")
    func liveKeys() throws {
        defer { LiveWindows.closeAll() }
        let surface = AppKitSurface()
        let probe = EventsProbe()
        surface.events = probe
        let returnKey = try #require(AppKitWindowTests.keyEvent("\r", keyCode: 36, flags: []))
        let letter = try #require(AppKitWindowTests.keyEvent("x", keyCode: 7, flags: []))

        surface.showProgress(PresentationCopy.progress(for: .checking), activation: .ifAppActive)
        let progress = try #require(LiveWindows.progressPanels.first)
        progress.keyDown(with: returnKey)
        progress.keyDown(with: letter)
        #expect(probe.hides == 0)
        #expect(progress.isVisible)

        surface.showAlert(PresentationCopy.alert(for: .childExited, showLogAvailable: true))
        let failure = try #require(LiveWindows.failurePanels.first)
        failure.keyDown(with: letter)
        #expect(!failure.performKeyEquivalent(with: letter))
        #expect(probe.choices.isEmpty)
        #expect(failure.performKeyEquivalent(with: returnKey))
        #expect(probe.choices == [.dismiss])

        surface.closeAlert()
        surface.closeProgress()
        #expect(LiveWindows.progressPanels.isEmpty)
        #expect(LiveWindows.failurePanels.isEmpty)
    }

    @Test("Without a receiver, or once the surface is gone, live window controls change nothing")
    func noReceiver() throws {
        defer { LiveWindows.closeAll() }
        var surface: AppKitSurface? = AppKitSurface()
        surface?.showProgress(PresentationCopy.progress(for: .starting), activation: .ifAppActive)
        surface?.showAlert(PresentationCopy.alert(for: .childExited, showLogAvailable: true))
        let progress = try #require(LiveWindows.progressPanels.first)
        let failure = try #require(LiveWindows.failurePanels.first)

        // No receiver was ever attached: every control is inert and the windows stay.
        progress.controls.hideButton.performClick(nil)
        progress.performClose(nil)
        for button in failure.controls.buttons {
            button.performClick(nil)
        }
        failure.performClose(nil)
        #expect(progress.isVisible)
        #expect(failure.isVisible)

        // A receiver attached later is reached.
        let probe = EventsProbe()
        surface?.events = probe
        progress.controls.hideButton.performClick(nil)
        failure.controls.buttons[0].performClick(nil)
        #expect(probe.hides == 1)
        #expect(probe.choices == [.dismiss])

        // Windows that outlive their surface report to no one.
        weak var released = surface
        surface = nil
        #expect(released == nil)
        progress.controls.hideButton.performClick(nil)
        progress.cancelOperation(nil)
        failure.controls.buttons[1].performClick(nil)
        failure.cancelOperation(nil)
        #expect(probe.hides == 1)
        #expect(probe.choices == [.dismiss])

        progress.close()
        failure.close()
        #expect(LiveWindows.progressPanels.isEmpty)
        #expect(LiveWindows.failurePanels.isEmpty)
    }
}
