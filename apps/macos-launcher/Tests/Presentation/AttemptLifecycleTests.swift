import LaunchContract
import Testing
@testable import LauncherPresentation

@MainActor
@Suite("One attempt, ordered progress, delayed panel, Hide and reopen")
struct AttemptLifecycleTests {
    @Test("Presentation timing constants are the reviewed values")
    func timingConstants() {
        #expect(PresentationTiming.progressThreshold == .seconds(1))
        #expect(PresentationTiming.browserDeadline == .seconds(10))
        #expect(PresentationTiming.showLogOfferWait == .seconds(3))
        #expect(PresentationTiming.quitGrace == .seconds(2))
    }

    @Test("The engine runs once despite repeated starts, reopens and hides")
    func oneRun() async {
        let h = Harness()
        await h.start()
        h.controller.start()
        h.controller.reopenRequested()
        h.controller.hideRequested()
        h.controller.reopenRequested()
        h.controller.start()
        await drainMainActor()
        #expect(h.engine.runCount == 1)
        #expect(h.engine.quitCount == 0)
        #expect(h.controller.phase == .waiting)
    }

    @Test("Stages reach the screen in emission order and repeats are dropped")
    func stageOrder() async {
        let h = Harness()
        await h.start()
        let emitted: [LaunchStage] = [
            .checking, .checking, .waitingForOtherLaunch, .waitingForStore, .waitingForStore,
            .waitingForRelease, .starting,
        ]
        for stage in emitted {
            h.engine.emit(stage)
        }
        await waitUntil("five distinct stages") { h.surface.progressUpdates.count == 5 }
        await drainMainActor()
        let expected: [LaunchStage] = [.checking, .waitingForOtherLaunch, .waitingForStore, .waitingForRelease, .starting]
        #expect(h.surface.progressUpdates == expected.map { PresentationCopy.progress(for: $0) })
        // The panel is not visible yet, so nothing is announced.
        #expect(h.surface.announcements.isEmpty)
        #expect(h.surface.progressShows.isEmpty)
    }

    @Test("Stages emitted from a background thread keep their order")
    func offMainStageOrder() async {
        let h = Harness()
        await h.start()
        let engine = h.engine
        await Task.detached {
            engine.emit(.checking)
            engine.emit(.waitingForRelease)
            engine.emit(.checking)
            engine.emit(.starting)
        }.value
        await waitUntil("four stages") { h.surface.progressUpdates.count == 4 }
        let expected: [LaunchStage] = [.checking, .waitingForRelease, .checking, .starting]
        #expect(h.surface.progressUpdates == expected.map { PresentationCopy.progress(for: $0) })
    }

    @Test("The panel appears on its own only once 1 s has passed")
    func delayedProgress() async {
        let h = Harness()
        await h.start()
        await h.emit(.checking)
        await h.waitForTimer(at: .seconds(1))

        h.clock.advance(by: .milliseconds(999))
        await drainMainActor()
        #expect(h.clock.hasSleeper(until: .seconds(1)))
        #expect(h.surface.progressShows.isEmpty)

        h.clock.advance(by: .milliseconds(1))
        await waitUntil("the delayed panel") { h.surface.progressOnScreen }
        #expect(h.surface.calls.contains(.showProgress(PresentationCopy.progress(for: .checking), .ifAppActive)))
        #expect(h.surface.announcements == ["Checking GraphGoblin…"])

        await h.emit(.starting)
        #expect(h.surface.announcements == ["Checking GraphGoblin…", "Starting GraphGoblin…"])
        #expect(h.surface.progressShows == [.ifAppActive])
    }

    @Test("Before any stage the delayed panel uses the neutral line")
    func delayedProgressWithoutStage() async {
        let h = Harness()
        await h.start()
        await h.waitForTimer(at: .seconds(1))
        h.clock.advance(by: .seconds(1))
        await waitUntil("the delayed panel") { h.surface.progressOnScreen }
        #expect(h.surface.calls.contains(.showProgress(PresentationCopy.progress(for: nil), .ifAppActive)))
    }

    @Test("A handoff accepted before the threshold shows no window at all")
    func quietFastHandoff() async {
        let h = Harness()
        await h.reachHandoff()
        h.opener.deliver(.accepted)
        await waitUntil("the quiet exit") { h.surface.terminated }
        h.clock.advance(by: .seconds(30))
        await drainMainActor()
        #expect(h.surface.progressShows.isEmpty)
        #expect(h.surface.alertsShown.isEmpty)
        #expect(h.surface.announcements.isEmpty)
        #expect(h.surface.terminationDecisions == [.now])
        #expect(h.engine.quitCount == 0)
        #expect(h.controller.phase == .finished)
    }

    @Test("Hide only hides: the attempt continues and stays hidden until reopen")
    func hideAndReopen() async {
        let h = Harness()
        await h.start()
        await h.emit(.checking)
        await h.waitForTimer(at: .seconds(1))
        h.clock.advance(by: .seconds(1))
        await waitUntil("the delayed panel") { h.surface.progressOnScreen }

        h.controller.hideRequested()
        #expect(h.surface.calls.last == .hideProgress)
        #expect(!h.surface.progressOnScreen)
        #expect(h.controller.phase == .waiting)
        #expect(h.engine.quitCount == 0)

        await h.emit(.starting)
        #expect(h.surface.progressUpdates.last == PresentationCopy.progress(for: .starting))
        #expect(h.surface.announcements == ["Checking GraphGoblin…"])

        h.clock.advance(by: .seconds(30))
        await drainMainActor()
        #expect(h.surface.progressShows == [.ifAppActive])

        h.controller.reopenRequested()
        #expect(h.surface.calls.contains(.showProgress(PresentationCopy.progress(for: .starting), .activate)))
        #expect(h.surface.progressOnScreen)
        #expect(h.engine.runCount == 1)

        await h.finishEngine(with: .openManagement(port: 4747, mode: .running))
        #expect(h.opener.submissions.count == 1)
    }

    @Test("Hiding before the threshold suppresses the automatic panel")
    func hideBeforeThreshold() async {
        let h = Harness()
        await h.start()
        await h.waitForTimer(at: .seconds(1))
        h.controller.hideRequested()
        h.clock.advance(by: .seconds(1))
        await drainMainActor()
        #expect(!h.clock.hasSleeper(until: .seconds(1)))
        #expect(h.surface.progressShows.isEmpty)
        h.controller.reopenRequested()
        #expect(h.surface.progressShows == [.activate])
    }

    @Test("Reopen before the threshold shows the panel at once, and only once")
    func reopenBeforeThreshold() async {
        let h = Harness()
        await h.start()
        await h.waitForTimer(at: .seconds(1))
        h.controller.reopenRequested()
        #expect(h.surface.calls.contains(.showProgress(PresentationCopy.progress(for: nil), .activate)))
        h.clock.advance(by: .seconds(1))
        await drainMainActor()
        #expect(h.surface.progressShows == [.activate])
    }

    @Test("Reopen while a failure is shown raises that window and never stacks another")
    func reopenRaisesExistingAlert() async {
        let h = Harness()
        await h.reachFailure(.diagnosticsUnavailable, offeringShowLog: false)
        h.controller.reopenRequested()
        h.controller.reopenRequested()
        #expect(h.surface.count(.raiseAlert) == 2)
        #expect(h.surface.alertsShown.count == 1)
        #expect(h.surface.progressShows.isEmpty)
        #expect(h.engine.runCount == 1)
    }

    @Test("Reopen and Hide after the launcher finished change nothing")
    func reopenAfterExit() async {
        let h = Harness()
        await h.reachHandoff()
        h.opener.deliver(.accepted)
        await waitUntil("the quiet exit") { h.surface.terminated }
        let count = h.surface.calls.count
        h.controller.reopenRequested()
        h.controller.hideRequested()
        #expect(h.surface.calls.count == count)
        #expect(h.engine.runCount == 1)
    }

    @Test("Progress arriving after the outcome never changes the screen")
    func lateProgress() async {
        let h = Harness()
        await h.reachFailure(.storeBlocked, offeringShowLog: false)
        let count = h.surface.calls.count
        await h.emit(.starting)
        #expect(h.surface.calls.count == count)
    }

    @Test("Cancelled ends quietly without asking for anything")
    func cancelledQuiet() async {
        let h = Harness()
        await h.start()
        await h.finishEngine(with: .cancelled)
        await waitUntil("the quiet exit") { h.surface.terminated }
        #expect(h.surface.alertsShown.isEmpty)
        #expect(h.resolver.resolveCount == 0)
        #expect(h.opener.submissions.isEmpty)
        #expect(h.engine.quitCount == 0)
        #expect(h.surface.terminationDecisions == [.now])
    }

    @Test("Each failure outcome closes the panel first, then shows its alert", arguments: CopyFixtures.launchFailures)
    func failureFlow(_ expected: FailureExpectation) async throws {
        let h = Harness()
        await h.start()
        await h.waitForTimer(at: .seconds(1))
        h.clock.advance(by: .seconds(1))
        await waitUntil("the delayed panel") { h.surface.progressOnScreen }

        await h.finishEngine(with: expected.outcome)
        if expected.offersShowLog {
            await waitUntil("the Show Log resolver") { h.resolver.isResolving }
            #expect(h.surface.alertsShown.isEmpty)
            h.resolver.settle(offeringAction: false)
        }
        await waitUntil("the failure window") { h.surface.alertOnScreen != nil }

        let alert = PresentationCopy.alert(for: expected.kind, showLogAvailable: false)
        #expect(h.surface.alertsShown == [alert])
        #expect(alert.title == expected.title)
        #expect(h.resolver.resolveCount == (expected.offersShowLog ? 1 : 0))
        #expect(h.opener.submissions.isEmpty)
        #expect(h.controller.shownFailure == expected.kind)
        let closed = try #require(h.surface.index(of: .closeProgress))
        let shown = try #require(h.surface.index(of: .showAlert(alert)))
        #expect(closed < shown)
        #expect(!h.surface.progressOnScreen)

        h.controller.alertChoiceMade(.dismiss)
        #expect(h.surface.terminated)
        #expect(h.surface.alertOnScreen == nil)
        #expect(h.engine.quitCount == 0)
        #expect(h.surface.terminationDecisions == [.now])
    }
}
