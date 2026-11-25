import AppKit

/// Routes AppKit lifecycle callbacks to the presentation controller.
@MainActor
final class LauncherAppDelegate: NSObject, NSApplicationDelegate {
    private let lifecycle: any PresentationLifecycle

    init(lifecycle: any PresentationLifecycle) {
        self.lifecycle = lifecycle
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Start after this callback returns so the Dock bounce ends promptly.
        Task { @MainActor in
            self.lifecycle.start()
        }
    }

    /// Finder double-click, Dock click or `open` while running. Surfaces existing state only.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        lifecycle.reopenRequested()
        return false
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        switch lifecycle.terminationRequested() {
        case .now:
            return .terminateNow
        case .later:
            return .terminateLater
        }
    }

    /// Hiding or closing the progress panel never ends the attempt.
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool {
        true
    }
}
