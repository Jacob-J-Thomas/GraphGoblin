import LaunchContract
import Testing
@testable import LauncherPresentation

@MainActor
@Suite("Browser handoff: one submission, 10 s deadline, first terminal result wins")
struct BrowserHandoffTests {
    @Test(
        "One submission of the literal address in both management modes",
        arguments: [UInt16(1), 4747, 65535],
        [ManagementMode.running, .observingShutdown]
    )
    func oneSubmission(port: UInt16, mode: ManagementMode) async throws {
        let h = Harness()
        await h.reachHandoff(port: port, mode: mode)
        let address = try #require(ManagementAddress(port: port))
        #expect(h.opener.submissions == [address])
        #expect(h.opener.submissions.first?.text == "http://127.0.0.1:\(port)/app/")
        #expect(h.controller.phase == .handingOff)
        await drainMainActor()
        #expect(h.opener.submissions.count == 1)
        #expect(h.engine.runCount == 1)
    }

    @Test("Accepted is a quiet exit")
    func accepted() async {
        let h = Harness()
        await h.reachHandoff()
        h.opener.deliver(.accepted)
        await waitUntil("the quiet exit") { h.surface.terminated }
        #expect(h.surface.alertsShown.isEmpty)
        #expect(h.surface.pasteboardWrites.isEmpty)
        #expect(h.resolver.resolveCount == 0)
    }

    @Test("Rejected shows the rejection and offers only Copy Address")
    func rejected() async throws {
        let h = Harness()
        await h.reachHandoff()
        h.opener.deliver(.rejected)
        await waitUntil("the failure window") { h.surface.alertOnScreen != nil }
        let expected = try #require(CopyFixtures.rejectedAlert(port: 4747))
        #expect(h.surface.alertsShown == [expected])
        #expect(h.resolver.resolveCount == 0)

        h.controller.alertChoiceMade(.showLog)
        #expect(h.surface.alertOnScreen != nil)
        #expect(!h.surface.terminated)

        h.controller.alertChoiceMade(.copyAddress)
        #expect(h.surface.pasteboardWrites == ["http://127.0.0.1:4747/app/"])
        #expect(h.surface.terminated)
        #expect(h.opener.submissions.count == 1)
    }

    @Test("A callback with neither an application nor an error is unconfirmed")
    func neitherResult() async throws {
        let h = Harness()
        await h.reachHandoff()
        h.opener.deliver(.unconfirmed)
        await waitUntil("the failure window") { h.surface.alertOnScreen != nil }
        let expected = try #require(CopyFixtures.unconfirmedAlert(port: 4747))
        #expect(h.surface.alertsShown == [expected])
    }

    @Test("Deadline expiry is unconfirmed, and a later callback is ignored")
    func deadlineExpiry() async throws {
        let h = Harness()
        await h.reachHandoff()
        await h.waitForTimer(at: .seconds(10))

        h.clock.advance(by: .milliseconds(9_999))
        await drainMainActor()
        #expect(h.surface.alertsShown.isEmpty)
        #expect(h.clock.hasSleeper(until: .seconds(10)))

        h.clock.advance(by: .milliseconds(1))
        await waitUntil("the failure window") { h.surface.alertOnScreen != nil }
        let expected = try #require(CopyFixtures.unconfirmedAlert(port: 4747))
        #expect(h.surface.alertsShown == [expected])

        h.opener.deliver(.accepted)
        await drainMainActor()
        #expect(h.surface.alertsShown.count == 1)
        #expect(!h.surface.terminated)
        #expect(h.opener.submissions.count == 1)
    }

    @Test("The deadline starts at submission, not at attempt entry")
    func deadlineStartsAtSubmission() async throws {
        let h = Harness()
        await h.start()
        h.clock.advance(by: .seconds(7))
        await h.finishEngine(with: .openManagement(port: 4747, mode: .running))
        await waitUntil("the browser submission") { h.opener.submissions.count == 1 }
        await h.waitForTimer(at: .seconds(17))
        h.clock.advance(by: .seconds(9))
        await drainMainActor()
        #expect(h.surface.alertsShown.isEmpty)
        h.clock.advance(by: .seconds(1))
        await waitUntil("the failure window") { h.surface.alertOnScreen != nil }
        let expected = try #require(CopyFixtures.unconfirmedAlert(port: 4747))
        #expect(h.surface.alertsShown == [expected])
    }

    @Test("A callback observed before the deadline wins even if the timer is delivered first")
    func observedBeforeDeadline() async {
        let h = Harness()
        await h.reachHandoff()
        await h.waitForTimer(at: .seconds(10))
        h.clock.advance(by: .milliseconds(9_999))
        // Observed at 9.999 s; both the callback hop and the deadline timer are now pending.
        h.opener.deliver(.accepted)
        h.clock.advance(by: .milliseconds(1))
        await waitUntil("the quiet exit") { h.surface.terminated }
        #expect(h.surface.alertsShown.isEmpty)
    }

    @Test("A callback observed at the deadline cannot count as accepted")
    func observedAtDeadline() async throws {
        let h = Harness()
        await h.reachHandoff()
        await h.waitForTimer(at: .seconds(10))
        h.clock.advance(by: .seconds(10))
        h.opener.deliver(.accepted)
        await waitUntil("the failure window") { h.surface.alertOnScreen != nil }
        let expected = try #require(CopyFixtures.unconfirmedAlert(port: 4747))
        #expect(h.surface.alertsShown == [expected])
        #expect(!h.surface.terminated)
    }

    @Test("The first terminal callback wins and later ones are ignored")
    func firstCallbackWins() async throws {
        let h = Harness()
        await h.reachHandoff()
        h.opener.deliver(.rejected)
        h.opener.deliver(.accepted)
        h.opener.deliver(.unconfirmed)
        await waitUntil("the failure window") { h.surface.alertOnScreen != nil }
        await drainMainActor()
        let expected = try #require(CopyFixtures.rejectedAlert(port: 4747))
        #expect(h.surface.alertsShown == [expected])
        #expect(!h.surface.terminated)
    }

    @Test("A callback delivered on a background thread is honored")
    func offMainCallback() async {
        let h = Harness()
        await h.reachHandoff()
        await h.opener.deliverOffMain(.accepted)
        await waitUntil("the quiet exit") { h.surface.terminated }
        #expect(h.surface.alertsShown.isEmpty)
        #expect(h.surface.terminationDecisions == [.now])
    }

    @Test("A visible panel switches to the handoff line")
    func visibleHandoffLine() async {
        let h = Harness()
        await h.start()
        await h.waitForTimer(at: .seconds(1))
        h.clock.advance(by: .seconds(1))
        await waitUntil("the delayed panel") { h.surface.progressOnScreen }

        await h.finishEngine(with: .openManagement(port: 4747, mode: .observingShutdown))
        #expect(h.surface.progressUpdates.last == PresentationCopy.handoffProgress)
        #expect(h.surface.announcements.last == "Opening GraphGoblin in your web browser…")
        #expect(h.surface.progressOnScreen)

        h.opener.deliver(.accepted)
        await waitUntil("the quiet exit") { h.surface.terminated }
        #expect(!h.surface.progressOnScreen)
    }

    @Test("Reopen during the handoff surfaces it without a second submission")
    func reopenDuringHandoff() async {
        let h = Harness()
        await h.reachHandoff()
        h.controller.reopenRequested()
        #expect(h.surface.calls.contains(.showProgress(PresentationCopy.handoffProgress, .activate)))
        await drainMainActor()
        #expect(h.opener.submissions.count == 1)
        #expect(h.engine.runCount == 1)
    }

    @Test("Hiding during the handoff keeps the submission pending")
    func hideDuringHandoff() async {
        let h = Harness()
        await h.reachHandoff()
        h.controller.reopenRequested()
        h.controller.hideRequested()
        #expect(!h.surface.progressOnScreen)
        #expect(h.controller.phase == .handingOff)
        h.opener.deliver(.accepted)
        await waitUntil("the quiet exit") { h.surface.terminated }
    }

    @Test("OK on a browser failure copies nothing")
    func dismissBrowserFailure() async {
        let h = Harness()
        await h.reachHandoff()
        h.opener.deliver(.unconfirmed)
        await waitUntil("the failure window") { h.surface.alertOnScreen != nil }
        h.controller.alertChoiceMade(.dismiss)
        #expect(h.surface.terminated)
        #expect(h.surface.pasteboardWrites.isEmpty)
    }

    @Test("Copy Address after an unconfirmed result copies the same fixed address", arguments: [UInt16(1), 65535])
    func copyAfterUnconfirmed(port: UInt16) async {
        let h = Harness()
        await h.reachHandoff(port: port)
        h.opener.deliver(.unconfirmed)
        await waitUntil("the failure window") { h.surface.alertOnScreen != nil }
        h.controller.alertChoiceMade(.copyAddress)
        #expect(h.surface.pasteboardWrites == ["http://127.0.0.1:\(port)/app/"])
        #expect(h.opener.submissions.map { $0.text } == h.surface.pasteboardWrites)
        #expect(h.surface.terminated)
    }

    @Test("Port 0 in a management outcome never reaches the browser")
    func zeroPortNeverSubmits() async throws {
        let h = Harness()
        await h.reachFailure(.openManagement(port: 0, mode: .running), offeringShowLog: true)
        #expect(h.opener.submissions.isEmpty)
        #expect(h.resolver.resolveCount == 0)
        let alert = try #require(h.surface.alertOnScreen)
        #expect(alert == PresentationCopy.alert(for: .invalidHandoff, showLogAvailable: false))
    }
}
