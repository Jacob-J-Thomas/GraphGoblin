# WP-F2b #205 round 3 implementation evidence

Base HEAD: `23cfb7b82287920018358e10cac87d9858081356`, branch `codex-wp-f2b-205`.
Worktree: `%USERPROFILE%\source\repos\GraphGoblin\.claude\worktrees\codex-wp-f2b-205`.
Changes are uncommitted for the orchestrator. This is implementation verification, not independent QA or merge sign-off.

## Reproductions before production changes

Public component forms and the API over real SQLite with injected fake harnesses reproduced all five findings at this head. No live provider turns were made.

- **F1:** changing owner or process defaults, then dispatching window focus or reopening a dialog with a fresh cache, failed to find `Default (high)`; the selected option remained `Default (low)`. The same-tab Settings test also retained low after changing the process response and saving owner defaults. See `before-web.log.txt` (five refresh failures).
- **F2:** inherited and explicit high both produced `status: 202` and `requests: [{ effort: "high", model: "claude-opus-5-5" }]`, against the expected `status: 422, requests: []`, after the ready list was narrowed to low. Direct manager starts also reached the fake. See `before-api.log.txt` (four failures, two supported-low passes).
- **F3:** after Settings/process data arrived, pending catalog still failed to find `/Default.*checking/`; failed catalog failed to find `Default (unavailable)`. The option remained concrete low. See `before-pending-and-accessibility.log.txt` and `before-web.log.txt`.
- **F4:** the LLM form failed to find `combobox` named `Model`; its model remained a union's Mode selector and nested Value. See `before-web.log.txt`.
- **F5:** the inherited model description was only `Model; inherits within this harness from loop, owner, then process defaults.` The effort description was only `Reasoning effort; inherits within this harness like the model. Catalog effort is guidance only.` Neither matched the inherited identity/unsupported description assertions. See `before-pending-and-accessibility.log.txt`.

The first pending-catalog test originally observed checking before defaults finished loading and passed too early; it was corrected to await both defaults queries before reproducing the failure. The first accessibility attempt also had a malformed expected option string; the corrected assertions reproduced both missing descriptions before production edits. The initial logs are retained, including these fixture/assertion mistakes.

## Changes and after checks

- **F1:** `refreshModelDefaults` replaces older lookups and invalidates owner Settings and process defaults together, keeping the cache's current data during cancellation. Providers refresh on window focus/visible-tab return; `NodeEditorDialog` refreshes per opening; Defaults Settings saves update authoritative Settings and invalidate both queries. Public form tests exercise each path, including a fresh cache and same-tab save. An API-only change without focus can appear on the next focus or opening. Two further cases demonstrated stale responses from both initial and background requests before this replacement (`focus-inflight-before.log.txt`); the final helper prevents either older response from satisfying the focus refresh.
- **F2:** the pure `resolveHarnessModel` accepts a ready Claude capability list and returns the existing `EFFORT_UNSUPPORTED` without substitution when the effective pair is absent. Manual `assertRunReadiness` resolves pinned root/child selections with the run's pinned defaults before durable admission. `RunManager` repeats resolution with a fresh ready list at the shared request boundary: all manual/trigger starts, children, replay, resume and recovery pass through it. Other paths can execute preceding nodes; the guard precedes the adapter request. Tests cover manual inherited/explicit refusal, direct starts, a real Event trigger, a pinned child, pause/resume with changed Settings, and supported low. Unknown/unready probes retain existing handling.
- **F3:** no catalog result yields checking/unavailable effort labels. Cached catalog results retain the existing background-refresh behavior and values.
- **F4:** LLM Model is one native dropdown; Default stores `{ mode: "inherit" }`, explicit selection stores `{ mode: "explicit", value }`. Inference model and effort remain on Settings outside Advanced. Classifiers remain Question → Model → Answer with no effort.
- **F5:** inherited model/effort identity and the unsupported inherited effort warning are linked with `aria-describedby`. Public component and browser assertions check accessible descriptions.

The initial post-change API Event fixture used an unrecognized `filter` field; removing it made all nine cases pass. The initial engine fixture omitted Claude's explicit required policy; adding read-only/never made all five cases pass. An older web assertion excluded every occurrence of “unavailable”; it now distinguishes a missing inherited default from the explicit selection's support/readiness. All these first results remain in their own logs.

## Gate and browser results

The existing nested-readiness integration file initially failed four probe-count assertions (15/19 passed), and its required one-time isolated rerun had the same four failures (15/19 passed). These were caused by the added request-time Claude checks, not timing: parent/child execution now totals three probes (one admission plus two requests), and a single Claude request totals two. The four assertions were updated accordingly; pin and adapter assertions remain intact. This small edit touches the sibling readiness test file owned by WP-F1.

Results are recorded in the adjacent `.log.txt` files. The final focused run passed **93 tests in four files**, including the form cases and existing harness-switch tests (`web-final-focused.log.txt`). The new API cases passed 9/9 and the engine cases passed 5/5 after the documented fixture corrections.

| Package | Full-suite result                                                             | Lines                          | Branches    | Statements  | Functions   |
| ------- | ----------------------------------------------------------------------------- | ------------------------------ | ----------- | ----------- | ----------- |
| Domain  | 31 files, 608 passed                                                          | 98.48%                         | 95.79%      | 97.32%      | 97.12%      |
| Engine  | 41 files, 1,586 passed                                                        | 98.10%                         | 93.09%      | 96.91%      | 98.82%      |
| API     | 65 files passed, 1 failed, 2 skipped; 1,329 tests passed, 2 failed, 8 skipped | Not emitted after failed tests | Not emitted | Not emitted | Not emitted |
| Web     | 131 files, 1,660 passed                                                       | 98.91%                         | 94.90%      | 98.01%      | 98.44%      |

The API full run failed two tests in untouched `src/subloop-restart.test.ts`: a duplicate `child_run.finished` count (expected 1, received 2), and a missing expected waiting child, followed by a 60-second teardown timeout. Its required single isolated rerun passed two tests and failed one solely on the fixture's `afterEach` timeout at line 23; neither assertion failure was reported again. This does not make the full gate green. Both results are retained in `api-coverage.log.txt` and `api-coverage-isolated-src-subloop-restart.test.ts.log.txt`. No stale API coverage summary is presented as current. The orchestrator's clean CI/outside-sandbox verification remains necessary for this native-process gate.

Final source typechecking passed all 20 tasks (`typecheck-after-browser-fixture.log.txt`), and lint passed all 11 tasks (`lint-after-browser-fixture.log.txt`). Lint retains one warning in untouched `apps/web/src/runs/inspector/ThreadViewer.tsx:106` (`@eslint-react/use-state`). Full `pnpm.cmd format` passed; later test/helper edits were formatted separately. Final layers, dependencies, tokens and generated-doc checks all passed. `pnpm.cmd build` passed all 11 tasks (`build.log.txt`).

The default Edge configuration, with `--retries=0`, passed **24/24** tests across `e2e/model-effort.spec.ts` (16) and `e2e/model-picker.spec.ts` (8), recorded in `browser-with-focus-event.log.txt`. All four previously known model-picker failures on main are resolved in this build. The additional existing `e2e/claude-harness.spec.ts` passed **11/11**, also with zero retries (`browser-claude-harness.log.txt`).

The first requested browser run had 23 passes and one cross-tab failure (`browser.log.txt`). The retained network extract proves Settings saved Sol/high but the editor made no later GET. A diagnostic run (`browser-focus-diagnostic.log.txt`) showed both headless pages remained `visible` and `focused:true`; `bringToFront()` emitted neither a window-focus nor a visible-tab event. The corrected fixture explicitly sends the public DOM focus event after verifying the saved Settings. It then checks the refreshed labels and actual fake adapter request, followed by a real dialog-close/open check after deleting the override. This is controlled browser event coverage, not a claim about native OS window activation. No production code was changed for this fixture correction. Both oversized traces are recorded in `NOT-KEPT.md`.

The three `after-*.png` captures were inspected: inference still has model/effort directly on Settings; LLM now has one Model dropdown and one Effort dropdown, without Mode or an Effort section; classifier still has Question → Model → Answer and no effort.

## Files and shared ownership

Round 3 changes 23 source/docs files, plus this evidence folder:

- Domain: `packages/domain/src/model-resolution.ts` and its test (ready Claude capability validation in the existing pure resolver).
- Engine: `packages/engine/src/run-manager.ts` and new `src/claude-effort.test.ts` (pinned defaults in the admission plan and shared request guard).
- API: `apps/api/src/run-readiness.ts`, `routes/runs.ts`, `nested-readiness.test.ts`, and new `claude-effort-readiness.test.ts`.
- Web: `src/api/queries.ts`, `src/app/bootstrap.tsx`, `src/editor/NodeEditorDialog.tsx`, `src/editor/model-effort.test.tsx`, new `src/editor/model-effort-refresh.test.tsx`, `src/forms/fields/model.tsx` and its test, `src/settings/sections/DefaultsSection.tsx`, plus `e2e/model-effort.spec.ts`, `e2e/model-picker.spec.ts`, and `e2e/server.ts`.
- Docs: `docs/06-harness-integration.md`, `docs/09-frontend-and-pwa.md`, `docs/guide/02-build-a-loop.md`, and the existing top Unreleased #205 bullet in `CHANGELOG.md`.

Shared-file edits and exact changed ranges are retained in `shared-edits.log.txt`: the run manager's start plan/default pin and model resolution, the manual run route callback, API readiness and its sibling tests, the defaults query helper, and docs 06. Stop/shutdown, targeted Event admission, thread reconstruction and session-handling regions are unchanged.

No contracts, saved configuration shapes, dependencies, ADRs or migrations changed. Docs 06/09, guide 02 and the existing top Unreleased #205 bullet describe the final behavior. Existing round-1/round-2 captures and hashes are preserved; new browser captures go here.

## Decisions and parameters

Inheritance still has one pure owner, `inheritedHarnessDefaults`, used by the existing domain resolver and web field. Ready Claude capabilities constrain that resolver's effective model/effort, independently of lower-level authored defaults that the node overrides. Manual admission uses the exact frozen root/child versions and the run's pinned owner/process defaults. Shared engine resolution covers other starts and resumed visits before the adapter request; automatic paths can execute earlier nodes.

Defaults refresh is event driven, with no new polling interval, retry count or other runtime number. Older requests are cancelled silently without reverting the current cache before fresh lookups start, so late responses cannot satisfy the new focus/open/save event. The existing harness-switch policy, readiness gating and supported model catalog are preserved.

## Caveats and open items

- The API coverage command remains failed on the untouched native restart fixture. Its one isolated rerun still timed out during cleanup. The orchestrator must reconcile this with the clean CI/outside-sandbox run; no current API coverage percentage is claimed.
- Browser request assertions use fake harnesses over the real built app/API. No live provider turn or actual screen-reader speech was exercised. The headless cross-tab focus case uses an explicit public DOM event, as described above; it does not establish native OS window activation behavior.
- Work is uncommitted for the orchestrator's commit, review and independent QA. No commit, push, merge, rebase, stash or branch switch was performed. Owner listeners/store were not used. Disposable test data and ignored build/coverage output follow the standard fixture lifecycle; no manual directory cleanup was performed.
- `FILES_CHANGED.log.txt` inventories the final changes, and `SHA256SUMS.log.txt` records final retained evidence bytes (excluding its own hash). Oversized traces are not kept; their metadata is in `NOT-KEPT.md`.
