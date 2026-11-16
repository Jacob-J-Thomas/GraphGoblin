# #456 macOS launcher presentation: implementation handoff 01

**Status: authored, not compiled.** Claude Code (model `claude-opus-5-5`) wrote the AppKit presentation component and its Swift Testing suite in the admitted checkout. No Swift toolchain exists on this Windows host and none was installed. No Swift build, no test run, no SSH, no native app, browser, gateway, port or owner-resource action took place. **No test is claimed to pass.** Compilation and every runtime result are pending root's isolated Mac `swift test` run.

- Checkout: `C:/Users/98jak/.codex/worktrees/gg-20261116-macos-launcher/GraphGoblin`, branch `codex/gg-20261116-macos-launcher`, head `3e8b98b80d478f0788ac50dd5817006fcf96c280`, tree `430d34fda9d7e91752a7dbc93794242b4c17a5aa` (unchanged).
- Shared contract: `apps/macos-launcher/LaunchContract.swift` is unchanged at 1,144 bytes, SHA-256 `60cde1d6d8d64bfe42b316b174c70c7d71f5fea1070c8f27cc0fb78aaff75fdc`.
- New files: 11 under `apps/macos-launcher/Presentation/` and 15 under `apps/macos-launcher/Tests/Presentation/`. No tracked file was modified (`git diff HEAD` is empty). Nothing was staged or committed.
- The exact per-file bytes, lines and SHA-256 are in [source-inventory.json](source-inventory.json), generated from the bytes on disk.

## 1. Files

| Path under `apps/macos-launcher` | SHA-256 | Bytes | Role |
| --- | --- | ---: | --- |
| `Presentation/LauncherPresentationEntry.swift` | `2513628b8e3a5df70a7e28867a4613cac37bba6e89b942646ff5d42ab120203e` | 1649 | Public `runLauncherPresentation(engine:resolveShowLog:)` |
| `Presentation/LaunchPresentationController.swift` | `acfaa4800f438ca3fe2ba2db26cad0d19e51f51fd5d15729064c03f66448168b` | 14848 | MainActor state machine |
| `Presentation/PresentationCopy.swift` | `5bc319fa2e1e51f19291325d47ef2196f2d1471411b5cab4b8f254b40a89029b` | 14727 | Closed mapping, fixed copy, literal address |
| `Presentation/PresentationSeams.swift` | `870aeff6f1eda291bd9532b1c401569ede7c1f9e548464f3b12807512a5e3201` | 2127 | Private seams and attempt token |
| `Presentation/HandoffArbiter.swift` | `13760b70d74e044201978e64e91da9bd63fe19a1d26bc4e003ab73bfc0d00f48` | 1513 | Browser deadline arbitration |
| `Presentation/AppKitSurface.swift` | `c7d81785aaf8603840129795b33eeb0bc135166ecfca4e038a2fe8ff11522c1b` | 3203 | Production rendering |
| `Presentation/ProgressPanel.swift` | `f41e28bfa66f8ca3ebaa2fc0f3fa90aef4411e7eaeb4210c0e9b72919bb07f7d` | 7292 | Delayed progress panel |
| `Presentation/FailurePanel.swift` | `aa6cd5ce416e48f1b8af18efaa4949b358e4e482a199ab37186f5bd45421b730` | 7586 | Failure window |
| `Presentation/AppKitSupport.swift` | `cc3f591d030bdfb8c07de02d77ae144c955b01c1e8ed0a91f3aae0749c3837fe` | 3113 | Key mapping, AX identifiers, menu |
| `Presentation/WorkspaceBrowserOpener.swift` | `3d547e319e1d7fc2f142c64cec27a5821f641dbf6ac02f2d3f1a78d73dde9211` | 1303 | NSWorkspace adapter |
| `Presentation/LauncherAppDelegate.swift` | `c854e22dd9dcc6e9e08d70069b8207b2d7898e344f4a8e9f53ce0edda2509152` | 1378 | App delegate |
| `Tests/Presentation/OutcomeCopyTests.swift` | `56addc1577d4aaf5cf9bf8de3a4f9b468c4dd09f54a153ce6809cae8c24affe6` | 24474 | Exhaustive copy/ports/vocabulary |
| `Tests/Presentation/AttemptLifecycleTests.swift` | `f9c6d10e2abe46fb0655d7607285fb77cfa5a8ad1d89fb39c1228624cd03961a` | 10389 | One run, stages, delay, Hide/reopen |
| `Tests/Presentation/QuitTests.swift` | `90638a3cae331f54c601d86b6363f224c186f311cab524a38eb853721b799601` | 6091 | Quit orders and suppression |
| `Tests/Presentation/BrowserHandoffTests.swift` | `ea9d906cd5e9a76efb32d2f857cb2636225da33b29e597701913cb34c64b1fe5` | 9531 | Browser outcomes and deadline race |
| `Tests/Presentation/ShowLogTests.swift` | `4bb22ba43e32809a0a1208d83ad6a2db5777685d2429e337a108174f7b31dd43` | 8352 | Resolver and action gating |
| `Tests/Presentation/HandoffArbiterTests.swift` | `26c27819d70ed6a1b889750d2d2336d5ff7d2f937ae9c79ca5c2ae02f0f7226b` | 2973 | Arbiter units and concurrency |
| `Tests/Presentation/AppKitControlTests.swift` | `a0cffa2e097f5c5b849a5f957cc2639512c928859d622860d7231053ee18f9ac` | 8822 | Ungated AppKit control properties |
| `Tests/Presentation/AppKitWindowTests.swift` | `a0cfd2f477d6f9636cdc42ff667aa6f2a3b3d8a61ccc5e708e1efc887d0c5458` | 6301 | GUI-session-gated window checks |
| `Tests/Presentation/Support/Harness.swift` | `fa5c59e4ad94a075ae11880bc3a3db66ed3be4022f2fc37d24d573c22f6c9a41` | 4054 | Scripted wiring, polling helpers |
| `Tests/Presentation/Support/ManualClock.swift` | `0535f8097c2a32b3ec9147a056d790d31ab6a33b1f17807c42213c4c140a1bb4` | 3642 | Injected monotonic clock |
| `Tests/Presentation/Support/ScriptedLaunchEngine.swift` | `224ea3f6cb9ae2b3d8f6aa9f62f5d165fb7ce1faf6da834cea426a58055bc696` | 2982 | Scripted `LaunchEngine` |
| `Tests/Presentation/Support/ScriptedBrowserOpener.swift` | `00f8df2638d4e4772bd613a6c89ade4565383aaf0b90b6655f219222130f0b93` | 1034 | Scripted opener |
| `Tests/Presentation/Support/ScriptedResolver.swift` | `daadebe9e900b17e0a34e90569324aa6b9a4f590aef5c6592dfce783e9a86676` | 1790 | Scripted resolver/action |
| `Tests/Presentation/Support/ScriptedSurface.swift` | `e0f8b4808bb0dd6b77fca0360f696608ff610837e0718475965349bd548133e3` | 3848 | Recording surface |
| `Tests/Presentation/Support/Probes.swift` | `91d98202b08b03c9ee14ce31027ab1090a2218632aa06e4d3daa3578141bf05d` | 586 | Lifecycle probe, recorder |

The production module imports only `AppKit`, `Foundation`, `LaunchContract` and `Synchronization` (`Mutex`, macOS 15). The test target imports `Testing`, `AppKit`, `CoreGraphics`, `Synchronization`, `LaunchContract` and `@testable LauncherPresentation`. There are no package dependencies. The layout matches the proposed manifest (`c872cc27…`): target `LauncherPresentation` at `Presentation`, test target `LauncherPresentationTests` at `Tests/Presentation`. Nothing in the test target is reachable from the product module, so the harness cannot enter the bundle.

## 2. Behaviour as implemented

**Entry.** `@MainActor public func runLauncherPresentation(engine: any LaunchEngine, resolveShowLog: @escaping @MainActor () async -> ShowLogAction?)` sets the regular activation policy and installs the minimal menu, delegate and controller. It then runs `NSApplication.run()`. It does not return under normal termination, because `NSApplication.terminate(_:)` exits the process. A second call returns at once without touching the engine. The composition uses `ContinuousClock`, `WorkspaceBrowserOpener` and `AppKitSurface`. Nothing else is public.

**One engine, one run, private token.** `start()` runs only from `.idle`. The delegate calls it from a `Task` after `applicationDidFinishLaunching` returns. `engine.run(progress:)` is called exactly once, from `Task.detached`, so engine work starts off the main actor. The `@Sendable` progress callback and the final outcome go into one `AsyncStream`, tagged with a private `AttemptToken`. They are consumed in yield order on the main actor. Repeated stages are dropped. Stages arriving after the outcome, after Quit or with a foreign token are discarded before any UI change. Reopen, Hide and Quit never call `run`. There is no Retry anywhere.

**Delayed progress (1 s).** The panel appears on its own only if the run is still unresolved 1 s after `start()`, by the injected clock. This timer is independent of the engine's 60 s budget. It never appears for a handoff or failure reached before then. It shows the latest stage line and two fixed sentences. Its buttons are **Quit** and **Hide**; no button is the default, so Return does nothing. It takes key focus only if the app is already active. Otherwise it is ordered front without activation. Stage changes are announced through `NSAccessibility` `announcementRequested` only while the panel is visible.

**Hide and reopen.** The close box, Command-W, Esc, Command-period and Hide all hide the panel. The attempt continues, and the automatic threshold will not re-show it. Reopen through `applicationShouldHandleReopen` acts on the current state:
- During waiting, handoff or Show Log resolution: shows and activates the existing panel with the current line.
- While a failure is shown: raises that window. It never stacks a second one.
- After exit or Quit: does nothing.

Reopen never restarts the attempt.

**Quit.** Command-Q, the panel's Quit button, Dock Quit and logout all reach `applicationShouldTerminate`, which calls `terminationRequested()`. The first Quit does the following synchronously:
- Moves to `.quitting`.
- Cancels the presentation timers and any pending Show Log resolution.
- Closes both windows.
- Calls `engine.requestQuit()` exactly once, before returning.

If the run has already returned, it answers `.terminateNow`. Otherwise it answers `.terminateLater` and replies when `run` returns, or after a 2 s presentation grace, whichever is first. After Quit, no browser submission happens and no window, alert or Show Log result appears. The presentation never signals any process. An already-submitted browser request is not retracted. Exits the launcher starts itself (accepted handoff, dismissing a failure, `cancelled`) do not call `requestQuit`.

**Browser handoff.** `openManagement(port, mode)` with a port in `1...65535` builds the only URL, `http://127.0.0.1:<port>/app/`. That covers both `.running` and `.observingShutdown`. The URL is submitted once through `NSWorkspace.open(_:configuration:completionHandler:)` with `activates = true`, which uses the default handler. A separate 10 s deadline is computed from the injected clock immediately before submission.

The native callback is translated on its own thread:
- An error gives `rejected`.
- An application with no error gives `accepted`.
- Neither gives `unconfirmed`.

That thread also records `clock.now` and offers the result to a lock-protected `HandoffArbiter`:
- An observation before the deadline keeps its result.
- An observation at or after the deadline, or the deadline timer firing, gives `unconfirmed`.
- The first settlement wins. Later callbacks and timers return `nil` and never reach the main actor.

Results:
- `accepted` is a quiet exit (OS acceptance only).
- `rejected` and `unconfirmed` show their window with Copy Address.
- Port `0` in `openManagement` never reaches the browser. It shows a neutral, presentation-defined "couldn't open" window.

**Show Log.** Only a reached launch failure offers Show Log: every failure outcome except `diagnosticsUnavailable`. The presentation-defined invalid-handoff case and both browser failures do not offer it. For an offering failure:
- The panel, if visible, stays while the presentation awaits `resolveShowLog()` on the main actor, for at most 3 s.
- A non-nil action adds **Show Log in Finder**.
- A nil result, or no answer within 3 s, shows the window without it. Any later answer is discarded.
- Choosing it closes the window, awaits the opaque action, then exits. Nothing else is ever opened as a fallback.
- A resolver or action that settles after Quit changes nothing.

**Cancelled** ends quietly with no window and no resolver call.

## 3. Reviewed copy and mapping (exact strings in `PresentationCopy.swift`)

Typography uses ’ (U+2019) and … (U+2026). The only dynamic values are a port number and the literal address built from it.

**Progress**

| State | Status line |
| --- | --- |
| no stage yet | Opening GraphGoblin… |
| `checking` | Checking GraphGoblin… |
| `waitingForOtherLaunch` | Another GraphGoblin launch is in progress. Waiting for it to finish… |
| `waitingForStore` | GraphGoblin’s data is in use. Waiting for it to become available… |
| `waitingForRelease` | The previous GraphGoblin session is still shutting down. Waiting for it to finish… |
| `starting` | Starting GraphGoblin… |
| handoff (presentation) | Opening GraphGoblin in your web browser… |

- Waiting detail: "Hiding this window doesn’t stop the launch. Quitting cancels the launch if GraphGoblin hasn’t started yet, and never stops a GraphGoblin that has already started."
- Handoff detail: "Your web browser may take a moment to open. Quitting the launcher doesn’t stop GraphGoblin."

**Failures.** Every window has **OK** as the Return default and cancel action. "Log" in the last column means the window can offer **Show Log in Finder** when the resolver returns an action.

| Outcome | Title | Message | Log |
| --- | --- | --- | --- |
| `installationInvalid` | GraphGoblin can’t start from its saved setup | The GraphGoblin folder this launcher was set up with has moved, isn’t built, or its saved settings can’t be read, so the launcher didn’t start GraphGoblin. Build that folder if needed, then run the macOS launcher installer again from it. | yes |
| `runtimeUnavailable` | GraphGoblin can’t find a usable Node.js | The Node.js this launcher was set up with has moved, can’t run on this Mac, or isn’t Node 22 (22.22.2 or later), so the launcher didn’t start GraphGoblin. Install Node 22, then run the macOS launcher installer again and choose it. | yes |
| `assetsUnavailable` | GraphGoblin’s web pages aren’t available | GraphGoblin’s built web pages are missing or couldn’t be loaded, so the launcher didn’t open them. Build the GraphGoblin folder again, then open GraphGoblin again. | yes |
| `keySourceUnavailable` | GraphGoblin can’t use the key for its data | The launcher couldn’t confirm a key file it can use for the data folder it was set up with, so it didn’t start GraphGoblin. If you start GraphGoblin another way, keep using that way. Don’t delete or replace files to get around this. | yes |
| `portInUse(p)` | Port p is already in use | Something is using port p, and it isn’t the GraphGoblin this launcher is set up for, so the launcher didn’t start GraphGoblin. Nothing was stopped. Close whatever is using the port, or run the macOS launcher installer again with a different port, then open GraphGoblin again. (With `p == 0`, "GraphGoblin’s port" replaces "port p" in both title and message.) | yes |
| `storeBlocked` | GraphGoblin’s data is in use | Another process is using the data folder this launcher is set up for, so the launcher didn’t start another copy of GraphGoblin. Nothing was stopped. Wait for the other process to finish, or close it deliberately, then open GraphGoblin again. Don’t delete files to get around this. | yes |
| `cannotVerify` | GraphGoblin couldn’t check its status | The launcher couldn’t confirm whether GraphGoblin is already running, so it didn’t start another copy. Nothing was stopped. Wait a moment, then open GraphGoblin again. | yes |
| `launchBusy` | Another GraphGoblin launch didn’t finish in time | Another launch of GraphGoblin was still in progress when this launcher stopped waiting, so it didn’t start GraphGoblin. Nothing was stopped. Wait a moment, then open GraphGoblin again. | yes |
| `releaseUnconfirmed` | GraphGoblin was still shutting down | The previous GraphGoblin session was shutting down, and the launcher couldn’t confirm that it finished in time, so it didn’t start GraphGoblin. The launcher never cuts a shutdown short. Wait for the shutdown to finish, then open GraphGoblin again. | yes |
| `diagnosticsUnavailable` | The launcher can’t use its log folder | The launcher couldn’t safely open its log folder, so it didn’t start GraphGoblin. Make sure your Mac has free disk space, then open GraphGoblin again. If this keeps happening, run the macOS launcher installer again. | no |
| `startFailed` | GraphGoblin couldn’t be started | macOS couldn’t start GraphGoblin, so nothing was started. Make sure the GraphGoblin folder and Node.js this launcher was set up with are still in place, then open GraphGoblin again. | yes |
| `childExited` | GraphGoblin stopped while starting | GraphGoblin quit before it was ready, so the launcher didn’t open it. The launcher’s log may say why. Fix the cause, then open GraphGoblin again. | yes |
| `startTimedOut` | GraphGoblin didn’t finish starting in time | GraphGoblin was started but didn’t become ready in time, so the launcher stopped waiting. It may still finish starting, and nothing was stopped. Wait a moment, then open GraphGoblin again. If this keeps happening, the launcher’s log may say why. | yes |
| `startupUnverified` | The launcher couldn’t confirm that GraphGoblin started | The launcher tried to start GraphGoblin but couldn’t confirm the result, so it didn’t open it. GraphGoblin may or may not be running. Nothing was stopped. Wait a moment, then open GraphGoblin again. If this keeps happening, the launcher’s log may say why. | yes |
| `unexpected` | The launcher ran into a problem | Something unexpected stopped the launch, so the launcher didn’t start GraphGoblin. Nothing was stopped. Open GraphGoblin again. If this keeps happening, the launcher’s log may say why. | yes |
| `cancelled` | (none: quiet exit) | | |
| `openManagement`, browser `accepted` | (none: quiet exit) | | |
| `openManagement` with port 0 | The launcher couldn’t open GraphGoblin | Something unexpected stopped the launcher from opening GraphGoblin. Open GraphGoblin again. If this keeps happening, the launcher’s log may say why. | no |
| browser `rejected` | Your browser didn’t open GraphGoblin | macOS reported a problem opening http://127.0.0.1:p/app/ in your default web browser. Copy the address into a web browser, or check your default web browser, then open GraphGoblin again. | Copy Address |
| browser `unconfirmed` | macOS didn’t confirm that your browser opened | The launcher asked macOS to open http://127.0.0.1:p/app/ in your default web browser, but macOS didn’t confirm it. The page may still open. If it doesn’t, copy the address into a web browser, or open GraphGoblin again. | Copy Address |

How the copy handles certainty:
- "Nothing was started" appears only for `startFailed`, the definite no-child case.
- `childExited` (verified exit), `startTimedOut` (started, not ready) and `startupUnverified` ("may or may not be running") are worded differently from one another.
- `assetsUnavailable` makes no claim about starting.
- No window states that GraphGoblin is running at dialog time.
- No copy contains a path, PID, helper text, error text, response URL or "gateway".

**Labels for the docs owner:**
- Window title: **GraphGoblin**.
- Panel buttons: **Hide**, **Quit**.
- Failure buttons: **OK**, **Show Log in Finder**, **Copy Address**.
- Menu: application menu **GraphGoblin** with **Quit GraphGoblin** (⌘Q); **File** with **Close** (⌘W).
- Hide tooltip and help: "Hide this window. The launch continues, and you can show the window again from the Dock."
- Quit tooltip and help: "Quit the launcher. Quitting never stops a GraphGoblin that has already started."
- Spinner accessibility label: "Launch in progress".

Troubleshooting rows can be keyed by the failure titles above.

## 4. Keyboard, focus and accessibility mapping

| Surface | Mapping |
| --- | --- |
| Progress panel | Titled, closable, not resizable, `hidesOnDeactivate = false`, `isReleasedWhenClosed = false`, `isRestorable = false`, normal level. Hide has the Esc key equivalent. Esc and ⌘. are also caught by `performKeyEquivalent`, `keyDown` and `cancelOperation`. The close box and ⌘W (`performClose`) also hide. Quit sends `terminate:` through the responder chain (same path as ⌘Q). No default button, so Return is inert. `initialFirstResponder` is Hide. |
| Failure window | Non-modal panel with a caution image (hidden from accessibility), bold title, small message, buttons trailing with the default rightmost. OK has `\r` (Return). Esc, ⌘. (with Caps Lock ignored), ⌘W and the close box all choose dismiss, including when OK is the only button. Accessibility subrole is `dialog`. `initialFirstResponder` is the default button. The title and message are announced when it appears. |
| Activation | The failure window and reopen call `NSApplication.activate()` and make the window key. The automatic progress panel only becomes key if the app is already active. |
| Identifiers | `gg.launcher.progress`, `.progress.spinner`, `.progress.status`, `.progress.detail`, `.progress.hide`, `.progress.quit`, `gg.launcher.failure`, `.failure.title`, `.failure.message`, `.failure.dismiss`, `.failure.show-log`, `.failure.copy-address` (for UI scripting by native QA). |

Why a non-modal panel instead of `NSAlert.runModal`: a modal alert nests the run loop and disables menu Quit. That makes it hard to guarantee the Quit, reopen-raise and late-callback rules above. It also leaves Esc for a lone OK unverified, as Sonnet's design noted. The panel is built only from stock controls.

## 5. Info.plist UI requirements (for the GPT installer; the installer alone writes the plist)

| Key | Type | Value | Requirement | Behaviour it controls |
| --- | --- | --- | --- | --- |
| `LSUIElement` | Boolean | absent or `false` | Required | A regular Dock app. Dock reopen, the Dock Quit item and the main menu ⌘Q depend on it. The code also calls `setActivationPolicy(.regular)`. |
| `LSBackgroundOnly` | Boolean | absent or `false` | Required | Same as above. |
| `NSSupportsSuddenTermination` | Boolean | absent or `false` | Required | Logout and Quit must reach `applicationShouldTerminate`, so that `requestQuit()` runs and the bounded `terminateLater` reply applies. |
| `NSSupportsAutomaticTermination` | Boolean | absent or `false` | Required | The launcher is usually windowless while waiting. Automatic termination could end an attempt. |
| `CFBundleName` | String | `GraphGoblin` | Recommended | Application menu title next to the fixed "Quit GraphGoblin" item. Alternate installs may keep it; UI copy always says GraphGoblin. |
| `NSPrincipalClass` | String | `NSApplication` | Recommended (conventional) | The code creates `NSApplication.shared` itself, so this is not functionally required. |
| `NSHighResolutionCapable` | Boolean | `true` | Recommended | Retina text rendering for the panels. |
| `LSMinimumSystemVersion` | String | `15.0` | Installer's choice | Matches the macOS 15 deployment target. |

No `NS*UsageDescription` key is needed. The presentation uses only URL open, a general-pasteboard write and accessibility announcements; Show Log's file access belongs to GPT's action. `LSMultipleInstancesProhibited` is **not** required. It governs multiple user sessions; same-session Finder/Dock activations already reach the running instance as a reopen. Sonnet's earlier suggestion of it is not needed for coalescing. Coalescing remains presentation behaviour, never store authority.

## 6. Intended compile and test command

Root's selected single isolated native run, unchanged from the boundary README, against a package containing exactly the root-placed manifest (`c872cc27…`), `LaunchContract.swift` (`60cde1d6…`) and the 26 files above:

```sh
/usr/bin/xcrun --sdk macosx swift test --package-path "$pkg" \
  --scratch-path "$qa_scope/swift-test" --cache-path "$qa_scope/swift-cache" \
  --config-path "$qa_scope/swift-config" --arch arm64
```

This debug `swift test` compiles every production file in `Presentation/`. `@testable import` needs the default debug testability. Tests use **Swift Testing**, not XCTest, because the recorded Mac has only Command Line Tools: `/Library/Developer/CommandLineTools`, Swift 6.3.1, SDK 26.4.1, no Xcode.

Contingencies for root, not admitted or run by me:
- If SwiftPM rejects the run because XCTest is unavailable (an environment error, not a source error), the same command with `--disable-xctest` is the narrow variant.
- If the `Testing` module itself is unavailable under these Command Line Tools, that is an environment blocker to report back.

Expected test inventory: 82 `@Test` functions, which expand to more cases through parameterized arguments. Of these, 5 are in `AppKitWindowTests`. That suite is enabled only when `CGSessionCopyCurrentDictionary()` is non-nil (a Quartz GUI session). A plain SSH process will most likely report it as **skipped**, not passed. On a GUI-session runner (for example hosted macOS 15), it constructs windows offscreen and never orders them on screen.

## 7. Test coverage by requirement

| Requirement | Tests (file › function) |
| --- | --- |
| 17 outcomes, 5 stages exhaustive, exact copy | OutcomeCopy › `fixturesCoverEveryOutcome` (compile-time exhaustive switches), `failureCopy` ×15, `stageCopy`, `cancelledIsQuiet`, `distinctTitles`; AttemptLifecycle › `failureFlow` ×15 (controller end to end) |
| Valid ports and literal URL, port 0 | OutcomeCopy › `managementHandoff` (4 ports × 2 modes, URL components), `zeroPortHandoff`, `portInUseCopy` ×3, `portInUseWithoutPort`; BrowserHandoff › `oneSubmission` (3 × 2), `zeroPortNeverSubmits` |
| Failure distinctions, no unsupported claims, no raw details | OutcomeCopy › `startFailureDistinctions`, `vocabulary`, `browserCopy` ×3, `canaryScannerDetects` (proves the scanner catches paths, PIDs, helper and exit text, `GG_`, JSON) |
| One engine, one run, no Retry | AttemptLifecycle › `oneRun`; BrowserHandoff › `oneSubmission`, `reopenDuringHandoff`; QuitTests › `quitBeforeStart` |
| Ordered progress on MainActor | AttemptLifecycle › `stageOrder` (dedupe), `offMainStageOrder`, `lateProgress`; QuitTests › `progressAfterQuit` |
| Delayed progress, injected clock | AttemptLifecycle › `timingConstants`, `delayedProgress` (999 ms vs 1 s), `delayedProgressWithoutStage`, `quietFastHandoff` |
| Hide and reopen | AttemptLifecycle › `hideAndReopen`, `hideBeforeThreshold`, `reopenBeforeThreshold`, `reopenRaisesExistingAlert`, `reopenAfterExit`; BrowserHandoff › `hideDuringHandoff`; ShowLog › `panelStaysUntilAlert` |
| Quit is synchronous, suppresses UI and submission, both orders | QuitTests › `quitThenManagementOutcome`, `quitThenFailureOutcome`, `quitThenCancelled`, `managementThenQuit`, `failureThenQuit`, `repeatedQuit`, `quitGrace` (1.999 vs 2 s), `normalExitDoesNotRequestQuit` |
| Accepted, rejected, unconfirmed, late callbacks | BrowserHandoff › `accepted`, `rejected`, `neitherResult`, `firstCallbackWins`, `offMainCallback`, `dismissBrowserFailure`, `copyAfterUnconfirmed` ×2 |
| 10 s deadline from submission, and the observation race | BrowserHandoff › `deadlineExpiry` (9.999 vs 10 s, then a late accepted), `deadlineStartsAtSubmission`, `observedBeforeDeadline`, `observedAtDeadline`; HandoffArbiter › all 5 (including 64-task concurrency) |
| Show Log gating, nil, stale resolver | ShowLog › `offeredAction`, `nilOffer` (no fallback), `noAffordanceNoResolver`, `slowResolver` (2.999 vs 3 s, then a late action), `resolverAfterQuit`, `actionCompletesBeforeExit`, `quitDuringAction`, `resolverAskedOnce` ×14 |
| Keys, focus, accessibility properties (scripted, no window) | AppKitControl › `mainMenu`, `progressControls`, `failureControlsWithShowLog`, `failureControlsForBrowser`, `failureControlsLoneOK`, `cancelKeys`, `distinctIdentifiers`, `browserCallbackTranslation`, `productionComposition` |
| Real window routing (GUI session only) | AppKitWindow › `progressPanelProperties`, `progressPanelHidePaths`, `failurePanelRouting`, `loneOKDismissesOnEscape`, `delegateRouting` |

Test-design notes:
- **Seams.** Tests use owner-private seams: the `Clock` generic (`ManualClock`), `LaunchEngine` (scripted), `BrowserOpening` (scripted), `PresentationSurface` (recording) and the `resolveShowLog` closure. They reach them through `@testable import`, not public test-only API.
- **Real time.** Real time only bounds polling, at most 5 s per wait. No test sleeps through a presentation budget.
- **Native observation.** The scripted tests never touch Finder, the Dock, the default browser, the pasteboard or VoiceOver. Those stay native observations.

## 8. Static checks performed here (not a compile pass)

- No tabs, trailing whitespace or CRLF line endings. The only non-ASCII characters are ’ and ….
- Per-file brace, parenthesis and bracket balance, aware of strings and comments.
- [static-copy-check.js](static-copy-check.js) (SHA-256 in the inventory) confirms that every user-visible copy literal asserted by the tests exists in `PresentationCopy.swift`: 62 plain and 4 interpolated literals, 0 missing.
- The contract digest and size are unchanged, and no tracked file differs from HEAD.
- I reviewed every file by hand for Swift 6 language-mode concurrency rules. Remaining compile risks I cannot settle without a compiler:
  - The `override` of `cancelOperation(_:)` on the `NSPanel` subclasses. If the SDK does not expose it as a member, drop `override` and add `@objc`.
  - The `NSAccessibilityPriorityLevel.high` spelling.
  - Type-checker inference inside `Mutex.withLock` closures. Results are annotated to limit this.
  - Swift Testing availability under Command Line Tools.

## 9. Presentation decisions for root review (no interface change)

1. Two new presentation-owned bounds, neither in the contract and neither affecting the engine's 60 s budget:
   - **Show Log offer wait, 3 s.** This keeps a hung resolver from hiding a reached failure.
   - **Quit grace, 2 s.** This lets the engine return, clean up its own helper and log its outcome after `requestQuit()` before the process exits. Exiting earlier is still safe under the contract, because locks release at process exit.
2. The progress panel's close, Esc and ⌘W mean Hide, which supersedes Sonnet's "close = Stop Waiting". Quit is the explicit button and ⌘Q.
3. OK is the default everywhere. Show Log and Copy Address are deliberate secondary choices. There is no Try Again.
4. Show Log is offered for every reached launch failure except `diagnosticsUnavailable`. Its log destination is the very thing reported unsafe, so nothing new would be in it.
5. Port 0 in `openManagement` or `portInUse` is treated defensively, as described in §2 and §3.
6. The private `BrowserOpening` seam takes a validated `ManagementAddress` instead of a raw port. It is still private; the boundary's sketch was illustrative.
7. A non-modal failure panel replaces `NSAlert.runModal` (§4).

## 10. Interface questions

**None blocking.** The shared `LaunchContract.swift` and the entry signature were sufficient, and no change is requested. Composition notes for GPT's `Entry.swift` and engine, all within the existing contract:
- `runLauncherPresentation` does not return in practice. Code after the call will not run on normal exit.
- `requestQuit()` is invoked synchronously on the main thread, so its guard must be short and non-blocking. Returning from `run` promptly after it lets the outcome be logged within the 2 s grace.
- `resolveShowLog` should settle within 3 s. `ShowLogAction` returns `Void`, so a failed recheck simply leads to a silent exit, which matches the contract.

## 11. Still pending (not established by this handoff)

- **Swift compilation** of all 26 files and the **scripted test results**: root's isolated Mac run.
- **Gated window checks**: need a GUI-session runner. Over SSH they are expected to skip.
- **Native observations**, none of which are covered by scripted tests:
  - real Finder, Dock and alias reopen;
  - panel focus when the app is inactive;
  - Return, Esc, ⌘., ⌘W and Tab delivery in real key windows, with Full Keyboard Access on and off;
  - VoiceOver reading of the announcements and the failure dialog;
  - main-actor work continuing during the `terminateLater` modal run-loop mode;
  - `NSWorkspace` callback timing for a cold default browser;
  - the clipboard after the launcher exits;
  - layout, readability and Dark Mode;
  - App Nap while windowless.
- **Owner subjective acceptance**: panel feel and the 1 s threshold, copy tone, and browser activation after a long wait.
- All final AIDLC gates are unchanged: opposite-family review, independent native QA, current-head CI, fresh Astra MAX audit and the shared scan cap.

No commits, staging, pushes, merges, issue changes, provider turns, child agents or edits outside `Presentation/**`, `Tests/Presentation/**` and this handoff directory were made. Scratch scripts used for the static checks live under `%TEMP%/gg456-checks`, outside the repository.
