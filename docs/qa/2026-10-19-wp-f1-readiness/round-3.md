# WP-F1 round 3 (#179)

## 1. Branch and worktree

`codex-wp-f1-readiness-precision`, worktree `.claude/worktrees/codex-wp-f1-readiness-precision` under the GraphGoblin checkout, base `ea2b152e653f7f1a50808696fbbdd6380712c78c`. Uncommitted; ready for orchestrator commit after independent review. No index changes, provider turns, or owner-instance access.

## 2. Per bolt

All six round-3 items belong to #179:

1. Transport detail is now **"Claude reported a connection or provider service error."** or **"Codex reported a connection or provider service error."** The action remains **"Check the network connection and the provider's service status, then retry preflight."** HTTP 500 establishes a service error, without establishing a connectivity diagnosis. Domain, API, component and browser assertions pin this copy.
2. Public-route regression `preserves quota detail with empty probe problems through validation, system preflight and run rejection` supplies `{ state: 'quota', ok: false, problems: [] }` through the harness port. Validation and system preflight retain **"Claude account usage limit reached. Wait for the usage limit to reset, then retry preflight."** Run admission returns 422 `HARNESS_NOT_READY`, a `HARNESS_READINESS_QUOTA` issue with that message, and **"Harness readiness checks failed. Fix the listed problems, then start the run again."** Zero turns start.
3. [Owner QA](README.md#owner-qa-disposable-instance-no-turns) now expands Advanced before Model, explains the actual command/shutdown bounds, and distinguishes an existing Codex failure during Retry from a previously ready result being rechecked.
4. Web full-run and file-only disposition is recorded below. No timeout, threshold or unrelated test was changed.
5. CLI syntax is tested before connection evidence. Both network-option diagnostics below are `cli-incompatible`; connection evidence still precedes authentication words.
6. The real signed-out Claude test removes only its own temporary home in `finally`, including assertion/probe failure paths, using `rm(home, { recursive: true, force: true })`.

| Diagnostic                                                 | Before                                    | After                                            |
| ---------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------ |
| `error: unknown option '--network-access'`                 | `transport`                               | `cli-incompatible`                               |
| `error: unexpected argument '--network' found`             | `transport`                               | `cli-incompatible`                               |
| `Failed to connect to authentication server: ECONNREFUSED` | `transport`                               | `transport`                                      |
| `API Error: 500 Internal server error`                     | `transport` with a connectivity diagnosis | `transport` with the service-error wording above |

The pipeline, native-process evidence and original boundary matrix remain in [the earlier report](README.md). This round changes classification order and copy, not probe execution or process termination. The prior disposable draft-save timing remains historical evidence; no new timing claim is made here.

## 3. Files changed

- Domain: `packages/domain/src/readiness.ts` moves CLI syntax ahead of network matching and changes the transport detail to the exact Claude/Codex sentences in section 2.
- Domain: `packages/domain/src/readiness.test.ts` adds both network-option cases and exact transport messages for both harness names.
- Infrastructure: `packages/infrastructure/src/claude/readiness.test.ts` updates its transport expectation and guarantees signed-out-home cleanup.
- API: `apps/api/src/model-readiness.test.ts` pins transport copy and empty-problems quota behavior through public validation, system-preflight and run routes; production API fallbacks are unchanged.
- Web: `apps/web/src/settings/SettingsPage.test.tsx` updates only the Codex transport expectation.
- Web: `apps/web/e2e/readiness.spec.ts` pins the exact Claude transport message; no visual component changed.
- Docs: `docs/06-harness-integration.md` documents the new service-error detail and unchanged action.
- Docs: `docs/09-frontend-and-pwa.md` documents that copy and Codex failure-note retention during Retry.
- Docs: `docs/guide/06-settings-and-secrets.md` gives the exact new transport detail and existing action.
- Docs: `docs/guide/07-troubleshooting.md` explains that copy covers provider HTTP 500 as well as connection failures.
- QA: `docs/qa/2026-10-19-wp-f1-readiness/README.md` updates Advanced/Model, timing bounds, Retry behavior, permitted ports and the round-3 report link.
- QA: `docs/qa/2026-10-19-wp-f1-readiness/round-3.md` records this round's evidence and gate disposition.
- Changelog: `CHANGELOG.md` extends the existing Unreleased #179 bullet with service-error wording and CLI-syntax precedence.

API and web edits are small cross-package regression/string edits explicitly assigned in this brief; no protected visual component or unrelated test is edited.

## 4. Tests

Before the domain fix, the new readiness tests produced **3 failures / 17 passes**: both option strings returned `transport` instead of `cli-incompatible`, and the exact transport message differed. With the fix, all **20 tests pass**.

The empty-problems public-route test first passed on the preserved-state baseline. Each fallback was then restored independently and temporarily: `readinessMessage(harness, preflight.state)` in model-issues became `readinessMessage(harness, 'unknown')`, then, in a separate run, `readinessMessage(id, result.state)` in system preflight became `readinessMessage(id, 'unknown')`. Each run failed exactly the new test (1 failed / 15 skipped), at validation and system preflight respectively: the received message was **"Claude readiness could not be confirmed. Check that the Claude CLI starts and responds, then retry preflight."** Each file was restored byte-for-byte in `finally` before further gates. The fixed full-file/API result is recorded below.

| Package        | Full-run tests                                            | Lines              | Branches           |
| -------------- | --------------------------------------------------------- | ------------------ | ------------------ |
| Domain         | 551 passed / 6 failed (557); 26 files passed / 1 failed   | 98.43% (1951/1982) | 95.64% (2198/2298) |
| Infrastructure | 508 passed / 9 failed (517); 34 files passed / 5 failed   | 98.80% (1896/1919) | 94.74% (1531/1616) |
| API            | 642 passed / 2 skipped (644); 40 files passed / 2 skipped | 98.55% (1703/1728) | 93.50% (1238/1324) |
| Web            | 1498 passed (1498); 118 files passed                      | 98.97% (7021/7094) | 95.01% (7183/7560) |

Domain file-only triage: `src/adversarial.test.ts` has the same 6 failures / 35 passes. The concrete error is `SyntaxError: The requested module 'node:module' does not provide an export named 'registerHooks'` under Node 22.14.0 (D-015).

Infrastructure full-run failures: one adversarial process-tree timeout, three Claude native-process cases (busy directory cleanup and a descendant still writing), the hanging readiness detail, two ProcessScripts termination timeouts, and two existing SQLite upgrade timeouts. The readiness state remains `unknown`, but the received detail is **"Claude CLI check process did not confirm that it stopped."** instead of the expected deadline detail. Real installed ready and disposable signed-out Claude probes pass, including the new `finally` cleanup. No process-handling fix is claimed from a sandbox result.

Every failed infrastructure file was run alone after the full coverage/static/build runs finished:

| File                           | Full-run failed tests                    | File-only result                                                                           |
| ------------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------ |
| `src/adversarial.test.ts`      | 1 process-tree timeout                   | 19 passed / 1 failed, same 30-second timeout                                               |
| `src/claude/process.test.ts`   | 3 termination/descendant cases           | 2 passed / 3 failed, same marker/EBUSY evidence                                            |
| `src/claude/readiness.test.ts` | 1 hang-detail mismatch                   | 11 passed / 1 failed, same unconfirmed-shutdown detail; both installed no-turn probes pass |
| `src/process/scripts.test.ts`  | 2 termination timeouts                   | 10 passed / 2 failed, same 15-second timeouts                                              |
| `src/sqlite/upgrade.test.ts`   | 2 existing tests timed out at 20 seconds | 26 passed, 17.70 seconds for the whole file                                                |

The seven native-process-related failures reproduce alone and remain in the sandbox/D-015 disposition. The two SQLite timeouts are load-sensitive, outside this patch, and **remain full-run failures** despite the isolated pass. No unrelated test was changed; no full suite was rerun. Windows process-list access through CIM also reports Access denied in this sandbox; this round makes no new unsandboxed process-lifetime claim.

The requested single full web coverage run **passes all 1,498 tests in 118 files**, with **zero timeouts** (989.90 seconds). No file-only web run is therefore required or performed. This result is separate from the review's earlier 1,495-pass / three-timeout run; no retry-to-green claim is made. No timeout, unrelated test, worker-isolation setting, exclusion or threshold was changed. This run bounded concurrency to two workers.

## 5. Gates

All commands use Node 22.14.0 first on PATH and `pnpm.cmd`. Coverage uses bounded workers and reports coverage even on failure; no exclusions or thresholds change.

| Exact command                                                                                           | Result                                            |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `pnpm.cmd check:layers`                                                                                 | PASS                                              |
| `pnpm.cmd check:deps`                                                                                   | PASS; existing no-orphans warning                 |
| `pnpm.cmd check:docs`                                                                                   | PASS; generated docs current                      |
| `pnpm.cmd check:tokens`                                                                                 | PASS                                              |
| `pnpm.cmd --filter @graphgoblin/domain test:coverage --maxWorkers 1 --coverage.reportOnFailure`         | FAIL; 551 passed / 6 known registerHooks failures |
| `pnpm.cmd --filter @graphgoblin/infrastructure test:coverage --maxWorkers 2 --coverage.reportOnFailure` | FAIL; 508 passed / 9 failures, triaged above      |
| `pnpm.cmd --filter @graphgoblin/api test:coverage --maxWorkers 1 --coverage.reportOnFailure`            | PASS; 642 passed / 2 skips                        |
| `pnpm.cmd typecheck --concurrency=2`                                                                    | PASS; 20 tasks                                    |
| `pnpm.cmd lint --concurrency=2`                                                                         | PASS; 11 tasks                                    |
| `pnpm.cmd build --concurrency=2`                                                                        | PASS; 11 tasks                                    |

| Exact command                                                                                                               | Result                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `pnpm.cmd --filter @graphgoblin/web test:coverage --maxWorkers 2 --coverage.reportOnFailure`                                | PASS; 1498 tests; one full invocation                                                                       |
| `pnpm.cmd --filter @graphgoblin/domain exec vitest run src/readiness.test.ts --maxWorkers 1`                                | Before: 3 failed / 17 passed; fixed: 20 passed                                                              |
| `pnpm.cmd --filter @graphgoblin/api exec vitest run src/model-readiness.test.ts -t "preserves quota detail" --maxWorkers 1` | Baseline: 1 passed / 15 skipped; each temporary old fallback: 1 failed / 15 skipped; fixed in full API pass |
| `pnpm.cmd --filter @graphgoblin/domain exec vitest run src/adversarial.test.ts --maxWorkers 1`                              | FAIL; same 6 registerHooks failures / 35 passed                                                             |

| Exact command                                                                                               | Result                              |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run src/adversarial.test.ts --maxWorkers 1`      | FAIL; 19 passed / 1 timeout         |
| `pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run src/claude/process.test.ts --maxWorkers 1`   | FAIL; 2 passed / 3 failures         |
| `pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run src/claude/readiness.test.ts --maxWorkers 1` | FAIL; 11 passed / 1 detail mismatch |
| `pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run src/process/scripts.test.ts --maxWorkers 1`  | FAIL; 10 passed / 2 timeouts        |
| `pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run src/sqlite/upgrade.test.ts --maxWorkers 1`   | PASS; 26 tests                      |

After the successful build, from `apps/web`, with `GG_E2E_BROWSER_CHANNEL=msedge` and retries explicitly disabled:

| Exact command                                                                                                                                            | Result                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `pnpm.cmd exec playwright test e2e/readiness.spec.ts --retries=0 --reporter=list,json --output=../../.tmp/wp-f1-round3/edge-readiness-results`           | PASS; 9 tests                       |
| `pnpm.cmd exec playwright test e2e/claude-harness.spec.ts:77 --retries=0 --reporter=list,json --output=../../.tmp/wp-f1-round3/edge-claude-77-results`   | PASS; 1 test                        |
| `pnpm.cmd exec playwright test e2e/claude-harness.spec.ts:159 --retries=0 --reporter=list,json --output=../../.tmp/wp-f1-round3/edge-claude-159-results` | FAIL; 2 known #205 cases            |
| `pnpm.cmd exec playwright test e2e/claude-harness.spec.ts:220 --retries=0 --reporter=list,json --output=../../.tmp/wp-f1-round3/edge-claude-220-results` | PASS; 1 test                        |
| `pnpm.cmd exec playwright test e2e/claude-harness.spec.ts:278 --retries=0 --reporter=list,json --output=../../.tmp/wp-f1-round3/edge-claude-278-results` | PASS; 1 test                        |
| `pnpm.cmd exec playwright test e2e/claude-harness.spec.ts:343 --retries=0 --reporter=list,json --output=../../.tmp/wp-f1-round3/edge-claude-343-results` | PASS; 1 test                        |
| `pnpm.cmd exec playwright test e2e/claude-harness.spec.ts:410 --retries=0 --reporter=list,json --output=../../.tmp/wp-f1-round3/edge-claude-410-results` | PASS; 1 test                        |
| `pnpm.cmd exec playwright test e2e/model-picker.spec.ts --retries=0 --reporter=list,json --output=../../.tmp/wp-f1-round3/edge-model-picker-results`     | FAIL; 4 known #205 cases / 2 passed |

Edge total: **16 passed / exactly 6 known #205 failures**, zero flaky results or skips. All 22 requested cases ran. The six are `claude-harness.spec.ts:159` twice, `model-picker.spec.ts:28` twice, `:94` and `:151`; no additional browser failures. The Claude tests are selected in six fresh-backend groups to keep every listener within 5624-5629. `e2e/server.ts` was restored byte-for-byte after the checks and has no final diff.

No contract/client regeneration or licence check is needed: schemas and dependencies are unchanged. `pnpm.cmd format:check` and `git diff --check` both pass. The production API fallback files and temporary E2E server also have no final diff.

## 6. Docs

Numbered docs 06 and 09, guides 06 and 07, owner QA and the existing Unreleased #179 bullet are updated. No contract or route schema changed; no generated contract/client changes or ADR are needed. Generated-doc consistency is still checked as requested.

## 7. Decisions and parameters

- Retain broad connection diagnostics for provider/errno messages, but recognize positive CLI syntax first so flag names are not mistaken for network failures.
- Keep the existing action verbatim. The UI badge remains Connection failed; changing visual labels is outside this round's string scope.
- Timing comes from `claude/harness.ts` (15,000 ms per command), `claude/process.ts` (up to 5,000 ms shutdown confirmation), and Codex `harness.ts` / `cli.ts` (15,000 ms per command, no separate confirmation wait). Earlier commands contribute their own elapsed time. These are existing implementation bounds, not a new whole-operation deadline.
- Edge tests use fake harnesses only, with a temporary local test-server port constraint to 5624-5629. The original test-server source is restored after the checks; each Claude test group gets a fresh backend so extra instances fit within that range.

## 8. Caveats and open items

- Domain and infrastructure coverage percentages exceed the unchanged thresholds, but their full test gates fail as detailed above; the two isolated SQLite passes do not erase the full-run timeouts.
- Owner product acceptance and independent review remain required. No paid provider turns were run; real CLI checks were version/help/auth-status only. Browser runs use fake harnesses.
- Existing Defaults asymmetry, D-017 run-start behavior and #243 engine error mapping remain outside scope.
- Coverage, ignored scratch logs and browser traces remain for the orchestrator. No manual directory cleanup was attempted; the signed-out test removes its own newly created home as explicitly required by this brief.
- Turbo emitted nonfatal `IO error: Access is denied. (os error 5)` warnings, but typecheck, lint and build all exited 0. Dependency checking reports the existing `drizzle.config.ts` no-orphans warning; no dependency rule changed.
- The Edge gate retains exactly the six known #205 failures listed above; no browser timeout or unrelated test was changed, and no retries were used.

For #243, `packages/engine/src/handlers/inference.ts:207-211` still maps `HARNESS_TRANSPORT_FAILED` to run `HARNESS_TURN_FAILED`, retaining the adapter code in details. No engine change was made. No commit was created.
