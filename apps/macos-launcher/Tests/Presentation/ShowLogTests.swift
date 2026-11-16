import LaunchContract
import Testing
@testable import LauncherPresentation

@MainActor
@Suite("Show Log: only a reached failure's opaque action, never a fallback")
struct ShowLogTests {
    @Test("A resolved action is offered, invoked once, and then the launcher exits")
    func offeredAction() async {
        let h = Harness()
        await h.reachFailure(.childExited, offeringShowLog: true)
        #expect(h.resolver.resolveCount == 1)
        #expect(h.surface.alertsShown == [PresentationCopy.alert(for: .childExited, showLogAvailable: true)])
        #expect(h.surface.choicesOnScreen == [.dismiss, .showLog])

        h.controller.alertChoiceMade(.showLog)
        await waitUntil("the exit after Show Log") { h.surface.terminated }
        #expect(h.resolver.actionInvocations == 1)
        #expect(h.resolver.actionsCompleted == 1)
        #expect(h.surface.pasteboardWrites.isEmpty)
        #expect(h.engine.quitCount == 0)
    }

    @Test("A nil offer shows no Show Log, and choosing it anyway does nothing")
    func nilOffer() async {
        let h = Harness()
        await h.reachFailure(.startTimedOut, offeringShowLog: false)
        #expect(h.resolver.resolveCount == 1)
        #expect(h.surface.choicesOnScreen == [.dismiss])

        h.controller.alertChoiceMade(.showLog)
        h.controller.alertChoiceMade(.copyAddress)
        await drainMainActor()
        #expect(h.surface.alertOnScreen != nil)
        #expect(!h.surface.terminated)
        #expect(h.resolver.actionInvocations == 0)
        #expect(h.surface.pasteboardWrites.isEmpty)

        h.controller.alertChoiceMade(.dismiss)
        #expect(h.surface.terminated)
        #expect(h.resolver.actionInvocations == 0)
    }

    @Test("The resolver is never asked without the Show Log affordance")
    func noAffordanceNoResolver() async {
        let diagnostics = Harness()
        await diagnostics.reachFailure(.diagnosticsUnavailable, offeringShowLog: true)
        #expect(diagnostics.resolver.resolveCount == 0)
        #expect(diagnostics.surface.choicesOnScreen == [.dismiss])

        let invalidHandoff = Harness()
        await invalidHandoff.reachFailure(.openManagement(port: 0, mode: .running), offeringShowLog: true)
        #expect(invalidHandoff.resolver.resolveCount == 0)

        let browser = Harness()
        await browser.reachHandoff()
        browser.opener.deliver(.rejected)
        await waitUntil("the browser failure window") { browser.surface.alertOnScreen != nil }
        #expect(browser.resolver.resolveCount == 0)
        #expect(browser.surface.choicesOnScreen == [.dismiss, .copyAddress])

        let cancelled = Harness()
        await cancelled.start()
        await cancelled.finishEngine(with: .cancelled)
        await waitUntil("the quiet exit") { cancelled.surface.terminated }
        #expect(cancelled.resolver.resolveCount == 0)

        let accepted = Harness()
        await accepted.reachHandoff()
        accepted.opener.deliver(.accepted)
        await waitUntil("the quiet exit") { accepted.surface.terminated }
        #expect(accepted.resolver.resolveCount == 0)
    }

    @Test("The offer waits at most 3 s; an action that arrives later is discarded")
    func slowResolver() async {
        let h = Harness()
        await h.start()
        await h.finishEngine(with: .childExited)
        await waitUntil("the Show Log resolver") { h.resolver.isResolving }
        await h.waitForTimer(at: .seconds(3))

        h.clock.advance(by: .milliseconds(2_999))
        await drainMainActor()
        #expect(h.surface.alertsShown.isEmpty)

        h.clock.advance(by: .milliseconds(1))
        await waitUntil("the failure window") { h.surface.alertOnScreen != nil }
        #expect(h.surface.alertsShown == [PresentationCopy.alert(for: .childExited, showLogAvailable: false)])

        h.resolver.settle(offeringAction: true)
        await drainMainActor()
        #expect(h.surface.alertsShown.count == 1)
        h.controller.alertChoiceMade(.showLog)
        await drainMainActor()
        #expect(h.resolver.actionInvocations == 0)
        #expect(!h.surface.terminated)
    }

    @Test("A resolver that settles after Quit cannot bring back any window")
    func resolverAfterQuit() async {
        let h = Harness()
        await h.start()
        await h.waitForTimer(at: .seconds(1))
        h.clock.advance(by: .seconds(1))
        await waitUntil("the delayed panel") { h.surface.progressOnScreen }
        await h.finishEngine(with: .childExited)
        await waitUntil("the Show Log resolver") { h.resolver.isResolving }

        #expect(h.controller.terminationRequested() == .now)
        #expect(h.engine.quitCount == 1)
        #expect(!h.surface.progressOnScreen)
        let callsAtQuit = h.surface.calls.count

        h.resolver.settle(offeringAction: true)
        h.clock.advance(by: .seconds(5))
        await drainMainActor()
        #expect(h.surface.calls.count == callsAtQuit)
        #expect(h.surface.alertsShown.isEmpty)
        #expect(h.resolver.actionInvocations == 0)
    }

    @Test("While the offer resolves the panel stays; it closes just before the alert")
    func panelStaysUntilAlert() async throws {
        let h = Harness()
        await h.start()
        await h.waitForTimer(at: .seconds(1))
        h.clock.advance(by: .seconds(1))
        await waitUntil("the delayed panel") { h.surface.progressOnScreen }

        await h.finishEngine(with: .cannotVerify)
        await waitUntil("the Show Log resolver") { h.resolver.isResolving }
        #expect(h.surface.progressOnScreen)
        #expect(h.surface.count(.closeProgress) == 0)
        #expect(h.controller.phase == .preparingFailure)

        h.controller.reopenRequested()
        #expect(h.surface.progressShows.last == .activate)

        h.resolver.settle(offeringAction: true)
        await waitUntil("the failure window") { h.surface.alertOnScreen != nil }
        let alert = PresentationCopy.alert(for: .cannotVerify, showLogAvailable: true)
        let closed = try #require(h.surface.index(of: .closeProgress))
        let shown = try #require(h.surface.index(of: .showAlert(alert)))
        #expect(closed < shown)
    }

    @Test("Show Log runs to completion before the launcher exits")
    func actionCompletesBeforeExit() async {
        let h = Harness()
        h.resolver.holdsActions = true
        await h.reachFailure(.unexpected, offeringShowLog: true)

        h.controller.alertChoiceMade(.showLog)
        await waitUntil("the Show Log action") { h.resolver.actionInvocations == 1 }
        #expect(h.surface.alertOnScreen == nil)
        #expect(!h.surface.terminated)
        #expect(h.controller.phase == .runningShowLog)

        h.controller.reopenRequested()
        h.controller.alertChoiceMade(.showLog)
        #expect(h.surface.count(.raiseAlert) == 0)
        #expect(h.resolver.actionInvocations == 1)

        h.resolver.releaseAction()
        await waitUntil("the exit after Show Log") { h.surface.terminated }
        #expect(h.resolver.actionsCompleted == 1)
    }

    @Test("Quit while Show Log runs exits without finishing again later")
    func quitDuringAction() async {
        let h = Harness()
        h.resolver.holdsActions = true
        await h.reachFailure(.startupUnverified, offeringShowLog: true)
        h.controller.alertChoiceMade(.showLog)
        await waitUntil("the Show Log action") { h.resolver.actionInvocations == 1 }

        #expect(h.controller.terminationRequested() == .now)
        #expect(h.engine.quitCount == 1)

        h.resolver.releaseAction()
        await waitUntil("the action to complete") { h.resolver.actionsCompleted == 1 }
        await drainMainActor()
        #expect(!h.surface.terminated)
        #expect(h.controller.phase == .quitting)
    }

    @Test("Every failure with the affordance asks the resolver exactly once", arguments: CopyFixtures.showLogFailures)
    func resolverAskedOnce(_ expected: FailureExpectation) async {
        let h = Harness()
        await h.reachFailure(expected.outcome, offeringShowLog: true)
        #expect(h.resolver.resolveCount == 1)
        #expect(h.surface.alertOnScreen == PresentationCopy.alert(for: expected.kind, showLogAvailable: true))
        h.controller.reopenRequested()
        await drainMainActor()
        #expect(h.resolver.resolveCount == 1)
    }
}
