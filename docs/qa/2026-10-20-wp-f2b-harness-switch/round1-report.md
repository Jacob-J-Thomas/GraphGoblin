# Historical round 1 report

The following records the first brief. Round 2 and D-023 supersede its default order and
inheritance/loading behavior; see [the current report](report.md).

# WP-F2b delivery report (#204)

Implementation and verification are recorded below. Independent review, independent QA and owner acceptance remain required before merge.

## 1. Branch and worktree

- Branch: `codex-wp-f2b-harness-switch`.
- Worktree: `<local>\source\repos\GraphGoblin\.claude\worktrees\codex-wp-f2b-harness-switch`.
- Base/unchanged HEAD: `453aee676882f188429080e948dcd7918f09adfd`, stacked on `codex-wp-f1-readiness-precision` per D-009. WP-F1 is pending owner acceptance.
- Uncommitted; ready for orchestrator commit after review. No commit, index mutation, push, merge, rebase, stash or branch switch was performed.

## 2. Per bolt

### #204 / B42: confirmed baseline and implemented authoring correction

1. **Explicit switches choose compatible defaults.** `useHarnessSwitch` is called only by the node editor's explicit `harness` action. It writes model and effort in the same undoable node update, retains focus on either destination harness radio, and preserves the existing safe Claude policy reset. Ten component direction/default cases cover Settings, loop, absent, disabled and disabled-Settings-with-loop defaults. Separate cases cover supported effort preservation, unavailable defaults, missing compatible effort, invalid defaults and lookup failures. The browser covers both switch directions and the actual save/reload/publish/run flow.
2. **Disabled preferences and failure truth.** Only enabled catalog rows are candidates; Claude candidates also intersect the ready adapter's listed model/effort capabilities. Missing, failed and paused lookups preserve authored model/effort and show a notice. The event reads the query cache itself so a just-failed cached refetch cannot use an older successful render. Recovery alone never changes authored fields. Both native disabled cases read back the disabled preference before fixture restoration. Separate ready/unready browser GET fixtures retain a loaded incompatible saved model without a harness action; normal API writes correctly reject explicit wrong-harness values.
3. **Persistence and request agreement.** The component cases save and reopen; Edge reloads a real saved/published definition; both API tests save, GET the draft, validate without issues, publish and inspect the destination FakeHarness's exact request. The built-app native collector confirms eight scenarios, six successful published/reopened executions and six matching real adapter-to-fake-CLI requests. See [native-after.json](native-after.json). This is controlled native process evidence, not provider entitlement or a paid turn.

[before.md](before.md) and [native-before.json](native-before.json) record the built baseline: all configured/absent/disabled switches kept the previous provider's ID; HTTP 503 catalog failures correctly kept authored values. The production correction was made only after this reproduction.

## 3. Files changed

All shared-file edits are listed below using final worktree line ranges. The picker, editor, readiness-neighbor browser files, numbered docs, guide and CHANGELOG are integration surfaces; no F1 readiness vocabulary/refetch code, F2a model membership/efforts, or F4 engine/turn path was changed.

| Shared file                                     | Changed line ranges                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `CHANGELOG.md`                                  | 7-8                                                                                         |
| `apps/web/src/forms/fields/model.tsx`           | 3-3, 8-8, 11-11, 15-15, 23-99                                                               |
| `apps/web/src/editor/NodeEditorDialog.tsx`      | 3-3, 47-47, 168-170, 295-296, 298-298, 309-309, 319-319, 321-327, 330-332, 335-345, 570-574 |
| `apps/web/src/editor/NodeEditorDialog.test.tsx` | 849-849, 902-902, 911-916, 918-919                                                          |
| `apps/web/e2e/claude-harness.spec.ts`           | 102-102, 107-108, 121-131, 168-168, 193-193, 199-199, 201-203, 219-228, 580-622             |
| `apps/web/e2e/model-picker.spec.ts`             | 3-11, 365-421                                                                               |
| `docs/06-harness-integration.md`                | 427-446                                                                                     |
| `docs/09-frontend-and-pwa.md`                   | 541-541, 676-695                                                                            |
| `docs/guide/06-settings-and-secrets.md`         | 297-316                                                                                     |

New files by package:

- Web: `apps/web/src/editor/harness-switch.test.tsx` (19 component cases); `apps/web/e2e/harness-switch-native.mjs` (retained reproducible collector).
- API: `apps/api/src/harness-switch.test.ts` (two public-route/FakeHarness integration cases). Existing `model-issues.ts` and catalog/default/loop routes already agree with explicit compatible values; regression evidence required no API production change.
- Tooling: `tooling/fixtures/model-switch-cli.cs` and `tooling/scripts/model-switch-fake-cli.ps1` (Windows PowerShell 5.1 builder; local synthetic CLIs, no provider calls).
- QA: this report, [owner README](README.md), [before record](before.md), and before/after native JSON under this directory.

## 4. Tests

**Before/after regression:** the before component run produced nine behavior failures and one lookup-notice synchronization failure (10 failed / 1 passed). Example: `Expected ... claude-fable-5-1; Received ... gpt-6-astra`; the reverse direction likewise retained the old Claude ID. The synchronization assertion was corrected to await the completed lookup after the form remount. The final expanded component suite passes 19/19. Its cached-refetch case then exposed a real stale-render action window (expected preserved `gpt-6-astra`, received `claude-opus-5-5`); the event-time cache guard closes it and the case passes.

- `harness-switch.test.tsx`: 19/19 passed after the final production guard.
- API `harness-switch.test.ts`: 2/2 passed in isolation and included in the coverage run.
- Native collector: 8/8 scenarios; 6/6 succeeded runs, save/reopen checks and exact model/effort requests; 2/2 disabled preferences retained.
- Edge (installed `msedge`, retries zero): 21 passed / 4 known #205 failures, reproduced again after the final production build. Both rewritten explicit-switch cases and both loaded-incompatible cases pass.

| Known #205 failure                                         | Brief/baseline coordinate  | Final coordinate           |
| ---------------------------------------------------------- | -------------------------- | -------------------------- |
| Catalog model/effort publish and reach harness, dark       | `model-picker.spec.ts:28`  | `model-picker.spec.ts:36`  |
| Catalog model/effort publish and reach harness, light      | `model-picker.spec.ts:28`  | `model-picker.spec.ts:36`  |
| Saved model removed from catalog / explicit unknown import | `model-picker.spec.ts:94`  | `model-picker.spec.ts:102` |
| Catalog failure / loop defaults share picker               | `model-picker.spec.ts:151` | `model-picker.spec.ts:159` |

These remain unchanged functional failures concerning controls under Advanced; they are not accepted by retry. The earlier two `claude-harness.spec.ts:159` failures are resolved by the rewritten #204 rule (now line 168).

| Package | Full-run result                                                | Lines              | Branches           |
| ------- | -------------------------------------------------------------- | ------------------ | ------------------ |
| API     | 701 passed, 1 failed, 6 skipped; one native worker error       | 97.17% (1790/1842) | 91.89% (1270/1382) |
| Web     | 1518 passed, 1 failed (1519); 118 passed files / 1 failed file | 98.96% (7055/7129) | 95.03% (7232/7610) |

Coverage thresholds and exclusions are unchanged. API skip guards are existing LIVE/PERF/platform guards; no paid turn was enabled.

**Individual failure triage:** API `adversarial.test.ts:184` (ADV-008 scope matrix) exceeded its unchanged 20 s limit under full coverage/load, then passed alone (test time within the existing limit). `qa.test.ts` had worker exit `3221225477` (native access violation); the same whole file passed 10/10 alone. These are recorded as load/native-worker environment classes; the full run stays failed. This is not a claim that an isolated pass makes that gate green. D-015's native tree-kill denial is a separate established class and was not a demonstrated cause of this worker access violation.

An early web coverage attempt was interrupted because the production cached-refetch guard had changed during the run; the final complete run used the final production logic. Its two failures, `DecisionAuthoring.test.tsx:127` and `:197`, each passed alone. The final full run reported only `EditorPage.test.tsx:1042` (assertion at line 1077): the `The server has a newer draft` notice was still present immediately after Discard it. That case passed alone without a timeout or code change. This is a timing/load symptom; the root cause is not established by an isolated pass. Full-run outcomes remain recorded rather than retried away.

## 5. Gates

All commands used Node 22.14.0 first on PATH and `pnpm.cmd`. Direct package coverage avoids Turbo cache reuse. Shared Turbo cache writes emitted sandbox access-denied warnings; commands still executed.

| Command                                                                                                                                                                       | Result                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm.cmd typecheck --concurrency=2`                                                                                                                                          | PASS, 20 tasks                                                                                                                                                                                  |
| `pnpm.cmd --filter @graphgoblin/web typecheck`                                                                                                                                | PASS after the typed browser fixture correction                                                                                                                                                 |
| `pnpm.cmd lint --concurrency=2`                                                                                                                                               | PASS, 11 tasks                                                                                                                                                                                  |
| `pnpm.cmd format:check`                                                                                                                                                       | PASS, all matched files                                                                                                                                                                         |
| `pnpm.cmd check:docs`                                                                                                                                                         | PASS; generated references up to date                                                                                                                                                           |
| `pnpm.cmd check:tokens`                                                                                                                                                       | PASS, 162 files                                                                                                                                                                                 |
| `pnpm.cmd check:layers`                                                                                                                                                       | PASS                                                                                                                                                                                            |
| `pnpm.cmd check:deps`                                                                                                                                                         | PASS, 804 modules / 3202 dependencies, zero errors; existing `drizzle.config.ts` orphan warning. Initial concurrent scan raced changing Playwright trace resources (ENOENT); stable scan passed |
| `pnpm.cmd --filter @graphgoblin/api test:coverage --maxWorkers 1 --coverage.reportOnFailure`                                                                                  | FAIL as recorded above; both coverage thresholds pass                                                                                                                                           |
| `pnpm.cmd --filter @graphgoblin/web test:coverage --maxWorkers 2 --coverage.reportOnFailure`                                                                                  | FAIL, one timing-sensitive device-draft assertion; both coverage thresholds pass                                                                                                                |
| `pnpm.cmd build --concurrency=2`                                                                                                                                              | PASS, 11 tasks after final production changes                                                                                                                                                   |
| `GG_E2E_BROWSER_CHANNEL=msedge pnpm.cmd --filter @graphgoblin/web exec playwright test e2e/claude-harness.spec.ts e2e/model-picker.spec.ts e2e/readiness.spec.ts --retries=0` | 21 passed / the four known #205 failures                                                                                                                                                        |
| `GG_SWITCH_EXPECT_FIXED=1 pnpm.cmd --filter @graphgoblin/web exec tsx --conditions=development e2e/harness-switch-native.mjs`                                                 | PASS, controlled built-app native evidence above                                                                                                                                                |

Every observed coverage failure is triaged individually with `vitest run <file>:<line> --maxWorkers 1`, or the whole `qa.test.ts` file for its native worker crash. No timeouts, thresholds or assertions were weakened. No dependency changed, so license checking was not required. Node schema and route contracts did not change, so no regenerated contract/client/reference artifacts were needed.

## 6. Docs

- Docs 06/09 and guide 06 describe the explicit switch, Settings-before-loop authoring precedence, ecosystem sources, compatible effort preservation and failure/recovery behavior. Docs/09's former claim that harness changes never rewrite fields is corrected.
- CHANGELOG has one new Unreleased bullet ending `(#204)`. No stored value changes or upgrade/reset are required.
- [README.md](README.md) is a self-contained owner acceptance procedure: Node 22, build, disposable `%TEMP%/gg-wp-f2b-*` data, ports 5830-5839, fake binary environment variables, exact clicks, expected model/effort values, save/reload/publish/run checks, real-CLI differences, stop and cleanup.
- No new ADR: this implements the already decided #204 rule and D-009 stacking rule, without changing runtime inheritance.

## 7. Decisions and parameters

- Configured model preference is **Settings, then loop**, independently for the destination harness, as this brief specifies. Settings is fetched through the existing public owner-settings query and parsed with `HarnessDefaultsSchema`; loop defaults come from the current editor definition.
- Ecosystem model IDs mirror the supported adapter defaults: Codex `gpt-6-luna` (`adapter-codex/src/harness.ts`), Claude `claude-opus-5-5` (`infrastructure/src/claude/models.ts`). They must still be enabled members of the fetched catalog. No catalog order or arbitrary first enabled entry is used.
- A supported authored effort stays. Otherwise effort preference is compatible Settings, compatible loop, then selected catalog `defaultEffort`; Claude also checks the adapter's listed efforts. A missing compatible effort preserves both authored values and explains the problem.
- Snapshot selection happens only at the explicit action. The cache is read at action time to refuse a just-failed lookup; preflight vocabulary and background-refetch behavior stay F1-owned. No queued action runs after recovery.
- Runtime node/loop/owner/process inheritance is unchanged. There is no engine or adapter fallback change, stored migration, disabled-entry re-enablement, model addition or effort-catalog change.
- Native collector startup/run observation budgets are 600 checks at 100 ms (up to 60 s plus request time), with a 15 s browser action budget; they are fixture observation limits, not product defaults or owner-approved execution limits. The collector asserts successful completion rather than treating observation expiry as a pass.

## 8. Caveats and open items

- Independent cross-provider review, bounded real provider turns (D-005), independent QA and owner running-product acceptance remain outstanding. This is implementation evidence, not acceptance or merge authorization.
- #205 is separate; its four browser failures remain exactly as listed. Model/effort remain under Advanced in this worktree.
- WP-F2a catalog membership is intentionally untouched. This base contains Opus/Fable; it does not claim Sonnet/Haiku verification or integration.
- Full coverage failures are retained with isolated triage evidence and are not called green. API has the scope-matrix timeout and native worker error; web has the device-draft notice assertion. Each affected case/file passed alone; authoritative review/CI must still assess the full-run failures.
- The named paging QA example was absent in this base; the owner README follows the existing readiness QA handoff structure and includes its own complete startup/acceptance/stop procedure.
- Manual/native work used port 5830 and prefixed disposable data. Existing API/E2E fixtures retained their standard automatic isolated ports/temp paths. The owner's ports 4747/4748, store and checkout were never operated on.
- Disposable directories, coverage and Playwright result directories are retained for owner/orchestrator cleanup; no manual directory deletion or dependency symlink/junction was attempted.
