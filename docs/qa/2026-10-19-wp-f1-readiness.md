# WP-F1 (#179): capability and readiness precision

## 1. Branch and worktree

- Branch: `codex-wp-f1-readiness-precision`.
- Worktree: `C:\Users\98jak\source\repos\GraphGoblin\.claude\worktrees\codex-wp-f1-readiness-precision`.
- Base: `0411eb9f017448ed9c4c4850981093cfeb5f1efb` (live HEAD, initially clean).
- Uncommitted. No staging, commits, publication, owner-instance changes or paid provider turns.
- Ready for orchestrator review; not ready to commit or close until the failed gates below are resolved or explicitly dispositioned.
- Independent Claude Opus 5.5 review and owner product acceptance remain required. This report does not close #179.

## 2. Per bolt: #179 / B41

### Current-state map (measured/read at the base above)

| Stage                       | Before                                                                                                                                                                                                                            | After                                                                                                                                                                                          |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude location/environment | `GG_CLAUDE_BINARY`, otherwise `%USERPROFILE%\.local\bin\claude.exe`; restricted subscription environment                                                                                                                          | Same location/environment; no model additions or installation changes                                                                                                                          |
| Claude probe                | Fresh empty temp directory; version >=2.1.285, required help flags including model/effort, hidden max-turns/help parse, local auth status; 15 seconds per command                                                                 | Same no-turn capability checks, plus explicit typed readiness and actionable diagnostics                                                                                                       |
| Codex location              | Override executable/JS launcher, otherwise SDK-bundled installed CLI                                                                                                                                                              | Same executable as execution; no provider substitution                                                                                                                                         |
| Codex probe                 | Version and login status only; old/missing-capability fixture could pass                                                                                                                                                          | Minimum tested SDK baseline 0.160.0; exec help verifies model/config/JSON/sandbox/cwd/repo-check/schema flags, resume help verifies JSON, then local login; fresh temp directory               |
| Probe reuse                 | Neither harness cached indefinitely. `modelIssues` memoized Claude only within one call; create/import/save called it twice                                                                                                       | Request-owned `ReadinessOperation` passed through both validation passes; one promise per harness, including rejection, per operation; independent requests always probe again                 |
| Admission mapping           | Claude failed probe -> warning `HARNESS_UNAVAILABLE`; Codex not probed by this path; model metadata resolved separately                                                                                                           | `HARNESS_READINESS_<STATE>` warnings allow draft saves and block publication; disabled/missing catalog issues retain existing codes                                                            |
| Public API                  | `/harness/preflight`: ok/authenticated/problems/version, optional Claude metadata. `/system/preflight`: ok/warn/fail                                                                                                              | Required harness `state`; system harness checks also carry state alongside severity; unexpected harness failures have safe fixed guidance                                                      |
| Web                         | `ready` / `not ready`; `supported by adapter` model badge. Picker phrases included `Checking Claude model availability`, `availability could not be checked`, `CLI preflight is not ready`, and a `(saved; unavailable)` fallback | Eight explicit readiness states; `listed by adapter` plus account-access limitation; checking/unknown override cached success during pending/failed refresh; saved selections survive failures |
| Classifiers/settings        | Classifier registry caches immutable clients by configuration/secret, rechecks metadata/secrets; settings routes manage catalog enablement                                                                                        | Unchanged: this bolt does not alter classifier semantics, model lifecycle, defaults on provider switches or usage recovery                                                                     |

### Boundary cases

Before evidence includes the original `cli.ts` exercised from a disposable copy through its exported `preflightCli`/`runCli`, the original route exercised through POST `/loops`, and the initial Claude executable regression run. Source observations are identified rather than presented as paid-provider evidence.

| Case                                    | Before                                                                                                          | After                                                                                   |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Claude old version / missing model flag | Already failed no-turn capability verification; this alleged gap was **not reproduced** for Claude on this base | `cli-incompatible`; detected version/capability retained, update/retry guidance         |
| Codex 0.100.0 / missing model flag      | **Confirmed:** both returned `ok:true`, authenticated, no problems                                              | `cli-incompatible`, never a model entitlement conclusion                                |
| Missing effort/config flag              | Claude already checks effort in help; Codex did not inspect exec flags                                          | Both native fixture executables return `cli-incompatible`                               |
| Pending/hanging CLI                     | Pending picker wording existed, but no typed outcome; Codex could describe timeout as CLI-run failure           | UI `checking`; bounded failed check `unknown`; no model rewrite                         |
| Authentication                          | Claude stderr/nonzero collapsed to `Claude turn failed`; Codex reported not logged in                           | `auth`, login guidance                                                                  |
| Quota                                   | Claude generic turn failure; **confirmed Codex misclassification** as not logged in                             | `quota`, account/reset guidance; selection unchanged                                    |
| Transport/temporary service             | Claude generic turn failure; **confirmed Codex misclassification** as not logged in                             | `transport`, connectivity/service guidance; selection unchanged                         |
| Unknown diagnostic                      | Generic failure                                                                                                 | `unknown`, retry/check-CLI guidance; raw CLI body omitted                               |
| Disabled model                          | `MODEL_DISABLED` from catalog metadata                                                                          | Same meaning; independent of failed auth/quota/transport probes; no lifecycle additions |
| Removed catalog identity                | `MODEL_NOT_IN_CATALOG`                                                                                          | Same meaning; failed catalog fetch is unknown rather than proof of removal              |

All 18 native fake-executable scenarios (nine per harness) passed the expected state mapping. Fixtures refuse turn commands. Evidence: [native fixture results](2026-10-19-wp-f1-native-fixtures.json), [original Codex results](2026-10-19-wp-f1-codex-before.json).

### Acceptance evidence

1. Capability truth: fake executable tests cover old/missing flags and auth/quota/transport/unknown/hang; native C# fixtures additionally cover missing effort/config. Installed no-turn probes: Claude **2.1.292 ready**, SDK Codex **0.160.0 auth**. This verifies prerequisites only, never account model access.
2. Reuse: `model-readiness.test.ts` proves one probe for multiple nodes and both create/save/import validation passes, fresh probes on subsequent and concurrent operations, and shared sanitized rejection. The original route regression failed `expected 2 to be 1`; corrected public-route tests pass.
3. Failure meaning: typed state plus distinct issue codes and safe messages; adapter execution transport errors use `HARNESS_TRANSPORT_FAILED`. Existing engine failure details preserve the adapter code; generic engine failure handling is not redesigned. Disabled/removed metadata remains separate. No fallback or automatic usage recovery.
4. Native lifetime: **measured, no orphan observed in the bounded installed no-turn samples**. See below. No process termination implementation changed.

### Native process-lifetime evidence

The first CIM collector was invalid: CIM and tasklist are denied in this managed environment, and its initial implementation did not surface stderr. Those empty snapshots were discarded and are not evidence. The corrected collector checks exit/stderr and a successful enumeration sentinel, using `Get-Process`.

Verified at `2026-10-19T07:51:40.494Z`, Node v22.14.0, in a new empty temp directory, through the product process runners:

| Harness / no-turn command                          | Disposition                                  | Before / after matching native PIDs | New survivors |
| -------------------------------------------------- | -------------------------------------------- | ----------------------------------- | ------------- |
| Claude `--help`                                    | Completed, exit 0                            | 9 / 9                               | 0             |
| Claude `--help`                                    | 1 ms deadline fired; close confirmed         | 9 / 9                               | 0             |
| Claude `--help`                                    | 1 ms cancellation requested; close confirmed | 9 / 9                               | 0             |
| Codex `exec --help` through installed SDK launcher | Completed, code 0                            | 9 / 9                               | 0             |
| Codex `exec --help` through installed SDK launcher | 1 ms timeout reported                        | 9 / 9                               | 0             |

The same pre-existing nine Claude/Codex PIDs remained in all samples. Claude exited 0 in the timeout/cancel races; these are bounded stop/close observations, not proof that forced termination won the race. Codex readiness has no cancellation interface, so no Codex readiness-cancellation claim is made. These observations do not establish model-turn or arbitrary descendant lifetime.

[Successful snapshots and probe facts](2026-10-19-wp-f1-native-lifetime.json). Reproduce after build with `node tooling/scripts/readiness-native.mjs`. No orphan fix is prescribed.

The final package-owned drivers were also exercised at `2026-10-19T09:07:24.860Z`: the same five matching native PIDs before/after each of the five samples, zero new survivors, the same Claude/Codex versions and readiness, and the same timeout/cancel dispositions. [Final driver evidence](2026-10-19-wp-f1-native-lifetime-final.json).

A separate task-owned Node sleeper confirmed `taskkill /T /F` exits 1 with `ERROR: Access denied` and leaves that exact sleeper alive in this sandbox; it was then stopped directly. The synthetic native hanging Claude fixture likewise survived the denied tree kill and was stopped by verified executable path/PID after its unknown/termination-unconfirmed result. These are real controlled-process failures, not installed-CLI orphan evidence. [Sandbox diagnostic](2026-10-19-wp-f1-taskkill.json).

A real fake-CLI timeout also exposed a Windows busy-directory cleanup race in Codex. Cleanup now preserves an already typed failed result; successful inspection with failed cleanup becomes unknown. It does not change process termination or claim to fix an orphan.

## 3. Files changed

- Contracts: required `HarnessReadinessStateSchema`/preflight state and contract tests.
- Domain: shared pure diagnostic classification and actionable messages, export and tests.
- Infrastructure/Claude: readiness mapping, ephemeral bounded diagnostic classification, typed execution transport errors, CLI fixtures/tests. `models.ts` and `policy.ts` are unchanged.
- Codex adapter: no-turn capability verification and disposable probe workspace, precise failure mapping, cleanup-result handling, fixtures/tests.
- API: request-owned memo, propagation through loop validation/create/import/save, typed system/admission responses, affected API expectations and new regression tests.
- Web: preflight/default/model-picker states, affected fixtures, component checks and `e2e/readiness.spec.ts`.
- API client: generated OpenAPI/schema and required-state fixture.
- Engine: testing fake/fixture state only; no engine execution implementation edit.
- Tooling/package scripts: native evidence orchestration and package-owned component drivers; native fake CLI C# source, PowerShell builder and API-owned public-harness fixture probe.
- Docs: docs/06, guide/07, generated API reference, CHANGELOG and this report/JSON evidence.

Shared WAVE regions: `apps/api/src/model-issues.ts` and docs/06 overlap WP-F2a. Changes concern readiness only; catalog models/policy are untouched. `apps/api/src/routes/loops.ts` changes only the readiness parameter/memo and its create/import/save call sites; import conversion behavior is untouched. The existing template-draft test's no-harness expectation changes to the new typed code. No other worker's implementation is imported or modified.

## 4. Tests

- New Claude/Codex executable boundary tests: ready, old, missing model flag, auth, quota, transport, unknown, hang; installed probes skip explicitly if binary missing. Neither installed binary was skipped here. Additional native C# cases verify missing effort/config.
- New domain diagnostics/messages and required contract-state tests.
- New public API `model-readiness.test.ts`: multi-node/multi-pass reuse, cross-request freshness/concurrency, rejection sanitization, all failure mappings, disabled/removed metadata independence.
- New component state tests, cached-ready refresh failure, and nine Edge browser checks.
- Regression evidence: eight initial Claude assertions failed because `state` was missing; original create route failed `expected 2 to be 1`; original Codex accepted old/missing-capability fixtures. A final cached-catalog refresh test reproduced `expected saved-model, received empty`; a retained checking/unknown option fixes that display regression without emitting an authored change. A timed-out Codex probe with partial quota text also failed `expected unknown, received quota`; timeout/start failure now takes precedence over partial diagnostics. The numeric-version counterexample failed `expected unknown, received auth/quota`; HTTP reasons now require explicit HTTP/status context. CLI fixtures expose controlled outputs, not live provider behavior.
- Focused API result: 67 passed. Browser result: 9 passed on Edge after build.
- Coverage/status details are finalized in the gates below. Initial over-parallel runs caused timing failures and were not treated as successful retries. No threshold or source exclusion was weakened.

## 5. Gates

All commands use Node 22.14.0 first on PATH (`$env:PATH = "$env:APPDATA\nvm\v22.14.0;$env:PATH"`). No paid readiness turns. Turbo uses this worktree's `.turbo/wp-f1-cache`; coverage runs call the package directly, avoiding Turbo dependency-cache ambiguity.

| Command                                                                                    | Final result                                                                                                       |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `pnpm.cmd typecheck --concurrency=2`                                                       | PASS, 20 tasks                                                                                                     |
| `pnpm.cmd lint --concurrency=2`                                                            | PASS, 11 tasks                                                                                                     |
| `pnpm.cmd build --concurrency=2`                                                           | PASS, 11 tasks                                                                                                     |
| `pnpm.cmd format:check`                                                                    | PASS, all matched files                                                                                            |
| `pnpm.cmd check:layers`                                                                    | PASS                                                                                                               |
| `pnpm.cmd check:deps`                                                                      | PASS, 769 modules / 2972 dependencies; existing no-orphans warning for `packages/infrastructure/drizzle.config.ts` |
| `pnpm.cmd check:tokens`                                                                    | PASS, 161 source files                                                                                             |
| `pnpm.cmd --filter @graphgoblin/api-client generate`                                       | PASS, regenerated OpenAPI/schema                                                                                   |
| `pnpm.cmd docs:generate`                                                                   | PASS; generated API reference has no resulting diff                                                                |
| `pnpm.cmd check:docs`                                                                      | PASS, generated docs up to date                                                                                    |
| `pnpm.cmd check:licenses`                                                                  | NOT RUN: no dependency or lockfile changes                                                                         |
| `pnpm.cmd exec playwright test e2e/readiness.spec.ts` (from `apps/web`, after final build) | PASS, 9 tests on installed Edge, no retries                                                                        |
| `node tooling/scripts/readiness-native.mjs`                                                | PASS, actual installed no-turn probes and five lifetime samples; bounded evidence above                            |
| `node apps/api/scripts/readiness-fixture-probe.mjs <claude-directory> <codex-directory>`   | PASS mapping, 18 native scenarios; hanging Claude fixture required exact task-owned cleanup in this sandbox        |
| `pnpm.cmd --filter @graphgoblin/tooling test:coverage`                                     | PASS, 77 tests; package command is Node's test runner and emits no coverage percentages                            |

Full package coverage commands and denominators (including failed tests, where emitted):

| Package / command after `pnpm.cmd --filter @graphgoblin/`                | Result                         | Lines                  | Branches               |
| ------------------------------------------------------------------------ | ------------------------------ | ---------------------- | ---------------------- |
| `contracts test:coverage --maxWorkers 2`                                 | PASS, 257 tests                | 99.73% (370/371)       | 94.89% (186/196)       |
| `domain test:coverage --maxWorkers 1 --coverage.reportOnFailure`         | FAIL, 541 pass / 6 fail        | 98.42% (1938/1969)     | 95.61% (2179/2279)     |
| `engine test:coverage --maxWorkers 2`                                    | PASS, 455 tests                | 98.51% (1992/2022)     | 93.08% (1575/1692)     |
| `infrastructure test:coverage --maxWorkers 2 --coverage.reportOnFailure` | FAIL, 505 pass / 6 fail        | 98.79% (1888/1911)     | 94.86% (1497/1578)     |
| `adapter-codex test:coverage --maxWorkers 1 --coverage.reportOnFailure`  | PASS, 81 pass / 4 LIVE skipped | 98.68% (301/305)       | 95.20% (298/313)       |
| `api test:coverage --maxWorkers 1 --coverage.reportOnFailure`            | PASS, 637 pass / 2 skipped     | 98.54% (1696/1721)     | 93.59% (1228/1312)     |
| `web test:coverage --maxWorkers 2`                                       | PASS, 1481 tests               | 98.93% (6991/7066)     | 94.81% (7191/7584)     |
| `api-client test:coverage --maxWorkers 1`                                | FAIL, 48 pass / 2 fail         | Not emitted on failure | Not emitted on failure |

The six domain failures are unchanged adversarial subprocess cases importing unavailable `node:module.registerHooks` on Node 22.14. The six infrastructure failures are native termination checks: one adversarial ProcessScripts child/grandchild test, two ProcessScripts timeout/abort tests, and three Claude process deadline/overflow/abort/descendant tests (timeouts, continuing marker writes and EBUSY cleanup). No threshold/exclusion or termination implementation was changed. The final Claude harness/protocol/readiness/process-failure component subset passes all 141 tests.

The API-client failures are the two real-HTTP template tests in `src/templates.test.ts`: 5-second test and 10-second cleanup timeouts. A separate built public-interface diagnostic subsequently returned injection HTTP 200, four templates over real HTTP, and completed cleanup. That diagnostic does not supersede the failed coverage gate or establish its cause. No retry-to-green claim is made.

Earlier over-parallel/older-code runs also hit offline-upgrade test timeouts in `packages/infrastructure/src/sqlite/upgrade.test.ts`. Those cases passed in the final full run after readiness fixes and lower concurrency; the earlier timing failures remain recorded and are not described as fixed by this bolt.

## 6. Docs

- `docs/06-harness-integration.md`: readiness state meanings, no-turn commands, operation memo, model-availability distinction and bounded native evidence.
- `docs/guide/07-troubleshooting.md`: action for each state and preservation of saved selections.
- `CHANGELOG.md`: Unreleased #179 bullet, including rebuild API/web together and required response `state`; no store reset.
- Regenerated `packages/api-client/openapi.json` and generated schema. `docs/reference/api.md` was regenerated with no resulting diff; `pnpm docs:generate` and `pnpm check:docs` pass.
- No ADR: this implements the approved readiness decision without changing installed-CLI architecture or model policy.

## 7. Decisions and parameters

- Readiness is CLI prerequisite health, not account model entitlement. Adapter model listings remain explicitly static.
- Codex minimum 0.160.0 is the pinned SDK baseline; a newer version must also advertise the required syntax. Help does not prove arbitrary config semantics or account access; execution retains that responsibility.
- Existing 15-second per-command product deadlines remain. Synthetic tests use that same healthy-probe deadline and a shorter intentional hang deadline; aggregate test bounds account for several commands.
- Claude process diagnostic classification retains only an ephemeral 8 KiB stderr window across chunks; model/turn stdout is never mined for failure reasons. No-turn inspection may classify its own version/help/auth stdout; this bounds untrusted diagnostics and catches split error tokens. Only explicit HTTP/status context can supply numeric HTTP reasons; version components alone are not status evidence. Only fixed cause/message text leaves preflight.
- Cache scope is a caller-owned operation, not a TTL/module cache. Rejections are cached within that operation only.
- Native stop probes use 1 ms to exercise the stop/exit race without starting a model turn; results are expressly bounded to those samples.
- Native fake CLI reads a scenario file beside itself because Claude deliberately filters arbitrary inherited environment variables. It refuses every turn command.

## 8. Caveats and open items

- Owner acceptance and independent Claude Opus 5.5 review are outstanding. Do not auto-close #179.
- No new Sonnet/Haiku models (#206), provider-switch defaults (#204), retirement lifecycle (#262), paid readiness turns, or usage recovery (#335).
- Observed outside scope: unchanged domain adversarial subprocess tests use `node:module.registerHooks` (`packages/domain/src/adversarial.test.ts:207` and related cases). Node 22.14.0 rejects that import. Six domain gate failures are recorded; no runtime upgrade/test exclusion is introduced here.
- Windows child/descendant termination tests and offline-upgrade tests have separate failures described in the final gate results. The installed no-turn observations above do not override those failures or establish arbitrary process lifetime.
- Existing broader model-picker/Claude browser failures tracked by #205/#241 were not repaired; the focused readiness browser spec passes.
- Actual retirement of a supported harness model was not performed: the current public API disallows adding/deleting harness catalog rows and adding new LiteLLM rows. Absent-identity validation and missing-catalog response fixtures establish the display/mapping behavior; lifecycle testing belongs to #262.
- Disposable test/probe directories, coverage and browser report folders are left for the orchestrator; nothing is recursively deleted.
- Raw task logs and diagnostic scratch files were moved individually to `C:\Users\98jak\AppData\Local\Temp\gg-wpf1-evidence-60f01ae9827440d6a9cdcf931a543640`; invalid initial CIM snapshots are not shipped as evidence. The durable report/JSON artifacts are under `docs/qa`.

### Owner QA in a disposable instance

1. Build with Node 22 (`pnpm.cmd build`). Use a separate PowerShell session and new empty temp directories. Never use the owner app/store at 4747/4748.
2. Create two native fake CLIs (Windows PowerShell/.NET compiler; no download):

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File tooling/scripts/readiness-fake-cli.ps1 -Directory "$env:TEMP\gg-wpf1-owner-claude" -Harness claude
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File tooling/scripts/readiness-fake-cli.ps1 -Directory "$env:TEMP\gg-wpf1-owner-codex" -Harness codex
   ```

   The builder refuses a nonempty directory. Choose new names if they exist. `-ExecutionPolicy Bypass` applies to that task-script process only.

3. In the disposable API terminal, prepend those two directories to PATH and explicitly set `GG_CLAUDE_BINARY=claude.exe` and `GG_CODEX_BINARY=codex.exe`. PATH alone does not replace Claude's normal absolute default or Codex's bundled default. Set `GG_DATA_DIR` to another new temp directory, `GG_PORT=5651` (or another free 5600-5699 port), and `GG_WEB_DIST` to this worktree's `apps/web/dist`. Start `node apps/api/dist/main.js`; open `/app/settings` on that disposable port.
4. Change only each fake directory's `scenario.txt`, then reload Settings or retry preflight:

   | File value                               | Expected                                                            |
   | ---------------------------------------- | ------------------------------------------------------------------- |
   | `ready`                                  | ready; models are listed by adapter, with account-access limitation |
   | `old`, `missing-model`, `missing-effort` | cli-incompatible, update/retry guidance                             |
   | `hang`                                   | checking while pending; unknown after deadline                      |
   | `auth`                                   | auth, login guidance                                                |
   | `quota`                                  | quota, allowance/reset guidance; saved model unchanged              |
   | `transport`                              | transport, connectivity/service guidance; saved model unchanged     |
   | `unknown`                                | unknown; no supported/unsupported conclusion                        |

   To see cli-missing, start a disposable instance with that binary option pointing at a nonexistent executable. No fixture accepts a prompt or turn command.

5. With scenario ready, disable a catalog model in Settings: its saved selection is disabled/unavailable and validation returns `MODEL_DISABLED`. Re-enable it to restore catalog availability. To check an absent identity, copy a valid definition, change only its model to `removed-model`, and POST it to `/loops/:id/validate`: expect `MODEL_NOT_IN_CATALOG`. POST `/loops` with that definition rejects admission. To see the picker preserve a saved value missing from a successful catalog response, run `pnpm.cmd --filter @graphgoblin/web exec vitest run src/forms/fields/model.test.tsx` (the missing-entry and cached-refresh response fixtures). The public API deliberately refuses adding/deleting harness catalog rows; do not modify supported seed models or invent a retirement workflow for this bolt.
6. For multi-node reuse, use create/save/import/validate through the API with several inference nodes. With Settings closed to avoid unrelated focus refetches, count `--version` entries appended to each fake's `probes.log`: one per referenced harness per operation, even when create/save performs both admission and response validation. Change scenario between requests; the next request must see the new cause. Draft saves remain possible; publication is blocked while not ready.
7. Inspect `/harness/preflight` and `/system/preflight` to compare typed state and system severity. Keep model/effort values unchanged during auth/quota/transport failures; no substitution should occur. Do not start a model run for this QA.
8. Optionally reproduce controlled native cases with `node apps/api/scripts/readiness-fixture-probe.mjs <claude-directory> <codex-directory>`, and installed no-turn lifetime with `node tooling/scripts/readiness-native.mjs`. Keep the data/report folders for review; stop only the disposable API when finished.
