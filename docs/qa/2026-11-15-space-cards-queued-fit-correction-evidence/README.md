# Space cards queued-fit correction evidence

This proposed QA packet preserves the first formal scan, its controlled queued-fit negative, the accepted bounded design, root dispositions and a pointer to the separately curated original-head CI packet. It records PR #482 publication head `daa43634c8a093f2cde8239a3501ae4b6b14c112` (tree `a3f55255f1309606e024171b9b3e4e943c004966`) against base `177f3a7d57768c88f19c6bb4d8ef2b272c1e91bd`. All copied source artifacts are mapped with byte counts and SHA-256 in [curation-manifest.json](curation-manifest.json); [SHA256SUMS](SHA256SUMS) covers every packet file except itself. [.gitattributes](.gitattributes) disables text normalization.

## Formal review and controlled negative

The full Sol scan 1 report is retained at [scan1/report.md.txt](scan1/report.md.txt), with its brief, source identity, verification/readback, root disposition and report-publication response beside it. This was formal scan **1 of 3**, returned **CHANGES REQUIRED**, and root accepted one queued-fit/Undo finding as **FIX-IN-PR**. It is not a final sign-off.

The controlled Edge/fileSQLite reproduction is preserved under [negative/](negative/): original plan, exact driver, result, first-failure screenshot, stdout/stderr/exit receipt, the pre-oracle observation, before/after checkout readbacks and terminal cleanup. The uninterrupted fit control completed; then trusted Undo restored the graph while xyflow's queued fit still ran, changing the viewport from zoom `1.66667` to `2` before the held callback. This is controlled real-dependency evidence, not owner acceptance or a broad native matrix. Source/index identity stayed unchanged; the exact first failure and cleanup records remain intact.

## Accepted design and limits

The full Claude Opus 5.5 xhigh design report and safe [launch](design/design-launch.json)/[exit](design/design-exit.json) receipts are preserved. Root's [design disposition](design/root-disposition.md.txt) accepts a bounded correction on existing behavior: use measured Canvas bounds with public `getViewportForBounds` and `setViewport`; keep definition identity, generation and revision checks in the synchronous mutation turn; retain a pending fit while public viewport or positive finite measurements are unavailable; cancel it when identity/revision goes stale; leave ordinary opening and manual Fit paths intact. The [implementation checkpoint](design/implementation-checkpoint.md.txt) is a historical status snapshot, superseded by the final handoff when available. The separate [implementation brief](design/implementation-brief.md.txt), spec and prepared native-plan/readback establish scope and future gates; the native plan is not execution evidence.

The implementation worker completed; its report, implementation evidence and root source freeze are preserved in the [implementation companion](../2026-11-15-space-cards-queued-fit-correction-implementation/README.md). The implementation checkpoint retained here is a historical preimplementation snapshot and is superseded by that report and later source freeze. This scan/design packet remains limited to scan 1, the original-head controlled negative, the accepted design, root dispositions and evidence pointers; it does not claim corrected native QA, corrected-head current CI, final audit, or owner acceptance.

## Original CI and earlier native evidence

The original publication-head CI is curated separately. [Original-CI reference](original-ci-reference.json) records its proposed repository destination and exact head/base/merge identity; the main run failed in web coverage with three Space cards assertions, while Browser, Windows, Template image and routing passed. It was not rerun and does not verify a later correction.

The earlier seven-group native positive remains historical. [Prior-native reference](prior-native-reference.json) records its full handoff and manifest hashes; it is separate evidence and does not supersede the later controlled queued-fit negative. No native correction run is included here.

## Source map and exclusions

- `scan1/` contains exact raw review/provenance copies; Markdown source reports are renamed to `.md.txt` without editing.
- `negative/` contains the first controlled failure, its positive control, screenshot, raw result/driver and cleanup/readback records.
- `design/` contains the accepted design, safe design launch/exit metadata, root disposition, historical checkpoint, scope brief and non-executed native plan.
- Original CI logs remain in the separate current-CI packet. The large generated full PR diff, reconstructible full source snapshots, model event/result streams, credential stores, profiles and caches are not copied.

This packet is evidence curation only. It was not copied into a repository checkout and changes no source, index, issue or GitHub state.
