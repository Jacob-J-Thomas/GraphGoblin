# PR #478 automatic-edge double-click negative evidence

This packet preserves a single native Edge run that reproduced an unintended edge removal. It is negative evidence for the selection interaction, not a passing acceptance run or a product fix. Raw reports, scripts, configs, bindings, logs, and observations are byte-exact copies.

## Confirmed behavior

On the first and only fixture, one native click on an unselected automatic edge selected it without changing the graph. A native double-click at the same naturally hittable point selected the edge on the first click; after the Remove toolbar appeared under the pointer, the second ordinary click activated Remove and deleted the edge. Both trusted clicks reached document capture and were uncanceled; no D3 drag click blocker or separate `dblclick` event was observed. The runner stopped with exit 2 for the confirmed product failure. There were zero fixture-correction batches, zero page errors, and zero new formal review scans.

The run recorded five successful browser PUTs: one initial description edit to establish a synced baseline, ordinary Remove plus its Undo, and accidental Remove plus its Undo. The initial create request was fixture setup outside that PUT count. The actual accidental removal was one conditional PUT; API response, public readback, submitted definition, and IndexedDB agreed. One Undo restored the exact graph and baseline token. The full observed event sequence and graph readbacks are retained in [observed.json](raw/evidence/runs/first/selection-doubleclick/observed.json), with the [run record](raw/evidence/runs/first/selection-doubleclick/run.json) and [overview](raw/evidence/runs/first/overview.json).

This was Playwright native mouse input through compiled API and Edge, not a physical-device trial. The observations do not establish physical double-click classification or a human timing range. The separate direct-Remove follow-up was not driven because the observed underlay had no second actionable graph target.

## Source and runtime binding

The tested candidate was `e624a2f5b0eaeaf608d9dc66baaa38c9c81c07be`, tree `759f9e39ed042082d1a07bd4859f76188b1ca1da`, parent `ca9ac7bdea9adb0a05a5e515fb6d7bb229b1eab8`, with actual-main reference `41bde22c80a796bf8c4bec8ab5dec8e755271f9e`. The candidate was local and unpublished at capture; the report's original GitHub link to e624 may not resolve until publication. This identity is not current merged-main evidence. The report inventories 319 changed paths, all QA evidence or the delivery register. It compares the 1,680-entry source closure by path and hash: 1,679 entries remained byte-identical, and the sole differing delivery-register entry matched its respective Git blob. No product code, tests, or build inputs changed between ca9 and e624.

The report records static introducedness against actual main only; it did not run the main version in a browser. The native probe reused the compiled ca9 runtime on Node 22.23.4. The served bundle was `/app/assets/index-smG5osOh.js`, SHA-256 `b1f84d0868cfffe89e25191b289e008fda58a2e8d061ac7c08dce6eac97a4b64`. The prior binding was `d30f0225116d44e8e22c65aeeda5cb3a07dfa3e3589ab7480395ad256eac7874`; before and after binding both match SHA-256 `799e5881a9bbae1b417926ca12dc63d84b17e6a5b0fafa9c3cb7c1093ef329d6`. All 19 embedded modules and 1,227 artifact hashes across 13 trees matched. The [before binding](raw/evidence/binding-before.json) and [after binding](raw/evidence/runs/first/binding-after.json) preserve this record. No separate source-map archive is duplicated here.

The report classifies the behavior as introduced by #207: the candidate adds a selected-edge Remove toolbar that overlays the still-clickable automatic edge trunk. The actual-main reference is source comparison only; no main-native run is claimed.

## Root disposition and boundaries

Root accepted the full report as a confirmed FIX-IN-PR. This packet does not contain or claim a correction, corrected-head QA, formal sign-off, current-main verification, or owner acceptance. The native evidence is one bounded reproduction of the naturally hittable selection-to-toolbar sequence.

The full report is preserved as [selection-doubleclick-native-report.md.txt](raw/report.md.txt) with source SHA-256 `64dbcc54c90b714c44f9afc2d13fe3c34c572a3ca49ae5620c9b40baaafb8375`. It records the selected and unselected hit targets, exact event timings, PUTs, graph state, source identity, terminal cleanup, and limits. [The Playwright driver](raw/probe.playwright.js), [admission/orchestration script](raw/probe.mjs), Edge config, gateway records, console, page snapshot, and cleanup are retained alongside it.

The disposable SQLite file and `master.key` are excluded and were not read or hashed. Their source paths and byte sizes are listed in [omissions.json](omissions.json). Private worker streams and signatures were not read, copied, or hashed.

See [retained-files-manifest.json](retained-files-manifest.json), [link-checks.json](link-checks.json), and [SHA256SUMS.txt](SHA256SUMS.txt) for exact retained file hashes and link validation. `.gitattributes` disables text conversion under `raw/`.
