# macOS presentation coverage 01: progress and two proposals

Worktree `C:/Users/98jak/.codex/worktrees/gg-20261116-macos-launcher/GraphGoblin`, source HEAD `635a637c4be4f8d63647c01996cdb80e3c262323` (product source `18089bba`). Implementer: actual Claude (claude-opus-5-5). Nothing was committed, pushed or run on macOS. This Windows host has no Swift toolchain, so none of the Swift below has been compiled or executed. Root's dirty docs/qa files and GPT's `Tests/Engine` and `Tests/Installer` edits in this worktree are untouched.

## Files

| File | Status |
| --- | --- |
| `apps/macos-launcher/Tests/Presentation/LiveAppKitTests.swift` | new: hosted-session gate sentinel, live `AppKitSurface` suite |
| `apps/macos-launcher/Tests/Presentation/LiveCompositionTests.swift` | new: real controller + real `AppKitSurface` (extension of the live suite) |
| `apps/macos-launcher/Tests/Presentation/ChildCompositionTests.swift` | new: `runLauncherPresentation` in a tracked child. **Needs Proposal A** |
| `apps/macos-launcher/Tests/Presentation/Support/LiveAppKit.swift` | new: `DisposableGUISession`, `LiveWindows`, `TerminationGuardSurface`, `LiveHarness`, `PasteboardSnapshot` |
| `apps/macos-launcher/Tests/Presentation/Support/FixtureChild.swift` | new: tracked-child runner (`FixtureLaunch`, `FixtureRun`) |
| `apps/macos-launcher/Tests/Presentation/Support/Probes.swift` | `EventsProbe` added |
| `apps/macos-launcher/Tests/Presentation/AppKitWindowTests.swift` | two off-screen tests added |
| `apps/macos-launcher/Tests/PresentationFixture/PresentationFixture.swift` | new test-only executable source. Inert until Proposal A (`Tests` is excluded from every current target) |

No production source, `Package.swift`, CI, tooling or docs file was edited.

## Gating and safety

- **Off-screen additions** (`AppKitWindowTests`) keep that suite's existing gate: a Quartz session. Nothing in them is ordered on screen, makes a sound, or terminates.
- **Live and child suites** need `DisposableGUISession.isAvailable`. That requires a Quartz session, `GITHUB_ACTIONS=true` and `RUNNER_ENVIRONMENT=github-hosted`, so they run on the existing hosted job without any CI change. They never run in a developer's own session, which therefore never sees windows, focus changes or pasteboard writes.
- **`hostedRunnerRecognized`** fails a GitHub-hosted run that does not satisfy the predicate, so those suites cannot be skipped silently.
- **No in-process call to `NSApplication.terminate` or `reply(toApplicationShouldTerminate:)`.**
  - In-process composition uses `TerminationGuardSurface`. It forwards every surface call to a real `AppKitSurface` except those two, which it records. Like AppKit, it puts the termination request to the lifecycle.
  - The real two run only inside the tracked child. That child is signalled (SIGTERM, then SIGKILL) only by the runner, only after a 30 s deadline, and only while it is still running and unreaped.
- **No browser, Finder, NSWorkspace, store, port or installation** is touched. `62241` appears only as a scripted management port and a pasteboard string.

## Behaviour cases and assertion names

All live and composition tests also assert that no launcher window is left on screen at the end. `LiveWindows.closeAll()` runs in a `defer` so a failed assertion cannot leak a window into the next count.

### Off-screen (`AppKitWindowTests`)

- `typedCancelKeys`: typed Esc, Command-period and Caps-Lock Esc through `keyDown` hide the progress panel and dismiss a failure window. Asserts 3 hides and 3 dismisses.
- `browserFailureButtons`: on a 62241 browser failure, OK is the initial first responder, and the buttons dispatch `[.copyAddress, .dismiss]`.

### Live `AppKitSurface` with an `EventsProbe` (`LiveAppKitTests`)

- `progressPanelLifecycle`:
  - Before any panel exists, update, hide and close create no window.
  - Show and re-show give exactly one panel, the same object, updated in place (status and detail).
  - Hide takes it off screen; it still receives updates and a later show returns the same object.
  - After close it is gone for good: later updates neither revive nor change it.
  - The next show builds a different panel with the given content.
- `failureWindowLifecycle`:
  - Raise and close with no window are no-ops.
  - A second alert closes the first, so exactly one is visible, with exact title, message and buttons (62241 URL in the message).
  - Raise keeps the same window; after close nothing is visible and raise does nothing.
- `liveKeys`:
  - Return and a letter typed into the live progress panel hide nothing.
  - A letter does nothing in a failure window.
  - Return through `performKeyEquivalent` chooses `.dismiss` and returns `true`.
- `noReceiver`:
  - With no `events`, every control (including the close box and Esc) is inert and both windows stay.
  - A receiver attached later is reached.
  - After the surface is deallocated (`weak` reference is nil), its windows report to no one.

### Real controller + real `AppKitSurface` (`LiveCompositionTests.swift`)

- `liveProgressPanel`:
  - No panel at 999 ms; exactly one at 1 s, with exact copy and a 420-pt content width.
  - A longer stage rewraps the same window (taller, same width).
  - Hide button: hidden, phase `.waiting`; a stage arriving while hidden updates the hidden window; reopen brings back the same object.
  - The real close box, typed Esc and Command-period each hide and reopen likewise.
  - `runCount == 1`, `quitCount == 0`.
  - Quit returns `.later` and closes the window at once; `requestQuit` is called once; after the engine returns, exactly one termination reply.
- `liveFailureReplacesPanel`:
  - While the Show Log offer resolves, the panel stays and no failure window shows.
  - Then the panel closes and exactly one failure window shows (`storeBlocked`, exact copy, OK + Show Log).
  - Two reopens raise the same window, with no progress panel.
  - Clicking the real OK closes it: one termination request with decision `.now`, `quitCount == 0`, no action invoked, phase `.finished`.
- `liveShowLog`:
  - The real Show Log button closes the window; the held action runs once while phase is `.runningShowLog` and no termination is requested.
  - After release: one termination request with `.now`, and the action completed once.
- `liveCopyAddress`:
  - The live panel switches in place to the handoff line and detail; `submissions == [62241]`.
  - On `.rejected`, the panel closes and one failure window shows with the exact 62241 message, OK and Copy Address.
  - Stale `.string` and `.html` are placed on the pasteboard. Clicking Copy Address leaves exactly `http://127.0.0.1:62241/app/` as the string, no HTML, and a higher change count.
  - The window closes: one termination request with `.now`, one submission, `quitCount == 0`.
  - The general pasteboard's original text is restored afterwards.
- `liveReturnChoosesOK`: `diagnosticsUnavailable` asks no resolver and shows OK only; Return returns `true`, closes the window, and produces one termination request with `.now`.

### Tracked child (`ChildCompositionTests`, needs Proposal A)

Every case asserts no timeout, EOF on both stdout and stderr, a normal exit and status 0, plus an exact ordered list of `gg-fixture:` markers.

- `quietExitAndSingleEntry`: `engine.run`, `fixture.second-call-returned`, `app.will-terminate`.
  - A second `runLauncherPresentation` call returns without touching its engine (any `second.*` marker would fail the list).
  - `.cancelled` then exits through `NSApplication.terminate` and the delegate's `.terminateNow`.
- `hideReopenMenuQuit`: progress visible with the "Checking GraphGoblin…" line; Hide gives `visible=0`; the delegate's reopen gives `visible=1` with the same window; the real main-menu "Quit GraphGoblin" item; `engine.request-quit`; `app.will-terminate`. Quit-to-terminate time is under 2,000 ms, so the reply followed the engine's return, not the grace.
- `panelQuitAfterGrace`: the progress panel's real Quit button with an engine that never returns. Asserts `engine.request-quit`, `app.will-terminate`, and 2,000 ms ≤ elapsed < 10,000 ms.
- `failureThenOK`: progress visible; `resolver.asked`; the failure window titled "GraphGoblin stopped while starting" with buttons `OK` and the progress panel no longer visible; OK clicked; `app.will-terminate`. There is no Quit request and no timing marker.

What these exercise: `LauncherPresentationEntry.swift` in full (both branches), `AppKitSurface.terminateApplication` and `replyToTermination`, the composed menu and delegate in a running `NSApplication`, and terminate-later handling.

User actions in the child are injected with `CFRunLoopPerformBlock` on the main run loop, which is how AppKit delivers clicks. They are deliberately not run inside a Swift main-actor job: a Quit answered `.terminateLater` spins a nested run loop, and only outside a main-queue job can that loop run the main-actor work that sends the reply.

## Proposal A (root, `Package.swift`): test-only fixture executable

`runLauncherPresentation` runs `NSApplication.run()` and ends the process, so it can only be tested in a child process. The real `GraphGoblin` binary cannot serve: with no installation it shows an `installationInvalid` window and waits for a person. A test-only executable linking the public entry is the smallest honest child. The source is already in place.

```diff
         .testTarget(name: "LauncherPresentationTests", dependencies: ["LaunchContract", "LauncherPresentation"],
-                    path: "Tests/Presentation")
+                    path: "Tests/Presentation"),
+        // Test-only GUI child for ChildCompositionTests. Never part of a product or the app bundle.
+        .executableTarget(name: "PresentationFixture",
+                          dependencies: ["LaunchContract", "LauncherPresentation"],
+                          path: "Tests/PresentationFixture")
     ]
```

**Expected build effects (unverified):**
- SwiftPM synthesizes an implicit executable product for a root-package executable target that has no explicit product. `swift test` builds it next to the test bundle as `<scratch>/arm64-apple-macosx/debug/PresentationFixture`, which is where `FixtureLaunch.executableURL` looks.
- Do not add it as a test-target dependency: that would link the fixture module into the test bundle.
- Without this diff, the hosted job **fails** the four child tests at `#require(isExecutableFile)`, by design. Root should land this diff together with the tests, or delete `ChildCompositionTests.swift`, `Support/FixtureChild.swift` and `Tests/PresentationFixture/`.

**Integration notes for GPT's collector and roster:**
- `Tests/PresentationFixture` is harness code, alongside `Tests/`. The fixture is a third, harness, executable beside the two product binaries.
- The child inherits the test process environment, including `LLVM_PROFILE_FILE`.
  - Under SwiftPM's default pattern (which I believe contains `%m`), the fixture writes its own `.profraw` into the same codecov directory. SwiftPM's merge should then count the child's `LauncherPresentation` hits once, against the shared functions.
  - If the collector sets its own path, the pattern must contain `%p` or `%m` so parent and child cannot write the same file.
  - The union sentinel should confirm this before child hits are counted.
- The fixture contains no profile control of its own.

## Proposal B (root review before implementation): browser-submission seam

`WorkspaceBrowserOpener.openManagement` calls `NSWorkspace.shared.open` directly. It can only be exercised without a browser launch if that one call is injectable. The proposed seam is internal; production composition (`WorkspaceBrowserOpener()`) and behaviour are unchanged:

```swift
/// The one native call: `NSWorkspace.shared.open(_:configuration:completionHandler:)`.
typealias WorkspaceOpen = @MainActor (
    _ url: URL,
    _ configuration: NSWorkspace.OpenConfiguration,
    _ completion: @escaping @Sendable (NSRunningApplication?, (any Error)?) -> Void
) -> Void

@MainActor
struct WorkspaceBrowserOpener: BrowserOpening {
    private let open: WorkspaceOpen

    init(open: @escaping WorkspaceOpen = { url, configuration, completion in
        NSWorkspace.shared.open(url, configuration: configuration, completionHandler: completion)
    }) {
        self.open = open
    }

    func openManagement(_ address: ManagementAddress, completion: @escaping @Sendable (BrowserOutcome) -> Void) {
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        open(address.url, configuration) { @Sendable application, error in
            completion(BrowserCallback.outcome(applicationReturned: application != nil, errorReturned: error != nil))
        }
    }
}
```

The default closure is the only line that reaches NSWorkspace. It stays visible and uncovered in the denominator.

Tests to add once approved (`Tests/Presentation/WorkspaceOpenerTests.swift`, any session, nothing opened):

- **Recorder.** `WorkspaceOpenRecorder` (main actor) records `(url, configuration.activates)` and keeps each completion. `complete(applicationReturned:errorReturned:)` invokes a completion from `Task.detached`, building `NSRunningApplication.current` or a `CocoaError` inside that task.
- **`exactSubmission`.** `openManagement(62241)` gives exactly one submission with `url.absoluteString == "http://127.0.0.1:62241/app/"` and `activates == true`. No outcome is reported before macOS answers.
- **`completionMapping`.** Parameterized over (app, nil) → `.accepted`, (nil, error) → `.rejected`, (app, error) → `.rejected`, (nil, nil) → `.unconfirmed`. Each completion is delivered off the main thread and reported exactly once.
- **`composedHandoff`.** The controller uses the real `WorkspaceBrowserOpener(open: recorder.open)` with `ScriptedSurface`. Engine `.openManagement(62241)` gives one activating submission. An off-main (app, nil) gives a quiet exit, `terminationDecisions == [.now]` and no alert. Separately, (nil, error) gives the Copy Address alert with the 62241 message.
- **Harness change.** This needs an optional `opener:` parameter on `Harness.init`, a test-support change only.

## Checks run here

- Read-only review of every Presentation source and test, the coverage plan and `ci.yml`.
- Bracket and string-interpolation balance check (Node 22.23.4 one-off script) on all eight new or changed Swift files: balanced.
- No `swift build` or `swift test`: no toolchain on this host; the owner Mac lacks `Testing`.

## Expected hosted command

The existing step, unchanged:

```
xcrun --sdk macosx swift test --package-path apps/macos-launcher \
  --scratch-path .tmp/macos-swift-test --arch arm64 --enable-code-coverage
```

Focused: add `--filter LauncherPresentationTests`. On GitHub-hosted runners, `GITHUB_ACTIONS` and `RUNNER_ENVIRONMENT` are set automatically.

## Unverified constraints and risks

1. **Compilation.** Swift 6 strict concurrency: the `@MainActor` closure arrays, the `CFRunLoopPerformBlock` trailing closure, `Mutex` in `final class` boxes, and `#expect` with `===` on optionals. Expect possibly one compile-fix round.
2. **`isVisible` in the test runner.** Windows in the runner process (no `NSApp.run`, possibly a prohibited activation policy) are assumed to report `isVisible` after `orderFront`/`makeKeyAndOrderFront`. If not, the live assertions fail loudly; they do not pass vacuously.
3. **`NSApplication.windows`** is assumed to list the surface's private panels (only visible ones are counted).
4. **Return on a live failure window.** `performKeyEquivalent(Return)` is assumed to reach the OK button even when the panel is not key.
5. **The real close box.** `standardWindowButton(.closeButton).performClick` is assumed to send `performClose:` to the panel.
6. **Pasteboard.** After `writeToPasteboard`, `NSPasteboard.general.string(forType: .html)` is assumed to be nil (no plain-to-HTML coercion).
7. **Main-queue draining in the child.** The terminate-later nested loop is assumed to drain the main queue when the action comes from a run-loop block (as it does for a real menu event); `hideReopenMenuQuit` depends on this. If it does not, the child hits its own 10 s window wait or the 30 s runner deadline and fails with markers.
8. **Implicit product and profile merge.** The implicit product location and the inherited-profile merge are unverified (Proposal A notes).
9. **Branches and timing.**
   - Which branch of `showProgress(.ifAppActive)` runs depends on whether the runner is active; the other branch may stay uncovered.
   - Key-window focus is not asserted anywhere, because activation is asynchronous and not observable deterministically in-process. Focus remains with the independent Finder/Dock GUI acceptance.
   - Timing bounds: under 2,000 ms after Quit to termination (the engine returns immediately), and at least 2,000 ms on the grace path (ContinuousClock never wakes early).
10. **AppKit noise.** A beep (`super.keyDown` for unhandled keys) and AppKit stderr output are expected on the hosted runner. Child stderr is captured and shown in failure messages, never asserted empty.
11. **Expected residual in Presentation.**
    - The opener's `NSWorkspace` default (Proposal B) and the whole of `openManagement` until B lands.
    - `FailurePanel.buttonClicked`'s foreign-sender guard, the `init?(coder:)` traps, the `fitContent` nil-`contentView` guards, and the controller's `self == nil` task guards.
    - One `ifAppActive` branch, and anything that the child profile merge fails to count.
    - No source was reshaped, excluded or replaced.
