# Reset route hold implementation evidence

This packet records the bounded Reset-toolbar hold implementation and its focused evidence. It does not establish completion of the broader Canvas review or native acceptance.

## Source and integration identity

The worker handoff describes eight unstaged files tested against parent HEAD 47b00a520a4b8787786102cac69d84f145f2ed1c. Root froze those exact eight source hashes in commit fdd9132763e7be881bbd7863f8ebbeb601a20233 (tree a256f4ac78d026113b79c2093d9c299d13eb18f1). A later root integration receipt records the same eight blobs byte-identical in candidate 124c8bdbccdc427fa6121085ef113afd221050fe (tree 025809982f57eee2e32f847e7318657fc78de3a6). The worker focused runs were performed before those freezes; this packet does not claim the runs were repeated on the integrated head.

The implementation is limited to Reset route in OrthogonalEdge RouteHandles: it holds the toolbar anchor and the Reset hit target through automatic-route settling, preserves the crossing-note slot, and stops Reset propagation before the edge wrapper can change selection. It adds no timer or global guard. This Reset change did not implement selection-then-Remove; that blocker is tracked separately.

## Focused evidence

- Final worker focused run: 115 passed across four files. No-emit typecheck, changed-file ESLint, Prettier, and diff checks passed on the worker's final bytes.
- Old-production control: 20 failed and 89 passed across the 109-test focused set; the failures were the new Reset-hold assertions. The earlier checkpoint control was 10 failed and 20 passed on the 30-test OrthogonalEdge subset. These are distinct runs and counts.
- Five single-change mutations were detected: 18, 19, 7, 4, and 1 failures respectively. The identity-only mutation demonstrates why the same-array Undo case is retained.
- The first candidate Prettier check failed on two line wraps and is preserved with the later passing checks. The original quota-interrupted attempt's old-production log is also retained. Its duplicate checkpoint copy has the same SHA-256 and is represented once.

The handoff records a controlled source swap using the included control scripts, candidate backup, and per-run logs. Each control restored OrthogonalEdge.tsx to the final candidate hash. The real-store Undo probe is included as a small raw observation file; it records new route and points objects after Undo for both tested connections. The tests also pin the same-array Undo case.

## Limits and gates

This is component and focused-test evidence. The E2E expectation was typechecked and formatted but not executed. No build, full coverage, native/browser run, provider, or owner store was used. The root source-freeze record says one of three formal review scans has been used; no formal scan or native acceptance is supplied by this packet. The source freeze and integration receipt both leave native and whole-PR gates pending. This does not prove real browser hit-testing or whole-candidate readiness.

## Evidence files

See the [complete evidence index](evidence-index.md), [worker handoff](worker/handoff.md.txt), [root source freeze](root/reset-hold-source-freeze.json), [root integration receipt](root/reset-hold-integration.json), [final patch](source/final.diff), and [final source manifest](source/final-manifest.json). The [copy manifest](copy-manifest.json) maps every raw copy to its source path and records the deduplicated original control log. [SHA256SUMS.txt](SHA256SUMS.txt) covers every packet file except itself.
