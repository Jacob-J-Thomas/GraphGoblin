# F2 fixes: an offered Codex effort the provider refuses, and its misrecorded failure (#205, #243, #244)

Implementation record for the two Medium defects that the final integrated check with real provider turns found on `main` at `a0470cb5`: [F2 record](../2026-10-27-final-f2-live/README.md), section "Defects", check 4 (LP-5). Part of #205, Part of #243, Part of #244.

- Branch `worktree-agent-a028ffe9642f999a3`, based on `main` at `b33a6d9f9f55fb4dc2379a257d38d938bfaf4703` (which holds the F2 record).
- Runtime: the project-scoped Node `v22.23.4` (`%USERPROFILE%/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64/node`), pnpm 12.8.1, Windows 11 (10.0.26300), Microsoft Edge through Playwright.
- No live provider call was made. Codex was always a controlled fake CLI run through the real `@openai/codex-sdk` 0.160.0, or the pinned CLI binary read as a file and never started. API tests used `GG_TEST_PORT_START=7000 GG_TEST_PORT_COUNT=40` and the data prefix `gg-f2fix-api-`; the browser specs used ephemeral ports.

## Summary

| Defect                                                                                                                    | Confirmed cause                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 (#205): Codex `minimal` is offered and accepted for `gpt-6-luna`, and the provider refuses it                          | The seeded Codex catalog (`DEFAULT_MODEL_CATALOG`) listed `minimal` for every Codex model. The model catalog compiled into the pinned Codex CLI lists `minimal` for none of them.                                                                                                                                                                                                                                                                                    | Each seeded Codex model offers exactly the canonical efforts the CLI's catalog lists for it (`low` to `max`; `low` to `xhigh` for GPT-5.5). Every path resolves through that catalog, so a saved `minimal` is refused with `EFFORT_UNSUPPORTED`, named on the editor field and node, and a run pinned to it fails before any provider request.                                                                                               |
| D2 (#243, #244): the provider's refusal is recorded as `HARNESS_DELIVERY_UNCERTAIN`, resumable, with an unrelated message | Confirmed as F2 read it, plus a classification gap. The provider's HTTP 400 in the stream was classified as a generic `HARNESS_TURN_FAILED` (rank 1). The SDK's process-exit error is also rank 1, and `mergeHarnessFailure` keeps the later evidence on a tie, so `Codex Exec exited with code 1: Reading prompt from stdin...` replaced it. A generic Codex failure is resumable, and after `turn.started` the engine turned it into `HARNESS_DELIVERY_UNCERTAIN`. | The adapter classifies the provider's refusal of the request as a pinned argument refusal (`HARNESS_ARGUMENTS_REJECTED`) and keeps its message. The SDK's exit error never replaces a failure the stream reported. The engine keeps a pinned refusal's own non-resumable code after acceptance. The run fails `HARNESS_TURN_FAILED` with `details.adapterCode: HARNESS_ARGUMENTS_REJECTED` and `resumable: false`, and no Resume is offered. |

## D1: the Codex effort table

**Source.** The model catalog compiled into the Codex CLI that the product runs: `@openai/codex` 0.160.0 for `win32-x64`, the SDK's bundled binary (`codex.exe`, 326,872,368 bytes, SHA-256 `fdda5fa3cf3fb3d000b876720742857676293e4315e4b045fae6f8bd7e866d1d`). [scripts/codex-catalog-efforts.mjs](scripts/codex-catalog-efforts.mjs) reads the binary as bytes, without starting it, and prints each seeded model's `supported_reasoning_levels` and their intersection with GraphGoblin's canonical scale ([codex-catalog-efforts.log.txt](codex-catalog-efforts.log.txt)). It is the method of the PR #417 record's `codex-model-catalog.mjs`, and it gives the same levels as that record.

| Seeded Codex model | CLI catalog default | CLI catalog levels                               | GraphGoblin offers (seeded `efforts`)   | Seeded default (unchanged) |
| ------------------ | ------------------- | ------------------------------------------------ | --------------------------------------- | -------------------------- |
| `gpt-6-luna`       | `medium`            | `low`, `medium`, `high`, `xhigh`, `max`          | `low`, `medium`, `high`, `xhigh`, `max` | `low`                      |
| `gpt-6.1-sol`      | `low`               | `low`, `medium`, `high`, `xhigh`, `max`, `ultra` | `low`, `medium`, `high`, `xhigh`, `max` | `medium`                   |
| `gpt-6-sol`        | `medium`            | `low`, `medium`, `high`, `xhigh`, `max`, `ultra` | `low`, `medium`, `high`, `xhigh`, `max` | `medium`                   |
| `gpt-6-astra`      | `low`               | `low`, `medium`, `high`, `xhigh`, `max`, `ultra` | `low`, `medium`, `high`, `xhigh`, `max` | `medium`                   |
| `gpt-5.6-luna`     | `medium`            | `low`, `medium`, `high`, `xhigh`, `max`          | `low`, `medium`, `high`, `xhigh`, `max` | `low`                      |
| `gpt-5.6-sol`      | `low`               | `low`, `medium`, `high`, `xhigh`, `max`, `ultra` | `low`, `medium`, `high`, `xhigh`, `max` | `medium`                   |
| `gpt-5.6-terra`    | `medium`            | `low`, `medium`, `high`, `xhigh`, `max`, `ultra` | `low`, `medium`, `high`, `xhigh`, `max` | `medium`                   |
| `gpt-5.5`          | `medium`            | `low`, `medium`, `high`, `xhigh`                 | `low`, `medium`, `high`, `xhigh`        | `medium`                   |

The binary's catalog holds no `minimal` level and no `none` level for any model (0 occurrences of either). `ultra` is not on GraphGoblin's effort scale and stays unoffered. Live evidence exists only for `gpt-6-luna`: F2 LP-5 saw the provider refuse `minimal` and accept `max`. The other rows rest on the CLI's catalog alone.

**`none` is an owner question, not changed.** The provider's refusal named `none` as a supported value for `gpt-6-luna`, and the CLI's catalog does not list it. Adding `none` would add a value to the canonical effort scale (`EffortSchema`), with editor, Claude and documentation consequences. This fix offers only what both the CLI catalog and the scale contain.

**Fix.** `packages/infrastructure/src/sqlite/settings.ts`: the Codex seed lists `low` to `max`, and `low` to `xhigh` for GPT-5.5. Startup refreshes seeded efforts from `DEFAULT_MODEL_CATALOG` (no migration), so a store from before the fix stops offering `minimal` at its next start. Every path that can send an effort resolves through the same live catalog (`resolveHarnessModel`):

| Path                                          | Behaviour with a Codex `minimal` after the fix (tests)                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inference node: draft save, publish, validate | 400 / issue `EFFORT_UNSUPPORTED` at `config.effort` (`catalog.test.ts`, every seeded model)                                                                                                                                                                                                                                                                                                        |
| LLM decision (explicit effort)                | Same (`catalog.test.ts`, every seeded model)                                                                                                                                                                                                                                                                                                                                                       |
| Settings owner defaults, loop defaults        | `PUT /settings` 400 `EFFORT_UNSUPPORTED` for every seeded model (`catalog.test.ts`); loop defaults are checked with the draft                                                                                                                                                                                                                                                                      |
| A version published before the fix            | The run is admitted, then fails `EVALUATION_INVALID_CONFIGURATION` with `details: { code: EFFORT_UNSUPPORTED, path: effort }`, `resumable: false`, before any harness or decider request (`catalog.test.ts`, inference and decision)                                                                                                                                                               |
| Inference schema repair on the same session   | Uses the node's resolved effort, so it cannot run once the node is refused (read from `inference.ts`, not separately tested)                                                                                                                                                                                                                                                                       |
| Output-transform repairs (`StructuredPort`)   | Resolve inherited Codex defaults; a stored `minimal` default fails `EVALUATION_INVALID_CONFIGURATION` before the call through `validateHarnessDefaults` in the engine's `resolveModel` (read from `run-manager.ts`, not separately tested)                                                                                                                                                         |
| Editor                                        | The kept value shows as "minimal (not supported by this model)" with "Effort minimal is not supported by GPT-6 Luna. Choose a supported effort or Default.", one issue on the node; Publish refuses and names the node; choosing `low` publishes and runs at `low` (Edge spec, both kinds; [kept-minimal-inference.png](kept-minimal-inference.png), [kept-minimal-llm.png](kept-minimal-llm.png)) |

The editor wiring for a kept unsupported effort is the one PR #417 added for GPT-5.5 `max`; nothing in `apps/web/src` changed.

**Regression tests**, all failing on the original code:

- `packages/infrastructure/src/sqlite/storage.test.ts`: `seeds the model catalog once and answers allow-list questions` now asserts the whole per-model table and `isAllowed('codex', 'gpt-6-luna', 'minimal') === false`; `does not reapply the migration but seeding restores current harness efforts` asserts that the startup seed removes `minimal` from an older row. Before: both failed on the seeded `minimal` ([tests-infrastructure-before.log.txt](tests-infrastructure-before.log.txt)).
- `apps/api/src/catalog.test.ts` (#205 block): `lists exactly the efforts the Codex CLI catalog gives each model: no minimal, no max for GPT-5.5`; `refuses minimal for every seeded Codex model (inference|decision, and as a default) before any request`; `fails a stored minimal (inference|decision) from before this catalog without any provider request`. `apps/api/src/api.test.ts` `manages api keys and the model catalog` now expects Luna without `minimal`. Before: all 7 failed. The stored-version cases failed because the run succeeded and reached the fake harness with `minimal`, which the real provider refuses ([tests-api-before.log.txt](tests-api-before.log.txt), which also holds the D2 API case, and [tests-api-d1-final-before.log.txt](tests-api-d1-final-before.log.txt) for the final assertions).
- `apps/web/e2e/model-effort.spec.ts` (Edge): `Codex effort choices follow the model: no minimal, max is offered and requested unchanged, but not for GPT-5.5` and `inference|llm: a Codex minimal saved before the catalog change is named on the field and the node until a supported effort is chosen`. Before: all 3 failed; the old catalog offered `minimal` ([tests-e2e-before.log.txt](tests-e2e-before.log.txt)). `apps/web/e2e/form-controls.spec.ts` now expects `low` as the first Codex effort chosen by keyboard (an existing test, updated).

**Stored values.** Drafts, published versions and defaults that hold a Codex `minimal` are not rewritten. Clean design over compatibility: they are refused as above, and the CHANGELOG upgrade note tells the owner to change them to `low` or another listed effort.

## D2: the provider refusal record

**Cause, confirmed.** The F2 reading holds, and one more step is needed to explain the record:

1. **Classification.** The CLI's stream carried `error` and `turn.failed` with `{"type":"error","error":{"message":"Unsupported value: 'minimal' …","type":"invalid_request_error","param":"reasoning.effort","code":"unsupported_value"},"status":400}`. `classifyCodexError` recognised neither the status nor the type and returned generic `HARNESS_TURN_FAILED` with the provider's message, rank 1.
2. **The tie.** The CLI then exited with code 1, and the SDK threw `Codex Exec exited with code 1: Reading prompt from stdin...`, where the stderr is only the CLI's banner. `TurnAccumulator.fail` folded it at the same rank (1), and `mergeHarnessFailure` keeps the later evidence on a tie (`>=`), so the exit message replaced the provider's.
3. **Resumability and code.** Codex permits Resume for a non-pinned generic failure even when `retriable` is false (docs/05), so `resumable: true`. `turn.started` had already been recorded as the Codex acceptance marker (#244), so the engine turned the generic `HARNESS_TURN_FAILED` into `HARNESS_DELIVERY_UNCERTAIN`.

A real `@openai/codex-sdk` run against a fake CLI with exactly that stream, stderr and exit reproduces the F2 record through the engine and over HTTP: `HARNESS_DELIVERY_UNCERTAIN`, `resumable: true`, `details.adapterCode: HARNESS_TURN_FAILED`, the exit message, and `recovery.resume.allowed: true` ([tests-adapter-before.log.txt](tests-adapter-before.log.txt), [tests-api-before.log.txt](tests-api-before.log.txt)).

**Fix.**

- `packages/adapter-codex/src/events.ts`, classification. A JSON error with `status: 400` and `error.type: invalid_request_error` is the provider's refusal of the request itself. It becomes `HARNESS_ARGUMENTS_REJECTED`, non-retriable, with the message `The provider refused the request (HTTP 400, <param>): <provider message>`. Other statuses, and a 400 without that type, keep their classes. Since review round 1 this check runs before every message heuristic, right after typed metadata.
- `packages/adapter-codex/src/events.ts`, the exit wrapper. `TurnAccumulator.fail` no longer lets the SDK's process-exit error replace evidence once the stream has reported an `error` or `turn.failed` for an unfinished turn, while that error classifies as generic (rank 1). Since review round 1 only that exact SDK error counts: a plain `Error` reading `Codex Exec exited with code <n>:` or `… with signal <name>:`. Any other thrown error joins the fold. Typed or higher-ranked thrown evidence still wins as before, for example `Not logged in` on stderr. With no stream report, or after `turn.completed`, the exit error is still the cause.
- `packages/engine/src/handlers/inference.ts` and `inference-failure.ts` (`isPinnedRefusal`). Only a generic turn failure becomes `HARNESS_DELIVERY_UNCERTAIN`. A pinned argument, configuration or policy refusal keeps `HARNESS_TURN_FAILED`, with its cause in `details.adapterCode`, also after acceptance. docs/05 already listed specific causes as staying intact under `delivery-uncertain`, and a pinned refusal is one (rank "pinned" in the evidence fold).
- `packages/adapter-codex/src/decider.ts`. A refused LLM-decision request maps to `DECIDER_HTTP_ERROR`, the class it had before through the generic code, so decisions still fail `EVALUATION_PROVIDER_FAILED` without provider text.

**The failure code chosen, and why.** The run fails **`HARNESS_TURN_FAILED`** with **`details.adapterCode: HARNESS_ARGUMENTS_REJECTED`**, **`resumable: false`**, and the message `harness turn failed: The provider refused the request (HTTP 400, reasoning.effort): Unsupported value: 'minimal' is not supported with the 'gpt-6-luna' model. Supported values are: …`. The run read that the inspector renders carries that code and message and `recovery.resume.allowed: false`, so no Resume is offered. The inspector itself was not opened for D2; the live QA below covers it.

- **Why a pinned argument refusal.** The documented rules (docs/05 "Inference submission and recovery", docs/06 #244) make unsupported policy, invalid configuration and rejected arguments non-resumable for both harnesses "because the definition is pinned". Model, effort, sandbox and approval options, output schema and prompt all come from the run's pinned definition and its recorded inputs, so the same request is refused again. A Resume, whether a resend or a continuation, would repeat it. `HARNESS_ARGUMENTS_REJECTED` is the pinned code Codex already uses for rejected turn arguments, and the provider's refusal of a request parameter is that case at the provider.
- **Why `HARNESS_TURN_FAILED` as the run code.** That is how the engine already reports every pinned refusal; with `definitely-not-submitted` the same record appears for a refused repair in `repair-start.test.ts` and in the pinned matrices. Before this fix, a pinned refusal after acceptance became generic `HARNESS_DELIVERY_UNCERTAIN`, which is the "delivery uncertainty" the brief rules out.
- **Why the provenance stays `delivery-uncertain`.** For Codex, the documented positive acceptance marker is `turn.started` (docs/06, #244), and the rules say a later refusal cannot downgrade an accepted turn to safe resubmission. The marker is sound here: the F2 rollout facts show the CLI's own session history recording message entries after `task_started` for the refused LP-5 turn (contents not recorded), so a resumed conversation would contain the prompt. `failure.inference.submission` therefore remains `delivery-uncertain` (accepted, outcome not recorded). The cause and resumability come from the pinned refusal, not from the provenance.
- **Alternative not taken (a #244 rule change, for the reviewer and owner).** The adapter could hold the `codex.turn.started` marker until the next stream event and drop it when that event is the provider's refusal, which would record the refusal as `definitely-not-submitted`. For a message-only turn the next event is the final message (F2 LP-4's real turn emitted exactly one item), so a gateway crash during generation would leave no durable acceptance. Under ADR-0045 that makes such turns non-resumable on inherited (previous, named, own) sessions, where today they continue. The existing test `continues the recorded session after a CLI dies following durable turn.started acceptance` (`packages/adapter-codex/src/turn-recovery.test.ts`) relies on durable acceptance during the turn. I kept #244's acceptance rule unchanged. The PR is still "Part of #244", because the delivery-uncertain row of its classification table now keeps pinned refusals intact.

**Claude adapter, checked for the same shape.** Not present. The Claude runner turns the first typed stream failure (an `assistant` record with `error`, or an error `result`) into `callbackError`, kills the process, and `checkOutcome` reports `callbackError` before it looks at the exit code. So a non-zero exit cannot replace a failure the stream reported. A guard test drives the public `ClaudeHarness` and a fake CLI that reports `rate_limit` in the stream and then exits 1 with a banner on stderr. It records `HARNESS_QUOTA_EXHAUSTED` and no private text: `packages/infrastructure/src/claude/submission.test.ts`, `keeps a provider failure the stream reported ahead of the non-zero exit that follows it`. It passed on the original code too, which is the expected result for an absent defect. One related observation, not changed: Claude maps the API's `invalid_request` category to a generic, non-resumable `HARNESS_TURN_FAILED` with the fixed text "Claude turn failed", because the Claude adapter keeps no provider text by design. That turn is recorded as `HARNESS_DELIVERY_UNCERTAIN` (not resumable). GraphGoblin validates Claude model and effort locally before any request, so a configuration refusal is less likely there.

**Regression tests**, failing on the original code unless noted:

- `packages/adapter-codex/src/refusal.test.ts`. The real SDK with `codexBinary` set to Node and the preloaded fake CLI [`fixtures/refusal-cli.mjs`](../../../packages/adapter-codex/src/fixtures/refusal-cli.mjs): stream `error` + `turn.failed` with the provider's 400, stderr banner, exit 1.
  - `records the provider refusal of the request, not the exit error that follows it`: events `session`, `submitted` (`codex.turn.started`), then `error` with `HARNESS_ARGUMENTS_REJECTED` and the provider's message.
  - `keeps an unclassified stream failure instead of the generic exit error`.
  - `fails the run with the provider refusal as its non-resumable cause and offers no Resume`: through `createTestEngine`; the run record as above; `manager.resume` refused; one `harness.turn`.
  - Before: `HARNESS_TURN_FAILED` / `Codex Exec exited with code 1: Reading prompt from stdin...`, and through the engine `HARNESS_DELIVERY_UNCERTAIN`, `resumable: true`.
- `apps/api/src/provider-refusal.test.ts`, `records a Codex request the provider refused with its own cause and offers no Resume (#243)`. The same fake CLI behind the real `CodexHarness`, over HTTP: `GET /runs/{id}` shows the run record above and `recovery.resume.allowed: false`, and the body does not contain the banner. `POST /runs/{id}/resume` returns 409, with no second turn. Before: `HARNESS_DELIVERY_UNCERTAIN`, `resumable: true`, `recovery.resume.allowed: true`.
- `packages/engine/src/handlers/inference-refusal.test.ts`, `keeps an accepted $family $code refusal as its own non-resumable cause`. Codex and Claude, for each of the three pinned codes, after a `submitted` marker. Before: `HARNESS_DELIVERY_UNCERTAIN` in all 6 ([tests-engine-before.log.txt](tests-engine-before.log.txt)).
- `packages/adapter-codex/src/events.test.ts`: `classifies the provider refusal of a request parameter as a pinned argument refusal (#243)` and `never lets the generic process-exit error replace a failure the stream reported (#243)` (new). `unwraps the JSON API error Codex reports and names the provider refusal` and `turns turn.failed into a classified failure …` were updated, as was `harness.test.ts` `reports a failed turn as an error event …`, all over the recorded `failed-invalid-model` fixture (a real CLI recording of a 400 refusal, which now keeps the provider's message instead of the exit error).
- `packages/adapter-codex/src/decider.test.ts`: `maps native Choice failure HARNESS_ARGUMENTS_REJECTED without retaining provider text`.
- `apps/api/scripts/failure-evidence/sdk-pinned-followups.mjs` (the `pnpm test:prompt-evidence` integration, not in CI): pinned stream refusals now expect `HARNESS_TURN_FAILED` under `delivery-uncertain` too.

## Gates

Run from the worktree root with Node `v22.23.4` first on `PATH` ([gates/runtime.log.txt](gates/runtime.log.txt)); API tests with `GG_TEST_PORT_START=7000 GG_TEST_PORT_COUNT=40` and `GG_TEST_DATA_PREFIX=gg-f2fix-api-`. Logs are in [gates/](gates/).

| Gate                                                                                                                                                  | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm build`                                                                                                                                          | pass, 11/11 tasks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `pnpm typecheck`                                                                                                                                      | pass, 20/20 tasks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `pnpm lint`                                                                                                                                           | pass, 12/12 tasks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `pnpm check:layers`                                                                                                                                   | pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `pnpm check:deps`                                                                                                                                     | pass: 0 errors, 3 warnings, all pre-existing orphans (`packages/infrastructure/drizzle.config.ts`, `apps/web/e2e/shutdown.config.ts`, `apps/api/scripts/check-templates.d.mts`)                                                                                                                                                                                                                                                                                                                                                                                       |
| `pnpm format:check`                                                                                                                                   | pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `pnpm docs:generate`                                                                                                                                  | pass, no diff in `docs/reference` (no node schema or route changed)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `pnpm --filter @graphgoblin/adapter-codex test:coverage`                                                                                              | pass: 518 passed, 4 skipped (live); statements 97.94%, branches 95.1%, functions 99%, lines 99.24%                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `pnpm --filter @graphgoblin/engine test:coverage`                                                                                                     | pass: 1,763 passed; statements 95.64%, branches 91.2%, functions 97.76%, lines 96.94%                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `pnpm --filter @graphgoblin/infrastructure test:coverage`                                                                                             | pass: 871 passed; statements 96.64%, branches 94.31%, functions 98.34%, lines 98.12%                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `pnpm --filter @graphgoblin/api test:coverage`                                                                                                        | Run 1 failed 3 tests and run 2 failed 1, all in files this change does not touch. Run 1: `history-cleanup.test.ts` (20 s timeout, the 1,000-user workspace case) and two `subloop-restart.test.ts` cases (`EADDRINUSE` on 7027). Run 2: `retired-event-startup.test.ts` (`EADDRINUSE` on 7013). Each of those files passed in one isolated run. Run 3 (`vitest run --coverage --coverage.reportOnFailure`, so the figures print even on a failure) passed: 1,679 passed, 14 skipped; statements 94.74%, branches 90.79%, functions 91.7%, lines 96.22%. See caveat 1. |
| `pnpm --filter @graphgoblin/web test:coverage`                                                                                                        | pass: 1,810 passed; statements 98.09%, branches 94.76%, functions 98.1%, lines 98.93% (only e2e specs changed in this package)                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `apps/web`: `pnpm exec playwright test e2e/model-effort.spec.ts e2e/model-picker.spec.ts e2e/claude-harness.spec.ts e2e/form-controls.spec.ts` (Edge) | pass, 46/46, after `pnpm build`. None of the six model-picker or Claude failures that the common brief lists for main appeared. The first run after the fix failed 3 tests on errors in my own new or updated assertions: `form-controls` still expected `minimal`, and the kept-minimal cases expected the unsaved-draft message where Publish of a saved draft reports "Publish failed … work: The selected reasoning effort is not supported by this model". That log was overwritten and is not kept; the corrected assertions passed in the next run.            |

Caveats on the gates:

1. **API port collisions and one load-sensitive timeout, outside this change.** `createApiProcessFixture` probes a free port in the `GG_TEST_PORT_*` range and the child binds it later, so parallel subprocess tests can race for the same port in a 40-port range. The 1,000-user cleanup case can exceed 20 s under full load. The PR #417 record saw the same kinds of failures. No product or test file involved was changed here.
2. `tests-api-before.log.txt` is the first before-fix API run. One assertion of `fails a stored minimal (decision) …` was tightened after it, to the exact `details`. [tests-api-d1-final-before.log.txt](tests-api-d1-final-before.log.txt) re-runs the final D1 API tests against the original seed, restored by hand for that run only and then put back: all 6 fail.

## Review round 1 (PR #426 scan 1)

The independent review of `4eabfb86` returned CHANGES REQUIRED with two P2 blockers in `packages/adapter-codex/src/events.ts`, both reproduced through the public harness and the real SDK, plus one non-blocking finding. The review record is kept outside this branch.

**B1: the exit-wrapper suppression discarded distinct SDK errors.** `TurnAccumulator.fail` dropped every thrown error of rank 1 after an unfinished stream failure, not only the SDK's process-exit error. With a fake CLI that emits a generic diagnostic, then a line that is not JSON, and exits 0, the SDK throws `Failed to parse item: MALFORMED_PROTOCOL_ITEM`, and the record kept the earlier diagnostic instead.

- **Fix.** Only the SDK's own process-exit error is suppressed, matched by its structure: a plain `Error` (prototype `Error.prototype`, no own `code`) whose message reads `Codex Exec exited with code <n>: ` or `Codex Exec exited with signal <name>: ` (the SDK 0.160.0 `CodexExec.run` shape). The unfinished-turn check and the rank-1 check stay. Every other thrown error joins the fold as before, so the parse failure, being later at the same rank, is recorded.

**B2: message heuristics overrode the structured refusal.** `classifyCodexError` ran the CLI-message regexes before the HTTP 400 `invalid_request_error` check. A refusal whose provider text contained `Error: invalid value` became the fixed `Codex rejected the turn arguments`, losing the provider's reason. Text containing `Thread not found` became a false `HARNESS_SESSION_MISSING` / `session-missing`.

- **Fix.** The structured refusal, decided from the parsed `status` and `error.type`, is now checked right after recognized typed metadata (which keeps its earlier boundary) and before every message heuristic.

**N1: a fixture bypassed type checking.** The completed-turn control in `events.test.ts` cast its event `as never`. It now passes a complete typed `usage` (`input_tokens`, `cached_input_tokens`, `cache_write_input_tokens`, `output_tokens`, `reasoning_output_tokens`).

**Regression tests.** All 17 new cases failed against the reviewed `events.ts` ([tests-review-r1-before.log.txt](tests-review-r1-before.log.txt)), run with that file restored from `4eabfb86` for the run only.

- `packages/adapter-codex/src/refusal.test.ts`, through the public `CodexHarness`, the real SDK and the fake CLI (`fixtures/refusal-cli.mjs` gained the `malformed`, `invalid-value` and `missing-thread` scenarios):
  - `records the SDK parse failure that follows an earlier stream diagnostic`. Before: the message was `An earlier generic diagnostic`.
  - `keeps the invalid-value provider refusal as a refusal with its own text` and `keeps the missing-thread provider refusal as a refusal with its own text`. Both expect `HARNESS_ARGUMENTS_REJECTED`, the provider's text and `delivery-uncertain`. Before: `Codex rejected the turn arguments`, and `HARNESS_SESSION_MISSING` with `session-missing`. In that run they were titled `keeps a … provider refusal …`.
- `packages/adapter-codex/src/events.test.ts`:
  - `keeps a 400 invalid-request refusal saying … a refusal with its text`, for each of the 30 trigger phrases of every message heuristic (arguments, missing session, quota, authentication, installation, transport). The 10 phrases of the two heuristics that ran first failed before. The cases also check that typed metadata keeps its earlier boundary.
  - `records … thrown after a stream failure as evidence of its own`, for a parse failure, an exit-shaped string that is not an `Error`, an `Error` subclass, and an error with its own `code`. All 4 failed before.
  - The wrapper test also covers the signal form.
- **The reviewer's probe, copied.** [scripts/review-r1-probe-errors.mjs](scripts/review-r1-probe-errors.mjs) and [scripts/review-r1-fake-codex.mjs](scripts/review-r1-fake-codex.mjs) are the reviewer's driver, with only the import, fake CLI and output paths changed. Run on the built fix, all six cases come out as required ([review-r1-error-probes.log.txt](review-r1-error-probes.log.txt)):
  - `wrapper` keeps the stream's failure;
  - `parse` and `completed` record `Failed to parse item: MALFORMED_PROTOCOL_ITEM`;
  - `auth` records `HARNESS_NOT_AUTHENTICATED`;
  - `invalid-value` and `missing-thread-text` record `HARNESS_ARGUMENTS_REJECTED` with the provider's text and `delivery-uncertain`.

**Docs.** docs/05 (evidence fold) and docs/06 (Codex failure mapping) now name the exact SDK error treated as a wrapper. docs/06 also says the provider refusal is recognised before any message heuristic.

### Behaviour QA findings added to this round

The independent behaviour QA of PR #426 at `4eabfb86` passed, with two real turns:

- the live refused turn recorded `HARNESS_TURN_FAILED` / `HARNESS_ARGUMENTS_REJECTED`, non-resumable, with the provider's message;
- a real `low` turn succeeded.

Its record is kept outside this branch. Three of its findings are fixed here.

**D-1 (Low): Settings still offered Codex `minimal` with Default model "(server default)".**

- **Cause.** `DefaultsSection` offered the full effort scale when no default model was selected. A refusal then showed only "invalid harness defaults (EVALUATION_INVALID_CONFIGURATION)" in the card footer.
- **Fix.** The Codex Default effort now lists the efforts of the model it applies to, in this order:
  1. the selected default model;
  2. otherwise the process default model from `GET /system/model-defaults`, which is GPT-6 Luna unless `GG_DEFAULTS` names another;
  3. while that is unknown, only the efforts every Codex catalog entry shares;
  4. the full scale only while the catalog itself is unavailable.
- **Refusals.** A `PUT /settings` refusal whose problems name `EFFORT_UNSUPPORTED` for that harness is shown below the field as "Not saved. Effort <e> is not supported by <model>. Choose a supported effort or Default.", with `role="alert"` and in the field's accessible description, instead of the footer. The model named is the attempted one or the server default.

**O-2: a stored Settings default of `minimal` showed "minimal (unavailable)" with no reason.** The kept value now reads "minimal (not supported by this model)", with the editor's sentence (`unsupportedEffortMessage`) below the field and in its description ([settings-kept-minimal.png](settings-kept-minimal.png)). "(unavailable)" remains only when the effective model is unknown.

**O-1: one `details` shape for every source.**

- **Before.** A run whose unsupported effort came from loop, owner or process defaults reported `failure.details` as the array of `validateHarnessDefaults` resolutions, so `details.code` was absent, although the CHANGELOG and docs/06 promised it.
- **Fix.** `RunManager`'s `resolveModel` now reports the first problem as `{code, path, level, harness}`. That is the node-level `{code, path}` shape plus where the default lives; the message is unchanged.
- **Test changed.** The engine test `claude-effort.test.ts` encoded the array and was updated.

**Regression tests**, failing on the code before this change (logs `tests-qa-*-before.log.txt`, each run with only the changed product file restored for the run):

- `apps/web/src/settings/sections/DefaultsSection.test.tsx` (`Codex default effort follows the model it applies to`):
  - `offers the server default model efforts with no model selected, never minimal`;
  - `offers only the efforts every model shares while the server default model is unknown`;
  - `explains a stored minimal default its model does not offer`, with and without a saved model;
  - `names an effort the server refuses on its field instead of a generic footer`;
  - `names the server default model when no model is selected`.
  - Before: 6 of these 7 failed; the guard `keeps the generic footer for any other refusal` passes before and after.
- `apps/web/e2e/model-effort.spec.ts` (Edge), `Settings Codex default effort follows the server default model and names an unsupported effort`:
  - the list with "(server default)" is `low` to `max`;
  - a refusal from a stale catalog shows "Not saved. Effort minimal is not supported by GPT-6 Luna. …" on the field, with no footer;
  - a stored `minimal` default is explained, and choosing `low` saves.
  - Before, against the previous web build: the list held `minimal`.
- `apps/api/src/catalog.test.ts`, `fails a run inheriting a stored loop-default|owner-default minimal with the same details shape, without any request`. Before: `details` was the array. `packages/engine/src/claude-effort.test.ts` likewise expects the object for a process default.

**Docs.**

- CHANGELOG #205 bullet: Settings choices and the `details` shape.
- docs/06 "Model catalog": the `details` shape and the Settings effort source.
- docs/09: Settings effort derivation and on-field refusal.
- Settings guide 06: Codex Default effort.

**Checks after the fixes**, Node `v22.23.4`, logs `gates/r1-*` (typecheck, lint and format logs are from the final run of this round):

| Check                                                                                                                                                                                        | Result                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @graphgoblin/adapter-codex test:coverage`                                                                                                                                     | pass: 555 passed, 4 skipped (live); statements 97.95%, branches 95.16%, functions 99%, lines 99.24%                                                                                                     |
| `pnpm --filter @graphgoblin/engine exec vitest run src/handlers/inference-refusal.test.ts`                                                                                                   | pass, 20/20, including the 6 accepted pinned-refusal cases                                                                                                                                              |
| `pnpm --filter @graphgoblin/engine test:coverage`                                                                                                                                            | pass: 1,763 passed; statements 95.65%, branches 91.2%, functions 97.76%, lines 96.94%                                                                                                                   |
| `pnpm --filter @graphgoblin/web test:coverage`                                                                                                                                               | pass: 1,817 passed; statements 98.09%, branches 94.78%, functions 98.1%, lines 98.93% (run before the type-only fix below)                                                                              |
| `pnpm --filter @graphgoblin/api exec vitest run src/provider-refusal.test.ts` (`GG_TEST_PORT_START=7000`, `GG_TEST_PORT_COUNT=40`)                                                           | pass, 1/1                                                                                                                                                                                               |
| `pnpm --filter @graphgoblin/api exec vitest run src/catalog.test.ts src/provider-refusal.test.ts src/claude-effort-readiness.test.ts src/stored-loop-defaults.test.ts`                       | pass, 44/44                                                                                                                                                                                             |
| `pnpm typecheck`                                                                                                                                                                             | First run failed in `DefaultsSection.tsx`, which indexed the process defaults by a plain string. The harness list now narrows to `HarnessId` with a type guard; no cast. Second run passed, 20/20 tasks |
| `pnpm lint`                                                                                                                                                                                  | Same first failure and cause; pass after the fix, 12/12 tasks                                                                                                                                           |
| `pnpm format:check`, `pnpm check:layers`, `pnpm check:tokens`                                                                                                                                | pass                                                                                                                                                                                                    |
| `pnpm check:deps`                                                                                                                                                                            | pass: 0 errors, the same 3 pre-existing orphan warnings                                                                                                                                                 |
| `pnpm docs:generate`                                                                                                                                                                         | pass, no diff                                                                                                                                                                                           |
| `pnpm build`, then from `apps/web`: `pnpm exec playwright test e2e/model-effort.spec.ts e2e/model-picker.spec.ts e2e/claude-harness.spec.ts e2e/form-controls.spec.ts e2e/qa.spec.ts` (Edge) | pass, 57/57                                                                                                                                                                                             |

**Not addressed here.**

- QA O-3: an invalid `GG_DEFAULTS` stops the API at start with a clear message. The CHANGELOG upgrade note already says to change `GG_DEFAULTS` before starting.
- QA O-4: Replay preselects the first node; that is the #256 area.
- QA O-5: provider-side session files are the owner's to remove.
- QA O-6 is a note for briefs.
- HQ-1, whether to add `none` or drop `minimal` from the scale, remains the owner's decision.
- The reviewer's N2 (unchanged API tests unreliable in the combined suite, with the port collision under #407) is outside this change.
- The reviewer's sandbox could not confirm process-tree termination, so the Claude guard test failed there on unconfirmed termination (D-015). It passed in this environment in the earlier gates.

## Scan 2 (PR #426 audit, resumed at `ae88d757`)

The second audit returned CHANGES REQUIRED with one P2 in `packages/adapter-codex/src/events.ts`. Its record is kept outside this branch.

**Finding.** The CLI's stderr can repeat the structured HTTP 400 refusal. The SDK then throws `Codex Exec exited with code 1: {"status":400,"error":{"type":"invalid_request_error",…}}`.

- `unwrap` tried to parse that whole prefixed text as JSON, failed, and the message heuristics then read the provider's text.
- The resulting typed class outranked the stream's correct `HARNESS_ARGUMENTS_REJECTED`, so the round 1 suppression (generic wrappers only) did not apply.
- "Thread not found in referenced input." became a false `HARNESS_SESSION_MISSING`: `submission: session-missing`, Start-fresh-session guidance, and Resume answering `SESSION_RECOVERY_REQUIRED`.
- "Error: invalid value for reasoning.effort." became "Codex rejected the turn arguments", losing the provider's text and parameter.

**Fix.**

- **Structure first.** Inside the recognised SDK exit error, the stderr payload after the prefix is now read as a provider error: the whole payload, or else its last line that is such JSON, so a banner line before it is fine. A JSON object with an `error` object or a numeric `status` is classified from that structure (`wrappedProviderError`), so a 400 `invalid_request_error` is a refusal with the provider's message and parameter before any heuristic runs. A non-JSON payload keeps the whole-text rules, so a distinct typed cause such as `Not logged in` on stderr is unchanged.
- **Repeats never replace the stream.** After the stream has reported a failure for an unfinished turn, an SDK exit error that merely repeats it is dropped whatever rank its text would get. A repeat is the same classified code and message, or stderr containing the stream's own structured provider error verbatim. A distinct typed cause still outranks the stream, and the existing ranking is otherwise unchanged.

**Regression tests**, all 15 failing against `ae88d757`, with only `events.ts` restored for the run ([tests-scan2-adapter-before.log.txt](tests-scan2-adapter-before.log.txt), [tests-scan2-api-before.log.txt](tests-scan2-api-before.log.txt)):

- **`packages/adapter-codex/src/refusal.test.ts`**, through the public `CodexHarness` and the real SDK. The fake CLI gained `GG_FAKE_CODEX_STDERR` (`repeat`, `banner-repeat`) and `GG_FAKE_CODEX_STREAM=none`.
  - `keeps the invalid-value|missing-thread refusal when stderr is repeat|banner-repeat and the stream reports report|none` (6 cases). Each expects `HARNESS_ARGUMENTS_REJECTED`, the provider's text and `delivery-uncertain`.
  - `fails the run on the invalid-value|missing-thread refusal repeated on stderr as a refusal, never a missing session`, through `createTestEngine` (2 cases). The run record is exactly `HARNESS_TURN_FAILED`, `details.adapterCode: HARNESS_ARGUMENTS_REJECTED`, the provider's message and `delivery-uncertain`, with no `missingSession`. Resume is refused.
- **`apps/api/src/provider-refusal.test.ts`**, over HTTP with the real `CodexHarness`: `records the refusal … repeated on stderr as the refusal, with Resume refused and Replay allowed`, for both texts. The fake CLI gained `GG_FAKE_PROVIDER_TEXT` and `GG_FAKE_CODEX_STDERR=repeat`. Each case asserts:
  - `failure.code: HARNESS_TURN_FAILED`, `details.adapterCode: HARNESS_ARGUMENTS_REJECTED`, the message `harness turn failed: The provider refused the request (HTTP 400, reasoning.effort): <text>`, `inference.submission: delivery-uncertain`, no `missingSession`;
  - `recovery.resume` `{allowed: false, code: FAILURE_NOT_RESUMABLE}`, and Replay at `infer` allowed;
  - `POST /resume` refused with 409 `FAILURE_NOT_RESUMABLE`, and one turn.
- **`packages/adapter-codex/src/events.test.ts`:**
  - the structured refusal inside the exit error for both texts, also after a banner line;
  - another structured provider error (429) read from its structure;
  - the repeat rule: stderr `ERROR: <the stream's JSON>`, which no parse reaches and the heuristics would call a missing session, is dropped, while a distinct `No rollout found …` on stderr still outranks.

**The auditor's driver, copied.** [scripts/scan2-wrapper-http.mjs](scripts/scan2-wrapper-http.mjs) with [scripts/scan2-order-cli.mjs](scripts/scan2-order-cli.mjs) changes only the fake CLI name, the temporary prefix and the output path. On the built fix, both rows meet its expectations and its assertions pass (exit 0) ([scan2-wrapper-http.log.txt](scan2-wrapper-http.log.txt), [console](scan2-wrapper-http-console.log.txt)):

- `HARNESS_TURN_FAILED` / `HARNESS_ARGUMENTS_REJECTED`, `delivery-uncertain`, the full provider message;
- Resume 409 `FAILURE_NOT_RESUMABLE`.

**Docs.** docs/05 (evidence fold), docs/06 (Codex failure mapping) and the #243 CHANGELOG bullet describe the structured stderr payload and the repeat rule.

**Checks**, Node `v22.23.4`, logs `gates/s2-*`:

| Check                                                                                                                              | Result                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `pnpm build`                                                                                                                       | pass                                                                                                   |
| `pnpm --filter @graphgoblin/adapter-codex test:coverage`                                                                           | pass: 568 passed, 4 skipped (live); statements 98.05%, branches 95.15%, functions 99.06%, lines 99.27% |
| `pnpm --filter @graphgoblin/engine exec vitest run src/handlers/inference-refusal.test.ts`                                         | pass, 20/20                                                                                            |
| `pnpm --filter @graphgoblin/api exec vitest run src/provider-refusal.test.ts` (`GG_TEST_PORT_START=7000`, `GG_TEST_PORT_COUNT=40`) | pass, 3/3                                                                                              |
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check`                                                                                 | pass                                                                                                   |

**Not changed.** Structured errors other than the 400 refusal still go through the existing rules in their existing order; the status checks for 429, 401/403 and 5xx come after the text heuristics, as before. The audit's N1 (local Windows termination checks blocked by `taskkill` Access denied, D-015) is environmental and outside this change.

## Scan 3 (capped path)

The third and last audit, at `732dba52`, returned CHANGES REQUIRED with two P2 findings in `packages/adapter-codex/src/events.ts`. Its record is kept outside this branch. PR #426 is at the D-035 cap, so this fix goes through the capped path: the orchestrator's review, an independent behaviour QA and green CI, with no further scan.

**Finding 1: the repeat detector discarded new stderr evidence.**

- **Cause.** Scan 2 treated the whole exit error as a repeat when its stderr contained any structured error the stream had reported, or when its single classification had the stream's code and message.
- **Effect.** Stderr holding the stream's refusal followed by a different cause lost that cause:
  - a later refusal with another parameter;
  - a genuine missing session, as JSON or as text;
  - an authentication failure after a repeated quota error.
- **Retry flag.** Comparing code and message alone also merged an exhausted quota with a rate limit of the same message, and kept the wrong retry flag.

**Finding 2: completion disabled the protection.** With `turn.completed` before or after a pinned `turn.failed`, the scan 2 rule (unfinished turns only) let a decorated repeat (`ERROR: <the same refusal JSON>`) through to the text heuristics. "Thread not found in referenced input." became a false missing session with Start-fresh guidance. "Error: invalid value …" lost its provider text and parameter. The audit's 1,200-case ordering matrix had 46 such failures.

**Fix** (`TurnAccumulator.fail`, with `stderrEvidence` and `lineProviderError`):

- **Pieces.** The exit error's stderr is split into pieces of evidence. A stderr that is one structured provider error as a whole (also pretty-printed over several lines) is one piece. Otherwise each line is a piece, read from the structured provider error it holds, also after a prefix such as `ERROR: `, and as text otherwise. Each piece is classified on its own.
- **Repeats.** A piece is a repeat only when it equals evidence the stream reported in code, message, retry flag and submission metadata. Repeats add nothing.
- **Distinct causes.** Every other typed piece joins the fold in stderr order, so the shared ranking and the later-observation rule decide.
- **Nothing new and typed.** The wrapper then adds nothing if the stream reported the turn's failure: fatal stream evidence (`turn.failed`, or an error of pinned or terminal rank) whatever the completion flag says, or any reported error of an unfinished turn. Otherwise the whole exit error is the cause, as before (for example a crash with only the banner on stderr).
- **Kept.** Other thrown errors and the shared ranking are unchanged. A successful turn with only diagnostics, followed by a distinct exit error, still fails with that exit error.

**Regression tests.** 13 cases failed against `732dba52`, with only `events.ts` restored for the run ([tests-scan3-adapter-before.log.txt](tests-scan3-adapter-before.log.txt)). Five more pass before and after: the audit's three controls, and the two decorated-repeat cases without completion, which scan 2 already fixed.

- **`packages/adapter-codex/src/stderr-evidence.test.ts`** (new), through the public `CodexHarness` and the real SDK with the spec-driven fake CLI [`fixtures/spec-cli.mjs`](../../../packages/adapter-codex/src/fixtures/spec-cli.mjs), the audit's fixture shape. Each case asserts the exact harness error: code, message, retry flag and submission.
  - The audit's 9 mixed-cause rows: a different refusal, repeat then a different refusal, missing session alone, repeat then missing session as JSON and as text, authentication after quota, repeat then authentication, and the two same-message quota/rate rows.
  - Both misleading provider texts with a decorated repeat in orders `SF`, `SCF` and `SFC`.
  - Two engine-level runs for `SCF` and `SFC`. The run fails `HARNESS_TURN_FAILED` with `details.adapterCode: HARNESS_ARGUMENTS_REJECTED`, the provider's message and `delivery-uncertain`, with no `missingSession`; Resume is refused.
- **`packages/adapter-codex/src/events.test.ts`:** `folds each distinct stderr piece and keeps repeats out, also after completion`:
  - completion plus a decorated repeat and a non-JSON line;
  - a pretty-printed provider error read as a whole;
  - a typed piece without stream evidence, read without the prefix.
- **The audit's drivers, copied** to `scripts/scan3-*.mjs`. Only the fixture name, the output paths, the temporary prefixes and, for the durable driver, the port were changed; the port is 6671, inside this work's range. All were run on the built fix:
  - **`scan3-mixed-causes.mjs`: 12/12 rows pass**, exit 0 ([log](scan3-mixed-causes.log.txt), [console](scan3-mixed-causes-console.log.txt)). Over HTTP:
    - the new refusal and both completion orders give `HARNESS_TURN_FAILED`/`HARNESS_ARGUMENTS_REJECTED` with Resume 409;
    - the new missing session gives `HARNESS_SESSION_MISSING` with Resume 409;
    - repeat then authentication gives resumable `HARNESS_NOT_AUTHENTICATED`.
  - **`scan3-durable-http.mjs`: all 4 rows** over actual HTTP on port 6671, on-disk SQLite and fresh gateway processes, identical after restart ([log](scan3-durable-http.log.txt), [console](scan3-durable-http-console.log.txt)):
    - the new refusal is kept, `FAILURE_NOT_RESUMABLE`;
    - the genuine new missing session gives `SESSION_RECOVERY_REQUIRED`;
    - both completion orders keep the refusal, `FAILURE_NOT_RESUMABLE`.
  - **`scan3-extended-order-matrix.mjs`: 1,200 of 1,200 cases pass** (audit: 46 failures) ([log](scan3-extended-order-matrix.log.txt), [console](scan3-extended-order-matrix-console.log.txt)). This ran on the build before the final comment-only edit and Prettier pass of `events.ts`; the runtime code is the same.

**Docs.** docs/05 (evidence fold), docs/06 (Codex failure mapping) and the #243 CHANGELOG bullet describe the piece-by-piece comparison and the completion rule.

**Checks**, Node `v22.23.4`, logs `gates/s3-*`:

| Check                                                                                                                              | Result                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `pnpm build`                                                                                                                       | pass                                                                                                  |
| `pnpm --filter @graphgoblin/adapter-codex test:coverage`                                                                           | pass: 586 passed, 4 skipped (live); statements 98.12%, branches 95.38%, functions 99.11%, lines 99.3% |
| `pnpm --filter @graphgoblin/engine exec vitest run src/handlers/inference-refusal.test.ts`                                         | pass, 20/20                                                                                           |
| `pnpm --filter @graphgoblin/api exec vitest run src/provider-refusal.test.ts` (`GG_TEST_PORT_START=7000`, `GG_TEST_PORT_COUNT=40`) | pass, 3/3                                                                                             |
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check`                                                                                 | pass                                                                                                  |

## Live check for the QA to repeat

The fixes were verified only with fake CLIs. The independent behaviour QA should repeat one real Codex turn, as follows:

1. **D1 without a turn.** On the built branch, `GET /model-catalog` lists the table above for every Codex model. In the editor, the Effort list of a Codex `gpt-6-luna` node offers `low` to `max`, and no `minimal`. A loop or Settings default with Codex `minimal` is refused with `EFFORT_UNSUPPORTED`.
2. **D2 with one real refused turn.** The product no longer sends `minimal`, and a run pinned to it now fails before any request, so the refusal has to be provoked on a disposable store. With the gateway running, add `"minimal"` to the `efforts` JSON of the `codex`/`gpt-6-luna` row in `model_catalog`, for example with the sqlite3 shell. Then publish a loop with a Codex inference node on `gpt-6-luna` at effort `minimal` and start one run. The seed refresh at the next start removes the edit. Expect:
   - `failure.code: HARNESS_TURN_FAILED`, `details.adapterCode: HARNESS_ARGUMENTS_REJECTED`, `resumable: false`;
   - a message starting `harness turn failed: The provider refused the request (HTTP 400, reasoning.effort): Unsupported value: 'minimal' …`;
   - no `Reading prompt from stdin` in the run record, the gateway's `codex turn failed` log line or the inspector;
   - no Resume in the inspector, and `POST /runs/{id}/resume` refused with 409.

   `failure.inference.submission` stays `delivery-uncertain`, for the reasons given above.

3. Optionally, one cheap real turn at `low` on `gpt-6-luna`, to show an accepted turn still completes and records `low`.

## Files

- `README.md`; [codex-catalog-efforts.log.txt](codex-catalog-efforts.log.txt) and [scripts/codex-catalog-efforts.mjs](scripts/codex-catalog-efforts.mjs) (D1 source); `tests-*-before.log.txt` (the regression tests run against the original product code, after the tests were written and before any product change); [kept-minimal-inference.png](kept-minimal-inference.png), [kept-minimal-llm.png](kept-minimal-llm.png) and [settings-kept-minimal.png](settings-kept-minimal.png) (Edge, from the `model-effort` spec after the fix); `gates/*.log.txt` (`gates/r1-*` after review round 1); [tests-review-r1-before.log.txt](tests-review-r1-before.log.txt), [review-r1-error-probes.log.txt](review-r1-error-probes.log.txt) and the copied review probe in `scripts/review-r1-*.mjs`; `tests-scan2-*-before.log.txt`, `scan2-wrapper-http*.log.txt` and the copied audit driver in `scripts/scan2-*.mjs` (scan 2); `tests-scan3-adapter-before.log.txt`, `scan3-*.log.txt` and the copied audit drivers in `scripts/scan3-*.mjs` (scan 3); [scripts/redact-copy.mjs](scripts/redact-copy.mjs), which copied captured output here.
- Paths, the user name, the machine name and SIDs are redacted. Every file is UTF-8 without a byte-order mark and under 1,000,000 bytes, so there is no `NOT-KEPT.md`.

## Cleanup

- The tests remove their own temporary directories. The 16 `gg-f2fix-api-*` stores that the API runs left in `%TEMP%` (the Windows libsql handle leak that predates this change) and this session's captured outputs (`%TEMP%\gg-f2fix-*.txt`) were deleted after copying.
- No process from these checks is left running, and nothing listens on ports 7000 to 7039 or 6670 to 6679. The owner's ports 4747/4748, `~/.graphgoblin`, the main checkout and other worktrees were not touched; review round 1 only read and copied the review folder. This work pushed and merged nothing (the orchestrator pushes the branch).
