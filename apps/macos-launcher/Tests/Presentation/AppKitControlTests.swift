import AppKit
import LaunchContract
import Testing
@testable import LauncherPresentation

/// Properties of the real AppKit controls, menu and adapters. Nothing here creates a window,
/// touches `NSApplication.shared`, the pasteboard or the default browser.
@MainActor
@Suite("AppKit controls, menu and adapters (no window server needed)")
struct AppKitControlTests {
    @Test("The main menu maps Command-Q to terminate and Command-W to performClose")
    func mainMenu() throws {
        let menu = LauncherMenu.make()
        #expect(menu.items.count == 2)

        let applicationMenu = try #require(menu.items.first?.submenu)
        #expect(applicationMenu.items.count == 1)
        let quit = try #require(applicationMenu.items.first)
        #expect(quit.title == "Quit GraphGoblin")
        #expect(quit.keyEquivalent == "q")
        #expect(quit.keyEquivalentModifierMask == [.command])
        #expect(quit.action == #selector(NSApplication.terminate(_:)))
        #expect(quit.target == nil)

        let fileMenu = try #require(menu.items.last?.submenu)
        #expect(fileMenu.title == "File")
        let close = try #require(fileMenu.items.first)
        #expect(close.title == "Close")
        #expect(close.keyEquivalent == "w")
        #expect(close.keyEquivalentModifierMask == [.command])
        #expect(close.action == #selector(NSWindow.performClose(_:)))
        #expect(close.target == nil)
    }

    @Test("Progress controls: Hide answers Esc, Quit sends terminate, Return is inert")
    func progressControls() {
        let content = PresentationCopy.progress(for: .waitingForRelease)
        let controls = ProgressControls(content: content)

        #expect(controls.hideButton.title == "Hide")
        #expect(controls.hideButton.keyEquivalent == "\u{1b}")
        #expect(controls.hideButton.toolTip == PresentationCopy.hideHelp)
        #expect(controls.hideButton.accessibilityIdentifier() == AccessibilityID.progressHide)

        #expect(controls.quitButton.title == "Quit")
        #expect(controls.quitButton.keyEquivalent == "")
        #expect(controls.quitButton.action == #selector(NSApplication.terminate(_:)))
        #expect(controls.quitButton.target == nil)
        #expect(controls.quitButton.toolTip == PresentationCopy.quitHelp)
        #expect(controls.quitButton.accessibilityIdentifier() == AccessibilityID.progressQuit)

        let returnButtons = [controls.hideButton, controls.quitButton].filter { $0.keyEquivalent == "\r" }
        #expect(returnButtons.isEmpty)

        #expect(controls.spinner.style == .spinning)
        #expect(controls.spinner.isIndeterminate)
        #expect(controls.spinner.accessibilityLabel() == "Launch in progress")
        #expect(controls.spinner.accessibilityIdentifier() == AccessibilityID.progressSpinner)

        #expect(controls.statusLabel.stringValue == content.statusLine)
        #expect(controls.detailLabel.stringValue == content.detail)
        #expect(!controls.statusLabel.isEditable)
        #expect(!controls.statusLabel.isSelectable)
        #expect(controls.statusLabel.accessibilityIdentifier() == AccessibilityID.progressStatus)
        #expect(controls.detailLabel.accessibilityIdentifier() == AccessibilityID.progressDetail)

        controls.apply(PresentationCopy.handoffProgress)
        #expect(controls.statusLabel.stringValue == PresentationCopy.handoffProgress.statusLine)
        #expect(controls.detailLabel.stringValue == PresentationCopy.handoffProgress.detail)
    }

    @Test("Failure controls: OK is the Return default; the secondary action has no key")
    func failureControlsWithShowLog() {
        let content = PresentationCopy.alert(for: .childExited, showLogAvailable: true)
        let controls = FailureControls(content: content)

        #expect(controls.buttons.map { $0.title } == ["OK", "Show Log in Finder"])
        #expect(controls.buttons.map { $0.keyEquivalent } == ["\r", ""])
        #expect(controls.buttons.map { $0.accessibilityIdentifier() } == [
            AccessibilityID.failureButton(.dismiss),
            AccessibilityID.failureButton(.showLog),
        ])
        #expect(controls.titleLabel.stringValue == content.title)
        #expect(controls.messageLabel.stringValue == content.message)
        #expect(!controls.titleLabel.isSelectable)
        #expect(!controls.messageLabel.isSelectable)
        #expect(!controls.messageLabel.isEditable)
        #expect(controls.titleLabel.accessibilityIdentifier() == AccessibilityID.failureTitle)
        #expect(controls.messageLabel.accessibilityIdentifier() == AccessibilityID.failureMessage)
        #expect(!controls.iconView.isAccessibilityElement())
    }

    @Test("Browser failure controls offer OK and Copy Address only")
    func failureControlsForBrowser() throws {
        let address = try #require(ManagementAddress(port: 4747))
        let controls = FailureControls(content: PresentationCopy.alert(for: .browserRejected(address), showLogAvailable: true))
        #expect(controls.buttons.map { $0.title } == ["OK", "Copy Address"])
        #expect(controls.buttons.map { $0.keyEquivalent } == ["\r", ""])
    }

    @Test("A lone OK is still the Return default")
    func failureControlsLoneOK() {
        let controls = FailureControls(content: PresentationCopy.alert(for: .diagnosticsUnavailable, showLogAvailable: true))
        #expect(controls.buttons.map { $0.title } == ["OK"])
        #expect(controls.buttons.first?.keyEquivalent == "\r")
    }

    @Test("Esc and Command-period are the only cancel keys")
    func cancelKeys() {
        #expect(KeyMapping.isCancelKey(charactersIgnoringModifiers: "\u{1b}", modifierFlags: []))
        #expect(KeyMapping.isCancelKey(charactersIgnoringModifiers: ".", modifierFlags: [.command]))
        #expect(KeyMapping.isCancelKey(charactersIgnoringModifiers: ".", modifierFlags: [.command, .capsLock]))
        #expect(!KeyMapping.isCancelKey(charactersIgnoringModifiers: ".", modifierFlags: []))
        #expect(!KeyMapping.isCancelKey(charactersIgnoringModifiers: ".", modifierFlags: [.command, .shift]))
        #expect(!KeyMapping.isCancelKey(charactersIgnoringModifiers: "\u{1b}", modifierFlags: [.option]))
        #expect(!KeyMapping.isCancelKey(charactersIgnoringModifiers: "\r", modifierFlags: []))
        #expect(!KeyMapping.isCancelKey(charactersIgnoringModifiers: "w", modifierFlags: [.command]))
        #expect(!KeyMapping.isCancelKey(charactersIgnoringModifiers: "q", modifierFlags: [.command]))
        #expect(!KeyMapping.isCancelKey(charactersIgnoringModifiers: nil, modifierFlags: []))
    }

    @Test("The native browser callback translates to the closed outcome")
    func browserCallbackTranslation() {
        #expect(BrowserCallback.outcome(applicationReturned: true, errorReturned: false) == .accepted)
        #expect(BrowserCallback.outcome(applicationReturned: false, errorReturned: true) == .rejected)
        #expect(BrowserCallback.outcome(applicationReturned: true, errorReturned: true) == .rejected)
        #expect(BrowserCallback.outcome(applicationReturned: false, errorReturned: false) == .unconfirmed)
    }

    @Test("Accessibility identifiers are distinct")
    func distinctIdentifiers() {
        let identifiers = [
            AccessibilityID.progressPanel, AccessibilityID.progressSpinner, AccessibilityID.progressStatus,
            AccessibilityID.progressDetail, AccessibilityID.progressHide, AccessibilityID.progressQuit,
            AccessibilityID.failurePanel, AccessibilityID.failureTitle, AccessibilityID.failureMessage,
            AccessibilityID.failureButton(.dismiss), AccessibilityID.failureButton(.showLog),
            AccessibilityID.failureButton(.copyAddress),
        ]
        #expect(Set(identifiers).count == identifiers.count)
    }

    @Test("The production composition types build without opening anything")
    func productionComposition() async {
        let entry: @MainActor (any LaunchEngine, @escaping @MainActor () async -> ShowLogAction?) -> Void =
            runLauncherPresentation(engine:resolveShowLog:)
        _ = entry

        let surface = AppKitSurface()
        let probe = LifecycleProbe()
        let controller = LaunchPresentationController(
            engine: ScriptedLaunchEngine(),
            resolveShowLog: { nil },
            opener: WorkspaceBrowserOpener(),
            surface: surface,
            clock: ContinuousClock()
        )
        surface.events = controller
        #expect(controller.phase == .idle)

        let delegate = LauncherAppDelegate(lifecycle: probe)
        delegate.applicationDidFinishLaunching(Notification(name: NSApplication.didFinishLaunchingNotification))
        #expect(probe.starts == 0)
        await waitUntil("the deferred start") { probe.starts == 1 }
        #expect(probe.reopens == 0)
    }
}
