#362 is already fixed at `02351e2f`. On this Windows host a `.cmd` or `.bat` script never runs its body: the run fails with a resumable `SCRIPT_START_FAILED`, never `INTERNAL_ERROR`, and that holds through the built engine and the built API. I made no code changes. The checkout stayed at `02351e2f` (tree `d289bb12`) with a clean status and unchanged lockfile from start to finish.

**Results:** 64 cases, 64 pass, 0 fail. That is 33 acceptance cases, 22 controls, 2 mutant controls and 6 runs of existing unit tests, which count as supporting evidence only. The verdicts are computed from the raw output, not entered by hand.

- **Native refusal:** with `shell:false`, Node v22.23.4 rejects all 7 batch-file variants I tried (`.cmd`, `.bat`, upper/mixed case, trailing dot or space, with arguments). It throws `spawn EINVAL` immediately, before any process exists, and no marker file was created. Running the same files through `cmd.exe /d /c` does create the markers, so the files work when actually executed. A missing executable fails differently (`ENOENT`), as expected.
- **Script runner (built code):** the batch refusal comes back as `definitely-not-started` instead of an error. 200 repeated refusals gave identical results and left no timers or handles behind.
- **Engine and API:** the run fails `SCRIPT_START_FAILED` with the node, visit and dispatch recorded. Recovery offers plain Resume and Replay with no extra consent, which matches docs 04/05. Resume tries again and is refused again, and a stale Resume is rejected (409). Restarting the engine or the whole API on the same database never re-runs anything. Cancelling right after a refusal ends the run as cancelled, not failed. The API logs contain no `INTERNAL_ERROR`, no raw `EINVAL`, no stack traces and no provider activity.
- **The fix is what makes the difference:** I ran the same tests against a copy of the built runner with only the PR #375 catch removed. The `EINVAL` then escapes and the run is recorded as `SCRIPT_OUTCOME_UNCERTAIN`, which requires consent. So the correct result above comes from that catch.
- **Naming:** `PROCESS_START_FAILED` was never an engine or API error code. Script-node failures use `SCRIPT_START_FAILED`, and I did not reintroduce the old name.

**Three pre-existing issues for you to rule on. None of them blocks the already-fixed finding:**
- **O1 – old name still visible:** the runner's internal text `spawn failed: PROCESS_START_FAILED` shows up in heartbeat script-probe results (confirmed on this machine). Poll triggers forward the same text in their source; I did not run them.
- **O2 – unhelpful message for batch files:** for a batch file the refusal is permanent, yet the message and the user guide say to Resume, and Resume and Replay can only fail again. The fix that works is changing the command to `cmd.exe /d /c <file>`, but no doc says so; the field help just says "Program to run." A batch-file refusal and a missing executable also produce identical failures. This overlaps with #364.
- **O3 – test gaps:** the repo has no native `.bat` test and no API-level test for batch refusals.

**Not verified:** the MCP and web inspector surfaces (I make no UI claim), deadline and forced-stop ordering (source only), live SSE streaming, poll-trigger probes, coverage thresholds, other platforms, CI, review and the final audit.

**What closing #362 still needs:**
1. You record that `SCRIPT_START_FAILED` replaces the issue's `PROCESS_START_FAILED` wording.
2. You record a disposition for O1 and O2.
3. Opposite-family review.
4. A fresh independent Astra MAX final audit.
5. Current-target CI with the native Windows job passing at the closing commit.

This report does not close the issue.

**Process notes:**
- The first `pnpm exec` ran an install on its own; the lockfile stayed unchanged.
- One shell command failed to parse and ran nothing, so I re-ran it.
- One `tasklist` call needed rerunning.
- One fixture left a 60-second timer running, which inflated its wall time but not the results.

All four are logged in `raw/99-failed-commands-and-repairs.log`.

**Cleanup:**
- Both API processes (PIDs 18668 and 36472) shut down cleanly with exit code 0, and their ports were freed.
- All test data stayed inside the QA folder.
- The only thing I deleted was one copied executable.
- I touched no owner ports, store or credentials, and made no provider calls.

Everything is in `C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i4-362-independent-01` (I left `provider/` alone); open `REPORT.md` first:
- `REPORT.md`
- `observations.json`
- `manifest.json`: hashes of 101 files
- `fixtures/`: test scripts plus `PREDICTIONS.md`, written before each run
- `raw/`
- `work/`