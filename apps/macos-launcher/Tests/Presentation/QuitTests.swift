import LaunchContract
import Testing
@testable import LauncherPresentation

@MainActor
@Suite("Quit: synchronous engine request, suppression, and both completion orders")
struct QuitTests {
    @Test("Quit, then a management outcome: no browser submission and no window")
    func quitThenManagementOutcome() async {
        let h = Harness()
        await h.start()
        await h.waitForTimer(at: .seconds(1))
        h.clock.advance(by: .seconds(1))
        await waitUntil("the delayed panel") { h.surface.progressOnScreen }

        let decision = h.controller.terminationRequested()
        // requestQuit() has already been called when Quit returns.
        #expect(h.engine.quitCount == 1)
        #expect(decision == .later)
        #expect(h.controller.phase == .quitting)
        #expect(!h.surface.progressOnScreen)
        let callsAtQuit = h.surface.calls.count

        await h.finishEngine(with: .openManagement(port: 4747, mode: .running))
        await waitUntil("the termination reply") { h.surface.replied }
        await drainMainActor()
        #expect(h.opener.submissions.isEmpty)
        #expect(Array(h.surface.calls.dropFirst(callsAtQuit)) == [.replyToTermination])
        #expect(h.engine.quitCount == 1)
    }

    @Test("Quit, then a failure outcome: no window and no Show Log resolution")
    func quitThenFailureOutcome() async {
        let h = Harness()
        await h.start()
        #expect(h.controller.terminationRequested() == .later)
        let callsAtQuit = h.surface.calls.count
        await h.finishEngine(with: .childExited)
        await waitUntil("the termination reply") { h.surface.replied }
        h.clock.advance(by: .seconds(10))
        await drainMainActor()
        #expect(h.resolver.resolveCount == 0)
        #expect(h.surface.alertsShown.isEmpty)
        #expect(Array(h.surface.calls.dropFirst(callsAtQuit)) == [.replyToTermination])
    }

    @Test("Quit, then the engine's own cancellation: one reply, nothing shown")
    func quitThenCancelled() async {
        let h = Harness()
        await h.start()
        await h.emit(.starting)
        #expect(h.controller.terminationRequested() == .later)
        await h.finishEngine(with: .cancelled)
        await waitUntil("the termination reply") { h.surface.replied }
        #expect(h.surface.count(.replyToTermination) == 1)
        #expect(!h.surface.terminated)
        #expect(h.surface.alertsShown.isEmpty)
    }

    @Test("Engine completion, then Quit: the submitted request stays and late callbacks are ignored")
    func managementThenQuit() async {
        let h = Harness()
        await h.reachHandoff()
        await h.waitForTimer(at: .seconds(10))

        #expect(h.controller.terminationRequested() == .now)
        // The run has returned, so no reply is owed and a repeated Quit is also immediate.
        #expect(h.controller.terminationRequested() == .now)
        #expect(h.engine.quitCount == 1)
        #expect(!h.clock.hasSleeper(until: .seconds(10)))
        let callsAfterQuit = h.surface.calls.count

        h.opener.deliver(.rejected)
        h.clock.advance(by: .seconds(10))
        await drainMainActor()
        #expect(h.surface.calls.count == callsAfterQuit)
        #expect(h.opener.submissions.count == 1)
        #expect(!h.surface.terminated)
    }

    @Test("Engine completion with a failure, then Quit: the window closes and later choices are ignored")
    func failureThenQuit() async {
        let h = Harness()
        await h.reachFailure(.diagnosticsUnavailable, offeringShowLog: false)
        #expect(h.controller.terminationRequested() == .now)
        #expect(h.engine.quitCount == 1)
        #expect(h.surface.alertOnScreen == nil)
        h.controller.alertChoiceMade(.dismiss)
        h.controller.reopenRequested()
        #expect(!h.surface.terminated)
        #expect(h.surface.count(.raiseAlert) == 0)
    }

    @Test("Quit again before the engine returns: still later, one request, one reply, then now")
    func repeatedQuitBeforeEngineReturns() async {
        let h = Harness()
        await h.start()
        #expect(h.controller.terminationRequested() == .later)
        await h.waitForTimer(at: .seconds(2))
        let callsAtQuit = h.surface.calls.count

        // Part-way through the grace, Quit arrives again (menu, Dock and logout).
        h.clock.advance(by: .seconds(1))
        await drainMainActor()
        #expect(h.controller.terminationRequested() == .later)
        #expect(h.controller.terminationRequested() == .later)
        await drainMainActor()
        #expect(h.engine.quitCount == 1)
        #expect(h.controller.phase == .quitting)
        #expect(h.surface.calls.count == callsAtQuit)
        // The grace keeps its original deadline; it was not restarted at 3 s.
        #expect(h.clock.hasSleeper(until: .seconds(2)))
        #expect(!h.clock.hasSleeper(until: .seconds(3)))

        await h.finishEngine(with: .cancelled)
        await waitUntil("the termination reply") { h.surface.replied }
        await drainMainActor()
        // The reply retired the grace, so the grace can never reply a second time.
        #expect(!h.clock.hasSleeper(until: .seconds(2)))
        h.clock.advance(by: .seconds(5))
        await drainMainActor()
        #expect(Array(h.surface.calls.dropFirst(callsAtQuit)) == [.replyToTermination])

        // The one reply has been sent, so nothing is left to wait for.
        #expect(h.controller.terminationRequested() == .now)
        await drainMainActor()
        #expect(h.engine.quitCount == 1)
        #expect(h.surface.count(.replyToTermination) == 1)
        #expect(!h.surface.terminated)
    }

    @Test("Quit again before the grace expires: the original 2 s deadline holds and one reply is sent")
    func repeatedQuitBeforeGraceExpires() async {
        let h = Harness()
        await h.start()
        #expect(h.controller.terminationRequested() == .later)
        await h.waitForTimer(at: .seconds(2))
        let callsAtQuit = h.surface.calls.count

        h.clock.advance(by: .milliseconds(1_500))
        await drainMainActor()
        #expect(h.controller.terminationRequested() == .later)
        await drainMainActor()
        #expect(!h.clock.hasSleeper(until: .milliseconds(3_500)))

        h.clock.advance(by: .milliseconds(499))
        await drainMainActor()
        #expect(!h.surface.replied)
        #expect(h.controller.terminationRequested() == .later)
        await drainMainActor()
        #expect(!h.clock.hasSleeper(until: .milliseconds(3_999)))
        #expect(h.surface.calls.count == callsAtQuit)

        h.clock.advance(by: .milliseconds(1))
        await waitUntil("the termination reply at the original 2 s") { h.surface.replied }
        #expect(Array(h.surface.calls.dropFirst(callsAtQuit)) == [.replyToTermination])

        // After the reply a repeated Quit has nothing to wait for, and a late engine return
        // adds nothing.
        #expect(h.controller.terminationRequested() == .now)
        await h.finishEngine(with: .cancelled)
        h.clock.advance(by: .seconds(5))
        await drainMainActor()
        #expect(h.controller.terminationRequested() == .now)
        #expect(h.engine.quitCount == 1)
        #expect(h.surface.count(.replyToTermination) == 1)
        #expect(Array(h.surface.calls.dropFirst(callsAtQuit)) == [.replyToTermination])
        #expect(!h.surface.terminated)
    }

    @Test("Quit waits at most 2 s for the engine to return")
    func quitGrace() async {
        let h = Harness()
        await h.start()
        #expect(h.controller.terminationRequested() == .later)
        await h.waitForTimer(at: .seconds(2))

        h.clock.advance(by: .milliseconds(1_999))
        await drainMainActor()
        #expect(!h.surface.replied)

        h.clock.advance(by: .milliseconds(1))
        await waitUntil("the termination reply") { h.surface.replied }

        await h.finishEngine(with: .cancelled)
        await drainMainActor()
        #expect(h.surface.count(.replyToTermination) == 1)
        #expect(!h.surface.terminated)
        #expect(h.engine.quitCount == 1)
    }

    @Test("Quit before the attempt starts means the engine never runs, and Quit again is still now")
    func quitBeforeStart() async {
        let h = Harness()
        #expect(h.controller.terminationRequested() == .now)
        #expect(h.controller.terminationRequested() == .now)
        #expect(h.engine.quitCount == 1)
        h.controller.start()
        await drainMainActor()
        #expect(h.engine.runCount == 0)
        #expect(h.controller.phase == .quitting)
        #expect(!h.clock.hasSleeper(until: .seconds(2)))
        #expect(!h.surface.replied)
    }

    @Test("Progress after Quit never reaches the screen")
    func progressAfterQuit() async {
        let h = Harness()
        await h.start()
        #expect(h.controller.terminationRequested() == .later)
        let callsAtQuit = h.surface.calls.count
        await h.emit(.waitingForRelease)
        h.controller.reopenRequested()
        h.clock.advance(by: .seconds(1))
        await drainMainActor()
        #expect(h.surface.calls.count == callsAtQuit)
    }

    @Test("Exits the launcher starts itself are not Quit requests")
    func normalExitDoesNotRequestQuit() async {
        let h = Harness()
        await h.reachHandoff()
        h.opener.deliver(.accepted)
        await waitUntil("the quiet exit") { h.surface.terminated }
        #expect(h.surface.terminationDecisions == [.now])
        #expect(h.engine.quitCount == 0)
        #expect(h.controller.terminationRequested() == .now)
        #expect(h.engine.quitCount == 0)
    }
}
