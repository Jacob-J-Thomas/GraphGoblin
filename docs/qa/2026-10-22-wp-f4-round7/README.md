# WP-F4 round 7: synchronous missing-session refusals (#244)

## 1. Branch and worktree

Branch `codex-wp-f4-prompt-provenance`, worktree
`.claude/worktrees/codex-wp-f4-prompt-provenance`. Base and observed HEAD:
`d8a760664bc5da18f56cd3356608093d39c17d00`, clean before work; ancestry from
`34335655` verified with `git merge-base --is-ancestor`. Changes are uncommitted;
ready for orchestrator commit after review. Node `v22.14.0`, PowerShell and
`pnpm.cmd`. No provider turns or other agents.

## 2. Per bolt

**#244 B3: reproduced, then corrected.** Built the unchanged head first
([build](build-before.log.txt)), then ran the auditor's unmodified
`node "$env:TEMP\gg-audit-f4-r2-20261022\session-missing-boundary.mjs"`.
All four cases failed ([log](auditor-before.log.txt), [results](auditor-before.json)).

| Family | `retriable` | Stored code / classification before fix            | Resume / extra calls before fix |
| ------ | ----------- | -------------------------------------------------- | ------------------------------- |
| Codex  | false       | `HARNESS_TURN_FAILED` / `definitely-not-submitted` | 200 / 1                         |
| Codex  | true        | `HARNESS_TURN_FAILED` / `definitely-not-submitted` | 200 / 1                         |
| Claude | false       | `HARNESS_TURN_FAILED` / `definitely-not-submitted` | 409 / 0                         |
| Claude | true        | `HARNESS_TURN_FAILED` / `definitely-not-submitted` | 200 / 1                         |

The Codex failure quotes the complete mismatch:

```text
[{"label":"code","actual":"HARNESS_TURN_FAILED","expected":"HARNESS_SESSION_MISSING"},
 {"label":"submission","actual":"definitely-not-submitted","expected":"session-missing"},
 {"label":"resumable","actual":true,"expected":false},
 {"label":"HTTP status","actual":200,"expected":409},
 {"label":"extra calls","actual":1,"expected":0}]
5 !== 0
```

Claude with `retriable: false` failed both classification assertions (`2 !== 0`);
the other three cases failed all five (`5 !== 0`). This is the current-head
reproduction, independently of the auditor's historical results.

Launch exceptions, streamed errors and rejected results now share a mapper that
returns both the typed cause and the submission classification. A missing session
always records `session-missing`, retains `HARNESS_SESSION_MISSING` and its
`details.adapterCode`, and blocks Resume regardless of family or retryability.
The durable submission event identifies the repair turn and logical visit.
The existing completed-turn handle is still cleared before repair invocation.

The adjacent classification review found two additional losses at the same
boundary: explicit delivery uncertainty and unconfirmed termination were recorded
as definite non-submission. Both now retain uncertainty; termination remains
non-resumable. Result rejection without an error event also preserves missing-session
classification. The inherited-session guard (D-022), per-harness generic failure
rule, pinned refusals and exact saved repair retries retain their existing rules.

The rebuilt API now passes **all four** cases ([log](auditor-after.log.txt),
[results](auditor-after.json)): typed `HARNESS_SESSION_MISSING`, durable
`session-missing`, `resumable: false`, Resume **409**, **zero extra calls**.
The native restart suite passed **5/5 in one execution**
([log](native-restart.log.txt)): accepted-session continuation, both D-022
inherited-session blocks, and result-only Claude acceptance before exit under
previous and named policies. All five used port 5660 and disposable fake-provider stores.

## 3. Files changed

Line numbers refer to the final source; the removed mapper's range refers to the base.

| Package / file                                           | Lines                                                 | Change                                                                                                             |
| -------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `packages/engine/src/handlers/inference-failure.ts`      | 1–82, new                                             | Shared cause and submission mapping, preserving missing sessions and uncertainty                                   |
| `packages/engine/src/handlers/inference.ts`              | 4–38, 122–145, 184–189, 466–504; base 192–241 removed | Mapper extraction, durable streamed/result/launch classification, existing cleanup precedence                      |
| `packages/engine/src/handlers/inference-refusal.test.ts` | 1–148, new                                            | Both families and retry flags through public harness ports; asynchronous and result-only parity; uncertainty cases |
| `apps/api/src/prompt-provenance.test.ts`                 | 2–5, 9–121                                            | Four REST regressions using the public Codex SDK factory / `resumeThread` boundary and Claude harness port         |
| `apps/api/scripts/prompt-restart.integration.mjs`        | 21, 34                                                | Restrict native suite allocation to the round's ports 5660–5669                                                    |
| `docs/05-execution-engine.md`                            | 263–267                                               | Explain synchronous classification and refusal of Resume                                                           |
| `CHANGELOG.md`                                           | 7                                                     | Extend the existing #244 bullet; retain the operational upgrade warning                                            |
| This round-7 directory                                   | all new                                               | Sanitized evidence and this report                                                                                 |

Shared-file edits are explicitly listed above. No `run-manager.ts`, readiness,
adapter production code, contracts, web source, dependencies, historical QA or
matrix artifacts changed.

## 4. Tests

The engine stays independent of adapter packages: its handler tests inject the
supported `HarnessPort`. API tests exercise the real Codex adapter's public SDK
factory, throwing at `resumeThread(id)`, and the public Claude harness port,
matching the auditor's injection boundaries. Neither uses a private method or
patches the component under test. REST history verifies durable turn/visit
classification; Resume must return 409 without a third invocation.

Pre-fix runs, before production edits:

- Engine four synchronous cases failed and four asynchronous counterparts passed
  ([first log](engine-before.log.txt)): `Tests 4 failed | 4 passed (8)`.
- Expanded engine run added the two uncertainty regressions; both failed as well
  ([log](engine-before-expanded.log.txt)): `Tests 6 failed | 4 passed (10)`.
- API four new synchronous cases failed; three existing cases passed
  ([log](api-before.log.txt)): `Tests 4 failed | 3 passed (7)`.

Quoted regression assertions:

```diff
- "code": "HARNESS_SESSION_MISSING"
+ "code": "HARNESS_TURN_FAILED"
- "submission": "session-missing"
+ "submission": "definitely-not-submitted"
- "resumable": false
+ "resumable": true
```

The API also reported `AssertionError: expected 200 to be 409` and an extra call.
The uncertainty cases reported expected `delivery-uncertain`, received
`definitely-not-submitted`. Post-fix focused runs passed 81 engine and 11 API
tests ([engine](engine-focused-after.log.txt), [API](api-focused-after.log.txt)).
Four result-only missing-session cases were subsequently added and passed in
the full engine gate. The final new handler file has 14 cases: twelve missing-session
cases (two families × two retry flags × three boundaries), plus two uncertainty cases.

| Coverage gate | Tests                                        | Lines  | Branches |
| ------------- | -------------------------------------------- | ------ | -------- |
| Engine        | PASS 592                                     | 98.07% | 92.66%   |
| adapter-codex | PASS 102; 5 existing live skips              | 98.80% | 94.72%   |
| API           | FAIL: 752 passed, 1 failed, 6 existing skips | 98.04% | 93.32%   |

The new mapper itself has 100% line and 98% branch coverage. Thresholds and
exclusions are unchanged. Controlled SDK/harness results establish the fault
boundary, not live-provider behavior.

## 5. Gates

All commands run from the worktree root with Node 22 first on PATH.

| Command                                                                                                | Result / evidence                                                                      |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `pnpm.cmd typecheck`                                                                                   | PASS, 20 tasks; [log](typecheck.log.txt)                                               |
| `pnpm.cmd lint`                                                                                        | PASS, 11 tasks; [log](lint.log.txt)                                                    |
| `pnpm.cmd format --ignore-path .prettierignore --ignore-path <protected-ignore>`                       | PASS; [log](format.log.txt)                                                            |
| `pnpm.cmd check:layers`                                                                                | PASS; [log](layers.log.txt)                                                            |
| `pnpm.cmd check:deps`                                                                                  | PASS, zero errors and existing `drizzle.config.ts` orphan warning; [log](deps.log.txt) |
| `pnpm.cmd --filter @graphgoblin/engine test:coverage --maxWorkers=2 --coverage.reportOnFailure`        | PASS; [log](engine-coverage.log.txt)                                                   |
| `pnpm.cmd --filter @graphgoblin/adapter-codex test:coverage --maxWorkers=1 --coverage.reportOnFailure` | PASS; [log](codex-coverage.log.txt)                                                    |
| `pnpm.cmd build`                                                                                       | PASS, 11 uncached tasks; [log](build-after.log.txt)                                    |
| `pnpm.cmd --filter @graphgoblin/api test:coverage --maxWorkers=2 --coverage.reportOnFailure`           | **FAIL**, 752 passed / 1 failed / 6 skipped; [log](api-coverage.log.txt)               |
| Auditor driver against rebuilt code                                                                    | PASS 4/4; [log](auditor-after.log.txt)                                                 |
| `pnpm.cmd test:prompt-restart`                                                                         | PASS 5/5, one execution; [log](native-restart.log.txt)                                 |

The first API coverage command **failed before loading any tests**:
`Cannot find module 'C:Users<user>AppDataLocalTempgg-audit-f4-r2-20261022port-scope.cjs'`.
The preload path's backslashes were consumed by pnpm's shell. The corrected command
uses forward slashes. This setup failure is retained, not classified as D-015 or
silently replaced by the corrected gate ([log](api-coverage-setup-failure.log.txt)).

The corrected API coverage run **failed** in
`src/subloop-restart.test.ts`, `a hard kill around child completion leaves every
parent one continuation after restart`, with:

```text
Error: API child exited before GraphGoblin API listening: Error: listen EADDRINUSE:
address already in use 127.0.0.1:5660
```

This is a listener collision during parallel subprocess tests in the restricted
ten-port range, **not D-015**. One required isolated run,
`pnpm.cmd --filter @graphgoblin/api exec vitest run src/subloop-restart.test.ts --maxWorkers=1`,
passed **3/3** in 60 seconds with the same external port guard
([log](api-subloop-isolated.log.txt)). It recorded all eight kill landings. The
original coverage command remains **FAIL**; neither the passing isolated run nor
the coverage percentages replace that outcome. No broad suite was rerun to turn
this failure green.

The first formatting invocation used a copied ignore file outside the repository;
its `.claude` rule excluded the worktree and it checked no files. It is retained
([log](format-initial.log.txt)) and is not the formatting gate. The corrected root
format command uses the repository's ignore file plus a separate file containing
only the protected QA/matrix patterns. It processed the repository while respecting
the explicit no-touch boundaries. No protected file changed.

## 6. Docs

Docs/05 and the existing CHANGELOG #244 bullet now state the shared classification
semantics. No new schema, API route, failure-detail shape or product decision was
introduced; no generated references, migration, additional upgrade note or ADR is
required. The existing #244 upgrade warning is unchanged. Historical evidence and
matrix files remain owned by the orchestrator and are unchanged.

## 7. Decisions and parameters

- Missing-session classification takes precedence over a retry flag or the fact
  that the adapter returned no handle. A refused conversation cannot be retried
  through Resume; explicit fresh-session choice remains #265.
- Keep each harness's existing generic-failure rule and the pinned-refusal exclusion.
  Continuation eligibility remains a separate D-022 check.
- Preserve explicitly reported transport uncertainty; unconfirmed termination
  forces uncertainty even if a report calls it definite non-submission.
- Restrict the native restart allocator to 5660–5669. For API coverage, the auditor's
  external listener guard restricts stock fixtures to the same range without
  changing their production behavior or assertions. Its source is retained as
  [text](port-scope.cjs.log.txt). The corrected full API gate uses a disposable
  temporary root named `gg-wp-f4-round7-unit`; stock fixtures keep their own
  `gg-api-*` names inside it.
- The auditor's driver is unmodified ([source as text](auditor-driver.mjs.log.txt),
  [hash and actual head](environment.json)). Its JSON hardcodes the old `34335655`
  head; that field is historical metadata. Both local executions run the actual
  `d8a76066` head recorded here. Its own `gg-audit-f4-r2-repair-*` store prefix is
  retained to reproduce the explicitly requested driver exactly.

## 8. Caveats and open items

No commit or Git index action was performed. Orchestrator commit, Fable review
and audit continuation remain separate steps. No provider-turn or owner-app claim
is made. The full API coverage gate remains failed on port contention despite its
passing isolated triage; the orchestrator needs a clean exact-head gate in its
integration environment. No D-015 native-termination failure was observed in the
completed coverage gates. Typecheck and lint emitted nonfatal Turbo cache-write
`Access is denied. (os error 5)` warnings; they still exited zero with all tasks successful.

Local user paths are redacted in retained evidence. Early focused API commands
used the stock disposable `gg-api-*` test helper and its automatic cleanup;
manual native restart stores use `gg-wp-f4-*`. No directory deletion command
was issued. Retained auditor stores and the unit temporary root are listed at
final handoff for orchestrator cleanup:

- `%TEMP%/gg-audit-f4-r2-repair-hJMs0d` (baseline auditor execution).
- `%TEMP%/gg-audit-f4-r2-repair-tf9Mh6` (fixed auditor execution).
- `%TEMP%/gg-wp-f4-round7-unit` (stock API test fixture root).

The five `gg-wp-f4-restart-*` stores were automatically removed by the existing
native fixture cleanup. Final allocated-port availability, store existence,
driver source hash and Git state are recorded in [final-state.json](final-state.json).
