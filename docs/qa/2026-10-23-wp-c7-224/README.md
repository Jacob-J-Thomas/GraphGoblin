# WP-C7 / #224 implementation handoff

## 1. Branch and worktree

Branch `codex-wp-c7-224`; base `88d6118da96f28cf4fa7b3278f6f3189fcfc0cb7`.
Worktree `%USERPROFILE%/source/repos/GraphGoblin/.claude/worktrees/codex-wp-c7-224`.
Uncommitted candidate. The orchestrator must commit the implementation and this entire evidence
directory together; this worker does not stage, commit, publish or merge. Owner ports 4747/4748
and the owner store were not used. New native checks use 5760-5769 and `gg-wp-c7-` temp stores. The required existing
recovery runners retain their built-in disposable port ranges and prefixes; their logs record them.

## 2. Per bolt

Only #224 is implemented; #319's interactive UI remains follow-on work.

| Criterion                                                                     | Candidate evidence                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Independent admission closes; queued independent work remains recoverable     | `packages/engine/src/drain.test.ts`: all independent start sources, poll-item start and in-flight admission race. `apps/api/src/shutdown.test.ts`: 503 `SHUTTING_DOWN`. `apps/api/src/shutdown-process.test.ts`: a queued independent parent remains unstarted through drain and runs after restart.                                                                                                |
| Input/status/cancel, required children and timers remain available            | API component input-during-drain test; engine cancel and due-timer cases. Native drain case answers a parked input, creates a child after drain starts, fires its timer, and completes the parent while queued work remains queued.                                                                                                                                                                 |
| Grace offers wait/force; waiting does not kill                                | API component grace/choice/wait test; native process waits beyond its short configured grace and accepts input and an explicit wait command. Production default is five minutes.                                                                                                                                                                                                                    |
| Explicit force interrupts the tree truthfully; cleanup precedes store release | Engine parent/child and in-flight fake-harness cases; native API force of a parked parent/child tree with SSE, lock release and restart. Controlled script/Claude transport acknowledgement and timeout tests; controller retains observation on unconfirmed cleanup. Native script descendants and controlled harness force cases are Linux-only, with win32 D-015 skip reason in the test source. |

API component, engine fake-port and controlled transport evidence do not establish live-provider
behavior. The native fixtures spawn the built `apps/api/dist/main.js`; no paid provider turn was run.
The normal native process case passed in the initial targeted run (`native-shutdown-initial.log.txt`),
which also records two aggregate CLI lifecycle timeouts; the final package gate below supersedes it.

## 3. Files changed

- API: configuration, container lifecycle, main signal handling, shutdown controller and routes,
  stable 503 error mapping, SSE close signal; new controller/API/native tests.
- Shared API fixtures: optional native port range/temp prefix; resource finalization in storage-reopen fixtures; managed shutdown fixtures settle their controller first.
  `main.test.ts` gives the two multi-process CLI cases a 180-second aggregate budget while
  retaining each child's 60-second deadline. `native-cli-metrics.ts` and its log measure individual
  cold commands (6.6-15.5 seconds); no assertion or retry policy was removed.
- Engine/contracts: interruption and termination failure codes, script result cleanup evidence,
  independent-admission guard, logical drain scope, force and cleanup; script/heartbeat handlers.
- Infrastructure: acknowledged tree termination for scripts and Claude; updated public dependency
  fake for the acknowledgement result and ordering/failure/deadline tests.
- API client: regenerated OpenAPI snapshot and generated TypeScript schema.
- Docs: numbered docs 05/07/11, troubleshooting guide, ADR-0049, CHANGELOG, generated API reference;
  Compose example stop grace becomes one hour.

Exact candidate line ranges and purposes for shared files are retained in `SHARED-TOUCHES.md`.

Shared WAVE regions: `run-manager.ts` changes are lifecycle, admission, dispatch and interruption
checks; child-creation identity/recovery algorithms are untouched. `routes/runs.ts` adds only the
SSE close signal. The script and heartbeat edits are additive cleanup checks, outside their
mutable-patch and logical-visit-counter work. The shared #317 subprocess harness keeps its defaults.
No production reset/conversion file, held ADR or reserved migration is changed. The existing
`version-migration.test.ts` changes only its teardown calls from normal stop to resource disposal. #375/#355 work is not taken over.

## 4. Tests

Baseline failures retained in `before.log.txt`: both new API regressions reached the missing
shutdown control and failed **`expected 404 to be 202`**. The earlier invalid fixture was corrected
before taking that baseline; it is not offered as defect evidence.

`before-taskkill.log.txt` runs the new nonzero-exit test against baseline `scripts.ts` and shows
**`exitCode: 0`** instead of expected **`exitCode: null, terminationUnconfirmed: true`**. The fixed
file was restored in a `finally` block. `cleanup-order-before.log.txt` records the intermediate
implementation's additional ordering gap: **`expected false to be true`** when acknowledgement
preceded root close. Both acknowledgement orders are now tested for scripts and Claude.

New maintained cases are in `drain.test.ts`, `shutdown.test.ts`, `shutdown-controller.test.ts`,
`shutdown-process.test.ts`, `shutdown-startup.test.ts`, `process/shutdown.test.ts`, and
`claude/process-failure.test.ts`.
`startup-drain-before.log.txt` records **`expected 'succeeded' to be 'queued'`** when stop
arrived during startup. `startup-drain-after.log.txt` and `shutdown-controller-verified.log.txt`
verify the early admission gate. `force-park-before.log.txt` records **`force did not settle the
parking run`**; `force-park-after.log.txt` verifies the final pass over parks committed during
force cleanup. `force-readiness-before.log.txt` records **`expected 'ready' to be 'forcing'`**;
the controller suite verifies both completion orders through constructor-injected public manager
primitives. These race failures are intermediate-candidate evidence, separate from the two
baseline-main API failures and baseline-main taskkill failure above.

The initial broad runs exposed a raw-manager-stop setup regression, a dependency-fake return
contract change, and inappropriate managed force in storage-reopen fixture disposal. These were
corrected. `wait-scope-verified.log.txt` passes all 68 wait/authorization cases;
`api-restart-regressions.log.txt` passes all 11 definition, migration and polling cases.
The initial and mixed-source broad logs are retained as investigation records, not green gates.
Repetition followed concrete fixes or measured resource-budget problems; no retries were added.

<!-- COVERAGE_RESULTS -->

| Package        | Lines              | Branches           |
| -------------- | ------------------ | ------------------ |
| engine         | 97.61% (2614/2678) | 92.19% (2210/2397) |
| infrastructure | 98.58% (2229/2261) | 95.16% (1809/1901) |
| api            | 97.79% (1906/1949) | 92.68% (1344/1450) |
| contracts      | 99.74% (385/386)   | 95% (190/200)      |
| api-client     | 100% (246/246)     | 99.37% (160/161)   |

<!-- /COVERAGE_RESULTS -->

## 5. Gates

All commands use Node 22.14.0 first on PATH and run from this worktree. Final package suites are
bounded to one or two workers and collect coverage even on failure, so D-015 cannot hide the denominator.
The final Turbo gates cap concurrency at two and read cache without writing it. No threshold,
assertion, coverage exclusion or retry-to-green policy was changed.

<!-- GATE_RESULTS -->

| Command                                                                                                                                         | Result                          | Retained output                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------ |
| `pnpm.cmd typecheck --concurrency=2 --cache=local:r`                                                                                            | PASS                            | `candidate-typecheck.log.txt`              |
| `pnpm.cmd --filter @graphgoblin/api typecheck`                                                                                                  | PASS                            | `api-typecheck-final.log.txt`              |
| `pnpm.cmd lint --concurrency=2 --cache=local:r`                                                                                                 | PASS                            | `lint-verified.log.txt`                    |
| `pnpm.cmd format:check`                                                                                                                         | PASS                            | `format-check-verified.log.txt`            |
| `pnpm.cmd check:layers`                                                                                                                         | PASS                            | `check-layers.log.txt`                     |
| `pnpm.cmd check:deps`                                                                                                                           | PASS                            | `check-deps.log.txt`                       |
| `pnpm.cmd --filter @graphgoblin/engine test:coverage --maxWorkers=2 --coverage.reportOnFailure`                                                 | PASS                            | `engine-coverage-verified.log.txt`         |
| `pnpm.cmd --filter @graphgoblin/infrastructure test:coverage --maxWorkers=1 --testTimeout=60000 --hookTimeout=60000 --coverage.reportOnFailure` | FAIL (see qualifications below) | `infrastructure-coverage-verified.log.txt` |
| `pnpm.cmd --filter @graphgoblin/api test:coverage --maxWorkers=2 --coverage.reportOnFailure`                                                    | FAIL (see qualifications below) | `api-coverage-verified.log.txt`            |
| `pnpm.cmd --filter @graphgoblin/contracts test:coverage --maxWorkers=2`                                                                         | PASS                            | `contracts-coverage.log.txt`               |
| `pnpm.cmd --filter @graphgoblin/api-client test:coverage --maxWorkers=2`                                                                        | PASS                            | `client-coverage.log.txt`                  |
| `pnpm.cmd test:recovery-process`                                                                                                                | PASS                            | `recovery-process.log.txt`                 |
| `pnpm.cmd test:wait-restart`                                                                                                                    | PASS                            | `wait-restart.log.txt`                     |
| `pnpm.cmd test:webhook-retry`                                                                                                                   | PASS                            | `webhook-retry.log.txt`                    |
| `pnpm.cmd test:prompt-restart`                                                                                                                  | PASS                            | `prompt-restart.log.txt`                   |
| `pnpm.cmd check:docs`                                                                                                                           | PASS                            | `check-docs-verified.log.txt`              |

<!-- /GATE_RESULTS -->

Gate qualifications: `infrastructure-coverage-final.log.txt` records 12 failures: six existing
SQLite upgrade cases hit the default 20-second test deadline under concurrent gates, and six
native termination/readiness cases cannot establish cleanup under D-015. The one-worker,
60-second CLI-budget run below keeps all tests, assertions, source coverage and thresholds;
it qualifies the timing issue rather than changing the protected upgrade tests. That run finishes
with 772 passing tests and six D-015 failures, with all upgrade cases passing. Exact native
failures in `infrastructure-coverage-verified.log.txt` include **`expected [Function] to throw an
error`** at the surviving PID assertion, marker growth **`expected 'xxxxxxxx' to be 'xxxxx'`**,
and **`Claude CLI check process did not confirm that it stopped`** instead of the expected
ordinary deadline message. Four fixture teardowns also report EBUSY. This gate remains failed.
`api-coverage-final.log.txt` is an intermediate mixed-source run with 62 failures. The corrected
`api-coverage-verified.log.txt` has 1,328 passing tests, 2 failures and 11 skips. Its two failures
are D1: duplicate `child_run.finished` (`expected 2 to be 1`) and a 60-second afterEach cleanup
timeout. `PREEXISTING-D1.md` retains the earlier C6 follow-up record and unchanged handler blob
identity for the duplicate completion seam. This API gate is **failed**, not a clean pass; the
known crash window remains outside #224. The separate cleanup diagnosis does not erase it. The unchanged mid-wake case passes in isolation
in `d1-cleanup-diagnosis.log.txt` (one passed, two cases filtered; 17.9 seconds of test time).
The full-run cleanup timeout remains unclassified rather than being assumed to be D-015. `candidate-lint.log.txt` found an
async callback without await; it was changed to return its Promise directly. `lint-verified.log.txt`
is the successful full repository result.

Runner `seconds` can include the build barrier before native recovery commands; use each native
runner's own TAP duration for execution timing. `COMMAND-RESULTS.json` indexes every captured
command result. Commands without a `.result.json` retain their command and outcome in the log.

## 6. Docs

`docs/05-execution-engine.md`, `docs/07-api-and-streaming.md`,
`docs/11-security-and-distribution.md`, `docs/guide/07-troubleshooting.md`,
`docs/decisions/ADR-0049-deliberate-shutdown.md`, CHANGELOG `(#224)` Upgrade note, Compose,
`docs/reference/api.md`, and generated api-client schema/OpenAPI snapshot are updated.
`docs-generate.log.txt`, `client-generate.log.txt`, and `check-docs.log.txt` retain generation
and the successful generated-reference check.

## 7. Decisions and parameters

The container owns `ShutdownController`. Main drives native signals and final HTTP closure.
States: running -> draining -> awaiting-choice -> draining on wait or forcing on force -> ready
-> stopped; drain/force observation or executor-cleanup failure becomes force-failed and retains listener, SQLite and lock.
Independent admission closes synchronously. Logical drain includes started/parked/paused runs and
required queued/new children; it excludes independent never-started queue entries. Recovery-isolated
unreadable history is not live work. D-021 stops retry backoffs and new delivery attempts while
letting the bounded in-flight attempt settle. Only after cleanup do remaining SSE inspectors close,
then HTTP, SQLite and the lock. Per-run terminal SSE closure retains its existing semantics.

Control: authenticated GET/POST `/system/shutdown`, POST strict actions drain/wait/force;
`system:read`/`system:write`. First signal requests drain; second delivered SIGINT/SIGTERM requests
managed force. Windows programmatic signals bypass JavaScript; Windows callers use the API.

Engineering choices, not owner-selected numbers: five-minute `GG_SHUTDOWN_GRACE_MS` default
(positive integer, maximum Node timer interval); 50 ms completion polling; five-second native
termination acknowledgement/close reporting deadline. Grace expiry only exposes choices/logs a
notice. Wait never adds a kill timer. Authored execution deadlines still apply. The one-hour Compose
example is an external supervisor limit; use API drain while the service remains running for
indefinite waiting, then stop Compose after exit.

Force records non-resumable `RUN_INTERRUPTED_BY_STOP`, node and attempt and possible external
effects; it never fabricates success or user cancellation. Termination failures retain their
specific code and block release. No migration 0019 is needed. #319 can consume phase, timestamps,
active run IDs and choices and send wait/force; this change does not implement that UI.

## 8. Caveats and open items

- Linux real-signal/script-tree/controlled-harness force tests are not run on this Windows host.
  New cases skip with the stated D-015/native-signal reason. The outside-sandbox reviewer and Linux
  CI must establish those native assertions; fake-harness evidence is not live-provider evidence.
- Observed outside scope: unchanged `apps/web/src/runs/inspector/ThreadViewer.tsx:106` emits
  `@eslint-react/use-state` in the otherwise passing root lint gate. No web source was edited.
- The full API coverage gate is not green: the D1 duplicate child-completion seam is already
  listed by C6 in the shared brief, and the subloop handler is unchanged. See `PREEXISTING-D1.md`.
  The D1 fixture-cleanup timeout is recorded separately and is not labelled D-015 without proof.
- Native D-015 failures also report EBUSY while disposing temporary process fixtures. Disposable
  `gg-claude-process-*` / `gg-process-tree-*` directories or processes may remain; retained logs
  give the fixture names. No manual forced cleanup or directory deletion was attempted.
- Independent Opus review, Sol QA and fresh Astra audit remain separate gates. This implementation
  report is not their sign-off, owner acceptance, merge authorization or bolt closure.
- The orchestrator must commit all cited evidence under these names with the implementation.
- No manual directory deletion was performed. Standard fixture disposal removes its own temporary stores. Generated `.tmp`, `.turbo`, `dist` and coverage directories remain
  for orchestrator housekeeping; no owner data or original worktree was changed.

Retained logs are normalized to UTF-8 with local user paths written as `%USERPROFILE%`.
No capture exceeds 1,000,000 bytes and no oversized capture was discarded.
`CAPTURE-MANIFEST.json` records retained artifact sizes and SHA-256 hashes after redaction;
`SOURCE-MANIFEST.json` records the changed source/docs outside this evidence directory.
