import AppKit
import LaunchContract
import Testing
@testable import LauncherPresentation

/// The real controller driving real launcher windows through `AppKitSurface`, with only the
/// process-ending calls recorded by `TerminationGuardSurface`. User actions are the windows' own
/// buttons, close box and keys.
extension LiveAppKitTests {
    @Test("The delayed panel is one live window: updated in place, hidden by its own controls, reshown by reopen, closed by Quit")
    func liveProgressPanel() async throws {
        defer { LiveWindows.closeAll() }
        let h = LiveHarness()
        await h.start()
        await h.emit(.checking)
        await h.waitForTimer(at: .seconds(1))

        h.clock.advance(by: .milliseconds(999))
        await drainMainActor()
        #expect(LiveWindows.progressPanels.isEmpty)

        h.clock.advance(by: .milliseconds(1))
        await waitUntil("the delayed panel") { LiveWindows.progressPanels.count == 1 }
        let panel = try #require(LiveWindows.progressPanels.first)
        #expect(panel.title == "GraphGoblin")
        #expect(panel.controls.statusLabel.stringValue == "Checking GraphGoblin…")
        #expect(panel.controls.detailLabel.stringValue == PresentationCopy.waitingDetail)
        #expect(panel.contentRect(forFrameRect: panel.frame).width == ProgressControls.contentWidth)
        let oneLineHeight = panel.frame.height

        // A longer stage line rewraps the same window in place at the same width.
        await h.emit(.waitingForStore)
        #expect(LiveWindows.progressPanels.count == 1)
        #expect(LiveWindows.progressPanels.first === panel)
        #expect(panel.controls.statusLabel.stringValue == PresentationCopy.progress(for: .waitingForStore).statusLine)
        #expect(panel.frame.height > oneLineHeight)
        #expect(panel.contentRect(forFrameRect: panel.frame).width == ProgressControls.contentWidth)

        // Hide: the attempt continues, the hidden window still follows the stages, and reopen
        // brings back the same window.
        panel.controls.hideButton.performClick(nil)
        #expect(!panel.isVisible)
        #expect(LiveWindows.progressPanels.isEmpty)
        #expect(h.controller.phase == .waiting)
        await h.emit(.starting)
        #expect(!panel.isVisible)
        #expect(panel.controls.statusLabel.stringValue == "Starting GraphGoblin…")
        h.controller.reopenRequested()
        #expect(LiveWindows.progressPanels.count == 1)
        #expect(LiveWindows.progressPanels.first === panel)

        // The close box, a typed Esc and Command-period each only hide it as well.
        let closeBox = try #require(panel.standardWindowButton(.closeButton))
        let escape = try #require(AppKitWindowTests.keyEvent("\u{1b}", keyCode: 53, flags: []))
        let commandPeriod = try #require(AppKitWindowTests.keyEvent(".", keyCode: 47, flags: [.command]))
        let hidePaths: [(name: String, act: @MainActor () -> Void)] = [
            ("close box", { closeBox.performClick(nil) }),
            ("Esc", { panel.keyDown(with: escape) }),
            ("Command-period", { _ = panel.performKeyEquivalent(with: commandPeriod) }),
        ]
        for path in hidePaths {
            path.act()
            #expect(!panel.isVisible, "\(path.name)")
            #expect(h.controller.phase == .waiting, "\(path.name)")
            h.controller.reopenRequested()
            #expect(LiveWindows.progressPanels.first === panel, "\(path.name)")
        }
        #expect(h.engine.runCount == 1)
        #expect(h.engine.quitCount == 0)
        #expect(h.surface.terminationRequests == 0)

        // Quit closes the live window at once and waits for the engine before replying.
        #expect(h.controller.terminationRequested() == .later)
        #expect(!panel.isVisible)
        #expect(LiveWindows.progressPanels.isEmpty)
        #expect(h.engine.quitCount == 1)
        await h.finishEngine(with: .cancelled)
        await waitUntil("the termination reply") { h.surface.terminationReplies == 1 }
        #expect(LiveWindows.progressPanels.isEmpty)
        #expect(LiveWindows.failurePanels.isEmpty)
        #expect(h.surface.terminationRequests == 0)
    }

    @Test("A reached failure replaces the live panel with one failure window; reopen raises it and OK closes it and exits")
    func liveFailureReplacesPanel() async throws {
        defer { LiveWindows.closeAll() }
        let h = LiveHarness()
        await h.start()
        let shown = await h.showDelayedPanel()
        let panel = try #require(shown)

        await h.finishEngine(with: .storeBlocked)
        await waitUntil("the Show Log resolver") { h.resolver.isResolving }
        // While the offer resolves the live panel stays and no failure window is shown.
        #expect(panel.isVisible)
        #expect(LiveWindows.failurePanels.isEmpty)

        h.resolver.settle(offeringAction: true)
        await waitUntil("the failure window") { LiveWindows.failurePanels.count == 1 }
        let failure = try #require(LiveWindows.failurePanels.first)
        #expect(!panel.isVisible)
        #expect(LiveWindows.progressPanels.isEmpty)
        let expected = PresentationCopy.alert(for: .storeBlocked, showLogAvailable: true)
        #expect(failure.alertContent == expected)
        #expect(failure.controls.titleLabel.stringValue == "Access to GraphGoblin’s data is blocked")
        #expect(failure.controls.messageLabel.stringValue == expected.message)
        #expect(failure.controls.buttons.map { $0.title } == ["OK", "Show Log in Finder"])

        h.controller.reopenRequested()
        h.controller.reopenRequested()
        #expect(LiveWindows.failurePanels.count == 1)
        #expect(LiveWindows.failurePanels.first === failure)
        #expect(LiveWindows.progressPanels.isEmpty)

        failure.controls.buttons[0].performClick(nil)
        #expect(!failure.isVisible)
        #expect(LiveWindows.failurePanels.isEmpty)
        #expect(LiveWindows.progressPanels.isEmpty)
        #expect(h.surface.terminationRequests == 1)
        #expect(h.surface.terminationDecisions == [.now])
        #expect(h.engine.quitCount == 0)
        #expect(h.resolver.actionInvocations == 0)
        #expect(h.controller.phase == .finished)
    }

    @Test("Show Log on the live failure window closes it, runs the offered action once, then exits")
    func liveShowLog() async throws {
        defer { LiveWindows.closeAll() }
        let h = LiveHarness()
        h.resolver.holdsActions = true
        await h.start()
        await h.finishEngine(with: .childExited)
        await waitUntil("the Show Log resolver") { h.resolver.isResolving }
        h.resolver.settle(offeringAction: true)
        await waitUntil("the failure window") { LiveWindows.failurePanels.count == 1 }
        let failure = try #require(LiveWindows.failurePanels.first)
        let showLog = try #require(failure.controls.buttons.last)
        #expect(showLog.title == "Show Log in Finder")

        showLog.performClick(nil)
        await waitUntil("the Show Log action") { h.resolver.actionInvocations == 1 }
        #expect(!failure.isVisible)
        #expect(LiveWindows.failurePanels.isEmpty)
        #expect(h.controller.phase == .runningShowLog)
        #expect(h.surface.terminationRequests == 0)

        h.resolver.releaseAction()
        await waitUntil("the exit after Show Log") { h.surface.terminationRequests == 1 }
        #expect(h.resolver.actionsCompleted == 1)
        #expect(h.resolver.actionInvocations == 1)
        #expect(h.surface.terminationDecisions == [.now])
        #expect(LiveWindows.failurePanels.isEmpty)
        #expect(LiveWindows.progressPanels.isEmpty)
    }

    @Test("Copy Address on the live browser failure puts exactly the management address on the general pasteboard, then exits")
    func liveCopyAddress() async throws {
        defer { LiveWindows.closeAll() }
        let snapshot = PasteboardSnapshot()
        defer { snapshot.restore() }
        let h = LiveHarness()
        await h.start()
        let shown = await h.showDelayedPanel()
        let panel = try #require(shown)

        // The live panel switches to the handoff line in place while the one submission is pending.
        await h.finishEngine(with: .openManagement(port: 62241, mode: .running))
        await waitUntil("the browser submission") { h.opener.submissions.count == 1 }
        let address = try #require(ManagementAddress(port: 62241))
        #expect(h.opener.submissions == [address])
        #expect(LiveWindows.progressPanels.first === panel)
        #expect(panel.controls.statusLabel.stringValue == "Opening GraphGoblin in your web browser…")
        #expect(panel.controls.detailLabel.stringValue == PresentationCopy.handoffDetail)

        h.opener.deliver(.rejected)
        await waitUntil("the failure window") { LiveWindows.failurePanels.count == 1 }
        let failure = try #require(LiveWindows.failurePanels.first)
        #expect(!panel.isVisible)
        #expect(LiveWindows.progressPanels.isEmpty)
        let expected = PresentationCopy.alert(for: .browserRejected(address), showLogAvailable: false)
        #expect(failure.controls.titleLabel.stringValue == "Your browser didn’t open GraphGoblin")
        #expect(failure.controls.messageLabel.stringValue == expected.message)
        #expect(failure.controls.buttons.map { $0.title } == ["OK", "Copy Address"])

        // Stale text and a stale rich type are both replaced by the one plain-text address.
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString("stale", forType: .string)
        pasteboard.setString("<b>stale</b>", forType: .html)
        let staleChange = pasteboard.changeCount

        failure.controls.buttons[1].performClick(nil)
        #expect(pasteboard.string(forType: .string) == "http://127.0.0.1:62241/app/")
        #expect(pasteboard.string(forType: .html) == nil)
        #expect(pasteboard.changeCount > staleChange)
        #expect(!failure.isVisible)
        #expect(LiveWindows.failurePanels.isEmpty)
        #expect(h.surface.terminationRequests == 1)
        #expect(h.surface.terminationDecisions == [.now])
        #expect(h.opener.submissions.count == 1)
        #expect(h.engine.quitCount == 0)
    }

    @Test("Return on the live failure window answers its default OK and exits")
    func liveReturnChoosesOK() async throws {
        defer { LiveWindows.closeAll() }
        let h = LiveHarness()
        await h.start()
        await h.finishEngine(with: .diagnosticsUnavailable)
        await waitUntil("the failure window") { LiveWindows.failurePanels.count == 1 }
        let failure = try #require(LiveWindows.failurePanels.first)
        #expect(h.resolver.resolveCount == 0)
        #expect(failure.controls.buttons.map { $0.title } == ["OK"])

        let returnKey = try #require(AppKitWindowTests.keyEvent("\r", keyCode: 36, flags: []))
        #expect(failure.performKeyEquivalent(with: returnKey))
        #expect(!failure.isVisible)
        #expect(LiveWindows.failurePanels.isEmpty)
        #expect(h.surface.terminationRequests == 1)
        #expect(h.surface.terminationDecisions == [.now])
    }
}
