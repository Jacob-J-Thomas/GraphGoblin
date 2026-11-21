The D203 QA for #364 passed on all five criteria with no product failure found. I used all three allowed instrumentation corrections, counting conservatively. Each product driver ran once and passed first time, and no assertion, timing window or fidelity check was weakened.

**Prerequisites:** the preparation receipt shows a clean checkout at `e8cf31d5` (tree `0927bbbf`, parent `580aded6`), an offline frozen install and one successful build. I rechecked its seal, then re-hashed all 1,750 source files and 1,271 build outputs plus the index, lock and install metadata. I did that before running anything (28/28 checks) and again afterwards (28/28). The checkout stayed clean and nothing was rebuilt.

| Criterion | Verdict | What I observed |
|---|---|---|
| 1. Public default turn | **PASS** (109/109) | The turn's start was genuinely refused by Windows (missing working directory, no process ID, `ENOENT`). I let the real file-metadata reads complete but held back their results. The fixed "could not be started (ENOENT)" failure came 1,002–1,010 ms after the refusal; a default engine run with no watchdog or deadline failed at 1,017.5 ms. It was marked definitely not submitted, with one turn attempt, no kill or retry, and no false timeout or cancellation. Timers and listeners were released. Releasing the held results later (a success, then a rejection) changed nothing and started no further lookups. |
| 2. Built runner with controlled seams | **PASS** (126/126) | Late metadata was rejected when the clock passed the deadline before the timer fired (simulated jump, and a real 1,150 ms event-loop block). An early-firing timer re-checked and settled at 1,437 ms. The budget starts at the refusal. Fast causes were kept. A 15 ms request deadline and an abort took priority, and an ordinary started process ran unbounded. |
| 3. Mapping, privacy, preservation | **PASS** (66/66) | Fast real refusals kept their specific messages: missing directory, a file used as the directory, missing executable. The earlier F1 output-loss and F2 help-only fixes held. A normal readiness check and normal turns (including one lasting 1.58 s) succeeded. No public output contained the canary, any path or raw native error text. |
| 4. Old-source control | **PASS** (15/15) | Built from the parent `process.ts` in scratch only, after a byte-for-byte check against the candidate's real build output. The old default turn was still pending at +1.5 s and +3 s, and settled only when I released the metadata, adopting the late cause. The old engine run was still `running` at +3 s. |
| 5. Integrity and cleanup | **PASS** | All 52 fixture processes closed and none survived. No listener belonged to them, and nothing was listening on 4747/4748/11434. Every held read was released, my scratch folders were removed, and retained file hashes are recorded. |

**Instrumentation corrections (originals, errors and results all kept):**
1. A pre-run probe of Node's module hooks, using dummy modules and no product code, was inconclusive and was refined. I count it to be safe.
2. The first attempt to build the old source failed its byte-for-byte check because the compile came out in the wrong module format.
3. The second attempt failed the same way. The third used the project's real build configuration and passed the unchanged check.

**Limits:**
- The public turn used the harness's default process runner. The only interception adds my local Node fixture script to the command line; there was no real Claude CLI, provider or account.
- The held reads were real reads whose results I deliberately delayed. I did not observe or induce a naturally stalled filesystem, and I don't claim the underlying read is cancelled.
- The F1 output loss and all criterion-2 cases used scripted child processes. Results come from this one Windows host.
- PLAN.md says it was written "~16:40 UTC". The file was actually created at 16:32:26Z, before the first command at 16:33:38Z; I noted this in the report instead of editing the plan.
- One recorded process ID was later reused by an unrelated `pwsh`.

This is not a renewed Astra approval, CI or native verification, whole-intent completion or owner acceptance. Final scan 3 stays negative. Archive publication, fresh CI/native checks and D035/D042 coordinator completion remain with root. Nothing was committed, staged or pushed.

Everything is in `G:\ggq\delivery-evidence\2026-11-17-five-intents\i4-364-deadline-independent-01`:
- `PLAN.md`
- `REPORT.md` (SHA-256 `cbb0a3841192ef5b064d095b8fbebdeb0a69e23c31d72760c322089bdc75b0d8`)
- `SEAL.json` (84 files, SHA-256 `44f7b4bb511b39e7f7b8c44195753b0cc84485c1cd52a505428c59ab118bfa53`)