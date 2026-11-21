**ACCEPT FIX** — bounded corrective review of the D203 correction for #364 (F3). I found no introduced actionable defect in the five-file delta.

## Binding and scope

- **Candidate:** `G:/ggq/gg-i4-364-claude-start/GraphGoblin`. I read the worktree's `HEAD` and branch ref; `codex/gg-i4-364-claude-start` resolves to `e8cf31d51837a4fa362f909604b3070277db6c25`.
- **Taken from the root receipt, not verified by me:** tree `0927bbbf…`, parent `580aded6…`, the clean state, and every SHA-256.
- **Scope:** `process.ts`, `process-failure.test.ts`, `docs/06-harness-integration.md`, `ADR-0089` and the ADR index, as in `source.patch`. The patch has no `harness.ts` hunk, and the F1/F2 corrections are still present in that file.
- **Standing:** this is the D035/D042 capped correction path. The final scan 3 verdict stays negative at `580aded6`; I request no further general scan.

## Introduced actionable defects

None.

## What I checked in `process.ts`

| Ordering | Outcome | Where |
| --- | --- | --- |
| Stat pending past the budget, `timeoutMs: null`, no abort | Settles with the spawn code only; `timedOut` and `aborted` stay false | 247–255 |
| Metadata arrives after the deadline but before a delayed timer callback | Cause discarded, generic refusal returned | 84, 89, 258 |
| Timer fires early against the monotonic clock | Re-arms for the remainder, then settles | 251–252 |
| Abort or shorter request deadline during diagnosis | Settles at once through `kill()`; no cause, no timeout | 160–167, 184 |
| Late stat success or rejection after settlement | Ignored; no working-directory lookup starts | 76–78, 84, 257 |
| Child close after refusal | Still ignored; the timer now bounds the wait | 266 |
| Started child | Handler returns before any diagnostic timer exists | 241 |
| Any settlement | Clears request, kill and diagnostic timers; removes the abort listener | 135–138 |

- **Failure mapping:** the expired result reaches the unchanged harness as `definitely-not-submitted` (`harness.ts:525`) and the existing unknown-cause `HARNESS_TURN_FAILED` (`harness.ts:154–158`). Nothing maps it to a timeout or an abort.
- **No scope creep:** the constant is module-private, and I found no retry, extra launch, kill of the refused child, PATH resolution or configuration.
- **Timer re-arm:** it cannot spin, because Node clamps sub-millisecond delays to 1 ms. That is my knowledge of Node, not something I ran.

## Tests and documentation

- **Public-turn test (lines 516–626):** it drives real `runClaudeProcess` through `ClaudeHarness.start` with scripted children and asserts everything D203 requires:
  - version, help, auth, then exactly one turn with `timeoutMs: null`;
  - not terminal at 999 ms, terminal at 1,000 ms;
  - the exact failure and a single `definitely-not-submitted` event;
  - no kill, zero timers, listener removed;
  - byte-stable results after late success and late rejection, with exactly one `stat` call.
- **Listener assertion:** it is attributable to the runner, because the spied signal is the harness's internal controller, which the harness itself never unsubscribes from.
- **Edited abort/deadline case:** it is strengthened, not weakened. The 15 ms deadline is needed to stay distinguishable from the new 1,000 ms budget.
- **Docs:** `docs/06` and ADR-0089 match the code, including the statement that native `stat` is not cancelled.

## Non-blocking observations

- **Redundant guards:** lines 78/84 and 89/258 are pairwise redundant, so removing one alone would not fail a test. The three new uncovered branches (76, 78, 250) are defensive guards. The other three uncovered branches (82, 161, 168) are in lines the patch does not touch.
- **Old-source control:** it ran only the two public-turn cases (filter `-t "settles a default public turn"`); both fail at test line 590. From reading, I expect the old source to fail the process-level bound cases too, but that was not run.
- **Native cause assertions:** they now depend on a real `stat` returning within one second. If CI or native verification shows the generic message where a specific cause is expected, read it as budget expiry under load.
- **Thread-pool occupancy:** already issued stats still hold thread-pool threads until they finish natively. This is documented and accepted by D203.

## What I inspected and its limits

- **Read in full:** `AGENTS.md`, `docs/15`, `decision-203.md`, the final scan 3 report, `receipt.json`, `source.patch`, candidate `process.ts`, `process-failure.test.ts`, ADR-0089 and the author `REPORT.md`.
- **Read in part:** `harness.ts`, `killTree`, the `docs/06` section, the index entry, the old `process.ts`, and the fixture at `start-refusal.test.ts:319`.
- **Raw evidence read:**
  - old-source control log and receipts;
  - both focused runs: 304 pass / 2 fail, then 306/306 across 13 files;
  - the TEMP-spelling witness, which shows the two failures come from the fixture's `dirname`/`tmpdir()` comparison, independent of this delta;
  - coverage summary and lcov branch records: 100% lines, 95.27% branches, `process.ts` only;
  - format-check log, instrumentation history, frozen-source receipt, seal (65 manifest entries counted), status and process-release records;
  - typecheck and lint logs, which contain only the command line; their exit code 0 comes from the receipts.
- **Not done:** I executed nothing — no tests, builds, git commands or hash computation. Source-to-patch agreement is by reading, not byte comparison.
- **Not observed:** a naturally stalled filesystem, or native refusal behaviour.
- **Reviewer identity:** my session reports Fable 5.2 (`claude-fable-5-2`). I cannot attest the reasoning-effort setting from inside the session.

## Remaining gates

Separate actual Opus 5.5 criterion QA, current-head and current-target CI and native verification, and coordinator completion remain required. This review is not author evidence, behaviour QA, merge authorization or owner acceptance.