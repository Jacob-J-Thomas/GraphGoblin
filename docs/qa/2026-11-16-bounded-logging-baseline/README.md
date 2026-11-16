# #438 baseline: unbounded gateway log reproduction

This packet preserves the independent native baseline run for the old logging behavior. It is a baseline defect reproduction, not candidate acceptance or a product pass.

## Result

Claude Opus 5.5 xhigh ran admitted baseline-attempt-3 once against the frozen pre-candidate checkout. All 31 behavior observations completed. Under 6,400 requests, gateway.log reached 8,660,042 bytes, above the 8 MiB bound, with zero rotations; held work still succeeded. Warm launch, wrong-store refusal, occupied-port refusal, restart and ordinary-shell controls also completed. The [full report](reports/full-report.md.txt) and [detailed tables](reports/detail-tables.md.txt) distinguish native observations, harness assertions, independent read-only checks and controlled evidence.

The driver itself exited 1 because its cleanup assertion refused the known Content.IE5 junction. Preserve that original incomplete result. A separate root-admitted, nonrecursive continuation then exited 0 and reached attested-retained: it unlinked only the exact junction, left its target and the disposable tree intact, and verified the raw evidence and target were unchanged. The [root cleanup receipt](provenance/root-cleanup.json), [continuation trace](cleanup/continuation-receipt.jsonl) and [root acceptance](provenance/root-acceptance.json) keep those outcomes separate.

## Scope and limits

This packet does not establish candidate behavior, a full-suite pass, or owner acceptance. Earlier setup stops remain historical context: the first setup had a missing PowerShell 7 path, a source binding rejected hardlinked cmd/git inputs, and V2 stopped on 616 bytes of PowerShell 5.1 progress CLIXML. This archive contains V3 attempt 3 and does not replace those records.

The V3 harness source and original checksum file are included under [harness/v3](harness/v3/README.md.txt). The 4,529,023-byte full source/build binding is retained externally at launcher-438-baseline-binding-02.json (SHA-256 85a77468ebe1bacfed414081261287809febf793785e9d28e2223939ff9820de); it is not duplicated here. The source report’s [evidence inventory](reports/evidence-inventory.json) records external evidence paths and hashes, with two disposable master.key digests intentionally omitted.

The packet excludes provider event/result/stderr streams, the provider final-message file, disposable databases and keys, the retained fixture tree, and raw gateway/store logs. log-readback.json is the preserved parsed readback; this packet does not contain the raw multi-megabyte gateway log. The cleanup receipt lists file identities and sizes only; no store bytes are copied.

The exact copied-file origins and byte hashes are in [source-copy-map.json](source-copy-map.json). The report’s original checksum manifest is preserved as reports/original-SHA256SUMS.txt; Markdown source files renamed to .md.txt are mapped there. The packet checksum manifest covers this README and all copied files.
