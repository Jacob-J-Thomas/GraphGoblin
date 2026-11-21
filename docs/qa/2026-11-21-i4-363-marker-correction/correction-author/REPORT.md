# #363 F3 fixture correction author handoff

Implemented at unchanged parent HEAD `55c9a5497f9e4a6e7f9ebeaa29283e3898170683`, base `a84f988b89e456b0e2270e3c4750afb250b6c68f`, in `G:/ggq/gg-i4-363-structured/GraphGoblin`. Only the three assigned existing files changed. The index is untouched; no commit, publication, provider call or other agent was used. D190 scopes this correction. The original final scan3 remains CHANGES_REQUIRED, SHA-256 `01a66800a4a9efdbeb9d7e479d9fc49aeac2c5875de05d0015203c3bd30a45ae`.

The harmless CLI now opens a uniquely named owned sibling exclusively, writes the complete JSON, closes the descriptor, and renames it to the final marker. Ownership begins only after successful exclusive open. The controlled pause metadata also uses write/close/rename. A barrier pauses the native child before final rename. The real-SDK host sees the final marker absent, the closed sibling's valid full record, and unsettled SDK work from within its waiting observer; releasing publication permits valid final observation, abort and settlement.

The observer catches read/parse/observation failures, aborts its owned SDK work in `finally`, and awaits its settlement before serializing the failure and rethrowing the original error. Independent read (actual ENOENT after removing the marker) and parse (actual malformed marker JSON) controls preserve child identity before injection. Tests assert driver exit 1 and original fault in stderr, public AbortError, settled work, native PID absence, removed SDK schema directory and untouched sentinels. The original six short/226-character success/error/abort cases and their schema, exact 243/255 lengths, environment, sentinel and cleanup assertions remain. The original 3000ms observation deadline, 6000ms subprocess timeout and 10000ms case timeouts are unchanged; no threshold or exclusion changed.

## Exact candidate sources

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `packages/adapter-codex/src/fixtures/schema-cli.mjs` | 3006 | `80a342d89d5601e3b9c6ab1acaa2874fac48ea63d0028cc77c56da54b7cedf03` |
| `packages/adapter-codex/src/fixtures/sdk-schema-case.mjs` | 4669 | `8bddd500a108d3275472c6dbaaad6d3dccbb1120ede9752556017cf1e46ef7b2` |
| `packages/adapter-codex/src/sdk-schema.test.ts` | 7949 | `2050e1298e84323fd026c8af5d953697562894ba5de3f0db8863d6caa629058a` |

Raw original/candidate bytes are in `before/`, `candidate-01/`, and `after/`, with source bindings. `candidate.diff` and `final-worktree-binding.json` record the final unstaged state. The installed SDK remains SHA-256 `ec7471535be310cabbb8f256faa80a1101e46b84b41d42cae40a3e36a9a5feb7`.

## Verification and retained attempts

All execution used project Node v22.23.4 and process-local TEMP/TMP/TMPDIR at `G:/ggq/qa-scratch/i4-363-marker`. Only isolated test child environments receive synthetic HOME/CODEX_HOME values; no global or owner's home was modified. `run-command.ps1` records exact pnpm.cmd invocations and complete output.

| Final check | Result | Evidence |
| --- | --- | --- |
| Focused real installed SDK suite | 9/9 passed, including unchanged original six | `focused-02.log` |
| Adapter package coverage | 678 passed, four unchanged live skips; 99.41% lines, 95.50% branches, 98.26% statements, 99.31% functions | `coverage-01.log`, `coverage-summary.json` |
| Adapter typecheck | Passed | `typecheck-02.log` |
| Adapter lint | Passed | `lint-02.log` |
| Changed-file formatting | Passed | `formatcheck-01.log` |
| Diff whitespace / index | Passed / untouched | `final-worktree-binding.json` |
| Retained native replay | Nine corrected cases passed once; each retains raw state/stdout/stderr | `*-state.json`, `replay-attempt-01.mjs`, `replay-results.json` |
| Original-fixture controlled counterfactual | Expected parse failure, exit 1; zero-byte final marker; helper already absent after host exit | `replay-02-old-only.log`, `old-controlled-stderr.log`, `replay-results.json` |

Candidate 01 first passed 9/9, typecheck and lint. Source inspection then identified the test-only pause JSON metadata also needed atomic publication; that small correction is candidate 02, with fresh checks above. Both candidates and all logs remain.

The first external replay completed all nine corrected scenarios and then failed its author's overstrong old-counterfactual assertion that the child must remain alive after the original host parse failure. It was already absent. `replay-01.log`, `replay-attempt-01.mjs` and `replay-01-disposition-and-revised-prediction.txt` preserve the failure and revised expectation. No maintained test failed or was weakened. At coordinator direction only the bounded old counterfactual was rerun; the nine passing cases were read from their retained state without new SDK execution. The corrected counterfactual retains its original stderr and reports actual child absence, rather than requiring an orphan.

The counterfactual adapts only the old driver's import resolution to the actual installed SDK and the old CLI writer's scheduling: native open of the final marker with `w`, pause before native write, then the original write/close. Its original unguarded observer bytes remain intact, and stderr points to its line 48 JSON.parse. That throw precedes the original line 51 abort in source. The controlled marker was empty and the host exited 1 without reaching the state write. Both old counterfactual attempts observed the helper already absent after host exit. This establishes the vulnerable ordering and the bypassed explicit abort under controlled scheduling; it does not demonstrate a natural OS race or an orphan. The original final audit's source finding and successful historical product/CI evidence retain their original classifications.

Read-only final CIM inspection found none of 13 retained replay/witness PIDs and no node/codex command lines matching the task scratch or maintained SDK fixture roots (`process-absence.json`). Maintained tests also assert child absence. The outer counterfactual harness uses PID-scoped ownership cleanup only; no global process kill was used. Test roots and selected artifacts remain on G: for review, without live work.

Earlier read-only lookup errors are retained in `initial-inspection-attempts.md`; they did not mutate the checkout. The first counterfactual aggregate failure is retained, not relabeled as a pass. `predictions.md` predates source edits. This packet establishes author implementation and bounded verification only. Independent actual Fable correction review, separate actual Opus behavior QA, combined gates, exact-head/current-target CI, native artifact verification and coordinator completion remain with the root. No fourth general scan was run.
