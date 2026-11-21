# D203 independent behavior QA for #364: bounded Claude refusal diagnosis

Performed by actual Claude Code, model `claude-opus-5-5` (Opus 5.5) at xhigh, in a context independent of the
GPT author and the Fable reviewer. This is criterion-specific behavior QA of the frozen candidate. It is not a
general review, a renewed Astra approval, CI/native verification, whole-intent completion or owner acceptance.
Final scan 3 (`i4-549-final-astra-02/REPORT.md`, SHA-256 `b7d9f742…f0ac56`, rechecked) stays negative at its own revision.

## Verdicts

| Criterion | Verdict | Basis (independent observations only) |
| --- | --- | --- |
| C1 public default turn, pending metadata past the budget | **PASS** | 109/109 predicates. Genuine native no-PID refusal of the turn and controlled withholding of stat delivery. Terminal fixed unknown failure 1,002–1,010 ms after refusal (engine run 1,017.5 ms), definite non-submission, one turn attempt, no kill or retry, no false timeout or cancellation, timers and listeners released, unchanged after late success or rejection. |
| C2 built runner with controlled child/stat/time seams | **PASS** | 126/126 predicates over 19 cases: delayed-callback acceptance (virtual clock and a genuine 1,150 ms event-loop block), early-timer recheck, budget from refusal, timely causes, wall-clock jumps, immutability, no follow-on lookup, cleanup, 15 ms deadline, abort, started processes. |
| C3 public mapping, privacy, F1/F2 and normal checks | **PASS** | 66/66 predicates: native file-cwd and missing-executable mappings; request deadline and abort priority; F1 output loss vs completed sign-out; F2 help-only causes (timely and expired); ready preflight; ordinary and 1.5 s started turns; no canary, path or native diagnostic text in any public value. |
| C4 finite old-source control | **PASS** | 15/15 predicates. Parent `process.ts` built to scratch through the real build program. Its byte-fidelity gate passed after two failed builder attempts, which are kept. The old default turn was still pending at +1.5 s and +3 s and settled only on release, adopting the late cause. The old engine run was still `running` at +3 s. |
| C5 integrity, cleanup and retained hashes | **PASS** | Integrity 28/28 before and 28/28 after: HEAD/tree/parent, clean status, index, lock and install metadata, the five freeze hashes, 1,750 source files and 1,271 build outputs, no extra outputs, and the bound evidence. No surviving fixture process, no listener owned by a recorded PID, no owner-port listener. Held stats were released. |

The instrumentation-correction budget was **fully used (3 of 3)**, counting conservatively. No product failure was found.

## Exact bindings

- Checkout `G:\ggq\gg-i4-364-deadline-qa\GraphGoblin`, detached HEAD `e8cf31d51837a4fa362f909604b3070277db6c25`, tree `0927bbbf9f3889791c956e7816e3524c9a5a8fe6`, parent `580aded6d295061897b047ac16811e5da230d9e0`. Status was empty before and after. The worktree index `…\.git\worktrees\GraphGoblin158\index` SHA-256 was `c806109d…7799166` before and after.
- Root freeze receipt SHA-256 `c6c28a0a…8b9779`. All five frozen sources matched, including `process.ts` `4103c271…6fc5` (blob `5173fd67`) and `process-failure.test.ts` `1ed1d1e5…e8f0`. Candidate built `dist/claude/process.js` is `9f8f0011…50202f`.
- **Preparation prerequisite: satisfied.** The receipt says `ENVIRONMENT_PREPARATION_COMPLETE_NOT_QA`, offline frozen install exit 0, one `pnpm build` exit 0, 1,271 outputs, clean exact source. I independently rechecked the SEAL members (manifest `7ca7bcf9…`, receipt `42c1503a…`, output hashes `c5462fbb…`). I recomputed every listed source and output hash before execution (`observations/c5-integrity-before.json`) and again after (`…-after.json`). No rebuild was performed.
- Author packet (immutable, not independent): REPORT `23fa538f…` and manifest `d38aea7a…` match, and all 65 manifest members match. It is preserved as is, including the 304-pass/2-fail TEMP-spelling run and its three instrumentation corrections. Author results are not counted here.
- D203 `decision-203.md` SHA-256 is `a9f9258b…af67f6`. The old QA checkout (`gg-i4-364-qa`) and the author checkout were not accessed.
- Runtime: `node.exe` v22.23.4 from the project runtime, first on the child PATH. `pnpm.cmd` 12.8.1 was used for the version record only. TEMP/TMP were the canonical `G:\ggq\qa-scratch\i4-364-deadline-independent-01` in every child (verified by `os.tmpdir()`).

## Method

Every product observation loads the **built dist** in plain Node 22, without Vitest and without TypeScript sources.
`node:module` `registerHooks` redirects only the imports of `dist/claude/process.js`. Its `stat` seam issues the
real native stat and can withhold delivery or supply an override. Its `spawn` seam calls the real spawn and, for
the fixture node binary, prepends my own `fixtures/qa-cli.mjs` to argv, leaving binary, cwd, env and options
unchanged. The `killTree` seam wraps the real function and logs each call. The drivers also wrap
`setTimeout`/`clearTimeout` and abort `add/removeEventListener`, attributed by stack to `claude/process.js` or
`harness.js`, and add a virtual `performance.now`, `Date.now` shifts and unhandled-rejection capture. The public
`ClaudeHarness` used its **default runner** (no `runner` option). No assertion or copy of the author's tests or
implementation was used.

Evidence tiers:

- **T1 native:** genuine spawn/start and real stat.
- **T2 native refusal plus controlled delivery:** a real stat issued, with its result withheld. This is not a naturally stalled filesystem.
- **T3 scripted:** scripted child, stat override or clock.
- **T4 old-source build.**

## C1 · Public default turn (`drivers/c1-public-turn.mjs`, receipt 10, T1/T2)

Setup: the built `harness.js` contains `timeoutMs: null`. Version, help and auth probes started natively (pid, close
0). The turn's missing working directory (canary path) was refused natively: no pid, spawn `ENOENT`, close −4058.
No turn-phase runner timer existed before the refusal, so there was no request timer. The external signal was never aborted.

| Case | Stat delivery | Result (time after native refusal) |
| --- | --- | --- |
| P0 | real, immediate | `HARNESS_INVALID_CONFIGURATION` "…working directory does not exist…", 2.0 ms |
| P1 | three executable-name stats withheld (natively completed: success, ENOENT, ENOENT) | `HARNESS_TURN_FAILED` "Claude could not be started (ENOENT); check the Claude executable's path and permissions and the working directory", **1,003.0 ms** |
| P2 | working-directory stat withheld (real late ENOENT) | same unknown failure, **1,002.0 ms** |
| P3 | working-directory stat withheld, late success (file stats) | same unknown failure, **1,009.7 ms** |
| P4 | engine `createTestEngine` (in-memory fakes, FakeClock; real harness), `runDeadlineSeconds` null (pinned), no `timeoutSeconds` | run `failed`, `harness turn failed: <unknown text>`, `adapterCode` `HARNESS_TURN_FAILED`, `submission` `definitely-not-submitted`, `resumable` false, **1,017.5 ms** |

P0–P3 each showed:

- Exactly one event, `{type:'error', …, retriable:false, submission:'definitely-not-submitted'}`.
- The result and `sessionId` rejected with the same `ClaudeHarnessError`.
- The queue closed at settlement.

All of P0–P4 showed:

- Four spawns: three probes and one turn.
- Zero `killTree` calls.
- No runner timer left pending. In P1–P4 the single diagnostic timer fired at the budget; in P0 it was cleared by the timely result.
- Runner and harness abort listeners were removed.

In P1–P4, late metadata was released at about +2.5 s. In P1–P3, results, events, spawns and kills were
byte-identical before and after release; in P4 the run record and spawn count were unchanged. No follow-on lookup
occurred: in P1 the working-directory stat was never issued. There were no unhandled rejections.

## C2 · Built runner with controlled seams (`drivers/c2-runner.mjs`, receipt 11, T3)

Timings are measured from the refusal unless noted.

- **R1 virtual clock jump.** At +50 ms the monotonic clock jumped +1,500 ms, then timely-looking "all executable names missing" metadata arrived. The runner settled 0.9 ms after delivery (76.8 ms real) with no `startRefusal`. The 1,000 ms timer was cleared without firing, and no working-directory lookup followed.
- **R2 genuine event-loop block.** A single `setImmediate` busy-waited until +1,150 ms real, then delivered the same metadata. The runner settled 0.2 ms after the block (1,150.3 ms) with no cause; the timer was cleared and never fired. JavaScript delivery is claimed only after the block ended.
- **R3 early timer (clock at 0.7×).** The first timer fired at real ~1,000 ms and was re-armed four times (300, 82, 17, 6 ms). Settlement came at **1,436.9 ms**, unknown cause; a late release changed nothing.
- **R4 budget starts at refusal.** Refusal came 700 ms after spawn and metadata 500 ms later: `executable-missing` retained, 502.5 ms after refusal and 1,203.9 ms after the call.
- **R5 timely causes.**
  - Executable missing at 400 ms → `executable-missing`.
  - Working directory missing at 850 ms → `working-directory-missing` (853.7 ms).
  - Working directory is a file → `working-directory-not-directory`.
  - Working directory is a directory → no cause.
  - EACCES → only a working-directory lookup, `working-directory-missing`.
  - Spawn EPERM → `UNKNOWN`, and a stat fault gave no cause.
- **R6 wall clock.** +2 h: timely cause kept. −4 h: still bounded at 1,013 ms.
- **R7 secondary events and late metadata.** Close −4058, both pipe ENOTCONN errors and a second `error` (EACCES) neither settled the runner early (unsettled at +500 ms) nor added flags; settlement came at 1,010.6 ms. A late success plus rejection left the *same* resolved object deep-equal, with no follow-on lookup. A late working-directory rejection was likewise ignored.
- **R8 earlier deadline and abort.**
  - `timeoutMs:15`: settled at 15.4 ms from the call, `timedOut:false`, no cause; the request timer fired and the diagnostic timer was cleared.
  - Abort at +200 ms: settled 0.36 ms after the abort, `aborted:true`, timer cleared.
  - Pre-aborted signal: no spawn.
- **R9 started processes.** An unbounded started child closing at 1,500 ms gave exitCode 0 at 1,510 ms, with no stat, no runner timer and no kill. A later EPERM error from a started child is not a refusal.
- Release and listener cleanup checks passed in every case. There were no unhandled rejections.

## C3 · Public mapping, privacy, preservation (`drivers/c3-public-mapping.mjs`, receipt 12)

- **Native mappings (T1), each with definite non-submission:**
  - Working directory is a file → `HARNESS_INVALID_CONFIGURATION` "…is not a folder…", 2.0 ms.
  - Executable removed only for the turn spawn (a scratch byte-copy of node.exe, renamed away on the first attempt) → `HARNESS_NOT_INSTALLED` "The Claude executable was not found at its configured path; install the Claude CLI or correct its path", 0.6 ms.
  - Missing working directory: P0 above.
- **Earlier request deadline (T2).** Preflight with `preflightTimeoutMs:50`, a missing absolute CLI and all stats withheld finished in 130.7 ms. It reported state `unknown` with problem "Claude CLI could not be started (ENOENT). Check that…". There was no timeout text. Each 50 ms timer fired and each diagnostic timer was cleared; late release started no lookup.
- **External abort at +200 ms (T2).** Result `AbortError` "Claude turn cancelled", no error event, settled 0.6 ms after the abort, one turn, no kill.
- **F1 (T3 auth child, native version/help).** Auth-like stdout or stderr, a pipe error and close 1 or null each produced state `unknown`, problem "Claude CLI check output could not be read. …", no `authenticated` key, version kept, and one owned-tree kill. Completed native sign-out produced `auth`, "Claude is not signed in. Run claude auth login, then retry preflight.", and `authenticated:false`.
- **F2 (T1, and T2 for the held variant).** The check folder was removed only for the help probe, then restored. The help-only text "…temporary check folder does not exist." was preserved, with version and auth succeeding. With its stat withheld, the help diagnosis expired at 1,004.6 ms and kept "Claude CLI could not be started (ENOENT)." Neither case was rewritten as the versioned `--max-turns/--help` failure.
- **Normal (T1).**
  - Ready preflight: `ready`, `claude.ai`, `authenticated:true`, version `2.1.290`, no problems.
  - Ordinary turn: events `session, item, submitted, usage, turn-complete`, final text kept.
  - Started turn completing 1,580.7 ms after spawn: success, with no stat and no turn timer.
- **Privacy.** Events, errors, preflights and the engine failure contained no canary, scratch or binary path, `spawn `, `errno`, `syscall`, `ENOENT:` or fixture marker.

## C4 · Old-source control (`tools/build-old-process.v3.mjs` receipt 15, `drivers/c4-old-source.mjs` receipt 16, T4)

The parent `process.ts` (blob `740f92c3`, SHA-256 `c44ed660…d322`) was emitted through the real
`infrastructure/tsconfig.build.json` program, with only that file's text substituted, into scratch (`4c83adaa…`).

- Gate: the same program emit of the candidate equals the built `9f8f0011…`.
- Cross-check: an ESNext transpile of the old source equals its program emit.
- The old build differs from the candidate dist only by the D203 lines.

`harness.js` was bound to the old file. The candidate `process.js` was not loaded, and dependencies were unchanged.

- **O1 old public default turn** (working-directory stat withheld): unsettled with no event and an open queue at +1,500 and +3,000 ms. It had no turn timer at all. It settled only on release (3,003.9 ms after refusal), adopting the late cause `HARNESS_INVALID_CONFIGURATION`.
- **O2 old engine default run:** still `running` at +3,000 ms (pinned `runDeadlineSeconds` null). It reached `failed` 4.6 ms after release with `adapterCode` `HARNESS_INVALID_CONFIGURATION`, and there was one turn attempt.
- The candidate counterparts P2/P4 reached terminal at 1,002 and 1,018 ms with the unknown cause and ignored the late result. The author's two old-source failures were not counted.

## C5 · Integrity and cleanup

- `c5-integrity` before and after: 28/28 each, all listed above.
- 52 native fixture PIDs were recorded, and every one closed in its driver. Afterwards no process had the fixture or binary-copy command line, no recorded PID owned a listener, and there was no 4747/4748/11434 listener (read-only listing, point in time). PID 46380 is now an unrelated `pwsh` started at 16:50:18Z, after its fixture had closed (PID reuse).
- All held stat promises were released after terminal observation. Driver scratch roots (`c1`, `c3`, `c4`, including the node.exe copy `dccc52de…` = runtime node.exe) were removed, and no `gg-claude-probe-*` folder remains. Retained scratch files and their hashes are in `retained-artifacts.json`. No store, cache or dependency was written. The agent session's `claude\` task folder under the TEMP root predates this QA and was untouched.

## Commands and timing (UTC, 2026-11-21)

| Receipt | Command | Exit | Duration |
| --- | --- | --- | --- |
| 01 | node --version | 0 | — |
| 02 | pnpm version | 0 | — |
| 03 | owner listeners before | 0 | 16:33:39 |
| 04 | integrity before | 0 | 16:33:40 |
| 05 / 05b | feasibility probes | 0 / 1 | 16:38–16:39 |
| 10 | C1 | 0 | 16:40:31–16:40:44, 13.4 s |
| 11 | C2 | 0 | 16:43:01–16:43:13, 12.4 s |
| 12 | C3 | 0 | 16:45:31–16:45:40, 9.2 s |
| 13 | C4 builder v1 | **1** | — |
| 14 | C4 builder v2 | **1** | — |
| 15 | C4 builder v3 | 0 | — |
| 16 | C4 | 0 | 16:49:27–16:49:37, 10.2 s |
| 17 | processes/listeners after | 0 | — |
| 18 | integrity after | 0 | 16:50:22 |
| 19 | recorded re-run of the read-only diagnosis | 0 | — |

Every receipt in `commands/` records argv, cwd, the process-local environment, exit code and stdout/stderr SHA-256.

## Failures, corrections and limits

- **Instrumentation corrections (3/3 used; see `instrumentation-history.json`):**
  1. A Node-API feasibility probe on dummy modules was inconclusive and was refined. Its TypeError proves the hook bound the seam. It is counted conservatively, although it ran no product code.
  2. Builder v1: the C4 fidelity gate failed because `transpileModule` emitted CommonJS.
  3. Builder v2: the same failure, kept. v3 used the real build program and passed the unchanged gate.

  All originals, errors and results are kept. Each product driver ran once and passed. Two diagnosis-only scripting mishaps (shell or heredoc backslash loss) are also recorded; one broken heredoc copy was overwritten and is not retained.
- **Pre-execution edits:** a recorder finish guard; one unsound C1 predicate removed before the first run.
- **Fixture route:** the public default turn ran with the default runner, but the spawn seam prepended the fixture script to the node binary's argv. There was no compiled native CLI and no real Claude CLI, provider or account.
- **Simulated vs natural:** F1 output loss and all C2 cases are scripted. Naturally occurring pipe loss and a naturally stalled Windows filesystem were not observed or induced. The delays are controlled delivery of natively completed stats.
- **Not claimed:** native stat cancellation, and real-time JavaScript delivery during a blocked event loop.
- **Not separately re-run:** stronger started-process outcomes (termination unconfirmed, overflow, callback, output loss on turns) beyond R7/R9 and F1. A no-PID refusal cannot produce them.
- **Scope:** observations are from one Windows host. Listener listings are point-in-time. The engine check used in-memory fakes.
- **Not run (as briefed):** the author's 306-test suite and coverage, the earlier 272 predicates, any API/persistence/browser/provider suite, a rebuild, and CI or canonical native verification. Root owns archive publication, fresh CI/native checks and D035/D042 coordinator completion before merge.
- **PLAN.md wording:** the plan says it was written "~16:40 UTC". That estimate was wrong: the file was created at 16:32:26Z and never modified, before the first command at 16:33:38Z.

## Evidence and seal

`G:\ggq\delivery-evidence\2026-11-17-five-intents\i4-364-deadline-independent-01` contains:

- `PLAN.md`
- `tools/`, `drivers/`, `fixtures/`
- `commands/` (receipts with stdout/stderr)
- `observations/` (raw predicates, seam logs, timers, listeners and spawn/stat/kill records per driver)
- `instrumentation-history.json`, `retained-artifacts.json`
- this `REPORT.md`

`SEAL.json` lists the bytes and SHA-256 of every other file, including this report. No commit, push, stage,
publication, issue change or owner-data change was made.
