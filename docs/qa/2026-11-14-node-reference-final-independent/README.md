# PR #474 final independent native evidence

This packet records the final independent Windows Edge run against source head `09167b3ec5d0bd553981ceaa8498ddb9be4c9458`, tree `dd32fe764a41caccc996b5c3328e8dd3661b0fa4`, parent `5a4fb439c63755eeb2b5bef945319772623a9905`, with actual main `a817e5ccb4fd598ca56089b97b4ce55e9cb6f58c`. The fixture used the compiled gateway and disposable file-backed SQLite.

## Build and source binding

- The forced build ran 12 tasks with zero cache hits (17.461 seconds).
- Before and after native execution, all 68 source hashes, 17 embedded modules, and 1,227 artifact paths across 13 trees matched binding `d575e3cc81ded1a8d3911d02e6faef01a8a5269470641017937d9e1ae02f44f9`.
- Both disposable fixtures closed; cleanup found no matching live processes/listeners or SQLite lock, WAL, or SHM residue. The SQLite file was verified during the run and is not included.
- The retained initial lookup-launcher `ENOENT` occurred because the external runs directory was missing before spawn. It is not a native behavior failure.

## Native findings

**A1 lookup and requiredness.** Both groups and all 26 HTTP operations passed on the first admitted fixture. Requests traversed the evaluated computed lookup key, repaired its nested reference, retained uncertainty about the outer computed identity, rejected the known missing counter with `422 LOOP_INVALID`, and preserved exact previously published versions and pins. Requiredness controls distinguished an inner explicit presence check from an outer wrapper whose key still must be evaluated.

**A2 activation and history.** All 8 variants and 41 checkpoints passed, with 29 conditional PUTs and zero page errors. Add, Remove, and Boolean activation after a valid self-reference rename each acted once on the same attached control, with a stable hit rectangle and repaired Source. The modal notice remained absent through click capture and became visible by the later window-bubble observation; a separate pane notice may already exist behind the modal. Steady controls, actual outside-up cancellation, duplicate-ID refusal with independent Add, and Tab/Space passed. Each pending action restored exact graphs and synchronized device records at four Undo/Redo boundaries.

The run does not newly establish native touch-driven `pointercancel` or held malformed JSON; component and earlier scoped evidence remain separately identified. The three inspected screenshots show pending Add, Remove, and Boolean states:

- [Pending Add](raw/runs/corrected-activation-final1/corrected-activation-pending-add.png)
- [Pending Remove](raw/runs/corrected-activation-final1/corrected-activation-pending-remove.png)
- [Pending Boolean](raw/runs/corrected-activation-final1/corrected-activation-pending-boolean.png)

## Evidence and disposition

- [Full native report](raw/final-native-report.md.txt)
- [Machine QA summary](raw/final-qa-summary.json)
- [Source/artifact binding before](raw/corrected-binding-before.json) and [after](raw/corrected-binding-after.json)
- [Build manifest](raw/final-manifest.json), [forced-build log](raw/forced-build.log), and [cleanup record](raw/final-cleanup.json)
- [Initial pre-spawn launcher failure](raw/final-lookup.log) and [first admitted lookup runtime](raw/final-lookup-native-first.log)
- [Root completion inspection](root-supplement/root-completion-inspection.md.txt)
- [Copied source retain manifest](source-retain-manifest.json), [copy manifest](copy-manifest.json), and [SHA-256 inventory](SHA256SUMS.txt)

Root's completion inspection accepts the source/native known-cause completion path under D-035/D-042. PR #474's three formal scans are consumed; this packet is not a fourth adversarial scan or fresh Astra sign-off. Exact publication-head/current-target CI and the final capped disposition remain pending, and owner acceptance remains open. The PR is still a draft at this evidence snapshot.
