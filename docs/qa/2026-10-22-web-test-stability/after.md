# Web editor test stability: verification

This is the historical round 1 record. The audit found remaining failures;
[round2.md](round2.md) records the follow-up and supersedes its stability conclusion.

Baseline and load definition: [before.md](before.md). The final Vitest matrix
uses Node 22.14.0 and three continuously busy Node worker threads per invocation.
Static gates and browser checks are recorded separately below as other evidence.
The retained load generator and transcripts are beside this document; local user-directory prefixes are redacted.
Vitest retries remain zero. No existing assertion, test, threshold, exclusion or
global timeout was removed, skipped or increased. Four inherently heavy cases have
documented per-test 60 s budgets, described below.

## Verification matrix

| Invocation       | Result                                | Vitest duration | Command wall time |  Lines | Branches | Statements | Functions |
| ---------------- | ------------------------------------- | --------------: | ----------------: | -----: | -------: | ---------: | --------: |
| Default run 1    | 116 files / 1474 tests passed, exit 0 |        299.21 s |         301.849 s | 98.93% |   94.83% |     98.02% |    98.49% |
| Default run 2    | 116 files / 1474 tests passed, exit 0 |        418.95 s |         423.592 s | 98.93% |   94.86% |     98.03% |    98.49% |
| Default run 3    | 116 files / 1474 tests passed, exit 0 |        329.01 s |         334.436 s | 98.93% |   94.84% |     98.02% |    98.49% |
| `--maxWorkers=1` | 116 files / 1474 tests passed, exit 0 |       1513.13 s |        1517.823 s | 98.93% |   94.84% |     98.02% |    98.49% |

Each completed full run emitted its coverage summary without a retry. Raw logs
are [gg-chore-web-run-1.log.txt](gg-chore-web-run-1.log.txt), [gg-chore-web-run-2.log.txt](gg-chore-web-run-2.log.txt), [gg-chore-web-run-3.log.txt](gg-chore-web-run-3.log.txt) and
[gg-chore-web-serial.log.txt](gg-chore-web-serial.log.txt). PowerShell renders pnpm's script-header stderr
as native-error records in redirected logs; the reported outcome uses the
actual pnpm exit code and Vitest's final test/coverage summaries.

The final series runs these commands sequentially, with a fresh three-thread
load process for each invocation. It stops on any nonzero exit:

```powershell
pnpm.cmd --filter @graphgoblin/web test:coverage --reporter=verbose
# The identical default-parallelism command runs three times.
pnpm.cmd --filter @graphgoblin/web test:coverage --reporter=verbose --maxWorkers=1
pnpm.cmd --filter @graphgoblin/web exec vitest run <file> -t <pattern> --repeats=9 --reporter=verbose
```

The focused command runs separately for each row below. Vitest 5.0.3 implements
repeats with `repeatCount <= repeats`, so 9 repeats means **10 executions**, with
zero retries. All parameters of each named declaration are included (a superset
of the reported classifier failures), for **130 individual executions**:

| Group              | File under `apps/web/`                 | Exact name pattern                                  | Parameters per execution |
| ------------------ | -------------------------------------- | --------------------------------------------------- | -----------------------: |
| Presets            | `src/editor/TriggerEditor.test.tsx`    | `previews, cancels and applies`                     |                        2 |
| Keyboard           | `src/editor/TriggerEditor.test.tsx`    | `edits authentication, body and extraction`         |                        1 |
| Default decisions  | `src/editor/NodeEditorDialog.test.tsx` | `authors and saves a new`                           |                        3 |
| Existing decisions | `src/editor/NodeEditorDialog.test.tsx` | `edits and saves a valid`                           |                        5 |
| Kinds              | `src/editor/NodeEditorDialog.test.tsx` | `selects each kind with only its applicable fields` |                        1 |
| Advanced           | `src/editor/NodeEditorDialog.test.tsx` | `keeps Advanced open through an undo and a redo`    |                        1 |

All six isolated groups passed **130/130 executions**, with no retries:

| Group              | Selected parameters | Executions | Vitest duration | Command wall time | Result       |
| ------------------ | ------------------: | ---------: | --------------: | ----------------: | ------------ |
| Presets            |                   2 |         20 |         81.03 s |          84.241 s | Pass, exit 0 |
| Keyboard           |                   1 |         10 |         63.82 s |          65.893 s | Pass, exit 0 |
| Default decisions  |                   3 |         30 |        131.45 s |         135.169 s | Pass, exit 0 |
| Existing decisions |                   5 |         50 |         73.25 s |          75.207 s | Pass, exit 0 |
| Kinds              |                   1 |         10 |         40.99 s |          42.727 s | Pass, exit 0 |
| Advanced           |                   1 |         10 |         63.34 s |          66.548 s | Pass, exit 0 |

Raw logs: [gg-chore-web-repeat-preset.log.txt](gg-chore-web-repeat-preset.log.txt), [gg-chore-web-repeat-keyboard.log.txt](gg-chore-web-repeat-keyboard.log.txt), [gg-chore-web-repeat-default.log.txt](gg-chore-web-repeat-default.log.txt), [gg-chore-web-repeat-existing.log.txt](gg-chore-web-repeat-existing.log.txt), [gg-chore-web-repeat-kinds.log.txt](gg-chore-web-repeat-kinds.log.txt), [gg-chore-web-repeat-advanced.log.txt](gg-chore-web-repeat-advanced.log.txt).
Each selected case reports `repeat x9`; Vitest's repeat runner preserves a failed
iteration as a failure, even if later iterations pass. Focused CLI filtering
accounts for the other cases shown as unselected/skipped in these isolated runs;
the full suite retained and passed all 1474 tests. Coverage was emitted in all
four full runs; the isolated name-filtered runs use ordinary Vitest execution
without altering coverage policy for partial runs.

## Matched case timings

Times below are individual-case milliseconds from the matched full coverage
runs. The serialized run used the same three-thread CPU load.

| Named test / parameter                          |        Before (ms) | Default 1 | Default 2 | Default 3 | Serial |
| ----------------------------------------------- | -----------------: | --------: | --------: | --------: | -----: |
| Trigger preset: issues-poll                     |              11022 |      7796 |      7687 |      9479 |   2273 |
| Trigger preset: issues-labeled                  |              12668 |      6377 |      5126 |      7610 |   1881 |
| Trigger keyboard authentication/body/extraction | **20176, timeout** |     10574 |      7300 |     13424 |   2977 |
| New default decision: expression                |               2714 |      1082 |      1315 |      2274 |    889 |
| New default decision: llm                       |               9938 |      9441 |      7244 |      4646 |   2853 |
| New default decision: classifier                |              15500 |      4687 |      6089 |      4430 |   2807 |
| Edit valid decision: expression                 |               2480 |      1196 |      1161 |      1094 |    875 |
| Edit valid decision: llm                        |               3024 |      1469 |      1825 |      1250 |    957 |
| Edit valid classifier: choice                   |               3180 |      1874 |      2478 |      1729 |   1400 |
| Edit valid classifier: noul                     |               3073 |      1611 |      1950 |      1681 |   1271 |
| Edit valid classifier: score                    |               4026 |      2298 |      2426 |      1651 |   1351 |
| Switch decision kinds and source focus          |              12704 |      5339 |      5607 |      4675 |   2903 |
| Advanced disclosure through undo/redo           |              19362 |      5767 |      9389 |      6930 |   4318 |

## Changes and sequencing

The new test-only `src/__fixtures__/node-editor.tsx` mounts `NodeEditorDialog`
through the existing providers. It uses the public editor store, the real
`validateDraft`/held-field issue aggregation and `useUndoShortcuts`. Tests that
assert persistence additionally mount the real `useAutosave`; dialog-only tests
do not mount a background persistence service.
It applies `LoopDefinitionSchema` on load, as an API read does, keys the dialog by
its real opening session and resets the store on unmount. There is no component
mock, private access, production export or fake production implementation.

This deliberately tests the dialog boundary. Full-page loading, server validation
and canvas integration remain covered by the unchanged EditorPage tests and six
TriggerEditor save/device-draft/reopen/export round trips. The component fixture
does not claim to exercise those page responsibilities.

| Reported case                                  | Cause and change                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Both preset preview/cancel/apply/undo variants | Whole-app work on held-input/graph/history changes, repeated local setup keystrokes, and background persistence. Mount the dialog without autosave and paste setup values. All Tab, Enter, cancel, preview, focus, graph, held-input and undo/redo checks remain.                                                                                                       |
| Keyboard authentication/body/extraction        | Each input, selector and undo drove the whole editor page and background persistence. Mount the dialog without autosave and paste the secret/header fixture strings. Retain JSON-pointer character typing, selectors, radios and keyboard undo/redo.                                                                                                                    |
| Default classifier authoring                   | Repeated page work plus 45 separate criteria input changes. Mount the dialog and paste complete criteria. Save and schema-validity assertions remain; the other default-decision parameters are retained.                                                                                                                                                               |
| Editing an existing classifier                 | Full-page work despite directly dispatching a single CodeMirror document edit. Mount the dialog; preserve all five expression/LLM/classifier parameters and save/focus/order assertions.                                                                                                                                                                                |
| Decision-kind switching                        | Several schema form remounts also updated unrelated canvas/page components. Mount the dialog, retaining confirmation and field-order/focus checks for every kind.                                                                                                                                                                                                       |
| Advanced disclosure undo/redo                  | Repeated page renders around form remounts; no long text or fixed timer wait to remove. Mount the real dialog with session identity and shortcuts; preserve remount, focus, disclosure and reopen assertions. After this reduction still reproduced a 20 s deadline failure, give this case alone 60 s for its intentionally repeated complete inference-form remounts. |

All user-event operations are awaited. Fixture pastes are single input edits,
not a series of queued keystrokes. In the neighbouring preset test, replacing a
secret uses select-all plus one paste, so its one-step undo does not depend on
`COALESCE_MS` or wall-clock speed. Existing state-based `findBy`/`waitFor` checks
remain. Autosave's real 600 ms debounce remains exercised; no interval or expiry
was found to control the originally reproduced timeout, so clocks were not globally faked.

The first full verification of the intermediate fixture still failed (retained log
[gg-chore-web-after-1.log.txt](gg-chore-web-after-1.log.txt), exit 1, 547.88 s, 1469 passed / 5 failed):
the labeled preset and keyboard tests timed out at 20147/20682 ms. That evidence
led to removing autosave from non-persistence component cases. Three additional
failures were also addressed through their existing public interfaces:

- `DecisionAuthoring` row ownership/removal timed out. Its full-page integration
  remains; complete route fixture values are pasted instead of typed.
- `saved-values` inference timed out at 20688 ms. Its component boundary and full
  inference-schema assertions remain; the model fixture value is pasted.
- `structure` S24 did not reach its conflict notice within 4 s. Its setup now
  waits for the public cached reconciled draft, then fakes only timeout scheduling
  during the local edit and explicitly advances the production autosave debounce
  plus zero-delay notifications inside `act`. Real timers are restored in
  `finally` before the original conflict/reload assertions and further editing.
  This removes a setup-readiness assumption and a real debounce wait. It does not
  establish or correct a product race.

A targeted loaded check after these refinements passed all six selected cases:
S24 1945 ms, route ownership 3795 ms, inference form 2404 ms, poll preset 3723 ms,
labeled preset 2032 ms and keyboard editing 3593 ms. These focused checks are
diagnostic verification; the final full-suite series below starts with this
refined revision. No failed run is counted as a passing gate.

That revision's first full run ([gg-chore-web-final-1.log.txt](gg-chore-web-final-1.log.txt)) passed 1473
tests and failed only Advanced at **20126 ms**, despite removing unrelated
rendering and autosave. Vitest duration was 340.98 s. Typecheck/lint started only
after that failure was already recorded; this run is not part of the final clean
series. It supports the last-resort **60 s** budget for this one case (three times
the old budget, consistent with the repository's API subprocess precedent).
There is no remaining fixture typing or fixed wait in that scenario to replace;
its real form remounts and focus assertions are the behavior under test.
Keyboard editing also took 18841 ms, so its two ordinary fixture strings now use
single paste edits while its JSON-pointer typing and keyboard history checks stay.

The next full admission run ([gg-chore-web-verified-1.log.txt](gg-chore-web-verified-1.log.txt)) exposed further
test-only scheduling/workload assumptions: **1467 passed / 7 failed**, 629.58 s
Vitest duration (638.791 s command wall time), with no coverage summary. Advanced
completed in **30563 ms** under its scoped budget. New failures and corrections:

| Case                                         | Failure                                                                                                       | Final change                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EditorPage JSON publishing/discard surfaces  | 20130 ms deadline                                                                                             | Keep the entire real page, canvas/dialog badges, publishing blockers and focus transitions; give this inherently multi-surface integration case 60 s locally. No setup typing or fixed wait was available to remove.                                                                                                                                          |
| EditorPage keyboard connections/default list | 20438 ms deadline                                                                                             | Keep real canvas node creation, keyboard entry, connection/removal and a second node's default list. Its actual transitions are the work under test; give this case 60 s locally.                                                                                                                                                                             |
| Node dialog opened/added list disclosures    | 20973 ms deadline                                                                                             | Already reduced to the minimal dialog without persistence; its repeated real nested-form remounts and history/focus checks require the work. Give this case 60 s locally.                                                                                                                                                                                     |
| EditorPage settings/variables/IDs/edges      | 20051 ms deadline                                                                                             | Paste complete name and ID fixtures; keep explicit Enter/blur commits, invalid/duplicate-ID checks and all graph/variable assertions.                                                                                                                                                                                                                         |
| EditorPage ID-close behavior                 | 20373 ms deadline                                                                                             | Mount the real node dialog for ID drafting/closing, retaining the original actual typing, Escape/close sequences and store assertions. The unrelated kitchen-sink canvas no longer rerenders per character.                                                                                                                                                   |
| v1 device-copy conversion/archive/overwrite  | Heading absent after its 5 s DOM wait; case 6398 ms                                                           | Await the UI's real lazy-import loader before mounting. This separates loader readiness from the DOM assertion window. Actual conversion, exact archival and overwrite assertions remain; loader-failure cases remain separate. The fixture also imports the converter directly, so cold converter transformation is not established as this failure's cause. |
| Cron stable announcement                     | After 2962 ms, the status already held `Custom expression: 0 9 * * *` instead of the prior daily announcement | Hold timeout/clearTimeout during the public select/input changes, assert the unchanged status, then advance exactly the production 350 ms debounce inside `act`; restore real timers in `finally`.                                                                                                                                                            |

There are **four** individual 60 s budgets: Advanced, opened/added lists, JSON
discard/publish, and keyboard connection/default-list integration. All have a
measured 20 s failure and intentionally retain their substantial real UI work.
Other tests and the global 20 s timeout are unchanged.

The extended focused check passed the seven non-cron cases (2412 to 10216 ms).
Its first fake-clock cron implementation deadlocked on user-event's outer task
wrapper. The final clock phase uses supported `fireEvent.change` input events;
picker keyboard behavior is tested elsewhere. The corrected cron case passed
**10/10 loaded executions**, zero retries ([gg-chore-web-cron-clock.log.txt](gg-chore-web-cron-clock.log.txt)).
No failed admission or diagnostic invocation is included in the final passing
matrix below.

The first `accepted-1` attempt then reproduced the known pre-G4 Settings focus
test defect: `Delete gpt-6-luna` lost heading focus after **8011 ms**. Baseline
main had not yet incorporated the test hunk from **`aad08eca`**. This worktree
now carries that exact test-only hunk: freeze timeout/clearTimeout while render
notifications are held, issue the confirmation through its public button, drain
only zero-delay work inside `act`, release notifications, and restore scheduler,
frame handling and real timers in nested `finally` blocks. The **500 ms** watch
cannot expire while that deliberately held test phase runs.

This is an intentional file overlap with **WP-G4 / `opus-wp-g4-exit-evidence`**:
`src/settings/SettingsPage.test.tsx` contains the same existing G4 correction;
the orchestrator should reconcile it with that branch. No G4 branch, PR, product
file or issue was changed. After recording the full-run failure, its load
generator was stopped during the later Settings diagnostic work; this failed
attempt is explicitly excluded from matched full-suite measurements.

The port passed all **30 focused executions** (three parameters, ten executions
each, no retries); log [gg-chore-web-settings-clock.log.txt](gg-chore-web-settings-clock.log.txt). A TypeScript AST
comparison against the worktree's original HEAD found **all 1070 original
explicit assertion calls retained** across the nine modified test files, with
one additional cached-draft readiness precondition in S24. No test declaration
or parameter was removed. Assertion-audit log:
[gg-chore-web-assertions.log.txt](gg-chore-web-assertions.log.txt).

CPU contention can still extend elapsed time; no finite test deadline can
guarantee success under unlimited starvation. The verification below measures
the requested finite load with default parallelism, rather than changing its
budget or claiming an absolute scheduling guarantee.

## Change manifest

All application edits are test code in `@graphgoblin/web`:

| Path under `apps/web/src/`           | Change                                                                                                |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `__fixtures__/node-editor.tsx`       | Real dialog/store/validation/history fixture; optional real autosave for persistence cases.           |
| `__fixtures__/user.ts`               | One awaited clipboard input edit for fixture text.                                                    |
| `editor/TriggerEditor.test.tsx`      | Component boundary and batched setup values; full round trips retained.                               |
| `editor/NodeEditorDialog.test.tsx`   | Component boundary, batched setup values, atomic secret replacement; two scoped form-remount budgets. |
| `editor/EditorPage.test.tsx`         | Smaller ID-close boundary, batched setup values; two scoped page-integration budgets.                 |
| `editor/DecisionAuthoring.test.tsx`  | Batched route fixture values.                                                                         |
| `editor/EditorPage.restore.test.tsx` | Explicit UI-loader readiness before mounting the conversion case.                                     |
| `forms/saved-values.test.tsx`        | Batched model fixture text.                                                                           |
| `forms/structure.test.tsx`           | Initial reconciliation precondition and controlled autosave clock.                                    |
| `forms/cron/control.test.tsx`        | Controlled announcement debounce.                                                                     |
| `settings/SettingsPage.test.tsx`     | Exact G4 clock-fix port; intentional WP-G4 overlap.                                                   |

Evidence files are `docs/qa/2026-10-22-web-test-stability/before.md` and this
`after.md`. No file in another application/package was edited. The Settings file
matches G4's `aad08eca` blob exactly:
`75c3057b44aa2847883cc32d4e4f4e9c09b5e816`.

## Gates and limitations

All commands use Node 22 first on PATH, from the worktree root.

| Command                                                                                                                                                                        | Result                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `pnpm.cmd typecheck`                                                                                                                                                           | Pass: 20 successful tasks; web ran freshly.                                                                 |
| `pnpm.cmd lint`                                                                                                                                                                | Pass after temporary browser-file removal: 11 successful tasks; web ran freshly.                            |
| `pnpm.cmd format:check`                                                                                                                                                        | Pass: all matched files use Prettier code style.                                                            |
| `pnpm.cmd check:layers`                                                                                                                                                        | Pass.                                                                                                       |
| `pnpm.cmd check:deps`                                                                                                                                                          | Pass: 0 errors; existing `no-orphans` warning for `packages/infrastructure/drizzle.config.ts`.              |
| `pnpm.cmd check:tokens`                                                                                                                                                        | Pass: 161 files checked.                                                                                    |
| `pnpm.cmd build`                                                                                                                                                               | Pass: 11 successful tasks; web built freshly.                                                               |
| `pnpm.cmd --filter @graphgoblin/web exec playwright test -c gg-chore-web-playwright.config.ts e2e/editor-modal.spec.ts e2e/trigger-types.spec.ts e2e/undo.spec.ts --retries=0` | **25 passed**, 1.4 minutes, real Edge against the built web app and in-memory test API with fake harnesses. |

Browser verification used disposable copies of the existing Playwright config,
global setup and server, with only the main/control listeners bound to **5770 /
5771**, retries forced to zero and results under
`%TEMP%\gg-chore-web-browser-results`. The disposable config is reconstructed from
[gg-chore-web-browser.cjs](gg-chore-web-browser.cjs) as
[gg-chore-web-playwright.config.ts](gg-chore-web-playwright.config.ts).
Those three temporary files were removed;
no persistent e2e or Vitest configuration changed. Browser log:
[gg-chore-web-browser.log.txt](gg-chore-web-browser.log.txt).

One concurrent lint invocation rejected that temporary config because it was
outside the TypeScript project service's allowed config names. This validation
ordering mistake was corrected by removing the temporary browser files and
running lint again before starting the final loaded series. That failed
invocation is retained in [gg-chore-web-lint-final.log.txt](gg-chore-web-lint-final.log.txt); it is not counted
as a passing gate. Turbo also emitted nonfatal cache I/O access-denied warnings
on successful typecheck/lint/build runs; the changed web task ran freshly.

No schema, route, dependency, production behavior or architectural decision
changed. Generated-doc and license gates are not required for this test-only
scope. No numbered doc, ADR or CHANGELOG update is needed.

The historical EditorPage worker-start timeout was not reproduced in the
baseline. No EditorPage or product-code correction is claimed. No product race
was established. No directory was explicitly deleted, no owner app/store was
accessed and no Git index, commit or remote operation was performed.

Final matrix completed at 2026-10-22T21:33:45.9123395Z. All recorded load-generator
process identities were checked afterwards; none remained active.
