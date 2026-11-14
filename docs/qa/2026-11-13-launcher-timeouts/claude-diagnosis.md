I couldn't write the plan file or call ExitPlanMode because this session only has Read, Grep and Glob, so the full report is below. I did not change any files or processes.

# Diagnosis/design review: Windows launcher helper timeouts (base `b3b5e187`)

## Verdict

The provisional direction is sound: drain both pipes, use the configured budget, and report which stage failed. It has four design gaps that would break existing tests or weaken fail-closed behaviour if implemented as described. The old logs can't show which stage timed out. The most likely contributor is slow process start on a cold or busy machine. A full pipe is a proven defect in the code but an unlikely cause of this incident.

## New evidence (read-only, owner files)

- **Previous gateway shut down cleanly.** `gateway.log:10255-10256`: gateway PID 2484 accepted `POST /system/shutdown` (202) at 2026-11-11 00:57:10Z. The next line, `:10257`, is PID 33348 listening at **2026-11-14 01:05:13Z**. Nothing was logged in between, so the two failed clicks never started a gateway. That fits a failure before spawn.
- **Failure times.** `launcher.log:7,10`: 01:03:02.16Z and 01:03:59.90Z (19:03 local).
- **The machine was slow at 19:05.** `graphgoblin.lock` records PID 33348 with `windowsCreationTime` 134390918987251810, which is **01:04:58.7Z**, and `startedAt` 01:05:08.257Z. So it took **9.5 s** from process creation to the first lock write (full API import plus one self PowerShell/WMI probe) and 14.3 s to listening. Warm, a helper takes about 1.5 s.
- **Owner budget.** The owner config has `StartupTimeoutSeconds: 60`. I read only that field because the config may hold GG_* secrets.

## Causal assessment

| Hypothesis                                                                                                                                                                                                                                                                                                                  | Reachable?                                           | Confidence for this incident                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **H2: slow helper start or imports on a cold or busy machine.** Both helpers import the whole sqlite barrel (`instance-identity.ts:7`) only to call the pure `databaseFilePath` (`db.ts:172`). That pulls in drizzle, the libsql native binding and the entire engine (`chat.ts:21`, `runs.ts:5` → `engine/index.ts:6-16`). | Yes                                                  | **Medium (most likely).** Fits two failures about a minute apart, then success, plus the 9.5 s gateway pre-lock time.                                                                                   |
| **H1: several WMI probes in sequence in `--store-state`.** Up to 4 probes (2 guards and 2 locks, `data-dir-lock.ts:95,228-230`, `instance-identity.ts:43-46`), each up to 5 s plus PowerShell start.                                                                                                                        | Only if lock records name live PIDs                  | **Low.** The 11-11 drain should have removed both locks.                                                                                                                                                |
| **H3: pipe backpressure.** `Launcher.cs:193,198` waits for exit before reading stdout and never reads stderr.                                                                                                                                                                                                               | Proven with a synthetic stderr flood (baseline test) | **Very low.** The real helper writes about 100 bytes plus one short stderr line (`instance-identity.ts:58-65`). Only an import-time stack trace or output caused by `NODE_OPTIONS` could fill the pipe. |

**Cheap read-only checks that would separate these:**

- **PowerShell event log.** Query events 400/403 in the `Windows PowerShell` log for 19:00–19:06. They normally record each PowerShell start and stop with its command line, which here includes `ProcessId = N`.
  - A probe for any PID other than 33348 before 19:04:58 confirms H1.
  - No probes before then rules H1 out.
  - The gap between 400 and 403 for 33348's self-probe measures how slow PowerShell/WMI was at the time.
- **Boot or resume time** shortly before 19:02.
- **User or machine `NODE_OPTIONS`.** `Launcher.cs:62-63` passes it to the helpers.

## Blockers in the provisional design

1. **Tying the helper bound to `StartupTimeoutSeconds` breaks the existing native suite.**
   - That suite uses `StartupTimeoutSeconds: 1` for six refusal cases (`windows-launcher.acceptance.mjs:219,394,542`). The real helper takes about 1.5–2 s, so a 1 s bound turns ownership refusals into helper timeouts.
   - **Recommendation:** helper bound = `max(StartupTimeoutSeconds, 15 s)`. The owner gets 60 s, the existing suite is unchanged, and no config field or installer change is needed. Hung-helper tests then take about 15 s each.
   - Raising the validation minimum instead would add about 90 s to a suite with a 240 s limit.
2. **Draining needs one deadline, a bounded buffer and no hidden waits.**
   - One deadline must cover exit plus EOF on both pipes.
   - Never call `WaitForExit()` without a timeout. In .NET Framework it waits for EOF on asynchronously read streams and hangs if a child process still holds the pipe.
   - Don't use `OutputDataReceived`: its line reader has no size limit on a single line.
   - Read raw bytes on background threads. Keep stdout up to a cap (≥128 KB, because the ownership JSON contains a path that may be long). Count and discard anything beyond the cap so draining continues. Count stderr bytes only.
   - Decode stdout as explicit UTF-8. Today's default decoding garbles non-ASCII paths, and the fixture path contains `α`.
3. **Fail closed on partial output.**
   - Refuse when stdout overflowed, even if the kept prefix is valid. Otherwise `{"state":"free"}` followed by junk would be accepted.
   - Refuse valid output followed by a hang.
   - Act only after exit, exit code 0, and EOF on both pipes.
4. **The total budget must be bounded and documented.**
   - Remove the redundant third ownership call (`Launcher.cs:293`) and reuse the loop's last result.
   - Never start a helper call after `releaseDeadline`.
   - With a 60 s bound and today's structure, the worst case before spawn is about 240 s (identity, then three ownership calls).
5. **The new suite must actually run.** `package.json:44` runs only the old acceptance file, so `windows-launcher-helper.acceptance.mjs` never reaches CI.
6. **Local repair hazard.**
   - Re-running `install-windows-launcher.ps1` without `-Environment` rewrites the JSON with an empty `Environment` (`:10,73-80`). That drops the owner's GG_* overrides and changes the configuration identity.
   - Recompile the exe in place with the same command as `:41` and leave the JSON alone. No gateway restart is needed.
   - Before doing so, check which keys are present without printing their values.

## Important, not blocking

- **Stage diagnostics.** Report the stage (identity or ownership), the outcome (timeout, exit N, invalid output, oversized output, stream left open), elapsed time and the bound. Never include stdout or stderr content.
  - Drop the PowerShell/WMI hint from the identity stage: identity never calls WMI, and the current text (`:196`) sent the investigation the wrong way.
  - Keep the "runtime / GG_* overrides" hint for a non-zero exit.
- **Kill handling.** `Kill()` can also throw `Win32Exception` while the process is exiting. `:195` catches only `InvalidOperationException`, so that would hide the timeout message.
- **Slow-success note.** On success, write one `launcher.log` line when any stage used more than about 50% of its bound. Without it, a recurrence still can't be pinned to a stage.

## Gaps in the draft tests (`windows-launcher-helper.acceptance.mjs`)

- **Missing positive case for the ownership stage.** Add a delayed ownership helper that returns `free` and then a stub `main.js` gateway. The stub must listen on `GG_PORT`, return the matching instance header, report its own PID (`:256` checks it against the spawned PID) and exit by itself.
- **Missing refusals:**
  - valid output then hang (both identity and `free`);
  - valid prefix plus overflow;
  - stderr flood together with a `held` result, which must still refuse as held with no spawn.
- **Inherited-handle test (`:173-184`).** Its 4 s child exits before a 15 s bound, so the expected failure would turn into a success. The child must outlive the effective bound and then exit by itself.
- **Bound-dependent tests.** The hung-identity and hung-ownership tests (`:130-171`) assume a 1 s bound. Re-baseline them to the chosen rule.
- **Formatting.** The draft isn't Prettier-formatted (`:90-94`).
- **Final run.** Rerun the existing native suite and the contention suite with no assertion changes beyond intended message wording.

## Recommended minimum scope

1. Rewrite `ReadHelper` per blockers 2–3.
2. Bound = `max(StartupTimeoutSeconds, 15)`.
3. Remove the redundant ownership call.
4. Stage diagnostics and the slow-success note.
5. The tests above, wired into `test:windows-launcher`.
6. Update docs: troubleshooting guide, `docs/10`, CHANGELOG.
7. Local repair: recompile the exe in place only.

**Not in this change:** no relaxed ownership checks, no lock deletion, no new config field.

## Optional follow-ups

- **Lighter helper imports.** Move `databaseFilePath` into a module with no dependencies, exported through its own subpath and re-exported by the barrel, so the gateway and helper still share one implementation. Do it only if a first-run-after-build measurement shows a real gain.
- **Job Object for the helper process tree.** A PowerShell process orphaned by a killed helper loses its 5 s timer. It doesn't hold the launcher's pipes, because Node turns off inheritance of its own stdio handles at startup and execFile uses fresh pipes.
- **Distinct helper exit codes** for unsupported runtime vs invalid configuration.

## Open questions for you

- The PowerShell event log and boot-time checks are still undone.
- I couldn't confirm whether 2484's drain completed, but no locks naming it remain.
- None of this proves which stage stalled, and no synthetic reproduction should be described as doing so.
