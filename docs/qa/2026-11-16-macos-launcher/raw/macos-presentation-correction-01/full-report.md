# #456 macOS launcher presentation: correction 01 (repeated Quit)

**Status: corrected in source, not compiled, no test run.** Claude Code (model `claude-opus-5-5`) changed only the two owned files. No Swift toolchain exists on this Windows host and none was installed. No Swift build or test, SSH, native app, browser, gateway, port, owner-resource, Git mutation, provider or agent action took place. **No test is claimed to pass.**

- Checkout: `C:/Users/98jak/.codex/worktrees/gg-20261116-macos-launcher/GraphGoblin`, head `6d7fcc9838d831fe1be3c3cf52c90a2f33e8f5b1`. `apps/macos-launcher/` is untracked there, so `git diff` does not show these edits; [correction.diff](correction.diff) is a unified diff against the exact frozen bytes.
- Baseline: the frozen sources in `launcher/macos-presentation-test-preparation-01/receipts/presentation-a82f9a136865461aa736a82a953b59e1/request.capsule.json`. All 28 capsule entries match their declared digests.
- The prior handoff `macos-presentation-implementation-01/` and the test-preparation evidence were read and left unchanged.

## 1. Finding and fix

`terminationRequested()` answered `.now` for both `.finished` and `.quitting`. So while the first Quit waited for the engine after `.terminateLater`, a second Quit (menu, Dock or logout) let AppKit terminate at once. That skipped the engine's cleanup and the 2 s grace. The old `repeatedQuit` test expected that wrong `.now`.

`LaunchPresentationController.terminationRequested()` now behaves as follows:

| Phase at request | Answer | Side effects |
| --- | --- | --- |
| `.finished` (the launcher's own exit) | `.now` | none |
| `.quitting`, reply still owed (`awaitingTerminationReply`) | `.later` | none: no second `requestQuit()`, no new or reset grace, no reply, no surface call |
| `.quitting`, reply already sent, or none owed (Quit before start, or after the run returned) | `.now` | none |
| any other phase (first Quit) | unchanged: `.later` if the run is in flight, otherwise `.now` | unchanged |

The rest of the controller is unchanged. In particular:
- `requestQuit()` still has exactly one call site.
- The 2 s grace is still scheduled at exactly one site.
- `awaitingTerminationReply` is still set to `true` at exactly one site.
- The existing `replyToTermination()` guard still allows at most one `surface.replyToTermination()`, whether the engine returns first or the grace expires first.

## 2. Files changed

| Path under `apps/macos-launcher` | Before (frozen) | After |
| --- | --- | --- |
| `Presentation/LaunchPresentationController.swift` | 14,848 B, `acfaa4800f438ca3fe2ba2db26cad0d19e51f51fd5d15729064c03f66448168b` | 15,401 B, 432 lines, `d5c73a0f78b390a542ddc2ee15954e58c63e2e0b8c2f229bb69c911b70e77c6a` |
| `Tests/Presentation/QuitTests.swift` | 6,091 B, `90638a3cae331f54c601d86b6363f224c186f311cab524a38eb853721b799601` | 9,644 B, 230 lines, `20fd858a2e89e7774fd42ac465b2e219372646a1a70e4ed9742e14d9530c387d` |

The other 26 capsule files are byte-identical on disk. These include `LaunchContract.swift` (`60cde1d6…`), `Package.swift` (`c872cc27…`), the other 10 production files and the other 14 test files. There are no extra files under `Presentation/` or `Tests/Presentation/`. Details are in [correction-inventory.json](correction-inventory.json).

## 3. Test changes (`QuitTests.swift`, existing seams only)

All tests use the existing `Harness`, `ManualClock` (`advance`, `hasSleeper`), `ScriptedSurface` (call log, reply count) and `ScriptedLaunchEngine` (`quitCount`). No support file or framework changed.

- **`repeatedQuit` removed.** It asserted the wrong `.now`.
- **New `repeatedQuitBeforeEngineReturns`.** The first Quit answers `.later`. At 1 s, two more Quits each answer `.later`. Then:
  - `quitCount == 1`, the phase is still `.quitting`, and there is no new surface call.
  - The grace sleeper is still at 2 s, and there is none at 3 s.
  - The engine then returns `.cancelled`. After that, the only new surface call is one reply, and the grace sleeper is gone. Advancing 5 s adds nothing.
  - A Quit after the reply answers `.now`, with `quitCount == 1`, one reply and no `terminate`.
- **New `repeatedQuitBeforeGraceExpires`.** Repeats at 1.5 s and 1.999 s answer `.later` and register no sleeper at 3.5 s or 3.999 s. Then:
  - There is no reply at 1.999 s and exactly one at 2.000 s, the original deadline.
  - A Quit after the reply answers `.now`.
  - A late engine return, plus 5 s more, adds nothing. Totals: one reply, `quitCount == 1`, no `terminate`.
- **`quitBeforeStart` extended** (pre-start, no run). A repeated Quit also answers `.now`, and `quitCount == 1`. No grace sleeper and no reply exist.
- **`managementThenQuit` extended** (run already returned). A repeated Quit also answers `.now`, and `quitCount == 1`.
- **Unchanged coverage of `.finished → .now`.** `normalExitDoesNotRequestQuit` (surface re-entry and a direct call) and the `terminationDecisions == [.now]` checks in other suites still cover it.

Test inventory: 83 `@Test` functions (was 82); `QuitTests` has 11 (was 10).

Expected discrimination below is reasoned from the source, not executed:

| Faulty variant | Assertion that fails |
| --- | --- |
| Frozen code (`.quitting` gives `.now`) | first repeated `== .later` in both new tests |
| `.quitting` always gives `.later` | post-reply `== .now` in both new tests; second `== .now` in `quitBeforeStart` and `managementThenQuit` |
| Repeat re-runs the Quit path | `quitCount == 1`; `calls.count == callsAtQuit`; no sleeper at 3 s, 3.5 s or 3.999 s |
| Repeat restarts the grace | sleeper still at 2 s, none at 3 s; reply at 2.000 s times out |
| Repeat replies immediately | `calls.count == callsAtQuit`; `!replied` at 1.999 s |
| Engine-return reply leaves the grace armed | no sleeper at 2 s after the reply |

## 4. Static checks performed (not a compile pass)

Run with Node v22.23.4 using [static-checks.mjs](static-checks.mjs); full output is in [static-checks-result.json](static-checks-result.json).

- Capsule integrity: all 28 frozen entries match their declared bytes and SHA-256. The two frozen originals equal the prior handoff's digests.
- Scope: only the two owned files differ from the capsule. The other 26 are byte-identical, with no extra files.
- Hygiene of both changed files:
  - valid UTF-8, no BOM, no CR, no tabs;
  - no trailing whitespace, single final newline;
  - no non-ASCII characters.
- Swift-aware delimiter balance passes for both files. It covers `()[]{}` and skips comments and string literals, including interpolation.
- Controller structure:
  - The combined `case .finished, .quitting:` is gone.
  - `case .quitting:` returns `awaitingTerminationReply ? .later : .now`.
  - There is 1 `requestQuit()` call site, 1 grace schedule, 1 `surface.replyToTermination()` and 1 `awaitingTerminationReply = true`.
- Tests: `repeatedQuit` is absent and the two new functions are present.
- Manual review:
  - The `switch` covers all 8 phases.
  - The ternary infers `TerminationDecision` from the return type.
  - Every test API used already appears in `QuitTests` or `Support/`.
- The receipt's `swift-stderr.raw` shows the frozen `LaunchPresentationController.swift` compiled with no warnings. The only errors are `no such module 'Testing'`. The edit adds no new API, type or import.

## 5. Pending (not established here)

- **Compilation** of the changed controller and the changed `QuitTests.swift`, and **every test result**: root's candidate-bound hosted Mac run. The owner Mac's Command Line Tools lack the `Testing` module (receipt `presentation-a82f9a13…`). As instructed, the test framework was not replaced, and the tests remain Swift Testing.
- **Native AppKit observations** that scripted tests cannot settle:
  - whether a second ⌘Q, Dock Quit or logout during the `terminateLater` wait reaches `applicationShouldTerminate` at all;
  - whether answering `.terminateLater` again is accepted (nested wait or ignored);
  - whether the single `reply(toApplicationShouldTerminate: true)` then ends the process.
- **Engine cleanup behaviour** remains the native worker's and root's verification. That covers cancellation polling (≤ 25 ms) and reaping only the verified owned read-only helper (≤ 250 ms or the original remaining budget), never the gateway. This presentation change only keeps the process alive for at most the 2 s grace; it proves no reaping.
- All final AIDLC gates are unchanged: opposite-family review, independent native QA, current-head CI, audit and scan.

No other product file, manifest, contract or prior evidence was edited. Scratch copies of the frozen originals and the check script live under `%TEMP%/gg456-correction-checks`, outside the repository.
