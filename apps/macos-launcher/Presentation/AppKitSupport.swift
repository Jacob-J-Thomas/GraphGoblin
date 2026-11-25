import AppKit

/// Stable identifiers for native UI scripting and accessibility observation.
enum AccessibilityID {
    static let progressPanel = "gg.launcher.progress"
    static let progressSpinner = "gg.launcher.progress.spinner"
    static let progressStatus = "gg.launcher.progress.status"
    static let progressDetail = "gg.launcher.progress.detail"
    static let progressHide = "gg.launcher.progress.hide"
    static let progressQuit = "gg.launcher.progress.quit"
    static let failurePanel = "gg.launcher.failure"
    static let failureTitle = "gg.launcher.failure.title"
    static let failureMessage = "gg.launcher.failure.message"

    static func failureButton(_ choice: AlertChoice) -> String {
        switch choice {
        case .dismiss:
            return "gg.launcher.failure.dismiss"
        case .showLog:
            return "gg.launcher.failure.show-log"
        case .copyAddress:
            return "gg.launcher.failure.copy-address"
        }
    }
}

/// Keyboard mapping shared by both launcher windows.
enum KeyMapping {
    static let escape = "\u{1b}"
    static let returnKey = "\r"

    /// Esc without modifiers, or Command-period: the cancel action of a launcher window.
    /// Caps Lock and other non-modifier flags are ignored.
    static func isCancelKey(
        charactersIgnoringModifiers characters: String?,
        modifierFlags: NSEvent.ModifierFlags
    ) -> Bool {
        let flags = modifierFlags.intersection([.command, .shift, .control, .option])
        if characters == escape {
            return flags.isEmpty
        }
        if characters == "." {
            return flags == .command
        }
        return false
    }
}

/// The minimal main menu: Quit (Command-Q) and Close (Command-W). Both use the responder
/// chain, so Quit always reaches `NSApplication.terminate(_:)` and the delegate.
@MainActor
enum LauncherMenu {
    static func make() -> NSMenu {
        let mainMenu = NSMenu(title: PresentationCopy.applicationMenu)

        let applicationItem = NSMenuItem(title: PresentationCopy.applicationMenu, action: nil, keyEquivalent: "")
        let applicationMenu = NSMenu(title: PresentationCopy.applicationMenu)
        let quitItem = NSMenuItem(
            title: PresentationCopy.quitMenuItem,
            action: #selector(NSApplication.terminate(_:)),
            keyEquivalent: "q"
        )
        quitItem.keyEquivalentModifierMask = [.command]
        applicationMenu.addItem(quitItem)
        applicationItem.submenu = applicationMenu
        mainMenu.addItem(applicationItem)

        let fileItem = NSMenuItem(title: PresentationCopy.fileMenu, action: nil, keyEquivalent: "")
        let fileMenu = NSMenu(title: PresentationCopy.fileMenu)
        let closeItem = NSMenuItem(
            title: PresentationCopy.closeMenuItem,
            action: #selector(NSWindow.performClose(_:)),
            keyEquivalent: "w"
        )
        closeItem.keyEquivalentModifierMask = [.command]
        fileMenu.addItem(closeItem)
        fileItem.submenu = fileMenu
        mainMenu.addItem(fileItem)

        return mainMenu
    }
}
