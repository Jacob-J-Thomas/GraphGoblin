import AppKit
import Darwin
import Foundation
import LaunchContract
import LauncherPresentation
import Synchronization

/// Test-only driver for the composed GUI launcher, started by `ChildCompositionTests` as a
/// tracked child in a disposable hosted GUI session. It is never part of the app bundle.
///
/// It runs the public `runLauncherPresentation` entry with a scripted engine, drives the real
/// windows only through their stable accessibility identifiers, writes one marker per line to
/// stdout and ends through the launcher's own AppKit termination. It opens no browser or
/// Finder window and touches no GraphGoblin installation, data, port or log.
@main
enum PresentationFixtureEntry {
    @MainActor
    static func main() {
        let arguments = Array(CommandLine.arguments.dropFirst())
        guard arguments.count == 1, let scenario = Scenario(rawValue: arguments[0]) else {
            Marker.write("usage")
            exit(64)
        }
        _ = NotificationCenter.default.addObserver(
            forName: NSApplication.willTerminateNotification,
            object: nil,
            queue: nil
        ) { _ in
            Marker.terminating()
        }
        runLauncherPresentation(engine: FixtureEngine(scenario: scenario)) {
            Marker.write("resolver.asked")
            return nil
        }
        // The entry ends the process through AppKit; returning here is a failure.
        Marker.write("fixture.presentation-returned")
        exit(70)
    }
}

enum Scenario: String, Sendable {
    /// The engine returns `.cancelled` after a second entry call: a quiet exit.
    case cancelled
    /// Progress shows; Hide, reopen, then the main menu's Quit; the engine returns on Quit.
    case progressMenuQuit = "progress-menu-quit"
    /// Progress shows; the panel's Quit button; the engine never returns.
    case panelQuitGrace = "panel-quit-grace"
    /// Progress shows, then `.childExited`, whose Show Log offer resolves to nothing; the user
    /// presses OK.
    case failureOK = "failure-ok"
}

/// Line-atomic stdout markers, written with `write(2)` so nothing is lost to buffering at exit.
enum Marker {
    private static let quit = QuitInstant()

    static func write(_ text: String) {
        let bytes = Array("gg-fixture: \(text)\n".utf8)
        bytes.withUnsafeBytes { buffer in
            guard let base = buffer.baseAddress else { return }
            var offset = 0
            while offset < buffer.count {
                let written = Darwin.write(STDOUT_FILENO, base + offset, buffer.count - offset)
                if written > 0 {
                    offset += written
                } else if written < 0, errno == EINTR {
                    continue
                } else {
                    return
                }
            }
        }
    }

    /// Records the instant the simulated user asked to quit.
    static func quitStarted() {
        let now = ContinuousClock().now
        quit.instant.withLock { $0 = now }
    }

    /// `NSApplication.willTerminateNotification`: the last thing AppKit announces before exit.
    static func terminating() {
        if let start = quit.instant.withLock({ $0 }) {
            let (seconds, attoseconds) = start.duration(to: ContinuousClock().now).components
            write("fixture.quit-elapsed-ms=\(seconds * 1_000 + attoseconds / 1_000_000_000_000_000)")
        }
        write("app.will-terminate")
    }
}

final class QuitInstant: Sendable {
    let instant = Mutex<ContinuousClock.Instant?>(nil)
}

final class FixtureEngine: LaunchEngine {
    private struct State {
        var quitRequested = false
        var quitWaiter: CheckedContinuation<Void, Never>?
        var proceeded = false
        var proceedWaiter: CheckedContinuation<Void, Never>?
        var parked: [CheckedContinuation<Void, Never>] = []
    }

    private let scenario: Scenario
    private let state = Mutex(State())

    init(scenario: Scenario) {
        self.scenario = scenario
    }

    func run(progress: @escaping @Sendable (LaunchStage) -> Void) async -> LaunchOutcome {
        Marker.write("engine.run")
        switch scenario {
        case .cancelled:
            await MainActor.run {
                runLauncherPresentation(engine: UntouchedEngine()) {
                    Marker.write("second.resolver.asked")
                    return nil
                }
                Marker.write("fixture.second-call-returned")
            }
            return .cancelled
        case .progressMenuQuit:
            progress(.checking)
            Task { @MainActor in
                await Driver.hideReopenThenMenuQuit()
            }
            await waitForQuit()
            return .cancelled
        case .panelQuitGrace:
            progress(.checking)
            Task { @MainActor in
                await Driver.panelQuit()
            }
            // Ignores Quit and never returns: only the presentation's grace can end the process.
            await park()
            return .unexpected
        case .failureOK:
            progress(.checking)
            Task { @MainActor in
                await Driver.failureThenOK(engine: self)
            }
            await waitToProceed()
            return .childExited
        }
    }

    func requestQuit() {
        Marker.write("engine.request-quit")
        let waiter: CheckedContinuation<Void, Never>? = state.withLock { current in
            current.quitRequested = true
            let waiting = current.quitWaiter
            current.quitWaiter = nil
            return waiting
        }
        waiter?.resume()
    }

    /// Lets the failure scenario return its outcome once the progress panel has been seen.
    func proceed() {
        let waiter: CheckedContinuation<Void, Never>? = state.withLock { current in
            current.proceeded = true
            let waiting = current.proceedWaiter
            current.proceedWaiter = nil
            return waiting
        }
        waiter?.resume()
    }

    private func waitForQuit() async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            let already: Bool = state.withLock { current in
                if current.quitRequested {
                    return true
                }
                current.quitWaiter = continuation
                return false
            }
            if already {
                continuation.resume()
            }
        }
    }

    private func waitToProceed() async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            let already: Bool = state.withLock { current in
                if current.proceeded {
                    return true
                }
                current.proceedWaiter = continuation
                return false
            }
            if already {
                continuation.resume()
            }
        }
    }

    private func park() async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            state.withLock { $0.parked.append(continuation) }
        }
    }
}

/// The engine offered to a second entry call. Any marker from it is a failure.
final class UntouchedEngine: LaunchEngine {
    func run(progress: @escaping @Sendable (LaunchStage) -> Void) async -> LaunchOutcome {
        Marker.write("second.engine.run")
        return .cancelled
    }

    func requestQuit() {
        Marker.write("second.engine.request-quit")
    }
}

/// Simulated user actions on the real windows, found by their accessibility identifiers.
@MainActor
enum Driver {
    static let progressPanel = "gg.launcher.progress"
    static let progressStatus = "gg.launcher.progress.status"
    static let progressHide = "gg.launcher.progress.hide"
    static let progressQuit = "gg.launcher.progress.quit"
    static let failurePanel = "gg.launcher.failure"
    static let failureTitle = "gg.launcher.failure.title"
    static let failureDismiss = "gg.launcher.failure.dismiss"

    static func hideReopenThenMenuQuit() async {
        let panel = await visibleWindow(progressPanel)
        reportProgress(panel)
        guard let hide = control(progressHide, in: panel, as: NSButton.self) else {
            fail("missing the Hide button")
        }
        hide.performClick(nil)
        Marker.write("fixture.hidden visible=\(flag(panel.isVisible))")

        // What AppKit calls on a Finder double-click or Dock click while running.
        let application = NSApplication.shared
        _ = application.delegate?.applicationShouldHandleReopen?(application, hasVisibleWindows: false)
        Marker.write("fixture.reopened visible=\(flag(panel.isVisible)) same-window=\(flag(window(progressPanel) === panel))")

        asUser {
            guard let item = NSApplication.shared.mainMenu?.items.first?.submenu?.items.first,
                  let menu = item.menu
            else {
                Driver.fail("missing the Quit menu item")
            }
            Marker.write("fixture.menu-quit title=\(item.title)")
            Marker.quitStarted()
            menu.performActionForItem(at: menu.index(of: item))
        }
    }

    static func panelQuit() async {
        let panel = await visibleWindow(progressPanel)
        reportProgress(panel)
        asUser {
            guard let panel = Driver.window(Driver.progressPanel),
                  let quit = Driver.control(Driver.progressQuit, in: panel, as: NSButton.self)
            else {
                Driver.fail("missing the progress Quit button")
            }
            Marker.write("fixture.panel-quit title=\(quit.title)")
            Marker.quitStarted()
            quit.performClick(nil)
        }
    }

    static func failureThenOK(engine: FixtureEngine) async {
        let panel = await visibleWindow(progressPanel)
        reportProgress(panel)
        engine.proceed()
        let failure = await visibleWindow(failurePanel)
        let title = control(failureTitle, in: failure, as: NSTextField.self)?.stringValue ?? "<missing>"
        let buttons = buttonTitles(in: failure).joined(separator: "|")
        Marker.write("fixture.failure-visible title=\(title) buttons=\(buttons) progress-visible=\(flag(panel.isVisible))")
        asUser {
            guard let failure = Driver.window(Driver.failurePanel),
                  let ok = Driver.control(Driver.failureDismiss, in: failure, as: NSButton.self)
            else {
                Driver.fail("missing the OK button")
            }
            Marker.write("fixture.click title=\(ok.title)")
            ok.performClick(nil)
        }
    }

    /// Runs `action` from a run-loop callout, as AppKit delivers a click or menu choice, rather
    /// than inside this Swift task's main-queue job. A Quit answered "later" spins a nested run
    /// loop until the reply, and only outside a main-queue job can that loop run the main-actor
    /// work that sends the reply.
    static func asUser(_ action: @escaping @MainActor @Sendable () -> Void) {
        let mainLoop = CFRunLoopGetMain()
        CFRunLoopPerformBlock(mainLoop, CFRunLoopMode.commonModes.rawValue) {
            MainActor.assumeIsolated {
                action()
            }
        }
        CFRunLoopWakeUp(mainLoop)
    }

    static func window(_ identifier: String) -> NSWindow? {
        NSApplication.shared.windows.first { $0.accessibilityIdentifier() == identifier }
    }

    /// Waits up to 10 s for the window to be on screen; a timeout ends the fixture with exit 75.
    static func visibleWindow(_ identifier: String) async -> NSWindow {
        let clock = ContinuousClock()
        let limit = clock.now.advanced(by: .seconds(10))
        while true {
            if let window = window(identifier), window.isVisible {
                return window
            }
            if clock.now >= limit {
                fail("timed out waiting for \(identifier)")
            }
            try? await Task.sleep(for: .milliseconds(20))
        }
    }

    static func control<Control: NSView>(_ identifier: String, in window: NSWindow, as type: Control.Type) -> Control? {
        guard let root = window.contentView else { return nil }
        return find(identifier, under: root) as? Control
    }

    static func reportProgress(_ panel: NSWindow) {
        let status = control(progressStatus, in: panel, as: NSTextField.self)?.stringValue ?? "<missing>"
        Marker.write("fixture.progress-visible status=\(status)")
    }

    static func buttonTitles(in window: NSWindow) -> [String] {
        guard let root = window.contentView else { return [] }
        return buttons(under: root).map { $0.title }
    }

    static func flag(_ value: Bool) -> String {
        value ? "1" : "0"
    }

    static func fail(_ reason: String) -> Never {
        Marker.write("fixture.failed \(reason)")
        exit(75)
    }

    private static func find(_ identifier: String, under view: NSView) -> NSView? {
        if view.accessibilityIdentifier() == identifier {
            return view
        }
        for subview in view.subviews {
            if let match = find(identifier, under: subview) {
                return match
            }
        }
        return nil
    }

    private static func buttons(under view: NSView) -> [NSButton] {
        var found: [NSButton] = []
        if let button = view as? NSButton {
            found.append(button)
        }
        for subview in view.subviews {
            found += buttons(under: subview)
        }
        return found
    }
}
