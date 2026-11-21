# #486 leaf author handoff

Bounded L implementation at `G:/ggq/gg-i4-486-authored-errors/GraphGoblin`, base `02351e2fb932b3be44e7cc3fb3943a61d568226c`. Root dispatched after actual Fable03 ACCEPT and D188/public admission, against the accepted real interface freeze v1. This is implementation-author evidence, not independent review, native/API/MCP/browser QA, acceptance, merge, or issue closure.

## Ownership and behavior

Only these repository files were edited:

- `packages/engine/src/handlers/script.ts`
- `packages/engine/src/handlers/heartbeat.ts`
- `packages/engine/src/handlers/decision.ts`
- `packages/engine/src/handlers/wait.ts`
- `packages/engine/src/handlers/flow.test.ts`
- `packages/engine/src/handlers/heartbeat-visit.test.ts`

Consumed `renderAuthored`, `predicateAuthored`, `authoredFailure`, `nodeWorkingDirectory`, `AuthoredSite`, and the selector's frozen fourth site argument. No helper, shared file, port, fake, barrel, RunManager, document, schema, dependency, or provider policy was edited. File-local test fixtures were expressly confirmed by root. No index operation, commit, push, owner-store action, provider request, agent spawn, or native service launch was performed.

- **B01:** indexed script argument rendering; previous unfinished-dispatch guard remains first; existing workspace/secret reads remain in their order. Genuine argument errors record no dispatch or runner invocation. External runner rejection after dispatch keeps uncertainty and consent requirements.
- **B02-B04:** header indices follow `Object.entries` order; headers/URL/body finish rendering before the HTTP callback; script probe arguments render before workspace resolution/runner. No current beat is recorded on these failures.
- **B05-B06:** until/deadline failures occur after the actual probe and durable beat. Fixed until causes omit all evaluated text, including direct/grouped/conditional/dynamic/assertion failures. Top-level syntax/unsafe-regex fixtures are explicitly synthetic publish-validation bypasses; nested `$eval` failures stay neutral. Timestamp NaN uses safe fixed text/false. Successful until bypasses the deadline. Existing lexical views, summary/full beat payloads and observed beat numbering remain intact.
- **B20:** expression routing still uses the existing primitive evaluator, fixed expression failure/invalid-response behavior and abort checks.
- **B21-B22:** instruction/question templates and indexed context selectors fail before a provider call; ordinary selected context and full-thread question rendering succeed. Provider errors retain provider policy.
- **B23-B24:** input prompt/timestamp faults occur before park/timer/wake/input effects; safe timestamp copy; waking bypasses rendering. View preparation is confined to the two template-bearing wait modes.
- **B26 consumers:** script/probe unwrap only engine-local workspace outcomes where workspace cwd is used; fixed script cwd bypasses an unused workspace. External resolve exceptions retain their path. W owns and verifies actual filesystem/cache/journal migration.

Assertions include exact code/node/message/boundary/cause/index and stored failure/event parity for deterministic failures, actual refused Resume followed by unchanged effects/events/timers, no raw marker in the new failure/logger projection, successful siblings and external same-class/name/code lookalikes. Probe response conversion and overflow remain separate controls. Ordinary recorded probe payloads are allowed to contain input markers; they are not new failure projections.

## Verification and all check attempts

Project runtime `v22.23.4`, `pnpm.cmd`, task-local `TEMP` and `TMP` = `G:/ggq/qa-scratch/i4-486-leaf`. No build, full coverage, shared-output tsc, install, or combined repository gate was run by L while A/W were writing.

| Attempt | Result | Evidence / correction |
| --- | --- | --- |
| leaf Vitest 01 | 92 pass / 10 fail | `leaf-vitest-01.log`: new fixture used a non-ULID dispatch id, omitted required heartbeat stop condition, and queried an absent optional details object with a matcher requiring an object. Corrected fixture inputs and nested absence assertions; no production failure identified. |
| leaf Vitest 02 | 101 pass / 1 fail | `leaf-vitest-02.log`: new helper's default maxBeats=1 exhausted a planned two-beat success. Set that scenario's maxBeats=3. |
| leaf Vitest 03 | 116/116 pass, exit 0 | `leaf-vitest-03.log`; added external/cwd/later-beat controls before this pass. |
| owned ESLint 01 | 9 test-only diagnostics, exit 1 | `leaf-eslint-01.log`: unnecessary assertions/escapes and intentional plain-object rejection lint. Removed redundant syntax; added narrowly explained rejection-input comments. |
| leaf Vitest 04 | 116/116 pass, exit 0 | `leaf-vitest-04.log`; final source behavior. |
| owned ESLint 02 | pass, exit 0 | `leaf-eslint-02.log` (empty successful output). |
| final Prettier check | pass, exit 0 | `leaf-prettier-check-01.log`. Formatting pass also retained as `leaf-format-01.log`. |
| owned diff check | pass, exit 0 | `leaf-diffcheck-01.log` (empty successful output). |

Vitest command: `pnpm.cmd --filter @graphgoblin/engine exec vitest run src/handlers/flow.test.ts src/handlers/heartbeat-visit.test.ts`.

ESLint command: `pnpm.cmd --filter @graphgoblin/engine exec eslint src/handlers/script.ts src/handlers/heartbeat.ts src/handlers/decision.ts src/handlers/wait.ts src/handlers/flow.test.ts src/handlers/heartbeat-visit.test.ts`.

One intermediate apply_patch attempt was rejected before any write because a Prettier-adjusted expected context no longer matched (`Failed to find expected lines ... script: { visitId: 'prior', dispatchId: 'dispatch', state: 'outcome-uncertain' }`). The current lines were read, and the corrected atomic patch then applied. No source was reverted.

## Source binding and remaining gates

`source-before/` and `source-before-binding.json` bind the six untouched leaf files at admission. `source-after/` and `source-after-binding.json` bind the six final files. `leaf.patch` contains only L's six-file diff; SHA-256 `f2760e5f4020406af53b8b3c7b924c49fba091e1d5b49253e336e8205bf06c8e`. `consumed-source-at-handoff.json` records the dirty shared dependency hashes observed at handoff, not an immutable all-repository test snapshot. A/W edits were preserved throughout; root must bind the final combined source and run combined gates. Initial/final working-tree inventories are retained.

No known L production/interface blocker remains. Remaining coordinator gates include full typecheck/coverage/repository checks at a stable combined source, any required integration correction, independent actual Claude review and separate native filesystem/SQLite/script/HTTP/API/MCP/browser QA, current-head/current-target CI, final audit, authorized Git delivery and owner decision review/QA. The changed production control flow preserves cancellation/timeout/stop/termination code; this leaf test group does not independently establish all native interruption races.

Tests used fake ports and in-memory RunManager plus direct public handler controls. The wake-bypass case substitutes a malformed context config after a real initial park as a controlled handler fixture; it does not claim a mutable production pinned definition. No real filesystem/process/network sink or paid provider was exercised. Vitest/ESLint processes exited. Task-local scratch and evidence are retained for root; no cleanup deletion was needed.
