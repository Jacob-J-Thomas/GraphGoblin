import AppKit
import CoreGraphics
import LaunchContract
import Testing
@testable import LauncherPresentation

/// Whether this test process belongs to a logged-in Quartz GUI session. Window construction
/// needs one; a plain SSH session does not have it.
enum WindowServerSession {
    static var isAvailable: Bool {
        CGSessionCopyCurrentDictionary() != nil
    }
}

/// Real launcher windows built offscreen. Nothing is ordered on screen, made key or shown
/// to a person. These are construction and routing checks, not native focus observations.
@MainActor
@Suite(
    "AppKit windows (needs a GUI login session; nothing is shown)",
    .enabled(if: WindowServerSession.isAvailable, "This process has no Quartz GUI session")
)
struct AppKitWindowTests {
    init() {
        _ = NSApplication.shared
    }

    static func keyEvent(_ characters: String, keyCode: UInt16, flags: NSEvent.ModifierFlags) -> NSEvent? {
        NSEvent.keyEvent(
            with: .keyDown,
            location: .zero,
            modifierFlags: flags,
            timestamp: 0,
            windowNumber: 0,
            context: nil,
            characters: characters,
            charactersIgnoringModifiers: characters,
            isARepeat: false,
            keyCode: keyCode
        )
    }

    @Test("Progress panel: titled, closable, fixed size, stays visible when the app deactivates")
    func progressPanelProperties() {
        let recorder = CallbackRecorder()
        let panel = ProgressPanel(content: PresentationCopy.progress(for: .checking)) {
            recorder.hides += 1
        }
        #expect(panel.styleMask.contains(.titled))
        #expect(panel.styleMask.contains(.closable))
        #expect(!panel.styleMask.contains(.resizable))
        #expect(!panel.styleMask.contains(.miniaturizable))
        #expect(!panel.hidesOnDeactivate)
        #expect(!panel.isReleasedWhenClosed)
        #expect(!panel.isRestorable)
        #expect(!panel.isFloatingPanel)
        #expect(panel.level == .normal)
        #expect(panel.title == "GraphGoblin")
        #expect(panel.initialFirstResponder === panel.controls.hideButton)
        #expect(panel.accessibilityIdentifier() == AccessibilityID.progressPanel)
        #expect(panel.controls.hideButton.target === panel)
        #expect(!panel.isVisible)
        panel.close()
    }

    @Test("Close box, Command-W, Esc, Command-period and Hide all only hide the progress panel")
    func progressPanelHidePaths() throws {
        let recorder = CallbackRecorder()
        let panel = ProgressPanel(content: PresentationCopy.progress(for: .starting)) {
            recorder.hides += 1
        }
        panel.performClose(nil)
        panel.cancelOperation(nil)
        let escape = try #require(Self.keyEvent("\u{1b}", keyCode: 53, flags: []))
        #expect(panel.performKeyEquivalent(with: escape))
        let commandPeriod = try #require(Self.keyEvent(".", keyCode: 47, flags: [.command]))
        #expect(panel.performKeyEquivalent(with: commandPeriod))
        panel.controls.hideButton.performClick(nil)
        #expect(recorder.hides == 5)
        #expect(!panel.isVisible)

        let returnKey = try #require(Self.keyEvent("\r", keyCode: 36, flags: []))
        #expect(!panel.performKeyEquivalent(with: returnKey))
        #expect(recorder.hides == 5)
        panel.close()
    }

    @Test("Failure panel: dialog subrole, default button first responder, every cancel path dismisses")
    func failurePanelRouting() throws {
        let recorder = CallbackRecorder()
        let content = PresentationCopy.alert(for: .childExited, showLogAvailable: true)
        let panel = FailurePanel(content: content) { choice in
            recorder.choices.append(choice)
        }
        #expect(panel.accessibilitySubrole() == .dialog)
        #expect(panel.accessibilityIdentifier() == AccessibilityID.failurePanel)
        #expect(panel.initialFirstResponder === panel.controls.buttons[0])
        #expect(panel.styleMask.contains(.closable))
        #expect(!panel.styleMask.contains(.resizable))
        #expect(!panel.hidesOnDeactivate)
        #expect(!panel.isReleasedWhenClosed)
        #expect(panel.title == "GraphGoblin")

        panel.cancelOperation(nil)
        panel.performClose(nil)
        let escape = try #require(Self.keyEvent("\u{1b}", keyCode: 53, flags: []))
        #expect(panel.performKeyEquivalent(with: escape))
        let commandPeriod = try #require(Self.keyEvent(".", keyCode: 47, flags: [.command]))
        #expect(panel.performKeyEquivalent(with: commandPeriod))
        panel.controls.buttons[0].performClick(nil)
        panel.controls.buttons[1].performClick(nil)
        #expect(recorder.choices == [.dismiss, .dismiss, .dismiss, .dismiss, .dismiss, .showLog])
        panel.close()
    }

    @Test("A lone OK failure panel still dismisses on Esc")
    func loneOKDismissesOnEscape() throws {
        let recorder = CallbackRecorder()
        let panel = FailurePanel(content: PresentationCopy.alert(for: .diagnosticsUnavailable, showLogAvailable: false)) { choice in
            recorder.choices.append(choice)
        }
        let escape = try #require(Self.keyEvent("\u{1b}", keyCode: 53, flags: []))
        #expect(panel.performKeyEquivalent(with: escape))
        #expect(recorder.choices == [.dismiss])
        panel.close()
    }

    @Test("The delegate routes reopen and Quit without starting another attempt")
    func delegateRouting() {
        let probe = LifecycleProbe()
        let delegate = LauncherAppDelegate(lifecycle: probe)
        let application = NSApplication.shared

        #expect(delegate.applicationShouldHandleReopen(application, hasVisibleWindows: false) == false)
        #expect(delegate.applicationShouldHandleReopen(application, hasVisibleWindows: true) == false)
        #expect(probe.reopens == 2)
        #expect(probe.starts == 0)

        probe.decision = .later
        #expect(delegate.applicationShouldTerminate(application) == .terminateLater)
        probe.decision = .now
        #expect(delegate.applicationShouldTerminate(application) == .terminateNow)
        #expect(delegate.applicationShouldTerminateAfterLastWindowClosed(application) == false)
        #expect(delegate.applicationSupportsSecureRestorableState(application))
    }
}
