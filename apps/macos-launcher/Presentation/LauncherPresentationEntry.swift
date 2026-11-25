import AppKit
import LaunchContract

@MainActor
private enum PresentationEntry {
    static var claimed = false
}

/// Runs the GUI launcher for the one engine attempt this process makes.
///
/// Call once, on the main actor, from the no-argument GUI route. This runs the AppKit event
/// loop and does not return under normal termination: `NSApplication.terminate(_:)` exits
/// the process. A second call returns immediately without touching the engine.
///
/// The engine is asked to `run` exactly once and to `requestQuit()` at most once. The
/// resolver is asked only when a reached failure offers Show Log. No Retry exists; opening
/// GraphGoblin again starts a fresh process and attempt.
@MainActor
public func runLauncherPresentation(
    engine: any LaunchEngine,
    resolveShowLog: @escaping @MainActor () async -> ShowLogAction?
) {
    guard !PresentationEntry.claimed else { return }
    PresentationEntry.claimed = true

    let application = NSApplication.shared
    application.setActivationPolicy(.regular)
    application.mainMenu = LauncherMenu.make()

    let surface = AppKitSurface()
    let controller = LaunchPresentationController(
        engine: engine,
        resolveShowLog: resolveShowLog,
        opener: WorkspaceBrowserOpener(),
        surface: surface,
        clock: ContinuousClock()
    )
    surface.events = controller
    let delegate = LauncherAppDelegate(lifecycle: controller)
    application.delegate = delegate

    // NSApplication holds its delegate weakly; keep the composition alive for the run loop.
    withExtendedLifetime((surface, controller, delegate)) {
        application.run()
    }
}
