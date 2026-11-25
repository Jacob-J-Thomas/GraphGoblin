import AppKit

/// Production rendering of the controller's decisions. Holds at most one progress panel and
/// one failure window, never both on screen.
@MainActor
final class AppKitSurface: PresentationSurface {
    weak var events: (any PresentationEvents)?

    private var progressContent = PresentationCopy.progress(for: nil)
    private var progressPanel: ProgressPanel?
    private var failurePanel: FailurePanel?

    func showProgress(_ content: ProgressContent, activation: ProgressActivation) {
        progressContent = content
        let panel = progressPanel ?? makeProgressPanel()
        panel.apply(content)
        switch activation {
        case .activate:
            NSApplication.shared.activate()
            panel.makeKeyAndOrderFront(nil)
        case .ifAppActive:
            // Never take key focus on our own once the user has switched away.
            if NSApplication.shared.isActive {
                panel.makeKeyAndOrderFront(nil)
            } else {
                panel.orderFront(nil)
            }
        }
        panel.startSpinner()
    }

    func updateProgress(_ content: ProgressContent) {
        progressContent = content
        progressPanel?.apply(content)
    }

    func hideProgress() {
        guard let panel = progressPanel else { return }
        panel.stopSpinner()
        panel.orderOut(nil)
    }

    func closeProgress() {
        guard let panel = progressPanel else { return }
        progressPanel = nil
        panel.stopSpinner()
        panel.close()
    }

    func showAlert(_ content: AlertContent) {
        closeAlert()
        let panel = FailurePanel(content: content) { [weak self] choice in
            self?.events?.alertChoiceMade(choice)
        }
        failurePanel = panel
        panel.center()
        NSApplication.shared.activate()
        panel.makeKeyAndOrderFront(nil)
        announce("\(content.title). \(content.message)")
    }

    func raiseAlert() {
        guard let panel = failurePanel else { return }
        NSApplication.shared.activate()
        panel.makeKeyAndOrderFront(nil)
    }

    func closeAlert() {
        guard let panel = failurePanel else { return }
        failurePanel = nil
        panel.close()
    }

    func announce(_ text: String) {
        NSAccessibility.post(
            element: NSApplication.shared,
            notification: .announcementRequested,
            userInfo: [
                .announcement: text,
                .priority: NSAccessibilityPriorityLevel.high.rawValue,
            ]
        )
    }

    func writeToPasteboard(_ text: String) {
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(text, forType: .string)
    }

    func terminateApplication() {
        NSApplication.shared.terminate(nil)
    }

    func replyToTermination() {
        NSApplication.shared.reply(toApplicationShouldTerminate: true)
    }

    private func makeProgressPanel() -> ProgressPanel {
        let panel = ProgressPanel(content: progressContent) { [weak self] in
            self?.events?.hideRequested()
        }
        panel.center()
        progressPanel = panel
        return panel
    }
}
