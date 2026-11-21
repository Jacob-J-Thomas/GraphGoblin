**ACCEPT FIX** for F3 at head `b1cdd20463f6dbbd4e55cae0109395db724a778f` (parent `55c9a549`), limited to the three frozen files. I found no introduced blocking finding. This was a static review with Read/Glob/Grep only: I ran no commands or tests and recomputed no hashes.

## Source binding

- The three checkout files read identically to the root-freeze `git show b1cdd204:…` records (13–15) and to the post-image of `source.patch`, which matches `candidate.diff`.
- The worktree's branch ref file reads `b1cdd204…`.
- Tree `65443d7d…`, the clean status and the three SHA-256 values are as recorded in the freeze receipt and author bindings, not recomputed by me.
- The `before/` bytes carry the same recorded hashes and line numbers (11, 48, 51) as the final audit's `marker-race-source.json`.

## Assessment (static)

- **Atomic publication** (`schema-cli.mjs` 22–67): the record is written to a sibling named with PID and UUID, opened `wx`, closed, then renamed to the final path. Ownership starts only after the exclusive open, and a failure before the rename removes only that sibling.
- **Pause metadata** (45–56): uses the same write/close/rename, so the barrier does not reintroduce the race.
- **No parse before full publication** (`sdk-schema-case.mjs`): the observer parses three files, and each is complete when read.
  - The pause file is published by rename.
  - The sibling is closed before the pause file appears, and the child is blocked until release.
  - The final marker exists only after the rename.
- **Abort and settlement on failure** (53–91): every statement that can throw after the SDK work starts sits inside the `try`. The `finally` aborts and awaits the work, which cannot reject. In the installed patched SDK, abort kills the child and the turn settles after its stdout closes, then schema cleanup runs.
- **Original fault preserved** (85–86, 119–125, 130): the same error object is serialised into state and rethrown after settlement.
- **Barrier is deterministic** (57–67): the child cannot publish without the release, and the release is written only from inside the observer's wait loop. Ordering comes from the handshake; the 3000 ms deadlines only fail loudly.
- **Old assertions intact** (`sdk-schema.test.ts`): the six original cases keep every assertion and the 3000/6000/10000 ms limits, and gain settlement and child-absence checks. The empty-stderr check is replaced only for the two fault controls, by exit code 1 plus the original message in stderr.

## Candidates considered and refuted

1. **`observerWaiting: true` is a constant.** The proof is carried by the in-loop capture, the re-probed `finalMarkerExists: false`, `workSettled: false`, and the sibling record equalling the final record with the sibling gone afterwards.
2. **A second failure after settlement could pre-empt the rethrow.** The liveness probe, directory listing or state write could throw first. Abort and settlement are already complete by then, and the exit is still non-zero.
3. **Rename adds a Windows sharing-violation failure mode.** It would fail loudly (child exits 1, non-abort rejection, test fails), with the sibling removed and no partial marker. Rename is the mechanism D190 selected.
4. **The fault controls inject from inside the observer.** They fail at the real observation statement (line 78) with a real `ENOENT` and a real `SyntaxError`, and the retained stderr stacks point to 78:27 and 78:21.
5. **Abort mode no longer re-reads the record after settlement.** Passing paths are equivalent, and a record missing at the deadline still fails the test.

## Author-native records (read, not re-executed)

- **Focused suite:** `focused-02.log` shows 9/9.
- **Adapter coverage:** 678 passed, 4 skipped, 99.41% lines, 95.50% branches.
- **Typecheck, lint, format check:** each exited 0.
- **Publication-window and fault states:** the three retained state files match the test assertions.
- **Counterfactual, first attempt:** `replay-01.log` fails at harness line 160, after the zero-byte marker, exit 1, `SyntaxError` and no-state assertions had passed.
- **Counterfactual, old-only rerun:** exit 1 with the `SyntaxError` at line 48:25 and the child absent; the nine corrected cases were re-read from retained state, not rerun.
- **Process absence:** 13 PIDs listed, none matching.

These runs were on the uncommitted worktree at `55c9` and bind to `b1cdd204` only through the recorded hashes; the logs carry no in-log source hash.

## Not established here

Independent Opus behaviour QA, current-head CI, native artifact verification and coordinator completion remain required. No natural race or orphan is claimed. This is not a fourth general scan, a renewed Astra sign-off, a merge, an issue closure or owner acceptance, and the original scan 3 CHANGES_REQUIRED stands as recorded.