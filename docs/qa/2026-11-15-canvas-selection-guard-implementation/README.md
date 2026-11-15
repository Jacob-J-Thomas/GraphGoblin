# Canvas selection-to-Remove guard implementation evidence

This packet records the bounded correction for a later click activating the Remove toolbar button after the first click selected a connection. It is implementation and focused-test evidence, not native acceptance or a formal review.

## Source and integration identity

The worker changed eight files from parent HEAD fdd9132763e7be881bbd7863f8ebbeb601a20233 (tree a256f4ac78d026113b79c2093d9c299d13eb18f1). Root froze the eight exact source hashes in ae69908ca313c26390afc1a8459d2a6d33a42015 (tree 1656d28c29171b7ecb1ec31cd432f23acf68469e), then integrated them into candidate dbc55454b224e350f7005cdaf58b8655c4b9e71e (tree a52fb7570c279ceb74f0ffa9c1a0453313c39e21), following the Reset hold integration at 124c8bdbccdc427fa6121085ef113afd221050fe. The worker's focused runs were performed on its candidate before those freezes; root verified byte identity, but this packet does not claim a rerun on the integrated head.

The production change is local to Remove's click handler: stop propagation first, ignore browser click counts above one and return focus to the connection; count zero and one continue through existing settling, protection, identity, and removal behavior. It adds no state, timer, global listener, event replay, or Canvas/RouteEditing contract. The Reset hold remains unchanged.

## Focused results

- Final worker focused suite: 125 passed across four files. No-emit typecheck, changed-file ESLint, Prettier, and diff check passed. The E2E regression was typechecked, linted, and formatted but not run.
- Old-production control: 8 failed and 111 passed across 119 tests. The failures are the new count-above-one assertions. The absent-guard case is the same handler as HEAD, so it was not redundantly run as a separate mutation.
- Three mutations were detected: changing the guard to reject counts >= 1 (therefore refusing a normal count-one click) produced 17 failures; changing it to reject counts other than 1 (therefore refusing count zero) produced 15; moving stopPropagation after the guard produced 4. Control scripts restore the candidate from the included backup and log the restored SHA.

The first contract fixture failed because it sampled the viewport before xyflow's initial fit-view had completed. A diagnostic run showed the change occurred after the first press, before any later click; the fixture now records its reference after fit settles. The first Prettier check also failed on two E2E lines, then passed after formatting. Both first failures and their repair artifacts are retained.

## Limits and review boundary

These tests set browser click counts explicitly in component/store tests and dispatch a browser-order contract sequence through installed xyflow/D3. They do not prove native hit-testing or how Edge, Windows, touch, pen, or an OS-injected mouse numbers clicks. The E2E test was not executed. No build, full coverage, provider, physical-device, native/browser QA, or owner service/store was used. Root's source records say one of three formal review scans has been used. Native QA is recorded separately; this packet has no native result or sign-off. Owner acceptance and whole-candidate readiness remain separate.

The root disposition and implementation brief are included as scope provenance; neither turns the worker handoff into a review. The accepted Opus design report is preserved byte-for-byte (SHA-256 `f42c0d4ef3e3c85715dc22c606bf6bbef619c208492d8ce3515143b5000ec806`). The [worker handoff](worker/handoff.md.txt) records all test and control limits, including that separate count-one clicks still remove and that no four-click, touch-classification, or physical-device guarantee is claimed.

## Evidence files

See the [complete evidence index](evidence-index.md), [root disposition](provenance/root-disposition.md.txt), [implementation brief](provenance/implementation-brief.md.txt), [Opus design report](provenance/opus-design-report.md.txt), [root source freeze](root/selection-guard-source-freeze.json), [root integration receipt](root/selection-guard-integration.json), [final patch](source/final.diff), and [final source manifest](source/final-manifest.json). The [copy manifest](copy-manifest.json) maps every raw copy to its original path. [SHA256SUMS.txt](SHA256SUMS.txt) covers every packet file except itself.
