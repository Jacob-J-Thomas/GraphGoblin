# Issue #207 corrected-stack independent native evidence

This packet preserves independent Windows Edge evidence for the corrected #207 stack at head `bc9094fd426fe1c1a4b81b0e490e3887f977dbc7`, tree `c8841e39d83bf292553d840de4bf3cadc6097824`, parent `64a955887962f72287e532824be1b8cb32c5f055`, stack base `35bb3fbdc724a82064d0d9e65b551608542c6b22`, and actual main `a817e5ccb4fd598ca56089b97b4ce55e9cb6f58c`. The source packet's 92 evidence files are copied byte-for-byte. It contains no model streams, database files, credentials, or browser profiles.

## Bound source and build

The forced Node 22.23.4 build ran **12/12 tasks with zero cache hits** in 17.814 seconds. The native run bound 85 source paths, 18 embedded modules, and all 1,227 artifact paths across 13 trees. Before/after binding SHA-256 was `f44fa2c8377b3d6b29debb5441db5dfc3e94857b20431e946ca18e8ccc41cdae`. Native fixtures served the exact bound assets through the compiled API with disposable file SQLite.

## Native and repository outcomes

Ten native fixture runs recorded 50 attempted writes and zero page errors. Eight runs succeeded and recorded 36 accepted browser PUTs. The initial pan fixture clipped the toolbar target; a corrected fixture checked readiness before using ordinary zoom to expose it. The first Shift modifier fixture expected a node move that did not occur; the retained modifier run uses Control, the installed Windows multi-selection modifier. A first artifact-mapping read also failed before fixture execution because a reduced historical binding lacked a field; the full UI mapping resolved that evidence issue.

On the corrected pan path, the actual pane click remained suppressed while the gate was unavailable and D3's blocker was present. The first tested click after readiness reached Remove, removed only the intended edge once, and Undo restored the graph. Blank route ownership/recovery, repeat pan with wheel/Fit, keyboard, Reset, coarse input, and protected Chat cases are documented in the report. The coarse target measured 146.58 × 44 CSS pixels.

Two exact repository Playwright cases also passed **2/2 on the first run** in 25.6 seconds, with one worker and no retries. They used isolated ephemeral loopback ports, source API with provider fakes and in-memory SQLite, and an externally copied 28-file web distribution; the served files were restored. These repository tests are separate from the native API/IndexedDB fixtures.

## Post-node-drag click overlap remains inconclusive

An ordinary node drag moved the node and deselected the selected edge, leaving no Remove target. Shift did not move the node and therefore did not test selected-edge reachability. With Control, the real modifier drag preserved the selected edge; its enabled Remove control stayed hittable. Two follow-up clicks worked after D3's click blocker cleared. In the bounded immediate trace, D3's generated click saw the blocker at +4.5 ms; it was absent by the next pointerdown at +8.2 ms, and the follow-up click worked at +12.1 ms.

This does **not** establish whether a reachable follow-up click can overlap the active blocker. The overlap question remains inconclusive for the formal reviewer. This evidence neither waives the D3 node-drag caveat nor claims a general post-drag fix. Physical touch hardware and screen-reader behavior were outside this run.

## First outcomes and cleanup qualification

The packet retains the first clipped-target pan and modifier-fixture failures, the pre-fixture mapping-reader error, and the initial cleanup observation of an unrelated `conhost.exe` with a reused historical PID. No process was terminated. Final cleanup matched no fixture PID, listener, or SQLite lock/WAL/SHM residue. See the first and terminal [cleanup records](raw/corrected-cleanup.json) and [final cleanup](raw/corrected-cleanup-final.json).

## Evidence and status

- [Full native report](raw/corrected-stacked-native-report.md.txt) and [machine summary](raw/corrected-native-summary.json)
- [Source admission](raw/exact-source-admission.json), [before binding](raw/corrected-binding-before.json) and [after binding](raw/corrected-binding-after.json), and [artifact delta](raw/corrected-build-artifact-delta.json)
- [Pan event projection](raw/pan-event-projection.json), [coarse screenshot](raw/runs/corrected-coarse-first/207-after-coarse-remove.png), and [immediate Control trace](raw/runs/corrected-node-drag-immediate-control/observed.json)
- [Repository test output](raw/repository-two-e2e-first/stdio.log) and [execution metadata](raw/repository-two-e2e-first/execution.json)
- [Original prepared README](raw/prepared-readme.md.txt), [source retain manifest](source-retain-manifest.json), [copy manifest](copy-manifest.json), [link audit](link-check.json), and [SHA-256 inventory](SHA256SUMS.txt)

This evidence is scoped to the corrected stack. Final-main integration, current-target CI/coverage, formal reviews, final Astra disposition, and owner acceptance remain separate gates; this packet consumes no formal review scan.
