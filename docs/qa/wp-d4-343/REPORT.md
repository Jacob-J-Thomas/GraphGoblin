# WP-D4 / #343 implementation report

## 1. Branch and worktree

Branch `codex-wp-d4-343`, worktree `%USERPROFILE%\source\repos\GraphGoblin\.claude\worktrees\codex-wp-d4-343`, base `88d6118da96f28cf4fa7b3278f6f3189fcfc0cb7`. Uncommitted; ready for orchestrator commit, subject to the gate failures below. No index changes, commits, GitHub writes, provider model turns, owner-store operations or operations on ports 4747/4748 were performed. New restart fixtures use `gg-wp-d4-` stores and ports 5750–5759.

Evidence files in this directory are supplied for the orchestrator to commit with the implementation. They are not represented as already committed. This is implementation evidence, not opposite-vendor review, independent QA, Astra audit or merge sign-off.

## 2. Per bolt

Only #343 is implemented.

| Criterion                                                                        | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. One explicit, owned, eligible destination; typed refusals                     | `apps/api/src/targeted-events.test.ts`: missing target, malformed/absent/foreign loop, insufficient scope, unpublished version, mismatched entry/type, ambiguous entries and explicit disambiguation. No broadcast fallback remains.                                                                                                                                                                                      |
| 2. Receipt, exact target and stable identity precede 202; restart recovers       | Public API faults before inbound/receipt insertion return 503 and leave neither row. Four atomic run-admission failure points retain one pending intent. `apps/api/src/targeted-events-restart.test.ts` kills the built API before a receipt, while pending before run creation, and after run admission, then starts a new process on the same SQLite file.                                                              |
| 3. Keyed retries and recovery reuse one delivery/run; recipients are independent | Eight concurrent same-key requests return one Event ID; changed-payload retry returns the original admission and run link. Identical keys for two loops and two explicit trigger nodes are independent. Restart verifies one allocated run and one sequence-1 queued event.                                                                                                                                               |
| 4. Independent starts use configured capacity                                    | Public API test configures capacity two and two delayed fake harness turns; both runs are observed running before either finishes. This is controlled scheduling evidence, not a live-provider claim.                                                                                                                                                                                                                     |
| 5. Truthful states, bounded failures and existing repeat rules                   | Public API tests cover pending, admitted, deduplicated, failed, eight-attempt exhaustion, immutable accepted version, malformed saved intent without rewriting it, and repeated unkeyed inputs. Receipt state and run links are read together. The existing Events page already renders these states; its source is unchanged.                                                                                            |
| 6. Webhook URL contracts and retired chaining remain intact                      | `triggers.test.ts` retains URL/authentication/Allow/key/receipt checks; the targeted suite checks fixed `{accepted:true}` acknowledgement and two identical unkeyed webhook bodies producing two runs. The adversarial external-Event test now targets one loop while retaining rejection of exit-to-Event chaining. The deliberate nesting refusal is the only new webhook refusal. No issue relationships were changed. |

The 997-level Event and webhook cases are refused before persistence with 422, bounded typed diagnostics and warning logs. The shared receipt boundary is tested: depth 994 produces `json_valid(intent)=1`; depth 995 is refused. Iterative JSON validation also refuses a deeply nested non-finite number without entering the recursive request validator.

## 3. Files changed

The complete supplied manifest is `FILES.log.txt`; retained log sizes and original/portable SHA-256 values are in `EVIDENCE-MANIFEST.json`. Logs are normalized to UTF-8 with home paths written as `%USERPROFILE%`. Pre-normalization log bytes are not kept; their hashes and sizes are recorded. Raw JSON evidence (`baseline-restore.json`) is unchanged. No retained capture exceeds 1,000,000 bytes.

- API: Event request/response route; targeted intake and small webhook depth guard; iterative webhook JSON validation; one additive Event-admission dependency in `container.ts`; public API, adversarial, ordering and restart tests; additive disposable-prefix/port options in testing helpers.
- Engine: Event claim/receipt port types; `receiveEvent`, dispatch/retry and pending-pin admission logic in `run-manager.ts`; Event fake and acknowledgement tests. The fake commits receipt/run links before notifying queued-event observers.
- Infrastructure: separate Event receipt adapter/table; shared atomic admission commit; Event-aware key/pin checks; coherent delivery/run-link reads; loop receipt cleanup; migration `0018_targeted_event_admission`, journal and snapshot; Event tests. Historical migration fixtures in `catalog.test.ts`, `delivery-runs.test.ts`, `history-summaries.test.ts` and `webhook-receipt-upgrade.test.ts` drop the later Event table before rewinding their disposable ledger.
- Domain: export the existing iterative stored-depth check with an optional maximum, retaining the poll default unchanged.
- API client: generated OpenAPI and schema, resource description and contract test.
- Docs: 03, 05, 07, 08, guide 04, ADR-0048, CHANGELOG and generated API reference.

Wave boundaries: `container.ts` has only the additive TriggerService dependency; no stop/dispose or structured wiring changes. `run-manager.ts` changes are admission/recovery dispatch and the additive pending-pin check, with no shutdown, child-creation, uncertain-script or finalisation changes. No web source, MCP tool, SSE transport, model controls, process termination implementation or protected store-reset/conversion implementation was edited. The four historical-fixture changes are additive test setup only.

## 4. Tests

New tests are in `targeted-events.test.ts`, `targeted-events-restart.test.ts`, engine `event-admission.test.ts` and SQLite `event-admission.test.ts`. Existing route/client tests were updated for the clean targeted body. The four touched SQLite specifications pass 82 tests (`sqlite-verified.log.txt`). The targeted Event and built-process restart files pass all 24 tests in `targeted-verified.log.txt`; that combined command also contains an unrelated scope-matrix timeout, so its overall exit is a failure.

Before changing production code, `baseline.log.txt` captured three failures on the clean base:

- Missing target: `expected 202 to be 400`.
- Explicit target: expected `target`, `admissionId` and pending state, but received two `runIds` for two loops.
- 997-level payload: `expected 202 to be 422`.

A final controlled replay against `88d6118` replaced the twelve affected intake/engine/SQLite source files with their original Git bytes, keeping the current additive empty migration and the public test harness. `baseline-complete.log.txt` records **20 failing regressions and one passing concurrency control**. The URL webhook depth regression also fails with `expected 202 to be 422`, reproducing the follow-up report on the original path. `baseline-restore.json` records Node 22, each implementation SHA-256 and successful byte-for-byte restoration of all twelve files. After replay, all twelve files match the pre-replay implementation snapshot byte for byte. This replay was done after implementation; only the initial three failures were captured before the first production edit.

The initial expanded suite exposed two test-fixture mistakes (logger shape and inference prompt shape), which were corrected without weakening assertions. A 90-second restart budget with three API startups timed out; the revised fixture seeds through the public SQLite repository, uses two real API startups and a 180-second outer budget, and retains the kill/reopen/identity assertions. Earlier failures are retained.

The original infrastructure gate exposed fixture replay errors, `table event_receipts already exists`; those fixtures now rewind structure as well as ledger. Native process and untouched conversion-test failures are reported separately, not retried away or described as receipt defects.

Coverage status is recorded in the gate logs. Engine's completed bounded run: 1,585 tests, 97.68% lines, 91.55% branches, 96.84% functions, 96.45% statements. No thresholds or exclusions changed.

## 5. Gates

All commands used Node `v22.14.0` first on PATH and `pnpm.cmd` in PowerShell. Later coverage runs use `--maxWorkers=2` to bound resource use. No test retries, exclusions or threshold reductions were introduced.

| Command                                                                  | Result                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`                                                         | PASS: 20 tasks, including tests/fixtures. Latest complete root run: 3m00.798s. Engine typecheck also passes after the final Promise-return lint fix.                                                                                    |
| `pnpm lint`                                                              | PASS: 11 tasks; existing ThreadViewer warning only.                                                                                                                                                                                     |
| `pnpm format:check`                                                      | PASS on completed implementation. Initial four warnings were fixed.                                                                                                                                                                     |
| `pnpm check:layers`                                                      | PASS.                                                                                                                                                                                                                                   |
| `pnpm check:deps`                                                        | PASS; existing orphan warning for `drizzle.config.ts`.                                                                                                                                                                                  |
| `pnpm check:migrations`                                                  | PASS: Drizzle generation is a no-op.                                                                                                                                                                                                    |
| `pnpm --filter @graphgoblin/api test:coverage --maxWorkers=2`            | FAILED / interrupted after prolonged built-entry execution. Capture includes two stale callers, subsequently corrected and verified separately, a polling-recipe timeout and three built-entry failures. No passing API coverage claim. |
| `pnpm --filter @graphgoblin/engine test:coverage --maxWorkers=2`         | PASS: 1,585 tests; 97.68% lines / 91.55% branches / 96.84% functions / 96.45% statements. The latest four admission tests also pass.                                                                                                    |
| `pnpm --filter @graphgoblin/infrastructure test:coverage --maxWorkers=2` | FAILED: 765 pass / 15 fail in untouched native termination/readiness and conversion timeout tests. All Event and migration-fixture tests pass; no summary emitted on failure.                                                           |
| `pnpm --filter @graphgoblin/api-client test:coverage --maxWorkers=2`     | FAILED: 70 pass / 2 template tests time out, including 10s cleanup hooks. Updated Event client contract passed; no summary emitted on failure.                                                                                          |
| `pnpm --filter @graphgoblin/domain test:coverage`                        | PASS: 593 tests; 98.47% lines / 95.78% branches / 97.11% functions / 97.32% statements.                                                                                                                                                 |
| `pnpm --filter @graphgoblin/api-client generate`                         | PASS; OpenAPI/schema retained.                                                                                                                                                                                                          |
| `pnpm docs:generate` then `pnpm check:docs`                              | PASS.                                                                                                                                                                                                                                   |
| `pnpm --filter @graphgoblin/api... build`                                | PASS before real-process verification.                                                                                                                                                                                                  |

`final-gates.log.txt`, `static-gates.log.txt` and `coverage-gates.log.txt` retain command/exit records; individual `.log.txt` captures retain each attempt, including development failures. Failed suites did not emit coverage summaries, so the >90% policy cannot be certified for API, infrastructure or api-client here. The API coverage command was interrupted with Ctrl-C at 2026-10-24 00:37 UTC after more than twenty minutes, including three built-entry failures; it was not called green. Its precise stall cause is unproven.

The post-replay API source/test typecheck and final `git diff --check` also pass.

MCP and web coverage/browser/token gates are not required because neither source changed. Licence checking is not required because no dependency changed.

## 6. Docs

ADR-0048 records explicit single destination, durable receipt-before-202, recipient-scoped permanent request identity, separate webhook ledger, finite recovery and nesting budget. Docs 07/08 and guide 04 describe the new body, states, refusal codes and external-side-effect limitation. Docs 03/05 explain the unchanged caller envelope and frozen admission. The CHANGELOG contains the required **Upgrade:** sender changes and old-row/operator behaviour. API client OpenAPI/schema and `docs/reference/api.md` are regenerated.

Migration 0018 is additive, with fresh journal `when` `1792798427210`. Existing inbound and webhook rows, including invalid history, are not rewritten or given inferred targets. Old broadcast rows retain run links and show admission “not tracked”. The orchestrator must preserve journal timestamp ordering when integrating migration 0019.

## 7. Decisions and parameters

- Body: strict `{loopId, triggerNodeId?, type, payload?, dedupeKey?}`; payload defaults to JSON null. A new request selects exactly one matching Event entry of the current published version. Ownership is checked before any retry lookup. Accepted retry lookup precedes republishing selection so it preserves the original target.
- Refusals: 400 `VALIDATION_FAILED` for missing/malformed fields or malformed Unicode request keys; 404 `LOOP_NOT_FOUND` for missing/foreign loops; 409 `VERSION_NOT_PUBLISHED`; 422 `EVENT_TRIGGER_NOT_FOUND`, `EVENT_TRIGGER_AMBIGUOUS`, `EVENT_KEY_EXPRESSION_FAILED`, `EVENT_KEY_INVALID` or `EVENT_PAYLOAD_TOO_DEEP`; existing 409 `LOOP_UPGRADE_REQUIRED`; 503 `EVENT_ADMISSION_FAILED` only for unconfirmed saving. Webhook depth uses 422 `WEBHOOK_PAYLOAD_TOO_DEEP` with a payload-free warning.
- Separate `event_receipts` keeps webhook public acknowledgement and duplicate-receipt semantics intact. Event request identity is owner/loop/trigger/type/key across versions. Repeats return the original delivery; a node expression is a separate payload-key rule. Empty request keys mean absent, whitespace is literal, unkeyed repeats are independent, and no hash suppression exists. Historic broadcast records do not invent targeted request identities. Existing authored node-key formatting/truncation is retained; keys that cannot survive SQLite Unicode binding are refused.
- Eight recorded failed admissions, delays 5/10/20/40/80/160/300 seconds, 15-second nonoverlapping sweep, five due Event identities per sweep separately from webhooks. Identity conflicts and removed targets fail immediately. These are engineering choices to bound persistent faults, not owner-approved numbers. Failure-metadata write errors leave the original pending intent available for recovery.
- Payload maximum is `POLL_ITEM_MAX_NESTING_DEPTH - 2 = 994`, root container at zero, accounting for `intent.queued.initialThread`. The iterative `isJsonValue` and depth walk avoid stack exhaustion before the bound is applied.
- This guarantees accepted admission identity and recovery, not exactly-once external effects.

## 8. Caveats and open items

No claim of merge readiness is made. Opposite-vendor orchestrator review, independent Sol QA and the bounded Astra audit remain outstanding. Broad failures are retained in [FAILURES.md](FAILURES.md) and their logs.

D-015 native termination/cleanup evidence includes `native process-tree cancellation must finish before fixture cleanup: expected true to be false` (`process/scripts.test.ts:194`); a descendant marker continuing to grow after cancellation at `claude/process.test.ts:146`; `EBUSY: resource busy or locked, rmdir` during native fixture cleanup; and the added readiness diagnostic `Claude CLI check process did not confirm that it stopped`. Process-tree tests also timed out at 15/30 seconds. These failures remain unresolved and are not waived.

Separately, seven untouched `sqlite/upgrade.test.ts` conversion cases timed out at 20 seconds. The focused API scope matrix timed out at 20 seconds. Two untouched client template tests timed out at 5 seconds and their cleanup at 10 seconds. Their causes have not been proven to be this change or disproven; the protected conversion implementation was not edited. The interrupted broad API run contains a polling-recipe timeout and three built-entry startup/CLI failures. These prevent release-gate acceptance in this environment. No further whole-suite retry was used to obtain a green result.

Outside scope: `apps/web/src/runs/inspector/ThreadViewer.tsx:106` retains its existing useState lint warning. No termination, store-reset, retired-conversion, child-recovery, uncertain-script or shutdown implementation was changed.

The orchestrator must commit retained evidence together with source before citing it in review/QA. Ignored coverage output and disposable backup directories may be removed by the orchestrator if desired; this worker does not delete directories. `PROCESS-CLEANUP.log.txt` records that captured disposable API PID 41456 is no longer running and identifies three retained native-test directories. No unknown or owner process was stopped.
