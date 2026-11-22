# D203 independent behavior QA plan for #364 (written before execution)

Executor: actual Claude Code, model `claude-opus-5-5` (Opus 5.5), xhigh, independent context.
Plan written 2026-11-21 ~16:40 UTC, before any driver or product code was executed.

## Bindings

| Item | Value |
| --- | --- |
| Checkout (frozen candidate, read-only) | `G:\ggq\gg-i4-364-deadline-qa\GraphGoblin` |
| Candidate head / tree / parent | `e8cf31d51837a4fa362f909604b3070277db6c25` / `0927bbbf9f3889791c956e7816e3524c9a5a8fe6` / `580aded6d295061897b047ac16811e5da230d9e0` |
| Preparation | `...\i4-364-deadline-qa-preparation-01` receipt `ENVIRONMENT_PREPARATION_COMPLETE_NOT_QA`, offline frozen install exit 0, one build exit 0, 1,271 outputs; SEAL manifest/receipt/output-hash SHA-256 already rechecked equal (7ca7bcf9…, 42c1503a…, c5462fbb…) |
| Root freeze | `Q\i4-364-deadline-root-freeze-01\receipt.json` (five source hashes) |
| Decision / negative scan | `Q\decision-203.md`; `Q\i4-549-final-astra-02\REPORT.md` (final scan 3 stays negative) |
| Author report (immutable, not independent) | `...\i4-364-deadline-author-01\REPORT.md` |
| Evidence (E) | `G:\ggq\delivery-evidence\2026-11-17-five-intents\i4-364-deadline-independent-01` |
| Scratch (S) | `G:\ggq\qa-scratch\i4-364-deadline-independent-01\work` (TEMP/TMP root is the canonical `G:\ggq\qa-scratch\i4-364-deadline-independent-01`; the pre-existing `claude\` task-output folder there belongs to the agent session and is not touched) |
| Runtime | `C:\Users\98jak\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64\node.exe` first on child PATH; `pnpm.cmd` only for a version record |

Out of bounds: `G:\ggq\gg-i4-364-qa` (old QA at b90), the author checkout, Q provider/brief/spec files,
owner ports 4747/4748/11434 (only a read-only listener listing), providers/accounts/real Claude CLI,
HOME/global settings, dependencies, Git commits/index/remote records. No subagents, no rebuild,
no coverage/browser/provider suite, no rerun of the earlier 272 predicates.

## Method and seams (independent of the author's vitest mocks)

All product code is the **built** `packages/infrastructure/dist` (and engine/domain/contracts dist)
loaded by plain Node scripts, not the TypeScript sources and not Vitest. Seams are installed with
`node:module` `registerHooks` (in-thread resolve hook) that redirect **only the imports made by
`dist/claude/process.js`** (or the scratch old `process.js`):

- `node:fs/promises` -> seam whose `stat` by default issues the real native `stat` immediately and
  can withhold *delivery* of its real result until an explicit release (or deliver a recorded
  override). Every call is logged (path class, time relative to the refusal, hold/release).
- `node:child_process` -> seam whose `spawn` by default calls the real `spawn` (genuine native
  start or genuine native refusal), prepending my own fixture script to argv for the fixture node
  binary (binary, cwd, env, options unchanged). It logs every spawn, pid presence, native `error`
  code and `close`. In runner-level cases it can instead return a scripted `ChildProcess`.
- `../process/index.js` -> seam wrapping the real `killTree`, logging every call.

Observation-only instrumentation in the driver: global `setTimeout`/`clearTimeout` wrappers that
attribute timers by stack to `claude/process.js` (created/fired/cleared), an `EventTarget`
`addEventListener`/`removeEventListener` wrapper for `abort` listeners added by process/harness code,
`events.getEventListeners`, `process.getActiveResourcesInfo()`, `unhandledRejection` capture, and an
optional virtual monotonic clock (`performance.now` replaced; real elapsed time is always measured
with `process.hrtime.bigint()`). `Date.now` can be shifted for wall-clock jump cases.

Fixture: my own `fixtures/qa-cli.mjs` (written for this QA) run by Node 22.23.4: answers
`--version` (`2.1.290`), `--help` (all required flags), `auth status` (`claude.ai`, or completed
sign-out), and a turn (`init` + `success` result, optionally after a 1,500 ms delay). No provider,
network or real Claude CLI.

Evidence tiers used in the report:
- **T1 native**: genuine Windows spawn refusal/start of the fixture via real `spawn`, real `stat`.
- **T2 native + controlled delivery**: genuine native refusal; real `stat` issued but its delivery
  withheld by the seam (controlled delay, *not* a naturally stalled filesystem).
- **T3 controlled**: scripted child/stat/clock through the built runner.
- **T4 old-source control**: parent `process.ts` compiled to scratch, otherwise identical dist.
Author results are cited only as context, never counted as observations here.

## Criteria, cases and my expected observations

Common expected texts (formed from source reading):
- UNKNOWN_TURN = `Claude could not be started (ENOENT); check the Claude executable's path and permissions and the working directory`, code `HARNESS_TURN_FAILED`, retriable false.
- MISSING_DIR_TURN = `Claude could not be started because the working directory does not exist; check the working directory setting` (`HARNESS_INVALID_CONFIGURATION`); NOT_DIR_TURN = same with `is not a folder`.
- MISSING_EXE_TURN = `The Claude executable was not found at its configured path; install the Claude CLI or correct its path` (`HARNESS_NOT_INSTALLED`).
- Probe texts: `Claude CLI could not be started (ENOENT).`, `Claude CLI could not be started because its temporary check folder does not exist.`, `Claude CLI check output could not be read.`, each + ` Check that the Claude CLI starts and responds, then retry preflight.`; sign-out `Claude is not signed in. Run claude auth login, then retry preflight.`
- Engine: run `failed`, `failure.code` `HARNESS_TURN_FAILED`, message `harness turn failed: <adapter message>`, `details.adapterCode`, `inference.submission` `definitely-not-submitted`, `resumable` false.

### C1 public default turn (driver `c1-public-turn`)
Public `ClaudeHarness` from dist with **default runner** (no `runner` option), `platform: 'win32'`,
binary = absolute Node 22 executable (exists). Version/help/auth probes start natively and succeed.
Turn `workingDirectory` = missing folder under S containing canary `PRIVATE_QA_CANARY_D203`; no
external abort; `HarnessStartRequest` has no timeout; harness passes `timeoutMs: null` (verified by
built `harness.js` text and by the absence of any request timer for the turn spawn).
- P0 control, real stat delivery (T1): expect MISSING_DIR_TURN, `definitely-not-submitted`, settle < 1,000 ms after refusal.
- P1 hold the three executable-name stats (T2): expect exactly one turn spawn with no pid and native `ENOENT`; terminal UNKNOWN_TURN event `[{type:'error',…, submission:'definitely-not-submitted'}]`, result and sessionId reject with it; settle 999–1,300 ms after refusal; no `HARNESS_TIMEOUT`, no AbortError; `killTree` 0 calls; total spawns 4 (3 probes + 1 turn); no process.js timer pending and no process/harness abort listener left. Released at +2,500 ms with the real late results (one success, two ENOENT rejections): result/event snapshots unchanged, **no follow-on working-directory stat**, no new spawn/kill/event, no unhandled rejection.
- P2 hold the working-directory stat; executable stats delivered (T2): same terminal UNKNOWN_TURN in the same window; late real ENOENT rejection (would have been MISSING_DIR_TURN) ignored.
- P3 hold the working-directory stat, late *success* override = real Stats of a file (would have been NOT_DIR_TURN): ignored, unchanged.
- P4 public engine default loop (T2): `createTestEngine` (**in-memory fakes: FakeClock, stores, catalogue; only the harness is real**), single inference node with no `timeoutSeconds`, loop `runDeadlineSeconds` default null; wd stat held. Expect `runToIdle` returns `failed` with the engine mapping of UNKNOWN_TURN, submission `definitely-not-submitted`, one turn spawn, then late release changes nothing.

### C2 built runner behavior with controlled seams (driver `c2-runner`)
Built `runClaudeProcess` imported from `dist/claude/process.js`; scripted children (no pid, `error`
ENOENT/EACCES, close -4058) or started children (pid set), controlled stat delivery and clock.
- R1 delayed timer callback, virtual clock: after refusal advance `performance.now` +1,500 ms, then deliver timely-looking “all names missing”; expect immediate settle (well before the real 1,000 ms timer), no `startRefusal`, diagnostic timer cleared, no cwd stat.
- R2 genuine event-loop block, real clock: in one `setImmediate` busy-wait until real refusal+1,150 ms, then deliver “all names missing” in the same callback; expect no `startRefusal` (accepted only if timely), timer cleared not fired.
- R3 early timer, slow virtual clock (rate 0.7): expect settle near real 1,430 ms (not at 1,000), multiple process.js re-arms, unknown cause.
- R4 budget starts at refusal: refusal emitted 700 ms after spawn, stats delivered 500 ms after refusal; expect cause retained (executable-missing).
- R5 timely causes with delays below budget: 400 ms all missing -> `executable-missing`; 850 ms wd missing -> `working-directory-missing`; wd file -> `working-directory-not-directory`; wd directory -> no cause; EACCES + wd missing -> `working-directory-missing` with no executable stats; EPERM stat fault -> no cause.
- R6 wall clock jumps (`Date.now` ±2 h) do not change timely cause or the ~1,000 ms bound.
- R7 hold forever: close -4058 and pipe ENOTCONN errors after refusal and a second `error` do not settle early or add flags; settle ~1,000 ms; late success then late rejection leave the resolved object deep-equal; no follow-on stat; timer/listener released.
- R8 earlier request deadline `timeoutMs: 15`: settle ~15 ms, `timedOut` false, no cause; earlier abort at 200 ms: settle within 50 ms of abort, `aborted` true; listener removed, diagnostic timer cleared; pre-aborted signal: no spawn.
- R9 started unbounded process (`timeoutMs: null`, pid set) closing 0 at 1,500 ms: exitCode 0 at ~1,500 ms, zero stat calls, zero process.js timers; started child with later `EPERM` error then close 0: no stat, exitCode 0.

### C3 public mapping, privacy, preservation (driver `c3-public-mapping`)
- M1 timely native (T1): missing wd -> MISSING_DIR_TURN; wd is a file -> NOT_DIR_TURN; executable renamed away only for the turn spawn (scratch copy of node.exe) -> MISSING_EXE_TURN; all `definitely-not-submitted`.
- M2 earlier request deadline, public preflight with `preflightTimeoutMs: 50`, missing absolute binary, stats held: settles < 1,000 ms; problem is the generic start text, not a timeout; external abort at 200 ms during a held turn: AbortError `Claude turn cancelled`, no error event, prompt settle.
- M3 F1 preservation (T3 auth child + native version/help): auth-like stdout + stdout pipe error + close 1 -> state `unknown`, `authenticated` absent, output-loss text; completed sign-out -> `auth`, `authenticated:false`.
- M4 F2 preservation (T1): check folder removed only for the help probe, then restored -> help-only CheckProcessFailure text preserved (not the versioned `failed the --max-turns/--help check`), version and auth succeed; help probe refused with held stat past budget -> generic `Claude CLI could not be started (ENOENT).` preserved.
- M5 normal completed checks (T1): ready preflight (ok, `claude.ai`, version, no problems); ordinary turn succeeds; slow started turn completing after 1,500 ms succeeds (budget does not apply to started processes).
- Privacy: every public value (events, errors, preflight, engine failure) is checked for absence of the canary, scratch root, binary path, `spawn `, `errno`, `syscall`, `ENOENT:` and fixture stderr body markers.

### C4 finite old-source control (driver `c4-old-source`, T4)
Parent `process.ts` from `git show 580aded6:…` (blob hash recorded) transpiled with the checkout's
TypeScript and the infrastructure build options into S only. Fidelity gate: the same transpile of the
candidate `process.ts` must equal the built `dist/claude/process.js` bytes. The resolve hook maps
`harness.js` -> scratch old `process.js`; all other dist and dependencies are unchanged; the candidate
tree is never written. Single observations: (a) public default turn with wd stat held: expect still
unsettled at +1,500 and +3,000 ms (no event, queue open), then after release settles with the late
cause MISSING_DIR_TURN; (b) engine default run with wd stat held: expect run still non-terminal at
+3,000 ms, then `failed` after release. Candidate counterparts are P2/P4. Controlled work released.

### C5 integrity and cleanup (driver `c5-integrity`, before and after)
Recompute SHA-256 of every preparation-inventoried source file and all 1,271 build outputs, the
worktree index file, lockfile and install metadata; `git status` empty and HEAD/tree exact, before
and after execution. Check author packet seal and freeze receipt bytes. Record a read-only listener
listing (no connection to owner ports), all fixture PIDs recorded by the spawn seam and their exit,
and absence afterwards of any process whose command line names my fixture. Hash retained scratch
artefacts (compiled old build, node.exe copy, fixture). Release every held stat before exit.

## Rules for failures and corrections
Each command is recorded by `tools/record.mjs` (argv, cwd, process-local env, UTC times, exit,
stdout/stderr bytes+SHA-256). At most three distinct driver/instrumentation corrections; originals,
errors and results are kept as `*.v1`, `*.v2`, … Unchanged failures are not retried; assertions,
windows and expectations above are not weakened. A product failure is reported as FAIL.
Per-criterion verdicts: PASS / CONDITIONAL / FAIL. Output: `REPORT.md` and `SEAL.json` (hash of
every evidence file). This is criterion QA only: no Astra approval, whole-intent completion, CI,
merge or owner acceptance.
