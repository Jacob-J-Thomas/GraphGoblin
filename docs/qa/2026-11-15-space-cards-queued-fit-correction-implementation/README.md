# Space cards queued-fit correction: implementation evidence

This packet preserves the implementation worker evidence and the subsequent source freeze for the queued-fit correction. It is implementation evidence, not a product-readiness sign-off.

## Source identity

The worker started on candidate daa43634c8a093f2cde8239a3501ae4b6b14c112, based on actual main 177f3a7d57768c88f19c6bb4d8ef2b272c1e91bd. Root later froze the accepted source at b043d3b8baafdff742803ae46750c8664067f3c7, tree c87fed2f00990e7ccb3728ab1935e3d75241f736, with the candidate as its sole parent; main is the base ancestor. The [root source-freeze receipt](root-records/root-source-freeze.json) is authoritative.

The four worker-owned Canvas source/test files in that receipt match the worker’s final hashes. Root added the guide, CHANGELOG and store.ts comment updates and extended the frontend guide history; those documentation/comment additions are represented in the freeze. The original source snapshot and index receipts remain in [worker/original](worker/original/) and the worker logs; the later committed source identity is recorded separately.

The [accepted scan/design/negative-evidence packet](../2026-11-15-space-cards-queued-fit-correction-evidence/README.md) documents the preceding finding, controlled probe, and accepted design.

## Results and limits

The final focused affected set passed **409 tests across 21 files**. The final scoped typecheck, ESLint and Prettier checks passed. The packet retains all three mutation rounds and stability logs: nine of ten final mutations were detected; M8 (plain size lookup instead of Object.hasOwn) survived because the positive-size check already rejects the prototype value. The production fix binds one setViewport to the captured draft, generation and revision, waits reactively for positive finite card/pane measurements and initialized viewport, and drops stale work in the same effect turn.

The first mocked run had 41 passes and one faulty test oracle; that oracle was corrected, with no fixture acceptance relaxed. The first scoped ESLint run failed because a mock called a hook conditionally; it was restructured without relaxing a rule. Both failures and their follow-up logs are retained.

Against exact old production, the new real-dependency file ran once and reported 6 failures and 2 passes. The Undo viewport oracle failed and the unmount case found one queued fit callback. Four hidden-pane cases stopped at a fixture premise because the visibility stub hid the wrong xyflow element; the fixture was corrected, but old production was not rerun. Those four cases are not evidence against the old implementation. See [the retained negative run](worker/negative-old-production/).

This is controlled jsdom/component evidence. It does not establish a native browser result or painted browser frames. Full build, full coverage, full-repository lint, corrected-head current CI and final independent audit are not established by this packet. Root’s accepted native plan uses the actual transform and synchronous source/dependency chain; the worker report’s historical suggestion to assert absence of the removed queued callback is not the governing oracle.

## Report provenance

The exact **4,832-byte runner summary** is preserved as [runner-final-summary.md.txt](worker/runner-final-summary.md.txt), SHA-256 2abe0a33733fed4a8cebce13b3cc0d76c8c52fcd7d76a407f0fce329b86840c6.

The worker-authored detailed report was 16,100 bytes and was overwritten by the runner summary. Its recorded report-specific Write and Edit payloads were reconstructed as [detailed-report-recovered.md.txt](worker/detailed-report-recovered.md.txt), SHA-256 0c0323516bbfface297dc6e29d764972c56502475807a31ec435dfd960045872. The original on-disk detailed-report digest was not independently retained, so byte identity to that earlier file cannot be certified. The [recovery provenance](worker/detailed-report-recovery-provenance.json) records the selected event UUIDs and exact edit hashes; no raw event stream was copied.

The [root source readback](root-records/root-sonnet-source-readback.json) and source-freeze receipt contain an earlier reportSha256 value that was recorded after overwrite and belongs to the short runner summary. The later [root erratum](root-records/checkpoint-space-482-correction-built.md.txt) makes this distinction explicit.

## Contents and integrity

- [Worker logs, source snapshots, diffs, negative run, mutation rounds and stability runs](worker/)
- [Root dispositions, build checkpoint and freeze/readback records](root-records/)
- [Source-to-copy map and exclusions](source-copy-map.json)
- [SHA-256 manifest](SHA256SUMS)

Raw Markdown is retained as .md.txt; authored Markdown is this README. .gitattributes disables text conversion. The manifest marks raw byte copies separately from the reconstructed report and derived curation records. No browser profiles, stores, credentials, caches, provider streams, or raw event/result files are included.
