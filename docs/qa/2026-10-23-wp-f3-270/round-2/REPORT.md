# WP-F3 #270: round 2

## 1. Branch and worktree

Branch `codex-wp-f3-270`, worktree `%USERPROFILE%\source\repos\GraphGoblin\.claude\worktrees\codex-wp-f3-270`.
Verified starting/current HEAD: `12a96af9a661d7779a956ebac8d6569205749bb8` (orchestrator's
round-1 commit, PR #392). Round-2 fixes remain uncommitted and unstaged. No GitHub,
owner-instance or owner-store mutations were performed.

## 2. Per bolt

Required fixes for #270:

| Finding | Change and evidence                                                                                                                                                                                                                                                                                                                                                                               |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1      | Regenerated only four domain current-format outputs: two export goldens plus upgrade-composed and conversion snapshots. Exactly 41 one-line insertions, zero deletions; frozen inputs and review hashes untouched. See golden-stat.log.txt.                                                                                                                                                       |
| B2      | Added the field/code and completion semantics to docs 07, guide 02's table/limits, guide 06; extended the CHANGELOG upgrade note for export/API clients; regenerated clients.                                                                                                                                                                                                                     |
| B3      | Replaced the sleep/either-outcome race with fake timers and a fault-injected event-store acknowledgement barrier. The timeout event is durable while the snapshot remains running; cancellation arrives then, persistence resumes, and exactly one failed terminal outcome retains STRUCTURED_COMPLETION_TIMEOUT. Existing cancel-then-advance coverage is retained in structured-cancel.test.ts. |
| N1      | Warn only for late fulfillment/non-abort rejection. AbortError and the exact forwarded abort reason are normal acknowledgements. Two regression cases failed before and pass after the change.                                                                                                                                                                                                    |
| N2      | Settings renders the schema's structuredTimeoutMs default, including the finite-value branch, alongside the run-deadline default.                                                                                                                                                                                                                                                                 |
| N3      | EvaluationRequest now requires runId and number-or-null structuredTimeoutMs; the boundary defensively treats undefined as null using nullish equality. Its undefined regression failed before and passes after.                                                                                                                                                                                   |
| N5      | Moved the field after maximum visits/run deadline; expanded Loop tab help. Regenerated contract/domain outputs and client/reference artifacts, preserving B1's exact diff.                                                                                                                                                                                                                        |
| N7      | Adapter tests hold cancellation pending, verify the physical scratch directory still exists and cleanup has not started, then assert cancellation settlement precedes cleanup and the directory is gone (success and rejection). API late/cancel cases wait for the observed warning count instead of setTimeout(0).                                                                              |
| N8      | Updated the historical round-1 report and ADR status; retained the independent passing adapter output as real-adapter-review.log.txt.                                                                                                                                                                                                                                                             |
| N9      | LLM timeout details retain timeoutMs plus evaluation provenance, including provider, resolved model and effort. The provenance assertion failed before and passes after.                                                                                                                                                                                                                          |

The initial requested `vitest run -u <three files>` collected only the latter two
files (39 snapshots). Running the export-golden file with trailing `-u` added the
remaining two. Final regeneration places all three filenames before `-u` and passes
115 tests in three files. Logs retain both commands and results.

## 3. Files changed

Package-grouped changes and exact shared-file line ranges are in [FILES.md](FILES.md).
No RunManager lifecycle or container wiring changes were needed in round 2.

## 4. Tests

Before fixes: 11 passed, 4 failed in two engine files. The four failures demonstrate
abort warnings (expected 0, got 1, twice), omitted-runtime-limit failure (expected
signal.aborted false, got undefined because no call started), and missing provenance
(actual details only contained timeoutMs). See engine-before-fixes.log.txt.
After fixes: 43 engine/evaluator tests passed in four files, including both cancellation
orderings and the added component boundary regression. See focused-engine.log.txt.
Contract golden regeneration passed 6 tests; domain regeneration passed 115.

The aggregate API run initially had two touched-file expectation failures: it awaited
one warning after a route late value, but CodexDecider correctly checks abort and rejects
with the forwarded reason, which N1 now suppresses. The route fixtures now exercise
non-abort late provider rejection, making the warning a valid positive barrier. API
repair and public RunManager route tests retain late fulfillment coverage. All 7 API
cases then passed in api-focused-fixed.log.txt. The final 43-test engine/evaluator
recheck passed after tightening B3's terminal filter to include run.finished. Production
source was unchanged during these test-only corrections.

<!-- COVERAGE-START -->

| Package       | Aggregate tests    | Lines              | Branches         | Gate   |
| ------------- | ------------------ | ------------------ | ---------------- | ------ |
| domain        | 593 passed (593)   | 98.47%             | 95.78%           | Passed |
| contracts     | 266 passed (266)   | 99.74%             | 95.00%           | Passed |
| engine        | 1597 passed (1597) | 98.05%             | 93.02%           | Passed |
| adapter-codex | 3 failed           | 497 passed         | 5 skipped (505)  | 98.88% | 94.66% | Failed |
| api           | 10 failed          | 1318 passed        | 8 skipped (1336) | 97.94% | 93.23% | Failed |
| web           | 1 failed           | 1635 passed (1636) | 98.92%           | 94.96% | Failed |
| api-client    | 72 passed (72)     | 100.00%            | 99.37%           | Passed |

<!-- COVERAGE-END -->

API aggregate counts precede the two fixture corrections above; the final 7-case
focused run passes. No synthetic aggregate totals are substituted. Runtime coverage
uses unchanged production source. All measured package lines/branches exceed 90%;
no threshold, timeout or exclusion was weakened.

| Untouched failed file                 | Aggregate                     | One isolated rerun                                                          |
| ------------------------------------- | ----------------------------- | --------------------------------------------------------------------------- |
| adapter-codex/probe-directory.test.ts | 1 passed, 3 failed            | 2 passed, 2 failed (5-second timeouts at lines 33 and 59)                   |
| api/main.test.ts                      | 2 passed, 3 failed, 4 skipped | 3 passed, 2 failed, 4 skipped (60-second startup/CLI timeouts at 49 and 67) |
| api/nested-readiness.test.ts          | 18 passed, 1 failed           | 19 passed                                                                   |
| api/subloop-restart.test.ts           | 1 passed, 2 failed            | 2 passed, 1 failed (60-second afterEach hook at 23, on the third scenario)  |
| api/templates/catalog-package.test.ts | 3 passed, 1 failed            | 4 passed                                                                    |
| api/triggers/github-recipe.test.ts    | 4 passed, 1 failed            | 5 passed                                                                    |
| web/editor/routing-review.test.ts     | 22 passed, 1 failed           | 23 passed                                                                   |

The subloop isolated failure is a different scenario than its aggregate failures.
All original failures remain unresolved, including cases that pass alone. The
isolated commands and results are in CHECKS.json and api-isolated-_.log.txt or
adapter-codex-isolated-_.log.txt. Web's untouched routing-review.test.ts:662 timed out at 60 seconds in the aggregate
(1635 passed, 1 failed); its one isolated rerun passed all 23 cases. The aggregate
failure remains unresolved. Web's one-worker gate took 2782.44 seconds; the retained
read-only process observations showed worker turnover while it ran.

## 5. Gates

All gate shells select Node v22.14.0 first on PATH and invoke pnpm.cmd. Turbo's cache
is confined to this worktree. Exact command arrays, exit codes and elapsed times are
retained in commands.log.txt and individual logs. Initial lint found a new fixture's unknown rejection reason; the fixture now narrows
the reason to Error. The first capture helper also stopped on a cp1252 Unicode print;
its partial lint.log.txt has no trustworthy exit code. See capture-error.log.txt. The
helper now writes UTF-8 stdout, and a fresh root lint will be recorded separately.
Final typecheck passed all 20 tasks and final lint passed all 11 tasks (one unchanged
ThreadViewer.tsx:106 warning). Full pnpm.cmd format, check:docs, check:layers,
check:deps and check:tokens passed; check:deps retains the existing drizzle.config.ts
no-orphans warning. Docs/client generation passed. Build passed all 11 tasks; the two unlimited-mode browser tests passed with retries disabled. Exact commands are indexed in [CHECKS.json](CHECKS.json).

Direct coverage commands (results in section 4):

```text
pnpm.cmd --filter @graphgoblin/domain test:coverage --coverage.reportOnFailure
pnpm.cmd --filter @graphgoblin/contracts test:coverage --coverage.reportOnFailure
pnpm.cmd --filter @graphgoblin/engine test:coverage --coverage.reportOnFailure
pnpm.cmd --filter @graphgoblin/adapter-codex test:coverage --coverage.reportOnFailure
pnpm.cmd --filter @graphgoblin/api test:coverage --coverage.reportOnFailure
pnpm.cmd --filter @graphgoblin/web test:coverage --coverage.reportOnFailure --maxWorkers=1
pnpm.cmd --filter @graphgoblin/api-client test:coverage --coverage.reportOnFailure
```

Completed root/browser gates (package coverage results are in section 4):

| Command                                                                         | Result                                                         |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| pnpm.cmd typecheck                                                              | Passed, 20 tasks                                               |
| pnpm.cmd typecheck --concurrency=1                                              | Final pass, 20 tasks                                           |
| pnpm.cmd lint                                                                   | Fixture lint error; capture interrupted (retained partial log) |
| pnpm.cmd lint --concurrency=1                                                   | Final pass, 11 tasks; existing warning                         |
| pnpm.cmd format                                                                 | Passed                                                         |
| pnpm.cmd docs:generate                                                          | Passed                                                         |
| pnpm.cmd --filter @graphgoblin/api-client generate                              | Passed                                                         |
| pnpm.cmd check:docs                                                             | Passed                                                         |
| pnpm.cmd check:layers                                                           | Passed                                                         |
| pnpm.cmd check:deps                                                             | Passed, existing warning                                       |
| pnpm.cmd check:tokens                                                           | Passed, 169 files                                              |
| pnpm.cmd build --concurrency=1                                                  | Passed, 11 tasks                                               |
| pnpm.cmd exec playwright test e2e/unlimited-mode.spec.ts --retries=0 (apps/web) | Passed, 2 tests                                                |

The machine is shared and heavily loaded. An unchanged failing test file is rerun
alone once as requested; both outcomes are recorded, without treating an
isolated pass as a passing aggregate suite.

## 6. Docs

Updated docs 05 (warning/provenance detail), 07, guides 02 and 06, ADR-0051, the #270
CHANGELOG upgrade note and the historical round-1 REPORT. Reference docs and client
were regenerated; final diff records which outputs changed.

Native evidence is separated explicitly:

- [../real-adapter.log.txt](../real-adapter.log.txt): worker's failed sandbox attempt.
- [real-adapter-review.log.txt](real-adapter-review.log.txt): independent reviewer output
  read/copied from `%USERPROFILE%\AppData\Local\Temp\gg-review-270-api\real.log`.
  The reviewer ran the committed runner unmodified at 12a96af9 outside the sandbox:
  100 ms timeout (run 1721 ms), 60,000 ms success (20346 ms), value assertion passed,
  two scratch directories cleaned. CLI 0.160.0 is reviewer-reported metadata.
  This is historical exact-head reviewer evidence, not a new native run of round 2.
  Its one late-result warning is the acknowledgement corrected by N1.

## 7. Decisions and parameters

Product semantics are unchanged: the engine owns the per-port completion deadline;
positive loop milliseconds are pinned per run; null/omission means Unlimited; the
120000 ms editor suggestion is only applied when authored. Existing explicit run/node
limits and cancellation remain independent. No spending/token/usage budget is added.

B3 uses the public RunManager with fake timers and a wrapped fake event-store port;
no private manager access or test-only production export was added. The 100 ms test
limit and deferred persistence acknowledgement determine the ordering rather than
wall-clock sleep. Adapter ordering tests use physical disposable directories with
the assigned gg-wp-f3-270- prefix and a controlled public HarnessPort.

## 8. Caveats and open items

All required fixes are implemented and the changed engine/API cases, types, lint,
formatting, generated-doc checks, build and browser checks pass. This is not a clean
aggregate-suite claim: adapter, API and web aggregate failures remain recorded above.
The two touched API fixture expectations were corrected and all seven focused API
cases passed afterward. No production source changed during these test-only corrections.

The untouched probe-directory, startup/CLI and restart files still failed in their
single isolated reruns. Nested readiness, template packaging, GitHub recipe and web
routing review passed alone, which does not resolve their aggregate failures. The
machine was shared; the cause of every failure was not established. Timeouts and
coverage protections were preserved. No extra retry was performed after the requested
one isolated rerun per untouched failing file.

The orchestrator owns commit, clean CI on PR #392, independent review and QA. These
changes remain uncommitted and unstaged; no GitHub mutation or owner-store change was
performed. No new native provider turn was repeated by this worker. The passing
reviewer adapter check applies to 12a96af9; current controlled tests and historical
native evidence remain distinct.

Current source/runner hashes are in SOURCES.json and retained round-2 evidence hashes
in ARTIFACTS.json. Captures are normalized to UTF-8 with user-profile paths redacted
before hashing; pre-normalization terminal streams are not separately kept. No retained
round-2 capture exceeds 1,000,000 bytes. The root artifact index refreshes the updated
round-1 report's hash; its prior raw logs and runners remain unchanged. Root source
hashes retain their historical round-1 scope.

Generated coverage/, dist/ and browser test-results/ outputs remain for the orchestrator;
no directories were manually deleted. Task-prefix temp inventory is in temp-leftovers.log.txt.
