# WP-F2b round 2 delivery report (#204)

## 1. Branch, worktree and base

- Branch: `codex-wp-f2b-harness-switch`.
- Worktree: `<local>\source\repos\GraphGoblin\.claude\worktrees\codex-wp-f2b-harness-switch`.
- Unchanged HEAD: `f6650ce9884576a014bfb27b7990cba6bc1391f7`, with parents
  `cbfdd42ffe4af1056a03b8b13994e79620c778d4` (original #204 implementation) and
  `6f21ff8b51ac48a2dd971574428a2deadded6b18` (current WP-F1), stacked under D-009.
- Changes remain uncommitted for the orchestrator's review/commit. The index is empty. No commit,
  push, merge, rebase, stash, branch switch, dependency installation, directory deletion or external
  symbolic link/junction creation was performed.

## 2. Acceptance evidence for #204 / #305 / I06 #288

B1-B3 and N1-N8 are implemented. [before.md](before.md) records the built baseline;
[round2-before.json](round2-before.json) and [round2-after.json](round2-after.json) preserve the
observations. These use Edge, native fake CLIs, fresh `%TEMP%/gg-wp-f2b-*` stores and port 5832.

| Required fix     | Built baseline                                                                            | Corrected product                                                                                                                                                         |
| ---------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1 inheritance   | Both directions pinned absent overrides to Settings models/high effort                    | Both fields remain `(loop default)`; saved config has neither property; requests resolve the selected harness's configured model/effort                                   |
| B2 precedence    | Claude loop Fable/low lost to Settings Opus/high; Codex loop Astra lost to Settings Luna  | Fable/low and Astra/high win respectively; high stays in the reverse case because it is supported                                                                         |
| B3 initial loads | Both early switches retained the old provider's explicit model and issued a Reload notice | A loading notice appears under Harness; the first checks finish and the action applies compatible values without another click; save/reopen/publication/request all agree |

The final collector passes **16 scenarios**, both directions for configured, absent, disabled,
failed, inherited, effort-only, competing loop/Settings defaults and early loading. **14 successful
runs** reach the native fake executable with exactly the expected model and effort. Both disabled
preferences stay off during the switch check. The two failed-catalog cases keep the authored values
and stable failure notice, with no switch-triggered refetch. The successful directory is
`%TEMP%/gg-wp-f2b-native-69l9Yv` (`results.json`, `api.log`, `bin/requests.jsonl`). The 14-case baseline
is extended by two effort-only checks in the corrected evidence.

B1 restores `claude-harness.spec.ts` assertions that the published node has no model/effort
properties, and the fields remain unset after reopening. Component checks cover pending and
successful lookups and both switch directions. An effort-only node retains model inheritance;
known unsupported effort is replaced or cleared to inherit, while failed checks retain its authored
effort. Native save/reopen and request checks cover this case in both directions too.

B2 has a test with three distinct Codex models: loop Astra/low overrides Settings Sol/high and
ecosystem Luna. The owner README uses the same distinct models and starts with a switch to Codex.
B3 removes pre-switch waits from the component setup, reverse browser case and collector; explicit
first-response delays prove waiting. A known failure is never queued behind another lookup, an
in-flight retry is not treated as the first load, and a first lookup's rejection ends that action
without a later rewrite on recovery.

N1: the catalog response identifies the adapter ecosystem defaults, with a test tied to those
constants. N2: only inference Harness fields mount the switch hook; the editor warms Settings and
preflight, and actions read shared state without fetching or remounting. The policy query observer
also stays mounted across switches. Trigger/exit dialog tests show no additional lookups. N3/N4:
notices sit under Harness with the alert icon, clear on history changes, keep focus and use F1's
retry names; failed catalogs no longer flicker due to a remount. N5: docs and notices explain
**Validation unavailable** and that an incompatible draft cannot be saved. N6: failed preflight
and invalid loop defaults are covered. N7/N8: the portable install/build/QA README, explicit collector
port and disposable output are complete; docs 09 holds the full rule with short references in docs
06/guide 06, and the guide section precedes its closing link.

Existing API model validation agrees with the selected values; no production edit to
`model-issues.ts` or node admission routes was necessary. No runtime selection, readiness vocabulary,
Claude policy capabilities, catalog membership or effort capabilities changed.

## 3. Files and shared-file edit ranges

All edits are named below. Ranges are old HEAD lines -> current lines; removed ranges name their
new anchor. New files show their whole range. The Codex adapter edit only exports its existing
default constant, outside the turn path. `EditorPage.freshness.test.tsx` only adjusts the expected
catalog response for the new metadata. The former report is retained as historical
[round1-report.md](round1-report.md).

| File                                                          | Edited ranges                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CHANGELOG.md`                                                | 7 -> 7                                                                                                                                                                                                                                                                                       |
| `apps/api/src/catalog.test.ts`                                | 1 -> 2-3; 17 -> 20-32                                                                                                                                                                                                                                                                        |
| `apps/api/src/routes/settings.ts`                             | 1 -> 2-3; 271 -> 273-277; 274 -> 280-287                                                                                                                                                                                                                                                     |
| `apps/web/e2e/claude-harness.spec.ts`                         | 107-108 -> 107-108; 121-125 -> 121-123; 129-130 -> 127-128                                                                                                                                                                                                                                   |
| `apps/web/e2e/harness-switch-native.mjs`                      | 9 -> 9; 30 -> 30-33; 36 -> 39; 63 -> 67; 78 -> 82; 86 -> 90-99; 89 -> 102-110; 97 -> 118-123; 112-113 -> 138-143; 130 -> 161-174; 136-143 -> 180-183; 145 -> 186-202; 149 -> 207; 152 -> 211; 157 removed at 215; 164 -> 223-231; 192 -> 259-263; 197 -> 268; 210-217 -> 281-283; 218 -> 285 |
| `apps/web/e2e/model-picker.spec.ts`                           | 391-393 removed at 390; 396 removed at 392; 398 removed at 393                                                                                                                                                                                                                               |
| `apps/web/src/__fixtures__/fake-api.ts`                       | 760 -> 760-771                                                                                                                                                                                                                                                                               |
| `apps/web/src/editor/ClaudePolicyField.tsx`                   | 5 -> 5; 28 -> 29; 30 -> 31; 36 -> 37-41; 48 removed at 52                                                                                                                                                                                                                                    |
| `apps/web/src/editor/EditorPage.freshness.test.tsx`           | 247 -> 247-251                                                                                                                                                                                                                                                                               |
| `apps/web/src/editor/EditorPage.tsx`                          | 15 -> 16-17; 122 -> 125-127                                                                                                                                                                                                                                                                  |
| `apps/web/src/editor/HarnessField.tsx`                        | new 1-116                                                                                                                                                                                                                                                                                    |
| `apps/web/src/editor/NodeEditorDialog.tsx`                    | 3 removed at 2; 8 -> 7; 47 -> 46-47; 168-170 removed at 167; 293-301 removed at 289; 309 removed at 296; 316-348 removed at 302; 570-574 removed at 523; 709-713 -> 658-664                                                                                                                  |
| `apps/web/src/editor/harness-switch.test.tsx`                 | 5 -> 6; 12 -> 13-18; 39 -> 45; 60 -> 67-70; 66-67 -> 76-77; 79-80 -> 89; 95 -> 105; 101-109 removed at 110; 114 -> 115-122; 122 -> 130-132; 127 -> 137; 129 -> 139; 188-190 -> 198-202; 216 -> 229-341                                                                                       |
| `apps/web/src/forms/fields/harness-switch.test.tsx`           | new 1-265                                                                                                                                                                                                                                                                                    |
| `apps/web/src/forms/fields/model.tsx`                         | 11 -> 11; 15 -> 15-20; 23-30 -> 28; 32-34 removed at 29; 36 -> 31-40; 38-40 -> 42-70; 42-43 -> 72-83; 45 -> 85; 47 -> 87; 49 -> 89; 51-52 -> 91; 54 -> 93; 56 -> 95; 58 -> 97; 64 -> 103; 66 -> 105; 76-78 -> 115-120; 82 -> 124; 87-92 -> 129-136; 94 -> 138; 96 -> 140-144                 |
| `docs/06-harness-integration.md`                              | 425-441 -> 425-431                                                                                                                                                                                                                                                                           |
| `docs/09-frontend-and-pwa.md`                                 | 684-700 -> 684-723                                                                                                                                                                                                                                                                           |
| `docs/guide/06-settings-and-secrets.md`                       | 301 -> 301-310; 303-321 -> 312                                                                                                                                                                                                                                                               |
| `docs/qa/2026-10-20-wp-f2b-harness-switch/README.md`          | 11 -> 11; 15 -> 15; 18 -> 18-19; 50 -> 51-54; 54 -> 58; 72-86 -> 76-94; 93-95 -> 101-103; 97 -> 105; 99-108 -> 107-108; 110-118 -> 110-122; 120-124 -> 124-146; 131-132 -> 153-155; 139 -> 162-164; 141 -> 167-168; 144 -> 172; 147-148 -> 175-178; 185 -> 216-218                           |
| `docs/qa/2026-10-20-wp-f2b-harness-switch/before.md`          | 11 -> 12-32                                                                                                                                                                                                                                                                                  |
| `docs/qa/2026-10-20-wp-f2b-harness-switch/report.md`          | whole report, 1-249                                                                                                                                                                                                                                                                          |
| `docs/qa/2026-10-20-wp-f2b-harness-switch/round1-report.md`   | new 1-125                                                                                                                                                                                                                                                                                    |
| `docs/qa/2026-10-20-wp-f2b-harness-switch/round2-after.json`  | new 1-533                                                                                                                                                                                                                                                                                    |
| `docs/qa/2026-10-20-wp-f2b-harness-switch/round2-before.json` | new 1-185                                                                                                                                                                                                                                                                                    |
| `packages/adapter-codex/src/harness.ts`                       | 62 -> 62                                                                                                                                                                                                                                                                                     |
| `packages/adapter-codex/src/index.ts`                         | 7 -> 8                                                                                                                                                                                                                                                                                       |
| `packages/api-client/openapi.json`                            | 17776 -> 17777-17779; 17786 -> 17789-17790                                                                                                                                                                                                                                                   |
| `packages/api-client/src/generated/schema.ts`                 | 1736 -> 1737                                                                                                                                                                                                                                                                                 |

## 4. Tests and coverage

Final full runs: **Web 1,541 passed**, 120/120 files; **API 711 passed, 6 skipped**, 48 files passed
and 2 skipped (717 tests, 50 files). Every coverage threshold remains unchanged and passes.

| Package | Lines              | Branches           | Statements         | Functions          |
| ------- | ------------------ | ------------------ | ------------------ | ------------------ |
| Web     | 98.95% (7083/7158) | 95.00% (7265/7647) | 98.04% (8126/8288) | 98.55% (2189/2221) |
| API     | 97.88% (1806/1845) | 93.01% (1291/1388) | 96.40% (1983/2057) | 94.08% (398/423)   |

Dedicated switch tests: **41 passed** (28 editor/component, 13 helper). Native collector: **16
scenarios passed**, including 14 saved/published/reopened/request-matched runs. The final full web
run also passes the earlier timed-out Undo/Redo case in 5.064 seconds.

Fail-before and individual triage evidence:

- Initial component run: **19 passed, 5 failed**: both loop-over-Settings cases, both disabled-loop
  effort-order cases, and early loading. Native baseline separately proves B1 inheritance pinning.
- Three additional failure/loading regressions failed individually before correction: a known
  failed catalog queued behind another first check, an initial-catalog retry treated as a first
  load, and an initial failure hidden by recovery while another check remained pending. Each
  formerly substituted `destination` / `high`; all now preserve the authored choice.
- Three effort-only regressions failed before correction: unknown or failed catalog cleared an
  authored effort, and initial Settings loading was not awaited for effort compatibility. All now
  retain effort on failure and keep the model unset on success.
- The first broad web attempt exposed an omitted-harness bug in the new field. It was stopped and
  fixed to use the contract's Codex default. `EditorPage.test.tsx:292` and `:330` each passed alone
  (1 passed/36 skipped), then passed in the final full run.
- First API coverage: **710 passed, 1 failed, 6 skipped**. Its sole failure was the new catalog
  test expecting Codex before Claude in the sorted response. It failed alone, was corrected and
  passed alone (1 passed/26 skipped), then passed in the final full API run.
- A broad web run had **1535 passed, 1 failed**: `EditorPage.freshness.test.tsx:201` expected raw
  catalog rows without the new `ecosystemDefault` response property. It failed alone at line 247;
  only that expected response was corrected. It passed alone (1 passed/7 skipped) and in the final
  full run. Freshness/validation logic and assertions remain intact.
- An intermediate broad run was stopped for the additional source correction after
  `NodeEditorDialog.test.tsx:521` exceeded its original 20-second limit (20.417 seconds). It passed
  alone with that same limit (1 passed/29 skipped; roughly 5-second body), and in the final full
  run. This load-class observation is retained; neither the timeout nor the assertion was weakened.
- One final coverage invocation ran zero tests because its default report directory had a stale
  Vitest lock. The PID had been reused by Bash, so the diagnostic did not identify a running Vitest.
  The final full run used a fresh report directory with identical test/coverage settings; see below.

## 5. Gates

All commands select Node **v22.14.0** on PATH and use `pnpm.cmd` in PowerShell.

| Exact command                                                                                                                                               | Final result                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `pnpm.cmd typecheck`                                                                                                                                        | PASS, 20 tasks; changed web files checked again after the final guard          |
| `pnpm.cmd --filter @graphgoblin/web typecheck`                                                                                                              | PASS on final source and all its tests/fixtures                                |
| `pnpm.cmd lint`                                                                                                                                             | PASS, 11 tasks; initial lint findings corrected                                |
| `pnpm.cmd --filter @graphgoblin/web lint`                                                                                                                   | PASS after final source and collector changes                                  |
| `pnpm.cmd format:check`                                                                                                                                     | PASS; report formatting rechecked at handoff                                   |
| `pnpm.cmd check:docs`                                                                                                                                       | PASS, generated references current                                             |
| `pnpm.cmd check:tokens`                                                                                                                                     | PASS, 163 files                                                                |
| `pnpm.cmd check:layers`                                                                                                                                     | PASS                                                                           |
| `pnpm.cmd check:deps`                                                                                                                                       | PASS, 0 errors; existing drizzle orphan warning, 809 modules/3228 dependencies |
| `pnpm.cmd build`                                                                                                                                            | PASS, 11 tasks, before final Edge/native checks                                |
| `pnpm.cmd test:coverage --filter=@graphgoblin/api -- --maxWorkers=1 --coverage.reportOnFailure=true`                                                        | PASS, 711 passed/6 skipped, all thresholds pass                                |
| `pnpm.cmd test:coverage --filter=@graphgoblin/web -- --maxWorkers=2 --coverage.reportOnFailure=true "--coverage.reportsDirectory=$qaCoverageDir"`           | PASS, 1541 passed, all thresholds pass                                         |
| `pnpm.cmd --filter @graphgoblin/web exec tsx --conditions=development e2e/harness-switch-native.mjs` with `GG_SWITCH_PORT=5832`, `GG_SWITCH_EXPECT_FIXED=1` | PASS, 16 scenarios and 14 exact fake requests                                  |

`$qaCoverageDir` was a new `%TEMP%/gg-wp-f2b-web-coverage-*` directory. The final web JSON/LCOV
reports are at `%TEMP%\gg-wp-f2b-web-coverage-27d3e0eff3ea4be186f0e30117032e75`; API reports are in
`apps/api/coverage`. Command logs remain under `%TEMP%/gg-wp-f2b-round2-*.log`.

After the final build, with `GG_E2E_BROWSER_CHANNEL=msedge`:

```powershell
pnpm.cmd --filter @graphgoblin/web exec playwright test e2e/claude-harness.spec.ts e2e/model-picker.spec.ts e2e/readiness.spec.ts --workers=1 --reporter=line
```

**21 passed, exactly 4 known #205 failures** (25 total, 3.1 minutes):

- `model-picker.spec.ts:36:3`: catalog model and effort publish and reach the harness (dark).
- `model-picker.spec.ts:36:3`: catalog model and effort publish and reach the harness (light).
- `model-picker.spec.ts:102:1`: a saved model removed from the catalog stays selected and explicit unknown import is rejected.
- `model-picker.spec.ts:159:1`: catalog failure preserves the current values until retry and loop defaults share the picker.

These are the first brief's `model-picker.spec.ts:28` twice, `:94` and `:151`, shifted by the
existing imports. All 9 Claude-harness and all 8 readiness cases pass, including both
loaded-incompatible cases and restored absent-property assertions. No browser failure is counted
as a pass. Model and effort remain in Advanced for the separate #205 work.

## 6. Docs, contracts and acceptance

Docs 06/09, guide 06 and the CHANGELOG use **loop, Settings, ecosystem** for explicit-model
switching (D-023), preserve unset inheritance and explain initial waiting/failure retention. A blocked
switch's incompatible draft cannot be saved; catalog failure shows **Validation unavailable**.
No stored value changes or migration/upgrade steps are required. The additive catalog response
property regenerates `packages/api-client/openapi.json` and `src/generated/schema.ts`.
`pnpm.cmd docs:generate` ran; reference rendering has no content change. This implements the settled
D-023 decision without another architectural change, so no new ADR is needed.

[README.md](README.md) is self-contained: checkout-relative start, Node 22, install/build, a fresh
store and permitted port, fake CLI variables, exact clicks and expected models/efforts, early
loading, full/effort-only inheritance, save/reopen/publication/run, real-CLI differences and stop /
retained cleanup. The collector uses `GG_SWITCH_PORT` from the README variable and writes only
its fresh disposable output. The report JSON was copied deliberately after inspection; the
collector never overwrites tracked `native-after.json` or other repository evidence.

## 7. Decisions and parameters

- **D-023:** configured preference is loop defaults from the current definition, then owner Settings,
  then the supported ecosystem model identified by the catalog response. Compatible effort order
  is loop, Settings, selected catalog suggestion. Supported authored effort stays; absent effort
  stays absent.
- The adapters remain the default identity sources: exported Codex `DEFAULT_MODEL` (public alias
  `CODEX_DEFAULT_MODEL`) and existing Claude `CLAUDE_MODEL`. The API annotates catalog rows without
  changing membership, efforts or enabled preferences. The web repeats no default model IDs.
- A fully inheriting node switches without reading/waiting for these lookups. An authored model or
  effort shares the already-running first checks; an effort-only node keeps its model inherited.
  The action starts no fetch. Known failures, retries after a failure, and first-check rejection
  cannot queue a later rewrite on recovery. Failed checks retain all authored model/effort values.
- Harness, dependent values and Claude's `read-only` / `never` policy update in one undo scope,
  without a form remount. Pending actions cancel on dismissal/history or a concurrent form edit.
  Successful recovery alone never authors values. Runtime still resolves node, loop, owner,
  process; no execution fallback changed.
- Native observation limits are 60 seconds for app/run polling and 15 seconds for browser
  expectations; these are fixture observation budgets, not product execution limits. Deliberate
  first-response delays are 1.5 seconds. Fixed-mode waits for observed values, and route teardown
  waits for handlers. Manual native app runs used port 5832; standard API/Edge suites retain their
  documented automatic free-port selection.

## 8. Caveats and open items

- Independent QA and the designated session's sign-off remain required before merge (register D-024); owner acceptance is not a gate. The earlier Opus review and
  bounded real provider turns (D-005) are prior evidence. This round used fake CLIs only, made no
  paid turns and did not touch the owner's app/store or ports 4747/4748.
- N9 stays with the Defaults-asymmetry owner note: switching to Codex checks readiness while its
  picker remains editable. Wrong-provider explicit Luna on Claude is the mismatched state the
  switch repairs, not a separate disablement defect.
- #205's four browser failures remain exactly as listed. WP-F2a membership/efforts/policy and WP-F4
  execution paths were not edited. No Sonnet/Haiku integration or effective Claude effort is claimed.
- Earlier full-run failures and stopped runs remain in the triage record above. The final web/API
  full suites pass; this is not a retry-to-green claim about those earlier runs. Each repetition
  followed a source/test correction, or the distinct zero-test stale-lock failure.
- Vitest's default-output lock `%TEMP%/vitest-coverage-5024a91c194686f7.lock` dates to 09:53:24 and
  names PID 19336. `Get-Process` identified that PID as `bash.exe`, started at 10:24:47. The stale
  lock and earlier report directory were retained; no unrelated process was stopped. CIM process
  enumeration was denied by the host. The final run's separate report directory avoids this
  environment issue without changing thresholds, exclusions, timeout or test isolation.
- Expanded collector attempts exposed fixed sampling-delay and route-teardown issues in the QA
  script; both were corrected before the final complete 16-case pass. Its own isolated processes
  were stopped, and disposable artifacts remain for review.
- Dependency cruising retains its existing `drizzle.config.ts` orphan warning, with zero errors.
  Turbo emits Windows cache access-denied warnings even on successful commands. These diagnostics
  are retained separately from product test results.

## Round 3: QA-204-01 (cached catalog failure)

### 1. Branch and worktree

`codex-wp-f2b-harness-switch`, worktree
`<local>\source\repos\GraphGoblin\.claude\worktrees\codex-wp-f2b-harness-switch`,
base `013be37a` (including WP-F1 round 6). The worktree started clean. This round is uncommitted;
ready for orchestrator commit after independent review/QA. D-024 applies: independent QA records
the result; there is no owner acceptance gate.

### 2. Per bolt: #204 / QA-204-01

**Confirmed before the fix:** the new component regression loaded a successful model catalog and
clean server validation, then failed its refetch with HTTP 503. The same catalog data remained
cached. Switching Codex to Claude retained `gpt-6-astra` / `minimal` and showed the Harness warning,
but `findByText('Validation unavailable')` failed: the toolbar still said **Ready to publish**.
The new Edge case independently reproduced the same missing status against the built web app,
real API and in-memory fake harnesses, using `gpt-6-luna` / `high`. Its first failed assertion was
`getByText('Validation unavailable', { exact: true }).toBeVisible()` (10-second observation budget).
No production source had changed for either reproduction.

**After the fix:** a catalog query error holds publication independently of whether cached data
exists. The cached picker remains usable; the explicit switch still retains its authored values
and warning, and starts no extra catalog request. Recovery restores validation of the unchanged
saved Codex draft and enables Publish, without changing the open form's incompatible values or
clearing the switch warning. The focused component regression and related component suites pass
(42 tests), and the served Edge regression passes both alone and in the required three-spec run.
Full coverage results are recorded below.

### 3. Files changed

All line ranges below refer to this round's final worktree; every shared-file edit is listed.

| File                                                 | Changed lines          | Purpose                                                                            |
| ---------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------- |
| `apps/web/src/editor/EditorPage.tsx`                 | 130-134, 512, 518, 522 | Catalog error gates status and publication independently of cached data.           |
| `apps/web/src/editor/EditorToolbar.tsx`              | 67, 86-87, 134-138     | Disable Publish with its catalog retry explanation.                                |
| `apps/web/src/editor/ValidationIndicator.tsx`        | 45, 51, 65-66          | Use the catalog-specific unavailable tooltip.                                      |
| `apps/web/src/editor/harness-switch.test.tsx`        | 206-247                | Cached-refresh failure, switch retention, no extra lookup and recovery regression. |
| `apps/web/e2e/model-picker.spec.ts`                  | 417-477                | Served Edge regression through normal background refetch.                          |
| `docs/09-frontend-and-pwa.md`                        | 553, 713-715           | Cached lookup errors hold Publish; recovery retains authored form values.          |
| `docs/qa/2026-10-20-wp-f2b-harness-switch/README.md` | 156-165, 212-223       | Cached-refresh reproduction and checked disposable cleanup.                        |
| `CHANGELOG.md`                                       | 7                      | Update the existing #204 bullet.                                                   |
| `docs/qa/2026-10-20-wp-f2b-harness-switch/report.md` | 251 onward             | This round's evidence and gate record.                                             |

No API, query/probe pattern, readiness vocabulary, switch selection, adapter/runtime path,
catalog membership or effort changes.

### 4. Tests

The existing cached-refresh component case now verifies the initial ready state, retained cache,
failed-refresh toolbar and disabled Publish, unchanged switch notice and authored model/effort,
no switch refetch, and successful recovery. A new `model-picker.spec.ts` browser case drives the
normal stale-query background refetch using a hidden-to-visible transition, then the same switch
and explicit catalog retry. Both regressions demonstrably failed before production changes. After the full coverage run,
the component case gained an explicit live-DOM assertion for the retained warning; that final
focused case passes (1 passed, 27 filtered/skipped, 14.35 seconds). Production source is unchanged
since the full coverage and Edge runs.

The Edge run has **22 passed, 4 failed, 26 total** (4.2 minutes). All 9 Claude harness cases and
9 readiness cases pass; the new cached-refresh case and the other three unaffected model-picker
cases pass. Exactly these known #205 cases fail, with no retries:

- `model-picker.spec.ts:36`: catalog model and effort publish and reach the harness (dark).
- `model-picker.spec.ts:36`: catalog model and effort publish and reach the harness (light).
- `model-picker.spec.ts:102`: a saved model removed from the catalog stays selected and explicit unknown import is rejected.
- `model-picker.spec.ts:159`: catalog failure preserves the current values until retry and loop defaults share the picker.

These are the original brief's `:28` twice, `:94` and `:151`, shifted by prior imports. The first two
receive an empty model value instead of `picker-dark` / `picker-light`; the third cannot find
the Model catalog in Settings link; the fourth times out looking for the retry button under
collapsed Advanced. They remain outside #204. The new case also passes alone
(1 passed), after failing before the fix; the full run confirms it alongside the neighboring specs.

Web coverage passes **1542 tests / 120 files** in 716.58 seconds, with **98.95% lines
(7088/7163), 95.01% branches (7280/7662)**; statements 98.04% (8132/8294), functions 98.55%
(2190/2222). No web failures required triage. Both packages exceed 90% lines and branches.

API coverage completes with **737 passed, 1 failed, 6 skipped / 744 tests**, across 55 files
(52 passed, 1 failed, 2 skipped), in 523.39 seconds. Coverage exceeds the thresholds:
**97.93% lines (1804/1842), 93.13% branches (1288/1383)**; statements 96.49% (1985/2057),
functions 94.25% (394/418).

The one failure is `src/main.test.ts:67`, **dispatches the API-key and preflight CLIs with their
real exit codes**: `Test timed out in 60000ms` (reported duration 60350 ms). This test runs four
local CLI processes, with an invalid preflight configuration to prevent provider probes. It
passes alone with the same Node 22 / temporary root and unchanged test/fixture limits: **1 passed, 8 filtered/skipped**, 15.79 seconds
for the isolated run. This is recorded as a load/environment-class failure under the brief's
triage rule, not a clean full-suite gate or a production fix. API source is unchanged; the whole
suite was not rerun to obtain a green result.

### 5. Gates

Node `v22.14.0`, `pnpm.cmd`, no threshold/timeout/exclusion changes:

| Command                                                                                                                                                                  | Round 3 result                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `pnpm.cmd typecheck`                                                                                                                                                     | Pass; 20 tasks.                                                                                                   |
| `pnpm.cmd lint`                                                                                                                                                          | Pass; 11 tasks.                                                                                                   |
| `pnpm.cmd format:check`                                                                                                                                                  | Pass.                                                                                                             |
| `pnpm.cmd check:docs`                                                                                                                                                    | Pass; generated docs are current.                                                                                 |
| `pnpm.cmd check:tokens`                                                                                                                                                  | Pass; 163 files.                                                                                                  |
| `pnpm.cmd check:layers`                                                                                                                                                  | Pass.                                                                                                             |
| `pnpm.cmd check:deps`                                                                                                                                                    | Pass; existing `drizzle.config.ts` orphan warning, zero errors.                                                   |
| `pnpm.cmd build`                                                                                                                                                         | Pass; 11 tasks.                                                                                                   |
| `pnpm.cmd --filter @graphgoblin/web exec vitest run src/editor/harness-switch.test.tsx src/editor/EditorPage.freshness.test.tsx src/editor/ValidationIndicator.test.tsx` | Pass; 42 tests / 3 files.                                                                                         |
| `pnpm.cmd --filter @graphgoblin/api test:coverage --maxWorkers=1 --coverage.reportOnFailure=true --coverage.reportsDirectory=<round3-temp>/api-coverage`                 | Coverage thresholds pass; 737 pass, 1 timeout, 6 skip. Command exits 1; isolated triage passes as recorded above. |
| `pnpm.cmd --filter @graphgoblin/api exec vitest run src/main.test.ts -t dispatches --maxWorkers=1`                                                                       | Pass; 1 test, 8 filtered/skipped.                                                                                 |
| `pnpm.cmd --filter @graphgoblin/web test:coverage --maxWorkers=2 --coverage.reportOnFailure=true --coverage.reportsDirectory=<round3-temp>/web-coverage`                 | Pass; 1542 tests / 120 files, coverage above both thresholds.                                                     |
| From `apps/web`, `GG_E2E_BROWSER_CHANNEL=msedge`, `pnpm.cmd exec playwright test e2e/claude-harness.spec.ts e2e/model-picker.spec.ts e2e/readiness.spec.ts`              | 22 pass; exactly the 4 known #205 failures above; command exits 1.                                                |

Turbo retains its Windows cache access-denied warnings despite successful tasks; PowerShell's
redirected logs wrap native stderr with `NativeCommandError`. Gate results use the native pnpm
exit code, not that log wrapper. Logs are in `%TEMP%/gg-wp-f2b-r3-*.log`.

### 6. Docs

Docs 09 describes publication being held even with cached catalog options; the status and Publish
tooltips identify the catalog retry rather than telling the user to publish to retry it. The QA
README adds the cached-background-refresh reproduction, retention/recovery expectations and
checked cleanup of its own disposable directory. The #204 CHANGELOG bullet reflects publication
being held. D-023 stays **loop default, then Settings default, then ecosystem default**; no stored
value changes, migration, schema or generated-reference changes are needed.

### 7. Decisions and parameters

The existing cached catalog remains available to the picker; its error state independently gates
validation and Publish. The same rule applies to the classifier model catalog. An ordinary failed
server validation check retains its existing Publish-to-retry behavior. No lookup starts from this
change. The browser uses the existing 2.1-second freshness wait, followed by an observed failed
background refresh; no readiness or Settings wait was added to a switch.

### 8. Caveats and open items

This round uses component fakes and the built web app against the real API's test harness; it
makes no live provider or paid turns. Standard API/browser tests keep their automatic isolated
ports (including the API suite's existing 5600-5699 subprocess fixture range). The native CLI
collector was not rerun this round; its prior 16-case evidence remains historical. The independent
QA result and designated session sign-off remain separate from this implementation evidence.

**Cleanup blocked by command policy:** all newly created temporary test stores are nested under
`%TEMP%/gg-wp-f2b-round3-da544a70206c4a838471b9b789b54f94`. All test runners and their fixtures
finished. A checked inventory found 704 files, 179 subdirectories, zero reparse points and zero
`graphgoblin.lock` files. The exact resolved path was checked against the expected path and the
system TEMP boundary before one `Remove-Item -LiteralPath ... -Recurse -Force` attempt. Automatic
policy review rejected that command before execution with **"blocked by policy"**. The root is
still present and needs removal by the orchestrator; no alternative deletion method was tried.
This leaves the brief's temp-store removal requirement unresolved. No prior-round directory or
owner app/store was touched. Flat coverage summaries were preserved separately as
`%TEMP%/gg-wp-f2b-r3-{web,api}-coverage-summary.json`, with the gate logs alongside them.
