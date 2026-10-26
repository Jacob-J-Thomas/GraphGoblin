# WP-F4 / #265 implementation evidence

## 1. Branch and worktree

Branch `codex-wp-f4-265`, worktree
`%USERPROFILE%/source/repos/GraphGoblin/.claude/worktrees/codex-wp-f4-265`.
Base `d32aa382cfc5578632e8b2b2cfd11813df9f8c44`. Uncommitted; ready for orchestrator
commit. Verification qualifications and the remaining acceptance work are listed below.

## 2. Per bolt

**#265 research result: confirmed through controlled public interfaces.** Missing
sessions already stopped and plain Resume already refused. The reproduced defects
were generic cause wording, the absent explicit recovery action, and premature
Codex reuse announcements. See [baseline.log.txt](baseline.log.txt) for commands,
quoted failures, setup corrections and evidence limits.

The eight-case baseline is also captured in
[baseline-matrix.json](baseline-matrix.json). Its engine sources are byte-exact
blobs from the base commit, verified by the hashes in
[baseline-source-manifest.json](baseline-source-manifest.json), in an ignored
worktree-local snapshot. It uses current installed contracts/domain dependencies:
domain is unchanged and the added optional contract fields are unused by this
baseline. This is an exact base-engine probe, not an unchanged whole-repository run.
Source and probe captures are preserved alongside the manifest.

The table describes controlled engine/adapter behavior, not installed-CLI behavior.
The same provider port is used by all session policies; no production component was
patched to inject a failure.

| Harness             | Session mode                              | Before                                                                                             | After                                                                                              |
| ------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Codex               | Fresh normal visit                        | Fresh start; succeeds; no resume/reuse                                                             | Preserved                                                                                          |
| Claude              | Fresh normal visit                        | Fresh start; succeeds; no resume/reuse                                                             | Preserved                                                                                          |
| Codex               | Inherited previous                        | `HARNESS_SESSION_MISSING`, generic message, Resume rejected, no fresh action                       | ID/origin named; explicit choice starts fresh with same task/model                                 |
| Claude              | Inherited previous                        | Same stop/refusal; fake reports no reuse                                                           | Same explicit recovery; durable guard also rejects premature reuse claims                          |
| Codex               | Own-session revisit                       | `HARNESS_SESSION_MISSING`, generic message, Resume rejected                                        | Explicit fresh choice; authored own policy remains for later visits                                |
| Claude              | Own-session revisit                       | Same stop/refusal                                                                                  | Same explicit recovery                                                                             |
| Codex               | Own after configured reset                | New fresh start; succeeds; old handle unused                                                       | Preserved; reset count unchanged by retries/recovery                                               |
| Claude              | Own after configured reset                | New fresh start; succeeds; old handle unused                                                       | Preserved                                                                                          |
| Both                | Named inheritance                         | Before wording/action follows the shared inherited path; not separately executed on unchanged main | Public engine tests cover missing ID, choice and later normal named selection                      |
| Both                | Fresh visit's interrupted continuation    | Not separately executed on unchanged main                                                          | Explicit missing cause after normal continuation attempt; chosen retry uses original authored task |
| Codex SDK fixture   | Unknown handle, promise/iterator refusal  | Premature `mode: resumed` record                                                                   | No resumed announcement on failure                                                                 |
| Codex SDK fixture   | Matching init followed by missing refusal | Premature reuse also reproduced after the initial fix                                              | No reuse claim until successful turn                                                               |
| Real installed CLIs | Unknown native ID                         | **Not run: D-005 delegates provider verification to orchestrator**                                 | Still outstanding; fake evidence does not qualify this row                                         |

The added action requires the observed failed event sequence and exact inference
node. It records actor, timestamp, node/visit, prior handle/origin, unchanged
model/effort, original task and `priorContextCarried: false` in one durable resume
intent. Declining sends no request and leaves the failure. Wrong/stale/repeated and
concurrent choices reject. Child recovery is explicit on the actual inference run;
a containing parent can subsequently Resume after that child's durable recovery.

For both failed baseline modes, the exact message is: "The recorded provider
session is missing or refused. An explicit fresh-session choice is required."
`resumable` is false and Resume returns `INVALID_STATE`. The baseline fake emits
only the upstream/earlier fresh announcement, so those engine cases already avoid
a reuse claim. The separate Codex SDK fixtures reproduce the adapter's premature
claim. Fresh and own-reset each start twice and never call resume; Resume on their
already successful run returns `INVALID_STATE`, as expected.

## 3. Files changed

- Contracts: typed missing-session failure metadata and fresh-session resume payload.
- Engine: inference selection/recording, durable choice action, child recovery eligibility and public tests.
- Codex adapter: native identity checks, success-gated reuse announcement and fixtures.
- API: recovery route, scope/owner/concurrency tests and real-process restart scripts.
- API client: generated OpenAPI/types and `runs.recoverSession` wrapper/test.
- Web: additive inspector recovery control, component tests and browser spec.
- Docs: 04/05/06/07/09, troubleshooting guide 07, ADR-0055, CHANGELOG and generated API reference.

No edits to `useRunEvents.ts`, `projections.ts`, evidence panels, owner store or main
checkout. The additive integration ranges (candidate line numbers) are:

- `apps/web/src/runs/RunInspectorPage.tsx`: import line 14 and control line 151.
- `apps/api/src/routes/runs.ts`: new route lines 254-274.
- `apps/api/src/adversarial.test.ts`: scope inventory line 149.
- `packages/api-client/src/resources.ts`: new wrapper lines 145-150.
- `packages/engine/src/run-manager.ts`: imports 78-79, failed Resume eligibility
  1042-1045 and 1059, and new action 1088-1151. The shared resume path retains its
  existing lock, terminal-sequence check and durable-intent completion.

All other shared-document edits are the issue-required behavior sections; generated
OpenAPI/reference changes describe the additive action and event/failure metadata.
The complete changed tracked-file hunk inventory, including every shared-document
range, is in [shared-ranges.log.txt](shared-ranges.log.txt).

## 4. Tests

The new engine matrix covers both harnesses, fresh/reset, inherited previous/named,
own continuation, exact task/model retention, declined reconstruction, and cancellation.
API tests cover plain Resume refusal, recovery, wrong state/node/sequence, strict
request fields, read-only and foreign-owner callers, API-key actor, concurrent
choice, repeated choice and containing-parent recovery. Web tests cover wording,
leaving failed, keyboard submission, pending/error state, invalidation and durable
history. Codex fixtures cover missing-session boundaries and native identity/refusal.

`missing-session.integration.mjs` exercises the built production API and SQLite in
real processes with only the provider port controlled. It removes the fake provider's
session file, restarts the failed gateway, then exits exactly after the recovery
choice commits and before its status write. Both inherited and own modes are checked
for both harnesses. The browser spec drives fail, leave failed, reload, choose and
succeed on the built web app. The final four native restart cases pass (217.27s),
and the single Edge/Chromium browser case passes with retries disabled (44.0s total).
See [restart-candidate.log.txt](restart-candidate.log.txt) and
[browser.log.txt](browser.log.txt). The restart events and provider-call captures
are retained for each harness/policy pair. The production API and SQLite are real;
the provider boundary is a synthetic file-backed port, not an installed CLI.

Final engine coverage passes: 47 files / 1662 tests, 97.54% lines (2745/2814),
91.87% branches (2396/2608). Its 17 new matrix tests include fresh interrupted
continuations and repair recovery restarting the original authored task. The six
new API tests pass on the final candidate; the advertised scope inventory passed
after its route entry was added, but a later candidate run timed out at 20 seconds.
Both observations are retained; a later pass does not erase a failure.

| Changed package | Lines                   | Branches                | Final test observation            |
| --------------- | ----------------------- | ----------------------- | --------------------------------- |
| Engine          | 97.54% (2745/2814)      | 91.87% (2396/2608)      | 1662 passed                       |
| Contracts       | 99.74% (387/388)        | 95% (190/200)           | 280 passed                        |
| API client      | 100% (247/247)          | 99.37% (160/161)        | 73 passed                         |
| API             | 97.52% (1974/2024)      | 92.09% (1387/1506)      | 1355 passed, 1 failed, 11 skipped |
| Web             | Not produced on failure | Not produced on failure | 1649 passed, 4 failed             |
| Codex adapter   | Not produced on failure | Not produced on failure | 494 passed, 2 failed, 5 skipped   |

API candidate coverage is in `api-coverage-candidate.log.txt`; the action tests and
advertised-scope inventory pass in that full run. The only failure is the untouched
`main.test.ts:69` CLI-dispatch test's 60-second timeout. Its single isolated run passes;
the gate failure remains unresolved rather than being erased by that pass.
Infrastructure was read but not changed;
its coverage gate was not requested for an unchanged package. No dependency changed,
so the conditional license gate is not applicable.

## 5. Gates

`run-gates.ps1` runs Node 22 and records exact commands, exits, elapsed time and log
names in `gates.json`. Coverage uses two workers to bound load on the shared host;
thresholds and denominators are unchanged. Logs replace the local profile prefix
with `%USERPROFILE%`. LIVE/PERF suites are disabled for this bounded worker run.
Native and browser result logs are recorded separately after the build.

The initial API package gate inherited the repository subprocess defaults
(`5600-5699`, `gg-api-process-`). The added restart proof and browser proof use
`5990-5999`; the candidate API gate and subsequent process diagnostics bind
`GG_TEST_PORT_START=5990`, `GG_TEST_PORT_COUNT=10`, and
`GG_TEST_STORE_PREFIX=gg-wp-f4-265-`. No owner port/store was used. The retained
gate script now sets those bounds explicitly for reproduction.

One preliminary typecheck failed on an invalid `exact` testing-library option in a
new test; it was corrected. One web assertion originally omitted the displayed
API code; its expected text was corrected. Neither was a product finding or retried
without a change. The final result table below supplements the initial chronological
`gates.json`; failure captures are retained rather than overwritten.

| Command (Node v22.14.0)                                                                       | Result                                                                             |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `pnpm docs:generate`                                                                          | Pass                                                                               |
| `pnpm typecheck`                                                                              | Pass, final 20/20 tasks (`typecheck-final.log.txt`)                                |
| `pnpm lint`                                                                                   | Pass, final 11/11 tasks, one untouched warning (`lint-candidate.log.txt`)          |
| `pnpm format:check`                                                                           | Pass; later changed files also pass `pnpm exec prettier --check`                   |
| `pnpm check:layers`                                                                           | Pass                                                                               |
| `pnpm check:deps`                                                                             | Pass                                                                               |
| `pnpm check:docs`                                                                             | Pass, generated docs current                                                       |
| `pnpm check:migrations`                                                                       | Pass, Drizzle no-op                                                                |
| `pnpm check:tokens`                                                                           | Pass, 171 source files                                                             |
| `pnpm --filter @graphgoblin/engine test:coverage --maxWorkers=2`                              | Pass, final `engine-coverage-final.log.txt`                                        |
| `pnpm --filter @graphgoblin/api test:coverage --maxWorkers=2`                                 | Fail initially; two own findings corrected, two untouched timeouts retained        |
| `pnpm --filter @graphgoblin/web test:coverage --maxWorkers=2`                                 | Fail, four untouched editor tests                                                  |
| `pnpm --filter @graphgoblin/adapter-codex test:coverage --maxWorkers=2`                       | Fail, two untouched readiness fixture tests                                        |
| `pnpm --filter @graphgoblin/contracts test:coverage --maxWorkers=2`                           | Pass                                                                               |
| `pnpm --filter @graphgoblin/api-client test:coverage --maxWorkers=2`                          | Pass                                                                               |
| `pnpm build`                                                                                  | Pass; 11 tasks, final cached run; preceding browser build compiled current sources |
| `pnpm build --filter=@graphgoblin/api`                                                        | Pass, seven tasks before final native proof                                        |
| `node --test apps/api/scripts/missing-session.integration.mjs`                                | Pass, four real-process cases                                                      |
| `pnpm --filter @graphgoblin/web exec playwright test e2e/missing-session.spec.ts --retries=0` | Pass, one built-web browser case                                                   |

The final API package command adds `--coverage.reportOnFailure` so its denominator
is reported even if an unrelated test fails. It is justified by the actual parent
eligibility and route-inventory fixes after the initial full run, not a retry of
unchanged source to erase failures.

The final `pnpm format:check` passes again (`format-final.log.txt`, 627.69 seconds).
Evidence Markdown is formatted once more after the final result entries.

| Additional command                                                                                                                                                                                           | Result                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @graphgoblin/api test:coverage --maxWorkers=2 --coverage.reportOnFailure`                                                                                                                     | Fails: one untouched CLI-dispatch timeout. All recovery tests pass; coverage exceeds 90%.                                                         |
| `pnpm --filter @graphgoblin/api exec vitest run src/missing-session.test.ts src/adversarial.test.ts -t 'missing-session\|explicit parent Resume\|every advertised route against every scope' --maxWorkers=1` | Six recovery tests pass; scope inventory times out at 20 seconds in this run. Its earlier fixed-inventory run and the final full API run pass it. |
| `pnpm --filter @graphgoblin/api exec vitest run src/subloop-restart.test.ts -t 'hard kill around child completion' --maxWorkers=1`                                                                           | Fails again at 180 seconds in isolation; later final full API run passes it.                                                                      |
| `pnpm --filter @graphgoblin/api exec vitest run src/templates/catalog-package.test.ts -t 'ships only declared' --maxWorkers=1`                                                                               | Passes in isolation; final full API run also passes. Original timeout retained.                                                                   |
| `pnpm --filter @graphgoblin/adapter-codex exec vitest run src/probe-directory.test.ts --maxWorkers=1`                                                                                                        | Four pass in the single isolated run; package gate failure retained.                                                                              |
| `pnpm --filter @graphgoblin/api exec vitest run src/main.test.ts -t 'dispatches the API-key and preflight CLIs with their real exit codes' --maxWorkers=1`                                                   | One passes, eight skipped in isolation; final package gate failure retained.                                                                      |

The two latest isolated native results are recorded in `isolated-native-results.json`.
No unrelated source, timeout, coverage threshold or exclusion was changed.

The initial full lint found missing fixture globals and an async function with no
await in the new fixture. Both were corrected; final full lint passes. Its remaining
warning is the untouched `ThreadViewer.tsx:106` `react/hook-use-state` warning.
The first native integration attempt failed because the new wait fixture lacked
its required prompt; the initial source is preserved. A subsequent diagnostic-only
edit shadowed a request parameter and failed parsing; it was corrected and checked
before the final four-case run. No failed capture is presented as provider evidence.

## 6. Docs

ADR-0055 records the event-first recovery decision and upgrade boundary. The top
Unreleased CHANGELOG bullet ends `(#265)`. Upgrade gateway/web/generated clients
together; no SQL migration or store reset. Historical failures lacking new typed
provenance are not rewritten or granted fresh-session eligibility; deliberately
start a new run/replay for those records. Relevant numbered docs and guide 07 explain
context loss, retained settings, API scope and inspector wording.

## 7. Decisions and parameters

- Reuse `run.resumed` as the atomic choice plus resume intent, using existing restart recovery.
- Bind approval to `nodeId` and exact `failureSeq`, rejecting stale/concurrent requests.
- Restart the authored node task, not a continuation/repair in a blank conversation.
- Preserve configured policy, inputs, model/effort, shared thread and visit/reset counts.
- Store requested handles immediately as provenance; claim reuse only after success.
- Keep SQL unchanged because events/failures are already validated JSON.
- Restrict parent eligibility to its same owned child's durable later resume and absence of a
  runtime failure. Authored Failure/Exhausted outcomes remain business data per #251.
- Controlled restart stores use `gg-wp-f4-265-`; manual ports are 5990-5999.
- Native scenario bounds are 60 seconds per poll and 240 seconds per case, to bound
  repeated process startup on this host; these are worker choices, not owner-approved
  performance targets. Browser retries are explicitly zero. Coverage workers are two.

## 8. Caveats and open items

D-005 real unknown-session CLI checks, independent review/QA/audit, orchestration
commit and owner product acceptance remain separate work. No provider turn, GitHub
write, commit, push or owner-environment action occurred. Temporary restart stores
and ignored coverage/browser outputs are left for the orchestrator; no directory
cleanup was attempted. Baseline terminal output was not retained; its evidence file
is explicitly a transcribed record. Retained logs and small restart evidence are
under this directory. No report capture exceeds 1,000,000 bytes; see `NOT-KEPT.md`.

Register `docs/delivery/2026-10-18-i01-i07-register.md:106`, D-005, assigns
"Live-provider verification ... by Claude workers or the orchestrator, not Codex
workers (sandbox cannot write the Claude CLI home)." The real-CLI reproduction row
therefore remains explicitly unresolved for that assigned verifier; no sandbox or
provider-home workaround was attempted here.

Observed outside scope, with unresolved causes: the untouched
`apps/api/src/subloop-restart.test.ts:133` hard-kill test times out at 180 seconds
both in the package gate and in isolation. The untouched
`apps/api/src/templates/catalog-package.test.ts:49` rebuild test times out at
20 seconds in that gate and passes in isolation. That isolated pass does not
erase the gate failure. No unrelated timeout was increased and no test was excluded.

The web package run finishes with 130 passed / 3 failed files and 1649 passed /
4 failed tests. Its unchanged editor failures are two 20-second focus-history
timeouts at `apps/web/src/editor/NodeEditorDialog.test.tsx:828`, a 20-second
JSON-history timeout at `apps/web/src/forms/json-sections.test.tsx:657`, and an
unmet restored-heading assertion at
`apps/web/src/editor/EditorPage.restore.test.tsx:129`. Their causes are unresolved.
The package's default reporter omits coverage on failure, so no final web coverage
percentage is qualified. See `web-coverage.log.txt`; the new recovery control tests
are among the passing tests. No unrelated editor source or test was changed.

Codex adapter coverage also fails outside the changed resume tests: the unchanged
`packages/adapter-codex/src/probe-directory.test.ts:33` long-TEMP readiness test
exceeds its 5-second timeout, and the next collision test's cleanup assertion at
line 100 includes that earlier test's root. The run has 494 passed / 2 failed /
5 skipped tests; the resume fixtures pass. The package's coverage summary is not
produced after those failures. No readiness/probe code or test was changed.
Its single isolated file run subsequently passes all four tests in 6.43 seconds;
that does not qualify the failed package gate or provide a package coverage percentage.

Final API coverage has 71 passed / 1 failed / 2 skipped files and 1355 passed /
1 failed / 11 skipped tests. The remaining failure at `apps/api/src/main.test.ts:69`
times out at 60 seconds; the single isolated test passes in a 24.71-second command.
The original scope-inventory, authored-negative-child and two timeout failures all
pass in the final package run. The first two had actual fixes; the timing failures
remain qualifications because later success alone does not resolve them.
