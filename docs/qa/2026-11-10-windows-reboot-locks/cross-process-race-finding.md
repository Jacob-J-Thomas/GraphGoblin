# Independent cross-process ownership finding — 2026-11-10

**P1 / merge blocker: multiple processes acquire the same data-directory lock after Windows PID reuse.**

Candidate: `84802cad`, built ownership module SHA-256 `007A07A167782D6504C5CB154009EF2F4BBE2EA9B2B2457B21B91F98C7ED3D53`. The relevant implementation is unchanged from `4cc66d26`.
Baseline: owner checkout at `ad5439133a4506f8d8634ae2a6730dd65533ffee`, built ownership module SHA-256 `0BCABF5C1C9A4AF3BBC3A348CE3EE46B8336F80DB2B7B0D71C10A119EC221732`.
Runtime: project Node `v22.23.4` on native Windows.

## Result

Five independent Node processes invoked the built API's `acquireDataDirLock` directly against the same disposable directory. Both `graphgoblin.lock` and `graphgoblin.lock.reclaim` initially named a real unrelated live process with a different valid OS creation identity. Every successful contender held its acquisition until all five contenders had reported; each reported successful holder was checked alive before releasing any acquisition.

| Trial                               | Simultaneous successful holders | Result                              |
| ----------------------------------- | ------------------------------: | ----------------------------------- |
| Candidate 1                         |                               4 | FAIL                                |
| Candidate 2                         |                               3 | FAIL                                |
| Candidate 3                         |                               4 | FAIL                                |
| Candidate 4                         |                               4 | FAIL                                |
| Baseline, identical reused-PID seed |                               0 | PASS: all five refused the live PID |

The unrelated fixture also remained alive throughout and exited on EOF afterward. No gateway, database connection, provider, owner store, owner port or shortcut was used.

## Root cause and introducedness

In `apps/api/src/data-dir-lock.ts:65`, the newly awaited Windows identity query leaves a substantial interval between reading a stale record and returning `stale`. `removeStale` then unconditionally unlinks the path at line 74. The reclamation guard is itself acquired through this same `acquireFile` / `removeStale` sequence (lines 92–99); it has no independent interprocess serialization.

Several contenders can all read the old guard, await the identity query, and then unlink replacement guards created by earlier successful contenders. Multiple contenders consequently enter main-lock reclamation, which has the same read/probe/unlink race. They each return a valid-looking acquisition while the pathname holds only the last writer's record. Token-checked release cannot undo that already-broken exclusivity.

The read/unlink weakness existed structurally before this patch, but the new live-PID reclamation path both admits a formerly refused scenario and adds an asynchronous OS query to its race interval. The exact scenario fails in all four candidate trials and is safely refused by the baseline. This is an introduced/worsened reachable violation of the one-writer invariant and belongs in this PR.

The earlier six-contender QA was in one process and therefore serialized by `acquiringPaths`. The native launch suite's Windows mutex likewise masks this direct-process path. Neither establishes safe multi-process guarded reclamation.

Required outcome: direct independent API writers must preserve at-most-one ownership while reclaiming stale main and guard files, including after PID reuse. A content re-read alone still leaves a non-atomic check/unlink interval; verification should exercise independent processes with successful acquisitions held concurrently.

## Reproduction and evidence

- `cross-process-race.mjs`: bounded four-candidate / one-baseline reproduction, five contenders per trial.
- `cross-process-race-results.json`: full participant PIDs, returned records, final record, and simultaneous-owner counts.
- `cross-process-race-output.txt` (original log bytes retained): raw JSON trial output.
- Retained disposable fixture directory: `cross-process-race-CN7Or2` beside this report.

The reproduction exited with code 2 to mark the failed invariant. All its disposable participant processes were released through stdin EOF and exited; no forced process termination was used.
