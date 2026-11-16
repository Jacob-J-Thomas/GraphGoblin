import LaunchContract
import Testing
@testable import LauncherPresentation

/// One controller wired to scripted engine, opener, surface, resolver and manual clock.
@MainActor
final class Harness {
    let engine: ScriptedLaunchEngine
    let opener: ScriptedBrowserOpener
    let surface: ScriptedSurface
    let clock: ManualClock
    let resolver: ScriptedResolver
    let controller: LaunchPresentationController<ManualClock>

    init() {
        let engine = ScriptedLaunchEngine()
        let opener = ScriptedBrowserOpener()
        let surface = ScriptedSurface()
        let clock = ManualClock()
        let resolver = ScriptedResolver()
        let controller = LaunchPresentationController(
            engine: engine,
            resolveShowLog: resolver.makeResolver(),
            opener: opener,
            surface: surface,
            clock: clock
        )
        surface.lifecycle = controller
        self.engine = engine
        self.opener = opener
        self.surface = surface
        self.clock = clock
        self.resolver = resolver
        self.controller = controller
    }

    /// Starts the attempt and waits until the engine's `run` has been entered.
    func start() async {
        controller.start()
        await engine.waitUntilRunning()
    }

    /// Returns `outcome` from the engine and waits until the controller has processed it.
    func finishEngine(with outcome: LaunchOutcome) async {
        engine.complete(with: outcome)
        await waitUntil("the engine outcome to reach the controller") {
            self.controller.runReturned
        }
    }

    /// Emits a stage from the engine and lets the ordered stream deliver it.
    func emit(_ stage: LaunchStage) async {
        engine.emit(stage)
        await drainMainActor()
    }

    /// Waits until a timer has registered its sleep for `offset` on the manual clock.
    func waitForTimer(at offset: Duration) async {
        await waitUntil("a timer at \(offset)") {
            self.clock.hasSleeper(until: offset)
        }
    }

    /// Completes the engine with a management outcome and waits for the one submission.
    func reachHandoff(port: UInt16 = 4747, mode: ManagementMode = .running) async {
        await start()
        await finishEngine(with: .openManagement(port: port, mode: mode))
        await waitUntil("the browser submission") {
            self.opener.submissions.count == 1
        }
    }

    /// Completes the engine with a failure and settles any Show Log resolution.
    func reachFailure(_ outcome: LaunchOutcome, offeringShowLog: Bool) async {
        await start()
        await finishEngine(with: outcome)
        if case .failure(let kind) = PresentationCopy.disposition(for: outcome), kind.offersShowLog {
            await waitUntil("the Show Log resolver to be asked") {
                self.resolver.isResolving
            }
            resolver.settle(offeringAction: offeringShowLog)
        }
        await waitUntil("the failure window") {
            self.surface.alertOnScreen != nil
        }
    }
}

/// Polls `condition` on the main actor, yielding between checks, for up to five seconds of
/// real time. Real time only bounds the polling; presentation time comes from `ManualClock`.
@MainActor
func waitUntil(
    _ description: String,
    sourceLocation: SourceLocation = #_sourceLocation,
    _ condition: () -> Bool
) async {
    let realClock = ContinuousClock()
    let limit = realClock.now.advanced(by: .seconds(5))
    while !condition() {
        guard realClock.now < limit else {
            Issue.record("Timed out waiting for \(description)", sourceLocation: sourceLocation)
            return
        }
        await Task.yield()
        try? await Task.sleep(for: .milliseconds(1))
    }
}

/// Lets already-enqueued main-actor work run before a negative assertion.
@MainActor
func drainMainActor() async {
    for _ in 0..<50 {
        await Task.yield()
    }
    try? await Task.sleep(for: .milliseconds(20))
    for _ in 0..<50 {
        await Task.yield()
    }
}
