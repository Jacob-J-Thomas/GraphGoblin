# #456 macOS launcher presentation: review correction preparation 01 (MACUI-01, -02, -03)

**Status: prepared, not applied, not compiled and not run.** Claude Code (model `claude-opus-5-5`) prepared one bounded correction batch for the three accepted findings in `launcher/macos-ui-opposite-review-01/`. Only Read, Write, Edit, Glob and Grep were used. There was no Bash, no Git, no build or test, no SSH, browser, native or owner action, no provider events or keys, and no child agent. **No product file in the checkout was changed.** Every write is under this directory. **No test is claimed to pass or fail.**

- Frozen source as given by root: checkout `C:/Users/98jak/.codex/worktrees/gg-20261116-macos-launcher/GraphGoblin`, head `8bddb93aaa61ebb1b962385efa97a468a379929d`, tree `d0f7b3eefda54c888e044715bd21ac30201003b3`, base `6d7fcc9838d831fe1be3c3cf52c90a2f33e8f5b1`. Without Git I could not confirm that the bytes on disk equal that tree. The proposed files were transcribed from the files on disk as read on 2026-11-16. Root must validate the inputs before applying (§7).
- Scope kept: `Presentation/**` and `Tests/Presentation/**` only. There are no changes to the engine, `LaunchContract.swift`, `Entry.swift`, `Package.swift`, the installer, docs, flags or the package graph. Timings are unchanged: 60 s engine, 10 s browser, 1 s progress, 3 s Show Log, 2 s Quit grace.

## 1. Output files

Full replacement files, at their repository-relative paths under `proposed/`:

| Proposed output | Replaces | Lines (frozen → proposed) | Finding |
| --- | --- | ---: | --- |
| `proposed/apps/macos-launcher/Presentation/PresentationCopy.swift` | same path | 298 → 298 | MACUI-01, MACUI-02 |
| `proposed/apps/macos-launcher/Presentation/LaunchPresentationController.swift` | same path | 432 → 441 | MACUI-03 |
| `proposed/apps/macos-launcher/Tests/Presentation/OutcomeCopyTests.swift` | same path | 447 → 476 | MACUI-01, MACUI-02 |
| `proposed/apps/macos-launcher/Tests/Presentation/ShowLogTests.swift` | same path | 198 → 268 | MACUI-03 |
| `proposed/apps/macos-launcher/Tests/Presentation/Support/ManualClock.swift` | same path | 105 → 121 | MACUI-03 (test support) |
| `handoff.md` (this file) | n/a | n/a | n/a |

**SHA-256 and byte counts: pending.** They cannot be computed without a shell. Root will hash both the frozen inputs and these outputs.

Line counts were taken with Grep. Files are LF, with no tabs and no trailing whitespace (checked with Grep). Non-ASCII use is unchanged in kind. Only ’ (U+2019) and … (U+2026) appear, and only in `PresentationCopy.swift` and `OutcomeCopyTests.swift`. The controller, `ShowLogTests.swift` and `ManualClock.swift` stay ASCII-only.

## 2. MACUI-01 (P2): Quit guidance after spawn commitment

**Root cause.** `PresentationCopy.waitingDetail` said Quit "cancels the launch if GraphGoblin hasn’t started yet". The real cutoff is earlier: `AttemptState.commit(before:)` in `Engine/NativeLaunchEngine.swift:30-35`. That commit happens before `.starting` is published and before the native spawn is submitted (`:301-305`). A Quit after commitment cannot prevent the start. This matches the contract's "Spawn commitment" and "Hide or Quit" rules and the installation guide (`docs/guide/01-install-and-first-run.md:156-157`).

**Fix (copy only).** The detail is shared by every stage and by the neutral line.

| | Text |
| --- | --- |
| Before | Hiding this window doesn’t stop the launch. Quitting cancels the launch if GraphGoblin hasn’t started yet, and never stops a GraphGoblin that has already started. |
| After | Hiding this window doesn’t stop the launch. Quitting cancels the launch if it’s still pending, but if GraphGoblin has already begun starting, it may still finish starting. Quitting never stops a GraphGoblin that’s already running. |

The new text keeps the Hide sentence and the detached-gateway sentence. It promises cancellation only for a pending launch and says that a start already under way may still finish. Three nearby strings were checked and left unchanged because none promises cancellation:
- `quitHelp`: "Quit the launcher. Quitting never stops a GraphGoblin that has already started."
- `handoffDetail`
- `hideHelp`

## 3. MACUI-02 (P2): Waiting and store-blocked copy asserted a live owner

**Root cause.** The engine's `StoreState.held` (`Engine/LaunchInputs.swift:191-205`) is reported for a verified live owner. It is also reported for a record whose ownership cannot be verified, such as a malformed or incomplete owner record or an uncheckable PID (`apps/api/src/data-dir-lock.ts:63-119`, `:230-248`). The contract confirms this: "A held record includes an unverifiable owner." `.waitingForStore` (`NativeLaunchEngine.swift:280-283`) and `.storeBlocked` at expiry (`:313-315`) therefore cannot prove that anything is using the data. The old copy said "GraphGoblin’s data is in use" and "Another process is using the data folder".

**Fix (copy only).** Access is now described as blocked or unconfirmed. Closing a session is suggested only if the user recognizes one, and only in the normal way. A persistent blockage points to the launcher's log, which the **Show Log in Finder** button offers when available. The message keeps "Nothing was stopped." and "Don’t delete files to get around this." It contains no instruction to force anything or to remove files, and no implementation words (the copy canary still applies). The `storeBlocked → .failure(.storeBlocked)` mapping, `offersShowLog == true` and the button set are unchanged.

| Text | Before | After |
| --- | --- | --- |
| `waitingForStore` status line | GraphGoblin’s data is in use. Waiting for it to become available… | Access to GraphGoblin’s data is blocked. Waiting for it to become available… |
| `storeBlocked` title | GraphGoblin’s data is in use | Access to GraphGoblin’s data is blocked |
| `storeBlocked` message | Another process is using the data folder this launcher is set up for, so the launcher didn’t start another copy of GraphGoblin. Nothing was stopped. Wait for the other process to finish, or close it deliberately, then open GraphGoblin again. Don’t delete files to get around this. | The launcher couldn’t confirm that the data folder it was set up with is free to use, so it didn’t start GraphGoblin. Nothing was stopped. Another GraphGoblin session may be using this data. If you recognize one, close it as you normally would, then open GraphGoblin again. If this keeps happening, the launcher’s log may say why. Don’t delete files to get around this. |

The new title is still distinct from every other failure title. The new status line is still distinct from the other six progress lines.

## 4. MACUI-03 (P3): A late Show Log answer could beat an expired timer

**Root cause.** `reachFailure` started a 3 s timer from `clock.now`. `showLogResolved` checked only the token and `phase == .preparingFailure`. After 3 s both continuations could be ready for the main actor. If the resolver's ran first, the phase was still `.preparingFailure`. The resolver then cancelled the already-due timer and showed **Show Log in Finder** after the offer window had closed.

**Fix (`LaunchPresentationController.swift`, behaviour change limited to this path).**
- **One deadline.** `reachFailure` computes one absolute instant, `deadline = clock.now.advanced(by: PresentationTiming.showLogOfferWait)`. It stores the instant with the pending failure, `pendingFailure: (kind: FailureKind, offerDeadline: C.Instant)?`. The expiry timer sleeps until that same instant with `after(deadline)`.
- **Resolver judged at handling time.** `showLogResolved` judges the answer on the main actor when it handles it: `clock.now < pending.offerDeadline ? action : nil`. An answer handled at or after the deadline is discarded, whichever continuation runs first. The window is then shown at once without Show Log, exactly as on expiry, and the queued timer is cancelled. `showLogOfferExpired` is unchanged apart from reading the tuple.
- **Unchanged.** Token and phase guards, Quit suppression, the reopen and Hide rules, the single `showFailure` path, `cancelPendingWork` and the action flow (`alertChoiceMade(.showLog)` → opaque action → exit). The action's own directory revalidation in `Entry.swift:14-19` is untouched. Nothing else in the controller changed.

This matches the browser `HandoffArbiter` rule (observation `< deadline` keeps its result; at or after gives the timeout result). One difference: here the instant is taken on the main actor, because the resolver is itself main-actor work and the button must never appear at or after the deadline.

**Test support (`ManualClock.swift`).** `ManualClock.advance(by:)` resumes due sleepers inside the call. With only that method, a test cannot keep the expiry timer from running except by relying on main-executor FIFO order. I added two test-only methods. The `Clock` seam, `sleep`, `advance` and `hasSleeper` are unchanged.
- `advanceWithoutResuming(by:)` moves `now` while due sleepers stay registered and cancellable.
- `resumeDueSleepers()` is `advance(by: .zero)`.

## 5. Expected test effects (reasoned from source, not executed)

Declared `@Test` functions go from 83 to 86: `OutcomeCopyTests` 13 → 14 and `ShowLogTests` 9 → 11. One new test takes 2 arguments.

| Test | Change | Expected on proposed source |
| --- | --- | --- |
| `OutcomeCopyTests.failureCopy` [storeBlocked] | Fixture title and message updated | pass |
| `OutcomeCopyTests.stageCopy` | Detail updated (all 5 stages and `nil`), `waitingForStore` line updated | pass |
| `OutcomeCopyTests.uncertainCopy` (new) | Explicit claims for 01/02. The detail promises cancellation only while pending, says a start under way may finish, and keeps Hide and never-stops-a-running-GraphGoblin. The store line, title and message contain none of "in use", "is using" or "Another process". The message says it "couldn’t confirm", that a session "may be using" the data, and "If you recognize one, close it as you normally would". It keeps "Nothing was stopped.", the log sentence and "Don’t delete files". Buttons are OK and Show Log. | pass |
| `OutcomeCopyTests.distinctTitles`, `vocabulary`, `startFailureDistinctions` | unchanged; now cover the new strings | pass |
| `AttemptLifecycleTests.failureFlow` [storeBlocked], `lateProgress`, `stageOrder` | unchanged; read copy from `PresentationCopy` and fixtures | pass |
| `AppKitControlTests` progress and failure controls | unchanged; compare labels with `PresentationCopy` | pass |
| `ShowLogTests.resolverAfterDeadlineBeforeTimer(elapsedMilliseconds:)` [3000, 3500] (new, race regression) | Holds the expiry timer with `advanceWithoutResuming` at exactly and beyond 3 s. Checks that the timer sleeper is still registered, then lets the resolver answer first with an action. Expects one alert without Show Log, choices `[.dismiss]`, the timer retired, no change after `resumeDueSleepers` and +5 s, Show Log unreachable (0 invocations, no exit) and OK still exits. | pass |
| `ShowLogTests.resolverJustBeforeDeadline` (new control) | Answer handled at 2.999 s with the timer pending. Expects Show Log offered, the timer retired, no second alert after +5 s, and the action invoked once before exit. | pass |
| `ShowLogTests.slowResolver` (existing control: timer first) | unchanged | pass |
| `offeredAction`, `resolverAskedOnce` ×14, `panelStaysUntilAlert`, `resolverAfterQuit`, `actionCompletesBeforeExit`, `quitDuringAction`, `AttemptLifecycleTests.timingConstants` (existing timely and Quit controls) | unchanged | pass |

The new race test encodes the chosen design: a late answer shows the window immediately without Show Log. If the fix only ignored the late answer and waited for the timer, `waitUntil("the failure window")` would time out before `resumeDueSleepers()`.

Discrimination, reasoned and not executed:

| Variant | Fails |
| --- | --- |
| Frozen controller (phase-only check) | `resolverAfterDeadlineBeforeTimer` [3000] and [3500] |
| `<=` instead of `<` | [3000] only |
| Deadline recomputed when the answer arrives, or no deadline check | [3000] and [3500] |
| Over-eager discard (for example a deadline shortened below 3 s) | `resolverJustBeforeDeadline`, `offeredAction`, `resolverAskedOnce` |
| Frozen copy with the proposed tests | `failureCopy` [storeBlocked], `stageCopy`, `uncertainCopy`, `AttemptLifecycleTests.failureFlow` [storeBlocked] |

## 6. Negative-control procedure (root or hosted Mac executes; not run here)

Use the established candidate-bound hosted command, for example `/usr/bin/xcrun --sdk macosx swift test --package-path "$pkg" … --arch arm64`. Add `--filter` as shown below.

1. **Positive run.** Build a scratch package from frozen tree `d0f7b3ee…` and overlay the five proposed files. Run the full suite. Expect every test to pass, 86 declared functions, and the GUI-session-gated `AppKitWindowTests` skipped where no session exists. Record the exact counts and any skips.
2. **MACUI-03 control.** In a second scratch copy, overlay the proposed `ShowLogTests.swift`, `Support/ManualClock.swift`, `OutcomeCopyTests.swift` and `PresentationCopy.swift`. Restore the frozen `Presentation/LaunchPresentationController.swift`. Run `--filter ShowLogTests`. Expected:
   - **Failures:** `resolverAfterDeadlineBeforeTimer` fails for both 3000 and 3500. The old code shows the alert with Show Log, so these assertions fail: `alertsShown == [alert(.childExited, showLogAvailable: false)]`, `choicesOnScreen == [.dismiss]`, `actionInvocations == 0`, `!terminated`, `phase == .showingFailure` and the final `actionInvocations == 0`.
   - **No hang:** `waitUntil("the failure window")` is satisfied, because the old code does show an alert.
   - **Passes:** `slowResolver`, `resolverJustBeforeDeadline` and every other ShowLog test.
3. **MACUI-01/02 control (optional).** Restore the frozen `PresentationCopy.swift` with the proposed tests. Run `--filter "OutcomeCopyTests|AttemptLifecycleTests"`. Expect the four copy failures in the last row of the §5 discrimination table and nothing else.
4. Restore the proposed controller and copy, then rerun the full suite to confirm step 1.

## 7. Applying (root, after the frozen backend review completes)

1. Confirm the checkout still has head `8bddb93a…` and tree `d0f7b3ee…`, and that the five target files equal their frozen blobs.
2. Hash the frozen inputs and the five proposed files.
3. Copy the proposed files over the same repository paths and review `git diff`. Expected hunks:
   - **`PresentationCopy.swift`:** lines 121, 140, 233 and 234 replaced; no lines added or removed.
   - **`LaunchPresentationController.swift`:**
     - line 65: the property becomes 2 doc lines plus the tuple property;
     - `reachFailure`: 2 comment lines, `let deadline`, the tuple assignment, and `after(deadline)`;
     - `showLogResolved`: 3 doc lines, the `pending` guard, `let offered` and `showFailure(pending.kind, …)`;
     - `showLogOfferExpired`: the `pending` guard and `showFailure(pending.kind, …)`.
   - **`OutcomeCopyTests.swift`:**
     - lines 122–123 (fixture);
     - new `uncertainCopy` after `startFailureDistinctions`;
     - line 393 (detail) and line 397 (`waitingForStore`).
   - **`ShowLogTests.swift`:** two tests inserted after `slowResolver`; no existing test changed.
   - **`ManualClock.swift`:** 2 doc lines in the type comment, and two methods after `advance(by:)`.
4. Static checks I ran with Grep:
   - all 17 unchanged failure messages are identical in the frozen and proposed `PresentationCopy.swift`;
   - all 14 unchanged fixture title and message pairs are identical in `OutcomeCopyTests.swift`;
   - 8 distinctive controller lines (arbiter, Quit reply, timer helper) match;
   - every new copy string asserted in the tests occurs verbatim in `PresentationCopy.swift`;
   - no straight apostrophe appears in any user-visible string.

## 8. Inputs read

**Repository (checkout above), read in full unless a range is given:**
- `AGENTS.md`
- `apps/macos-launcher/Presentation/PresentationCopy.swift`, `LaunchPresentationController.swift`, `HandoffArbiter.swift`, `PresentationSeams.swift`, `ProgressPanel.swift`
- `apps/macos-launcher/Tests/Presentation/OutcomeCopyTests.swift`, `ShowLogTests.swift`, `AttemptLifecycleTests.swift`, `QuitTests.swift` (lines 90–129)
- `apps/macos-launcher/Tests/Presentation/Support/ManualClock.swift`, `Harness.swift`, `ScriptedResolver.swift`, `ScriptedSurface.swift`, `Probes.swift`
- `apps/macos-launcher/LaunchContract.swift` (read only), `Entry.swift`, `Package.swift`, `Engine/NativeLaunchEngine.swift`
- `Engine/LaunchInputs.swift` (store-state grep only)
- `apps/api/src/data-dir-lock.ts` (lines 1–260)
- `docs/guide/01-install-and-first-run.md` (lines 110–229)
- `docs/guide/07-troubleshooting.md` (lines 1–110)
- Grep only: `Presentation/FailurePanel.swift`, `Tests/Presentation/AppKit*Tests.swift`, and the whole checkout for the old copy strings. The old strings appear only in `PresentationCopy.swift` and `OutcomeCopyTests.swift`, not in repository docs or tooling.

**QA artifacts, under `C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch/launcher/`:**
- `macos-ui-opposite-review-01/full-report.md` and `findings.json`
- `macos-presentation-implementation-01/full-report.md`
- `macos-presentation-correction-01/full-report.md`
- `macos-closed-contract-proposal.md` (lines 50–74 and a grep)
- `ui-design-decisions.md` (grep only)

## 9. Verification still due

- Root's input validation and hashing (§7), then the hosted Swift run (§6 step 1) and the negative controls (§6 steps 2–3). Record any GUI-session skips.
- Docs owner: no repository doc quotes the changed strings. The guide's Quit sentence (`01-install-and-first-run.md:156-157`) is already accurate. The copy table in the QA artifact `macos-presentation-implementation-01/full-report.md` §3 is now stale for three strings. Troubleshooting rows keyed by failure title would use "Access to GraphGoblin’s data is blocked".
- Native and owner gates are unchanged from the review's residual list:
  - independent native QA (Finder, Dock, focus, VoiceOver, layout and Dark Mode for the longer detail and store message, browser, clipboard, Show Log in Finder, repeated Quit and gateway survival after commitment);
  - current-head CI;
  - final Astra audit;
  - owner acceptance of the new copy's tone.
