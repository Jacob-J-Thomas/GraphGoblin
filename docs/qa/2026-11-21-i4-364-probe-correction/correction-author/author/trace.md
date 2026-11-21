# Independent trace of F1 and F2 at the original source

Source: `a04f6661a74a727e6c963d8648ea2998bb6dbe7b`, `harness.ts` SHA-256
`bc45a1849e0b8ac7e4c89ecc423faa8511da5bee374200b90328469863e6bf1b` (git blob `91b00200`),
`process.ts` blob `740f92c3`. Written before any test or source change. Line numbers are the
original `harness.ts` unless stated.

## Producers (process.ts, unchanged by this work)

- `outputFault` (process.ts 220-224): a stdout or stderr `error` of a started child (pid set) sets
  `outputFailed = true` and calls `kill()`. If `killTree` confirms and `close` arrives, the result
  settles with the close code (1, null or any other), so `outputFailed` coexists with a nonzero or
  null `exitCode`.
- `finish` (process.ts 143-148): for a probe (`classifyDiagnostics`), `failureState` is
  `cliFailureState(stderr window)` whenever `exitCode !== 0` and stderr was seen, independent of
  `outputFailed`; `notLoggedIn` whenever stderr contains "not logged in".
- Spawn refusal (process.ts 229-240): no pid, `spawnCode` set, then one `stat` observation gives
  `startRefusal` (`working-directory-missing` / `-not-directory` / `executable-missing`) or none.

## F1 — auth check, output lost, exit 1 or null

`inspect().run(['auth','status','--json'], true)` (harness.ts 263-327):

1. 277-284: `JSON.parse(result.stdout)` of a truncated body throws; `auth` stays undefined, so no
   `signOutDetail` (285-299).
2. 300-310: the positive sign-out branch is taken only for `signOutDetail`, stdout "not logged in"
   or runner `notLoggedIn`. That branch calls `checkOutcome({...result, exitCode: 0})`, whose
   `exitCode: 0` skips the inference branch and reaches the `outputFailed` guard at 201 — already
   correct (existing test harness.test.ts:1175 exercises exactly this, at exit 0).
3. Otherwise 314-325 call `checkOutcome` with `failureState` = runner `failureState` (recognised
   stderr) or, when absent/`unknown`, `cliFailureState(stdout)` of the truncated body.
4. `checkOutcome` (157-215) order: termination-unconfirmed 163, abort 170, spawn refusal 171,
   timeout 172, overflow 178, callback 185, **inference 186-200** (`probe && exitCode !== 0 &&
   failureState not unknown`), **output guard 201-205**, exit/stdin 206-212.
5. With `exitCode` 1 or null and an inferred `auth`, 195 throws `HARNESS_NOT_AUTHENTICATED` with
   `readinessDetail('claude','auth')` = "Claude sign-in is missing or invalid." before 201 is
   reached. `quota` → `HARNESS_QUOTA_EXHAUSTED`; `transport` → `HARNESS_TRANSPORT_FAILED`,
   retriable; `cli-incompatible` → `HARNESS_CLI_INCOMPATIBLE`.
6. 360-361: `failureState(error) === 'auth'` sets `facts.authenticated = false`. 376-390 produce
   `state: 'auth'` (version/help passed, so it is the first failure) and the problem
   "Claude sign-in is missing or invalid. Run claude auth login, then retry preflight."
7. Turn: 442-443 throw `inspection.failures[0]` = that `HARNESS_NOT_AUTHENTICATED`; 571-578 emit it
   with `submission: 'definitely-not-submitted'`; no `--print` process starts.

Stdout example from the report: `{"authMethod":"claude.ai","email":"authentication@example.invalid`
→ `cliFailureState` matches `authenticat` (domain readiness.ts 30) → `auth`. Recognised stderr
example: `API Error: 401` → status 401 → `auth` in the runner.

Not affected: exit 0 with output loss (inference branch requires `exitCode !== 0`); positive
sign-out text/JSON with output loss (step 2); turns (`probe` false; turn output loss is caught in
the precedence block at 519-527 and reported as "Claude turn failed").

Smallest correction: test `probe && result.outputFailed` before the inference branch, after the
callback check. Termination, abort, refusal, deadline, overflow and callback stay ahead of it.

## F2 — version passes, only the help check fails with a process cause

`inspect()` 328-352:

1. 329-331: version succeeds; `version` = e.g. `2.1.285`.
2. 335: help `run(...)`. Causes it can throw, all `HARNESS_TURN_FAILED` unless noted:
   a. spawn refusal → `startFailure(code, refusal, cwd, true)` (112-152): check folder missing /
      not a folder (127-131, new in #364); unexplained refusal "Claude CLI could not be started
      (ENOENT)." or the long-TEMP wording (139-145, new in #364 for ENOENT; pre-#364 probe ENOENT
      was `HARNESS_NOT_INSTALLED`, which the wrapper never touched; pre-#364 EACCES/UNKNOWN had the
      same short text and was already wrapped); executable missing → `HARNESS_NOT_INSTALLED`
      (passes through).
   b. output loss at exit 0 → 201 "Claude CLI check output could not be read." (new in #364);
      at exit 1/null with recognised stderr the F1 order first yields an inferred state
      (`cli-incompatible` → `HARNESS_CLI_INCOMPATIBLE`).
   c. ordinary option failure: exit ≠ 0 / stdin failure → "Claude CLI check exited with code N." /
      "stopped without an exit code." (206-212); recognised "unknown option" stderr →
      `HARNESS_CLI_INCOMPATIBLE` (186-200).
   d. termination unconfirmed / timeout / overflow → their own codes; abort → `DOMException`.
3. 336-347: the wrapper replaces every `HARNESS_CLI_INCOMPATIBLE` or `HARNESS_TURN_FAILED` with
   "Claude CLI <version> failed the --max-turns/--help check." — so 2a (folder, unexplained,
   long-TEMP) and 2b lose their fixed cause; 2c is the intended target; 2d and NOT_INSTALLED pass.
4. 350-352 push it; auth (354-363) runs independently and may succeed (`authenticated: true`).
5. 376-390: `state` `unknown`, problem "Claude CLI 2.1.285 failed the --max-turns/--help check.
   Check that the Claude CLI starts and responds, then retry preflight."; the fixed cause is absent
   from the whole response.
6. Turn: 442-443 throw that same wrapped error; no `--print` process starts.

Existing tests miss both: harness.test.ts:1155 refuses every command (version fails first);
1175 faults auth only, at exit 0 with explicit sign-out handling; 718 is the ordinary exit-1 help
failure (the intended wrapper target).

Smallest correction consistent with D193: a module-private subclass of `ClaudeHarnessError`, fixed
to `HARNESS_TURN_FAILED`/not retriable, constructed only where `startFailure` reports a probe start
refusal and where `checkOutcome` reports lost probe output; the help wrapper skips instances of it.
No message matching, no exported type, no code/retriability/message change, no process.ts change.
