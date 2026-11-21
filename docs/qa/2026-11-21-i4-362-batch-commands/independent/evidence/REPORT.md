# #362 independent behaviour QA (intent 4, U4.3): Windows `.cmd`/`.bat` script start refusal

Worker: `i4_362_behavior_qa`, Claude Opus 5.5 at xhigh, separate context and checkout. I did not author
the fix and made no code change. Date: 2026-11-21.

## Verdict

**ESTABLISHED: #362's defect is already fixed at `02351e2fb932b3be44e7cc3fb3943a61d568226c`.**

- On this Windows 11 host, Node v22.23.4 refuses a direct `.cmd`/`.bat` start with `shell:false` by throwing
  `spawn EINVAL` synchronously (code `EINVAL`, errno -4071, syscall `spawn`). The throw comes before any child
  object or PID exists. This was observed natively on 7 name variants and is not injected.
- The built runner contains that throw. It resolves `definitely-not-started` and never rejects.
- The built engine records a resumable `SCRIPT_START_FAILED` with `{visitId, dispatchId, state:
  definitely-not-started}`. The built API does the same through create/publish/run/get/events/resume/replay.
  No path records `INTERNAL_ERROR`.
- Across 200+ refusals and every tier, the batch body never ran: no marker file appeared. The same bodies do
  create their markers when run explicitly through `cmd.exe /d /c`.
- A discriminating mutant control shows these results come from PR #375's synchronous catch. Without that
  catch, the same native EINVAL rejects the runner promise and the current engine records
  `SCRIPT_OUTCOME_UNCERTAIN`.

Script-node acceptance: 64 mechanically computed cases, 64 PASS, 0 FAIL. That is 33 acceptance, 22
controls, 2 discriminating controls and 6 supporting unit-test runs. One adjacent pre-existing observation
(H1) matched its prediction. Unit tests are supporting evidence only; the acceptance result rests on the
native, engine and public-API tiers.

This verdict does not close #362. It does not replace opposite-family review, the fresh independent Astra
MAX final audit or current-target CI. I make no UI or owner-acceptance claim.

## Binding

| Item           | Value                                                                                                                             |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Checkout       | `G:/ggq/gg-i4-362-qa/GraphGoblin`, branch `codex/gg-i4-362-qa`                                                                    |
| HEAD / tree    | `02351e2fb932b3be44e7cc3fb3943a61d568226c` / `d289bb12b943557584c5659bc33447d1baebc2f6` (start and end; status clean both times) |
| Lockfile       | sha256 `3fda48ff…a0916df`, unchanged throughout                                                                                   |
| Runtime        | Node v22.23.4, project runtime `C:/Users/98jak/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64`; pnpm 12.8.1         |
| OS             | Windows 11 Pro 10.0.26300 (`ver` 10.0.26300.9974), x64                                                                            |
| Built code     | `pnpm build` exit 0, 12/12 tasks, 0 cached (`raw/02-pnpm-build.log`); dist hashes in `raw/03-dist-bindings.txt`                   |
| Source blobs   | `raw/00-source-state.txt`; line-numbered excerpts from git objects in `raw/04-source-evidence.txt`                                |
| Fix provenance | Sync catch added by `35bd31ad` (PR #375, 2026-10-25), an ancestor of HEAD; #362 was filed 2026-10-19                              |

## Contract reconciliation (current naming and behaviour)

- **Historical defect.** Before PR #375 (`35bd31ad^`), `ProcessScripts.run` called `spawn` inside the Promise
  executor with no catch. The handler had only `finally`, so the synchronous EINVAL rejected the promise and
  reached the executor's generic catch as `INTERNAL_ERROR` (source: `raw/04-source-evidence.txt`, last two
  excerpts).
- **Retired name.** `PROCESS_START_FAILED` was never a `RunErrorCode`: `git log -S` over engine/contracts
  source is empty. It was, and still is, only the runner's synthetic stderr text
  `spawn failed: PROCESS_START_FAILED` (`scripts.ts:132,197`). The current public code is `SCRIPT_START_FAILED`
  (`contracts/src/run.ts:58`), with state `definitely-not-started` (`run.ts:99`). I did not revive the
  retired name, and the engine never records it for script nodes (E, A).
- **Recovery semantics.** For a proven refusal, "explicit recovery consent" means the user's explicit
  Resume or Replay action (docs/05:489, "ordinary explicit Resume tries it again"; guide 03:273).
  `run-recovery.ts:85-126` grants `resume: allowed` with no `scriptConsent`. The extra `retryUncertainScript`
  consent and the `SCRIPT_CONSENT_REQUIRED` refusal apply only to `SCRIPT_OUTCOME_UNCERTAIN`. Observed
  behaviour matches (E1/E2/A1/A2/A6). M2 shows the consent path only when the fix is removed.
- **Precedence (source).** In the handler, unconfirmed termination is checked first, then cancellation
  (`ctx.signal.aborted` → cancelled), then state (`script.ts:82-115`). In the executor catch, deadline is
  checked first, then abort/cancel, then the typed `RunFailureError` (`run-manager.ts:2626-2683`).
  `INTERNAL_ERROR` arises only for untyped throws.
- **`shell:false` (source and behaviour).** The option is hard-coded at `scripts.ts:126` (dist line 115).
  Behaviourally, the batch bodies that create markers under `cmd.exe` never ran through the runner, engine
  or API.

## Method

I recorded predictions in `fixtures/PREDICTIONS.md` before each fixture ran (appended sections are marked).
Each fixture writes only into disposable directories under this evidence root, refuses paths outside it
and is preserved with its hash. Each batch fixture is `@echo effect>"<marker>"` plus `@exit /b 0`.
`fixtures/build-observations.mjs` computes every PASS/FAIL from explicit predicates over the raw JSON
(`observations.json`).

| Tier | What ran                                                                                                                                                                                                                                                                           | Evidence class                                       |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| N0   | Raw `node:child_process.spawn`, `shell:false`; no GraphGoblin code                                                                                                                                                                                                                 | native OS/runtime shape                              |
| N1   | Built `ProcessScripts` (default real `spawn`, no injection)                                                                                                                                                                                                                        | native + built runner                                |
| E    | Built `RunManager` public methods (`start`, `waitForIdle`, `getSnapshot`, `resume`, `cancel`) over `@graphgoblin/engine/testing` in-memory ports. Only the scripts port is swapped, for the real built `ProcessScripts`. E6 adds a timing seam: real refusal first, then `cancel()` | engine composition + native                          |
| A    | Built API `apps/api/dist/main.js` on a random loopback port with disposable SQLite and a minimal env (no owner secrets; USERPROFILE/APPDATA redirected; Ollama disabled; no inference nodes). Calls `POST /loops`, `/publish`, `/runs`, `GET /runs/:id`, `/events`, `POST /resume`, `/replay`, `/system/shutdown` | public API + SQLite + native                         |
| A6   | Second real API process on the same store                                                                                                                                                                                                                                          | process restart                                      |
| M    | Untracked mutant copy of the built runner with only the sync catch removed (`work/m-mutant-scripts.mjs`)                                                                                                                                                                           | discriminating control (non-production), native EINVAL |
| H    | Heartbeat `script` probe with a native `.cmd` through the built engine                                                                                                                                                                                                             | adjacent pre-existing check                          |
| U    | Existing focused vitest files, one file per run                                                                                                                                                                                                                                    | supporting only                                      |

Native and injected evidence are kept apart. Every N0/N1/E/A/A6/M/H refusal is the real Node EINVAL. The
only injected-error evidence is the repository's own unit test `scripts.test.ts:340` (Proxy throw), which
I counted as supporting. The repository's native win32 tests (`scripts.test.ts:358`,
`script-recovery.test.ts:60`) executed here; they were not skipped (`raw/u-infra-verbose.log`).

## Cases

Full actual values are in `observations.json`. Result: P = PASS. No FAIL occurred.

| Case(s)                                                                                       | Expected                                                                                                                                                                                                                                                                                                                                                                          | Actual                                                                                                                                                                                                      | R                        |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| N0-cmd-abs, -bat-abs, -cmd-upper (`.CMD`), -bat-mixed (`.Bat`), -cmd-trailing-dot, -cmd-trailing-space, -cmd-with-args | sync throw EINVAL/-4071/spawn, no spawn event, no marker                                                                                                                                                                                                                                                                                         | exactly that for all 7; 0.9–3.7 ms; no child, no PID                                                                                                                                                        | P ×7                     |
| N0-shim-extensionless, N0-missing-exe                                                         | async ENOENT, never EINVAL, no marker                                                                                                                                                                                                                                                                                                                                             | ENOENT -4058 on both                                                                                                                                                                                        | P ×2                     |
| N0-cmdexe-cmd, -cmdexe-bat, -node-marker                                                      | spawn, exit 0, marker `effect\r\n`                                                                                                                                                                                                                                                                                                                                                | as expected: the bodies are effective                                                                                                                                                                       | P ×3                     |
| N0-resources                                                                                  | no active resources retained                                                                                                                                                                                                                                                                                                                                                      | `[]` after every case; exit 0                                                                                                                                                                               | P                        |
| N1-cmd, -bat, -cmd-upper, -cmd-timeout30s-stdin                                               | resolves (never rejects) to the exact not-started shape with stderr `spawn failed: PROCESS_START_FAILED`; marker absent; no leaked timer or pipe                                                                                                                                                                                                                                  | exact; 0.9–3.7 ms; `[]`                                                                                                                                                                                     | P ×4                     |
| N1-cmd-maxStderrBytes0                                                                        | same shape, stderr `''`                                                                                                                                                                                                                                                                                                                                                           | exact                                                                                                                                                                                                       | P                        |
| N1-missing-exe-timeout30s                                                                     | not-started; timer cleared                                                                                                                                                                                                                                                                                                                                                        | exact; `[]`                                                                                                                                                                                                 | P                        |
| N1-cmdexe-cmd, N1-node-marker                                                                 | completed, exit 0, marker                                                                                                                                                                                                                                                                                                                                                         | as expected                                                                                                                                                                                                 | P ×2                     |
| N1-preaborted-node-marker                                                                     | aborted before call: not-started, no spawn, no marker                                                                                                                                                                                                                                                                                                                             | as expected                                                                                                                                                                                                 | P                        |
| N1-cmd-repeat-200                                                                             | 1 distinct result shape, no resources, no marker                                                                                                                                                                                                                                                                                                                                  | 1 shape; 171.5 ms total; `[]`; no marker                                                                                                                                                                    | P                        |
| N1-process-exit                                                                               | natural exit                                                                                                                                                                                                                                                                                                                                                                      | exit 0                                                                                                                                                                                                      | P                        |
| E1-cmd-first, E2-bat-first, E3-missing-exe-first                                              | `failed`, `{code SCRIPT_START_FAILED, message "The script process could not start. Resume tries to start it again.", resumable true, nodeId script, script {visitId, dispatchId = the single script.dispatched, state definitely-not-started}}`; no exitCode or details; no script `node.progress`/`node.finished`; resume allowed; no scriptConsent; replay allowed; schemas valid | exact. Events: `run.queued, run.started, node.started/finished(start), node.started(script), script.dispatched, run.failed`                                                                                 | P ×3                     |
| E1-cmd-manager-restart                                                                        | recovery does not re-run                                                                                                                                                                                                                                                                                                                                                          | 0 runner calls; unchanged                                                                                                                                                                                   | P                        |
| E1/E2 plain-resume                                                                            | 1 runner call; same visitId, new dispatchId; SCRIPT_START_FAILED again; no marker                                                                                                                                                                                                                                                                                                 | exact (2 dispatches, 2 `run.failed`)                                                                                                                                                                        | P ×2                     |
| E1/E2 stale-resume                                                                            | RECOVERY_STALE; 0 runner calls                                                                                                                                                                                                                                                                                                                                                    | exact                                                                                                                                                                                                       | P ×2                     |
| E4-node-marker, E5-cmdexe-explicit-shell                                                      | succeeded; progress exit 0; marker                                                                                                                                                                                                                                                                                                                                                | as expected                                                                                                                                                                                                 | P ×2                     |
| E6-cancel-precedence-seam                                                                     | real refusal, then cancel → `cancelled`; no `run.failed`; no marker                                                                                                                                                                                                                                                                                                               | runner `definitely-not-started` (signal live on entry, aborted after cancel); events end `run.cancel_requested, run.cancelled`                                                                              | P                        |
| E-no-internal-error                                                                           | no INTERNAL_ERROR, EINVAL or token in engine records or logs                                                                                                                                                                                                                                                                                                                      | 0/0/0; `node failed` lines are SCRIPT_START_FAILED only                                                                                                                                                     | P                        |
| A1-cmd-first, A2-bat-first, A3-missing-exe-first                                              | HTTP 201/200/202, then the same failure contract as E over SQLite                                                                                                                                                                                                                                                                                                                 | exact                                                                                                                                                                                                       | P ×3                     |
| A1/A2 plain-resume                                                                            | `POST /resume {observedSeq}` 200 without a consent flag; second dispatch, same visit; SCRIPT_START_FAILED; no marker                                                                                                                                                                                                                                                              | exact                                                                                                                                                                                                       | P ×2                     |
| A1-cmd-stale-resume                                                                           | 409 RECOVERY_STALE; no new events                                                                                                                                                                                                                                                                                                                                                 | 409, lastEventSeq 11 unchanged                                                                                                                                                                              | P                        |
| A1-cmd-replay-no-consent                                                                      | `POST /replay` 202; new run with `replayOf`; SCRIPT_START_FAILED; no marker                                                                                                                                                                                                                                                                                                       | exact                                                                                                                                                                                                       | P                        |
| A3-repaired-explicit-resume                                                                   | after the owner places a real executable, explicit Resume runs it; effect exactly once                                                                                                                                                                                                                                                                                            | 200 → succeeded; marker `effect\r\n` once (append mode); same visitId                                                                                                                                       | P                        |
| A4-node-marker, A5-cmdexe-explicit-shell                                                      | succeeded; marker once                                                                                                                                                                                                                                                                                                                                                            | as expected (A5 uses an identical `.cmd` body)                                                                                                                                                              | P ×2                     |
| A-server-log                                                                                  | no INTERNAL_ERROR, EINVAL, token, stack, batch path or provider text                                                                                                                                                                                                                                                                                                              | 114 JSON lines; 6 error-level `node failed`, all SCRIPT_START_FAILED with provenance; all other counts 0                                                                                                    | P                        |
| A-cleanup                                                                                     | drain 202; exit 0 unforced; port free                                                                                                                                                                                                                                                                                                                                             | as expected; `/healthz` ECONNREFUSED                                                                                                                                                                        | P                        |
| A6 ×6 runs, A6-markers-log-cleanup                                                            | after restart, nothing re-dispatched; refused runs still resume-allowed with no consent; markers unchanged                                                                                                                                                                                                                                                                        | lastEventSeq, failure and dispatchId identical; log has no errors or dispatches; exit 0; port free                                                                                                          | P ×7                     |
| M1-mutant-direct                                                                              | without the catch: promise rejects with native EINVAL                                                                                                                                                                                                                                                                                                                             | rejected EINVAL/-4071/spawn; no marker                                                                                                                                                                      | P                        |
| M2-mutant-through-current-engine                                                              | without the catch: SCRIPT_OUTCOME_UNCERTAIN plus SCRIPT_CONSENT_REQUIRED                                                                                                                                                                                                                                                                                                          | exact; scriptConsent present; no marker                                                                                                                                                                     | P                        |
| H1-heartbeat-script-probe-cmd                                                                 | prediction: contained, probe data shows the token                                                                                                                                                                                                                                                                                                                                 | see O1                                                                                                                                                                                                      | observed as predicted    |
| U1–U6                                                                                         | exit 0, all pass, native tests not skipped                                                                                                                                                                                                                                                                                                                                        | scripts.test 46/46; infra script-recovery 2/2; engine script-recovery 9/9; engine run-recovery 8/8; contracts script-provenance 6/6; verbose run confirms 2 native win32 tests executed                     | P ×6 (supporting)        |

The issue text mentions "no normal script progress event". As the brief requires, I did not treat that
absence as a defect: by contract, `node.progress` is recorded only for `completed` processes
(`script.ts:105-134`). `script.dispatched` is the documented pre-call durable marker. The matching
`run.failed` with `definitely-not-started` disposes it, and neither restart treated it as uncertain
(E1-cmd-manager-restart, A6).

## Pre-existing observations (not #362 failures; coordinator disposition needed)

- **O1. The internal runner token is still reachable through non-script-node probe paths.** The runner's
  synthetic stderr `spawn failed: PROCESS_START_FAILED` (`scripts.ts:132,197`, asserted by
  `scripts.test.ts:352,414`) never appears in script-node failures, events or logs. It is native-observed
  in heartbeat script-probe data, though: `heartbeat.beat.result` and `lastOutput.value.probe` carry
  `{exitCode:null, stderr:"spawn failed: PROCESS_START_FAILED"}` with no not-started state (H1;
  `heartbeat.ts:60-92` forwards stderr without `state`). The poll-trigger non-items probe has the same
  forwarding shape (`apps/api/src/triggers/poll.ts:271-279`, source only, not exercised). The historical
  INTERNAL_ERROR is also contained on the heartbeat path (H1 succeeded, no marker). This residual is
  pre-existing, not revived.
- **O2. Actionability for batch files.** For a batch file without an explicit shell, the refusal is
  deterministic. Resume and Replay of the pinned definition refuse again every time (A1, A2, A1-replay). The
  failure says "Resume tries to start it again", and guide 03:273 says "Fix the start configuration, then
  Resume". The working fix is to edit the loop to `cmd.exe /d /c <file>` (A5) and start a new run. No current
  doc or field help states that rule: the `command` field help is "Program to run."
  (`raw/05-docs-batch-guidance-grep.txt`). The EINVAL and ENOENT causes produce identical public failures
  (E1 vs E3, A1 vs A3), so a user cannot tell a batch refusal from a missing executable. This is
  deliberate, since the runner discards the error to avoid echoing commands. It relates to Intent 4's
  "actionable" goal and U4.5/#364. It is not a breach of #362's classification contract.
- **O3. Repository test gaps (supporting only).** There is a native `.cmd` test at runner and engine level,
  but no native `.bat` test and no built-API batch-refusal regression. The "synchronous EINVAL" unit test is
  injection-based.

## Commands and exit codes

| #   | Command                                                                                                                                     | Exit / result                                                                                         | Evidence                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 1   | git rev-parse / status / blob listing                                                                                                       | 0; clean                                                                                              | `raw/00-source-state.txt`                   |
| 2   | `pnpm exec node --version` (Git Bash)                                                                                                       | printed `v22.23.4`; exit not separately captured; triggered an implicit install (see Deviations)      | `raw/01-install.log`, `raw/99-…log`         |
| 3   | `gh issue view 362` (read-only)                                                                                                             | output read                                                                                           | (context only)                              |
| 4   | `pnpm install --frozen-lockfile --offline`                                                                                                  | 0, "Lockfile is up to date"                                                                           | `raw/01-install.log`                        |
| 5   | `pnpm build` (the single granted full build)                                                                                                | 0; 12/12; 0 cached; 1m49.7s                                                                           | `raw/02-pnpm-build.log`                     |
| 6   | `node fixtures/n0-node-spawn-shape.mjs`                                                                                                     | 0; 18.7 s                                                                                             | `raw/n0-*`                                  |
| 7   | `node fixtures/n1-process-scripts.mjs`                                                                                                      | 0; 15.6 s                                                                                             | `raw/n1-*`                                  |
| 8   | `node fixtures/e-engine-composition.mjs`                                                                                                    | 0; 15.3 s                                                                                             | `raw/e-*`                                   |
| 9   | `node fixtures/a-api.mjs`                                                                                                                   | 0; 76.1 s (API exited 0 at 15.9 s; fixture timer note)                                                | `raw/a-api*`                                |
| 10  | `pnpm --filter <pkg> exec vitest run <file>` ×5                                                                                             | 0 ×5                                                                                                  | `raw/u-*.log`                               |
| 11  | same with `--reporter=verbose` (infra script-recovery; scripts.test with `-t` filter)                                                       | 0 ×2                                                                                                  | `raw/u-infra-verbose.log`                   |
| 12  | `node fixtures/m-mutant-control.mjs`                                                                                                        | 0; 4.5 s                                                                                              | `raw/m-*`                                   |
| 13  | `node fixtures/h-heartbeat-probe.mjs`                                                                                                       | 0; 3.4 s                                                                                              | `raw/h-*`                                   |
| 14  | combined bash heredoc (A6 predictions, fixture and run)                                                                                     | **2, parse error; nothing executed** (verified)                                                       | `raw/99-failed-commands-and-repairs.log`    |
| 15  | `node fixtures/a6-api-restart.mjs` (after repair)                                                                                           | 0; 10.2 s                                                                                             | `raw/a6-*`                                  |
| 16  | `tasklist /FI "PID eq …"` under Git Bash                                                                                                    | **failed: MSYS path conversion ("Invalid argument/option")**; rerun with `MSYS_NO_PATHCONV=1` → 0     | `raw/90-cleanup-proof.txt`, `raw/99-…log`   |
| 17  | `node fixtures/build-observations.mjs`                                                                                                      | 0                                                                                                     | `raw/95-build-observations.stdout.txt`      |

## Resource cleanup proof

- **API processes.** PID 18668 (port 60554) and PID 36472 (port 63406) each drained through
  `POST /system/shutdown` and exited with code 0 without a forced kill. Afterwards both ports could be
  re-bound, and `tasklist` finds neither PID (`raw/90-cleanup-proof.txt`). I never killed anything by name.
- **Fixture processes.** Every fixture exited on its own. Final `process.getActiveResourcesInfo()` was `[]`
  for N0, N1 and E.
- **Data.** All runs used `GG_DATA_DIR=…\work\a\data`, confirmed by the server log's `dataDir`, plus a
  redirected profile. The disposable store remains as evidence: `graphgoblin.db`, `-wal` and `-shm`; I did
  not investigate why the WAL persists.
- **Removals.** The only removal was one copied executable, `work/a/a3-missing-then-repaired/later.exe`. It
  was a single file, unlinked after verifying its path was inside the QA root. There were no recursive
  deletions or moves.
- **Checkout.** Status is clean with all untracked files shown. The ignored entries are build/install
  outputs only (`dist/`, `.turbo/`, `node_modules/`). HEAD and tree are unchanged.
- **Ports and owner resources.** No owner port (4747/4748), owner store, config, credentials or provider
  was touched. No inference node ran, Ollama was disabled, and the provider counts in both API logs are 0.

## Deviations, failed commands and fixture repairs

These are all also recorded in `raw/99-failed-commands-and-repairs.log`.

1. pnpm 12 ran an implicit install on the first `pnpm exec`. The lockfile was unchanged and the tree stayed
   clean. I did not observe whether the registry was contacted. The explicit frozen offline install
   afterwards was a no-op.
2. A bash heredoc parse failure (exit 2). Nothing executed; I rewrote the files with file tools.
3. The `tasklist` path-conversion failure. I reran it.
4. `fixtures/a-api.mjs` left a 60 s fallback timer uncancelled. This inflated the fixture's wall time but
   had no evidence impact.

I made no production or tracked-file changes, did not stage or commit, and wrote nothing to the issue or PR.

## Not verified (evidence gaps, not PASS)

- MCP surface (docs say it returns the same failure and provenance) and the web inspector rendering. For
  the inspector I only quoted its source copy (`RunInspectorPage.tsx:215-216`), with no UI claim.
- Deadline and forced-stop precedence for a refusal. Source ordering only: a synchronous refusal leaves no
  time window, and the seam covered cancellation only.
- SSE live stream (I used the paged events endpoint), poll-trigger probe behaviour (source only), other
  platforms, and the coverage thresholds (full `test:coverage` was out of scope).
- Opposite-family review, the fresh independent Astra MAX final audit and current-target or native-Windows
  CI. None of these are part of this QA.

## Criteria for evidence-backed closure

1. The coordinator records that the current `SCRIPT_START_FAILED` / `definitely-not-started` contract
   supersedes the issue's `PROCESS_START_FAILED` expectation (naming reconciled, not revived).
2. The coordinator records a disposition for O1 (the residual token in heartbeat and poll probe data) and
   O2 (batch-file actionability, possibly via #364 or docs): either in-scope correction or a named
   follow-up. Neither blocks the already-fixed finding on its own.
3. Opposite-family review of this evidence.
4. A fresh independent final audit as the register requires.
5. Current-target CI with the native Windows job passing at the exact closing commit. That job includes
   `scripts.test.ts:358` and `script-recovery.test.ts:60`.
6. Closure by the coordinator under the batch's policy. This report closes nothing.

## Artifacts

- `observations.json`: all cases, with expected, actual, computed result and evidence paths.
- `manifest.json`: sha256 for every file in this root except `provider/` (reserved to the runner) and the
  manifest itself.
- `fixtures/`: predictions and fixture sources.
- `raw/`: logs, JSON and source evidence.
- `work/`: disposable fixture directories, batch files, markers, the SQLite store and the mutant runner.
