# #419 history-disconnect candidate evidence

This packet archives the accepted independent native candidate run for #419. It used candidate commit `7b7932f89b038a4635183b6adbc5fefa6df4fa6f`, tree `e6d5811824f170e36d5a90038486a5531feca255`, based on integrated main `98692c8a8c7b519e8c83e585e026d595cedc0550`.

## Candidate result

The native run exercised compiled production API routes composed through instrumented Fastify over actual TCP, with real SQLite, the manager, and API-key handling. Controlled promise gates and synthetic history supplied the ordered close/read evidence after SQLite operations had returned but while wrapped promises still held the route. This is not ordinary gateway-startup or browser evidence.

- All **8 actual disconnect cases** stopped starting repository work after the unfinished response closed. Already in-flight work settled on release. No later write, send, Fastify error, response finish, or new repository entry occurred. The abandoned page-two rejection did not trigger the baseline’s post-close generic 500/error path.
- All **11 connected positive controls** matched the accepted baseline’s HTTP status, content type, and response body bytes. All **10 negative controls** retained their expected status and problem code; seeded history digests and listener cleanup were also checked.
- The native runner exited 0 without deadline expiry. Both output streams closed empty. The independent readback found the runner, supervisor and exclusive-open helper absent, no TCP row for the owned port, and an empty owned store.
- The independent report’s root acceptance confirms **44 immutable external references** and retains **33 absolute frozen snapshot references** as historical observations. Those old absolute paths are not compared with the later mutable publication checkout.

The [raw independent report](independent-report/report.md.txt) is 8,265 bytes, SHA-256 `8e95c2cb458fcf2545ddd7f9d16863f0df6eb192ab9047e816ccc2d346b3d088`. Its original eight-payload seal is preserved in [SHA256SUMS.txt](independent-report/SHA256SUMS.txt), SHA-256 `96919fc03fd0af45866a69f9ffc9b1f15b335ec864e34f7a896d1220187855f7`.

## Included records

- `build/` contains candidate build launch/exit/receipt/log files and the full 4.33 MB build binding exactly once. The build admission is in `provenance/`.
- `native/` contains the candidate run summary and runner output, actual launch/preflight, child exit/close, supervisor result and empty stdout/stderr.
- `independent-report/` is a separate sibling directory with the raw full report, its seven other payloads, and the original eight-row seal.
- `provenance/` contains both root admissions, report acceptance/verifier, and the sealed readback preparation: verifier, process helper, raw README, and original three-row checksum seal.
- The common harness, execution-preparation bundle, shared #410 helpers and baseline evidence are in the sibling [baseline packet](../2026-11-15-history-disconnect-baseline/README.md). The accepted source and local implementation results are in the [implementation packet](../2026-11-15-history-disconnect-implementation/README.md); they are not duplicated here.

The source report’s original `README.md` is preserved byte-for-byte as `.md.txt`; its eight-row source manifest is preserved unchanged with original filenames. The [source-copy map](source-copy-map.json) records source paths, sizes and hashes; the [packet checksum manifest](SHA256SUMS.txt) covers all packet files other than itself.

No database or private store is included. The candidate report and acceptance say full current-head CI and both formal reviews remained required at that checkpoint. This packet does not claim those later gates passed.
