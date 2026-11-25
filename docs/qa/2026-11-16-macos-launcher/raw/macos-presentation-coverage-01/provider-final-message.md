I've written the presentation and AppKit tests, but none of them has been compiled or run: this host has no Swift toolchain, and the owner Mac lacks the `Testing` module. The full detail is in `C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch/launcher/macos-presentation-coverage-01-progress.md`.

Two things need you before the work is complete:

- **Package.swift (Proposal A).** The four child-process tests need a test-only executable target, `PresentationFixture`, added to Package.swift. I wrote its source but did not touch Package.swift. Until the target is added, the hosted job fails those four tests on purpose. Land the diff from the note with the tests, or delete the child files.
- **Browser seam (Proposal B, not implemented).** `WorkspaceBrowserOpener` calls `NSWorkspace` directly, so the 62241 URL, activation, single submission and completion mapping can't be tested without opening a browser. The note has a small internal seam for review and the four tests that would use it. Until then, `openManagement` stays uncovered.

No product source, Package.swift, CI, tooling or docs file was edited. Your dirty docs/qa files and the other worker's `Tests/Engine` and `Tests/Installer` edits are untouched. Nothing was committed or pushed.

## Files
- **Changed:** `Tests/Presentation/AppKitWindowTests.swift` (two tests that never put a window on screen) and `Support/Probes.swift` (a recorder for window actions).
- **New in `Tests/Presentation`:** `LiveAppKitTests.swift`, `LiveCompositionTests.swift`, `ChildCompositionTests.swift`, `Support/LiveAppKit.swift`, `Support/FixtureChild.swift`.
- **New outside `Tests/Presentation`:** `Tests/PresentationFixture/PresentationFixture.swift`, the child program. It is ignored by the build until Proposal A lands.

## Safety and gating
- **On-screen and child tests run only on GitHub-hosted runners** with a GUI session. A developer's own session never gets windows, focus changes or clipboard writes. A guard test (`hostedRunnerRecognized`) fails a hosted run that doesn't qualify, so these suites can't be skipped silently.
- **The test runner is never asked to quit.** In-process tests intercept only the two calls that would end the process. The real calls run only in a child the tests start themselves. That child is force-stopped only after a 30 s deadline, and only while it is still running.
- **Nothing real is touched.** No browser, Finder, data store, port or installation; 62241 is only a scripted port and a clipboard string.

## Behaviour cases and test names
- **Off-screen:**
  - `typedCancelKeys`: typed Esc, Command-period and Esc with Caps Lock hide the progress panel and dismiss the failure window.
  - `browserFailureButtons`: on the 62241 browser failure, OK has focus first, and the buttons choose Copy Address and dismiss.
- **Real `AppKitSurface` on screen:**
  - `progressPanelLifecycle`: one progress panel, updated in place; hidden and reopened as the same window; after close it is never revived, and the next show builds a new one.
  - `failureWindowLifecycle`: a second alert replaces the first, so only one is ever visible; raise and close behave, including with no window.
  - `liveKeys`: Return chooses OK on the failure window; other keys do nothing.
  - `noReceiver`: the "nil event" case — with no receiver, or after the surface is released, the controls do nothing.
- **Real controller with real windows:**
  - `liveProgressPanel`:
    - No panel at 999 ms, one at 1 s; a longer status line resizes the same window at fixed width.
    - The Hide button, close box, Esc and Command-period each hide the panel, and reopen brings back the same window.
    - Quit closes the panel and replies once after the engine returns.
  - `liveFailureReplacesPanel`: the panel stays while Show Log is resolving; then one failure window replaces it; reopen raises that same window; OK closes it and exits.
  - `liveShowLog`: the Show Log action runs once, then the app exits.
  - `liveCopyAddress`: the panel switches in place to the browser line; Copy Address leaves exactly `http://127.0.0.1:62241/app/` on the clipboard and clears stale content; the original clipboard text is restored afterwards.
  - `liveReturnChoosesOK`: Return answers OK and exits.
- **Child process (needs Proposal A).** Each test checks a clean exit with status 0, end of both output streams, and an exact ordered list of steps the child reports:
  - `quietExitAndSingleEntry`: a second launch call returns without running another engine, and a cancelled attempt exits quietly.
  - `hideReopenMenuQuit`: Hide, reopen, then the main menu's Quit; the app exits under 2,000 ms because it waited for the engine, not the grace period.
  - `panelQuitAfterGrace`: the panel's Quit with an engine that never returns ends after at least 2,000 ms.
  - `failureThenOK`: the failure window replaces the progress panel, and OK exits without a Quit request.

## Checks run
- I read all Presentation sources and tests, the coverage plan and `ci.yml`.
- A bracket and string balance check on the eight new or changed Swift files passed. That is the only check possible here.

## Expected hosted command
The existing CI step, unchanged:
```
xcrun --sdk macosx swift test --package-path apps/macos-launcher --scratch-path .tmp/macos-swift-test --arch arm64 --enable-code-coverage
```
For a focused run, add `--filter LauncherPresentationTests`.

## Unverified assumptions and risks
- **Compilation.** Expect possibly one compile-fix round on the hosted runner, mostly around Swift 6 concurrency rules.
- **AppKit behaviour in the test runner.** These are assumed, not confirmed:
  - Windows report as visible once shown, even though the runner never starts the AppKit event loop.
  - The app's window list includes the surface's panels.
  - Return reaches OK on a failure window that isn't the focused window.
  - Clicking the real close box hides the panel.
  - Copy leaves no HTML version on the clipboard.

  If any assumption is wrong, the affected test fails rather than passing vacuously.
- **Quit in the child.** The child assumes AppKit's wait for a deferred Quit can still run the controller's queued work when the click comes the way AppKit delivers real clicks. If not, the child times out and the test fails with its step list.
- **Child coverage.** I expect the child to write its coverage profile into SwiftPM's codecov directory and be merged. That is unverified; the other worker's merge check should confirm it, and their collector's profile path must stay unique per process.
- **Focus is not asserted.** It isn't reliably observable in-process; Finder/Dock GUI acceptance still covers it. One branch of the automatic panel display may stay uncovered, depending on whether the runner is the active app.
- **Expected leftover uncovered code:** the browser opener until Proposal B lands, plus a few unreachable guards and traps. No source was reshaped or excluded for counters.