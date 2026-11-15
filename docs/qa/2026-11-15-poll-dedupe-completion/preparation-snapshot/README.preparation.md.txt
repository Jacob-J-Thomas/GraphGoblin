# PR 484 completion evidence — PREPARATION

**State: PREPARATION, not sealed.** This packet contains scan 1 evidence and root admission/readbacks. Root has admitted Astra scan 2, which is still pending a terminal report, and has not supplied final merge evidence for this packet. Do not treat this preparation as final audit, merge, delivery, or owner acceptance.

## Claude formal scan 1

Root admitted scan 1 as `claude-opus-5-5` at `xhigh` against PR #484 head `08651317c485062eb90367e1df3f7632f8e1a6c7`, tree `c5d6d7f505e52b5ccf07b4bcb791777761dc45df`, and target `15ce9a1dd12e87b7f7cb5f853aaecf68d6188afd`. The launch, exit, and actual model readback show the requested model ran, exited 0, and returned a successful terminal result. It is formal scan 1 of the three-scan cap.

The complete detailed report is [full-report.md.txt](claude-scan1/full-report.md.txt), preserved byte-for-byte from the original report (28,512 bytes, SHA-256 `8804954db1e294f68493fe0a16f40e7a9ac7f9f73afbebd5b7e8535c9ca53b55`). Claude's verdict is READY, with no numbered findings and three non-blocking observations. The distinct terminal summary is [provider-final-message.md.txt](claude-scan1/provider-final-message.md.txt); it is also byte-identical to the saved final message. The [actual model and exit readback](claude-scan1/actual-model-exit-readback.json) records source hashes without copying the raw provider result envelope.

Root published the full scan 1 report comment at [PR #484](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/484#issuecomment-6895278204). The external copy is retained here for a self-contained evidence packet.

## Bounded probe evidence

[scan1-probe](claude-scan1/scan1-probe/) contains all 11 bounded scan 1 probe files, copied byte-for-byte. This preserves the probe scripts, outputs, and the first focused-test run. The full report explains their purpose and limits.

The private `events.jsonl` stream is excluded. The raw `result.json` provider envelope is not copied; only the actual model and terminal fields needed for provenance are recorded in the readback. The duplicate `latest.md` is omitted because its bytes match the distinct terminal-message file.

## Root provenance

[Root readbacks](root-readbacks/) include the scan 1 admission, current CI run and curation readbacks, plus the Astra scan 2 admission snapshot captured during preparation. The current-head CI evidence lives in the sibling [current-CI packet](../2026-11-15-poll-dedupe-current-ci/README.md); it is linked, not duplicated here.

The scan 1 admission binds source candidate `420240cad27d3865988dc7009dc9d80291e93c9c` to PR head `08651317c485062eb90367e1df3f7632f8e1a6c7`. The CI receipt records run `43715831258`, attempt 1, tested synthetic merge `98d2bc2c473d3167a39ae966f9dfb9e2f00904fe`, and its base/head parents. No owner acceptance is inferred.

## Preparation inventory

- [Preparation source-copy map](source-copy-map.preparation.json) maps each retained payload file to its source, byte count, and SHA-256.
- [Preparation checksum list](PREPARATION-SHA256SUMS.txt) verifies the current preparation snapshot. It is not the final packet manifest.
- A bounded credential-pattern check found no high-confidence credential matches in the selected scan 1 report, receipts, or probe files. This is a limited curation check, not a security audit.

The README, map, and checksums will be finalized only after root supplies the terminal Astra scan and merge receipts. No source, index, PR, or issue state was changed for this curation.
