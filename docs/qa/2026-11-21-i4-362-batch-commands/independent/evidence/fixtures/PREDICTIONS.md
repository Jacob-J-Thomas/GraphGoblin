# Predictions recorded before any native/public fixture ran (#362 independent QA)

Written 2026-11-21 against immutable source 02351e2fb932b3be44e7cc3fb3943a61d568226c
(tree d289bb12b943557584c5659bc33447d1baebc2f6), from reading:
packages/infrastructure/src/process/scripts.ts, packages/engine/src/handlers/script.ts,
packages/engine/src/handlers/script-dispatch.ts, packages/engine/src/run-recovery.ts,
packages/engine/src/run-manager.ts (resume/cancel/catch/failRun), packages/contracts/src/run.ts,
apps/api/src/routes/runs.ts, docs/04 Script, docs/05 "Deliberate script recovery (#321)".
Host: Windows 11 Pro 10.0.26300, Node v22.23.4 (project runtime).

## N0 raw node:child_process.spawn, shell:false (platform shape, no GraphGoblin code)

- N0-cmd-abs / N0-bat-abs: spawn() THROWS synchronously; err.code 'EINVAL', err.syscall 'spawn'
  (errno -4071 expected); no 'spawn' event; marker never appears.
- N0-cmd-upper (.CMD) / N0-bat-mixed (.Bat): same synchronous EINVAL (case-insensitive check).
- N0-cmd-trailing-dot / N0-cmd-trailing-space: synchronous EINVAL (post CVE-2024-36138 Node check);
  medium confidence. If either is not refused it is a Node platform behaviour to report, not
  forced into a PASS.
- N0-shim-extensionless (only NAME.cmd on disk, cwd+PATH contain it): async 'error' ENOENT
  (libuv searches only exact/.com/.exe), never EINVAL; no marker.
- N0-missing-exe: async 'error' ENOENT, no 'spawn' event.
- N0-cmdexe-cmd / N0-cmdexe-bat (cmd.exe /d /c <file>): 'spawn' event, exit 0, marker CREATED
  (positive control: the fixture bodies are effective when actually executed).
- N0-node-marker (node.exe -e write marker): exit 0, marker CREATED.
- Resource: the fixture process exits on its own after all cases.

## N1 ProcessScripts.run (built dist, real spawn)

- .cmd / .bat: resolves (never rejects) {state:'definitely-not-started', exitCode:null,
  stdout:'', stderr:'spawn failed: PROCESS_START_FAILED', stdoutBytes:0, stderrBytes:0,
  timedOut:false, stdoutOverflow:false, stderrOverflow:false}; no terminationUnconfirmed;
  marker absent; resolves within a few ms.
- .cmd with maxStderrBytes:0: stderr ''.
- missing exe: same definitely-not-started shape (async error path), marker n/a.
- cmd.exe /d /c refused.cmd (explicit author shell): state 'completed', exitCode 0, marker CREATED.
- node -e marker: completed, exit 0, marker CREATED.
- pre-aborted signal + node marker command: definitely-not-started without spawning, marker absent.
- Repeated .cmd refusals leave no extra active resources (getActiveResourcesInfo unchanged) and
  the process exits naturally.
- Note (source): the synthetic runner stderr still contains the token PROCESS_START_FAILED; the
  engine never surfaces stderr for definitely-not-started (no node.progress, no details).

## E engine composition (built dist RunManager + @graphgoblin/engine/testing ports + real ProcessScripts)

- .cmd/.bat script node: run status 'failed'; failure = {code:'SCRIPT_START_FAILED',
  message:'The script process could not start. Resume tries to start it again.', nodeId:'script',
  resumable:true, script:{visitId:'<runId>:<node.started seq>', dispatchId:<ULID>,
  state:'definitely-not-started'}}; no exitCode, no details; never INTERNAL_ERROR.
  Events include node.started(script), script.dispatched, run.failed; NO node.progress and NO
  node.finished for the script visit. Marker absent.
- Recovery snapshot: resume {allowed:true}; no scriptConsent; replay action for 'script' allowed.
- Plain explicit Resume (no retryUncertainScript): second script.dispatched with the SAME visitId
  and a NEW dispatchId; fails SCRIPT_START_FAILED again; marker still absent.
- Cancellation precedence seam (real runner refuses, then cancel lands before the handler reads the
  result): run ends 'cancelled' (run.cancelled), no SCRIPT_START_FAILED run.failed, marker absent.
- Controls: missing exe -> SCRIPT_START_FAILED; node marker -> succeeded + marker; cmd.exe /d /c
  refused.cmd -> succeeded + marker.

## A built API (apps/api/dist/main.js, disposable SQLite, random loopback port, no provider)

- POST /loops 201, POST /loops/:id/publish 200, POST /loops/:id/runs 202.
- GET /runs/:id settles 'failed' with the same failure as E; recovery.resume.allowed true; no
  recovery.scriptConsent. GET /runs/:id/events: no node.progress for the script, one run.failed.
- POST /runs/:id/resume {observedSeq} 200 (no consent flag needed); second attempt fails
  SCRIPT_START_FAILED with same visitId/new dispatchId; marker absent.
- .bat same first failure. Missing exe -> SCRIPT_START_FAILED; after the owner places a real
  executable at that path an explicit Resume completes (proves Resume semantics end to end).
- Node success control -> succeeded + marker. Explicit cmd.exe /d /c <the same .cmd> -> succeeded +
  marker (shell:false preserved; author-explicit shell is the supported batch path).
- API process logs: no INTERNAL_ERROR and no raw 'spawn EINVAL' for these runs.

## M discriminating mutant control (appended before M ran; after N0/N1/E/A had run)

Mutant = untracked copy of the built runner with only the synchronous spawn try/catch removed.
- M1 (mutant runner directly, native .cmd): the synchronous EINVAL thrown inside the Promise
  executor REJECTS the promise (code EINVAL, syscall spawn); marker absent.
- M2 (mutant runner through the current built engine): the current handler's runner-rejection
  catch records resumable SCRIPT_OUTCOME_UNCERTAIN (state outcome-uncertain) and recovery requires
  explicit consent (resume refused SCRIPT_CONSENT_REQUIRED, scriptConsent present); marker absent.
  (Pre-PR375 the handler had no catch, so the same rejection became INTERNAL_ERROR: source only.)
  So SCRIPT_START_FAILED in E/A is attributable to the synchronous catch, not another path.

## H adjacent heartbeat script probe (appended before H ran; pre-existing-issue check, not #362's node path)

Source: packages/engine/src/handlers/heartbeat.ts forwards {exitCode, stdout, stderr.slice(-4000),
json, timedOut} from the runner without its `state`.
- H1 heartbeat probe {kind:'script', command:<native .cmd>} with until 'true', record 'full':
  no INTERNAL_ERROR (synchronous catch also protects this path); the run succeeds through the
  heartbeat; heartbeat.beat.result and lastOutput carry exitCode null and stderr
  'spawn failed: PROCESS_START_FAILED' (internal runner token visible as probe data; no explicit
  not-started state); marker absent.

## A6 API restart over the same disposable SQLite store (appended before A6 ran)

- After a clean restart of the built API on the A data dir: every A-tier run keeps its status,
  lastEventSeq, failure and dispatch count; no new script.dispatched or run.failed is appended for
  the refused runs (startup recovery never re-dispatches a recorded proven refusal); recovery for
  the refused runs still shows resume allowed with no scriptConsent; markers unchanged.
