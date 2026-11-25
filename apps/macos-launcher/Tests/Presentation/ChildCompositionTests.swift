import Testing
@testable import LauncherPresentation

/// The production composition (`runLauncherPresentation`: application, menu, delegate,
/// controller, `AppKitSurface`, real windows and real AppKit termination) in a directly tracked
/// child process. The child is the `PresentationFixture` test executable with a scripted
/// engine; it ends only through the launcher's own termination path, and the test runner is
/// never asked to terminate. Serialized so that only one GUI child runs at a time.
@Suite(
    "Composed launcher in a tracked child process (disposable hosted GUI session only)",
    .serialized,
    .enabled(if: DisposableGUISession.isAvailable, "A GUI child process is started only in a disposable hosted GUI session")
)
struct ChildCompositionTests {
    static let checkingLine = PresentationCopy.progress(for: .checking).statusLine

    @Test("A cancelled attempt exits quietly through AppKit termination, and a second entry call returns at once")
    func quietExitAndSingleEntry() async throws {
        let run = try await FixtureLaunch.run("cancelled")
        run.expectCleanExit()
        #expect(run.events == [
            "engine.run",
            "fixture.second-call-returned",
            "app.will-terminate",
        ], "\(run.diagnostics)")
        #expect(run.quitToTerminationMilliseconds == nil, "\(run.diagnostics)")
    }

    @Test("Hide, reopen, then the main menu's Quit: Quit waits for the engine's return, then AppKit terminates")
    func hideReopenMenuQuit() async throws {
        let run = try await FixtureLaunch.run("progress-menu-quit")
        run.expectCleanExit()
        #expect(run.events == [
            "engine.run",
            "fixture.progress-visible status=\(Self.checkingLine)",
            "fixture.hidden visible=0",
            "fixture.reopened visible=1 same-window=1",
            "fixture.menu-quit title=\(PresentationCopy.quitMenuItem)",
            "engine.request-quit",
            "app.will-terminate",
        ], "\(run.diagnostics)")
        // The reply followed the engine's return, well inside the 2 s grace.
        let elapsed = try #require(run.quitToTerminationMilliseconds, "\(run.diagnostics)")
        #expect(elapsed < 2_000, "\(run.diagnostics)")
    }

    @Test("The progress panel's Quit with an engine that never returns ends once the 2 s grace has passed")
    func panelQuitAfterGrace() async throws {
        let run = try await FixtureLaunch.run("panel-quit-grace")
        run.expectCleanExit()
        #expect(run.events == [
            "engine.run",
            "fixture.progress-visible status=\(Self.checkingLine)",
            "fixture.panel-quit title=\(PresentationCopy.quitButton)",
            "engine.request-quit",
            "app.will-terminate",
        ], "\(run.diagnostics)")
        let elapsed = try #require(run.quitToTerminationMilliseconds, "\(run.diagnostics)")
        #expect(elapsed >= 2_000, "\(run.diagnostics)")
        #expect(elapsed < 10_000, "\(run.diagnostics)")
    }

    @Test("A reached failure replaces the progress panel; OK closes it and AppKit terminates without a Quit request")
    func failureThenOK() async throws {
        let run = try await FixtureLaunch.run("failure-ok")
        run.expectCleanExit()
        let alert = PresentationCopy.alert(for: .childExited, showLogAvailable: false)
        #expect(run.events == [
            "engine.run",
            "fixture.progress-visible status=\(Self.checkingLine)",
            "resolver.asked",
            "fixture.failure-visible title=\(alert.title) buttons=\(PresentationCopy.okButton) progress-visible=0",
            "fixture.click title=\(PresentationCopy.okButton)",
            "app.will-terminate",
        ], "\(run.diagnostics)")
        #expect(run.quitToTerminationMilliseconds == nil, "\(run.diagnostics)")
    }
}
