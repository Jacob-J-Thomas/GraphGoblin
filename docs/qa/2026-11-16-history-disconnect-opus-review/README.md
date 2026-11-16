# PR #490 formal review archive — scan 1

This packet preserves the original Claude Opus scan 1 report and its supporting review records. It archives that scan only; Astra scan 2 was still pending at this capture, so this is not a final review or merge disposition.

## Review identity and publication

- PR: [#490](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/490)
- Head: `497acaa602959bc828e8f1e90f2dce0a576a3492`, tree `88ade580c80b2139b5d1bf51449dca10e33184f1`
- Target: `98692c8a8c7b519e8c83e585e026d595cedc0550`
- Tested merge: `387322e7f7d2b2f4a48c149aeaea2fc4f3001996`, tree equal to head, parents target then head
- CI: [run 43773546178](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/43773546178), attempt 2 success; the accepted [current-CI archive](../2026-11-15-history-disconnect-current-ci/README.md) retains the first Gates timeout and the one authorized Gates-only retry.
- Formal review: Claude Opus 5.5, model `claude-opus-5-5`, effort `xhigh`, exit code 0. The complete original report is [review/full-report.md.txt](review/full-report.md.txt), 22,863 bytes, SHA-256 `1f0abc7a32cd9a3b17e98e62cf37f04766ea833e47c11dd8728093a9c45061dc`.
- The report was published verbatim in [comment 6904020571](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/490#issuecomment-6904020571); the fresh comment GET, root disposition, issue #491 readbacks, and issue #419 readback at Astra scan 2 start are retained under [provenance](provenance/). No PR #490 body snapshot after this review was captured.

The launch, result, exit and empty stderr receipts are under [review](review/). The provider’s terminal message is retained separately from the full report. The private provider event stream is excluded; [excluded-private-stream.json](excluded-private-stream.json) records its source size and digest without including its contents.

## Verdict and dispositions

The reviewer returned **READY** for scan 1 of the shared three-scan limit, with no blocking finding. Root accepted READY for scan 1 and recorded the following dispositions in [the root disposition](provenance/root-disposition.md.txt):

- **O1 — DEFER-ISSUE, P3:** focused CI tests do not cover disconnect during the inter-page yield. The native closed-at-yield case demonstrates current behavior; the report’s predicted mutation survival is static reasoning, not an executed mutation. Follow-up is parked in [issue #491](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/491). Both its creation readback and later review-link readback are retained.
- **O2 — NO-CHANGE:** HTTP/1.1 pipelining limitation is a static Node-source observation, not native reproduction or a newly confirmed product defect.
- **O3 — NO-CHANGE:** silent handling of pending rejection after disconnect is the accepted behavior; the connected error path retains its policy.
- **O4 — NO-CHANGE:** the sole caller distinguishes a missing thread from a disconnected response using the monotonic predicate.

The report’s process qualifications P1–P4 remain visible in the original report and root disposition. They include the initial Node path-selection sequence, temporary scratch-file activity (root did not independently certify deletion from the report alone), a denied compound command replaced with a read-only script, and inspection of bundled Node source.

## Evidence limits and correction record

The review evidence was compiled Fastify routes over real TCP and file SQLite using synthetic histories, fake clock/IDs, and request-scoped barriers. It is not ordinary built-gateway or browser evidence. The reviewer ran no tests, mutations, builds, or native reruns; they spot-checked companion Browser, Windows, and Template logs rather than reading each log in full. The coverage artifact contained summaries only.

Root’s read-only link-count check corrected a report wording discrepancy without changing either original reviewer message: the original full report’s 108 count was for the delivery register alone, while the provider final message said 160. The seven checked documents counted 10, 6, 6, 6, 16, 14, and 108 links respectively, 166 total with no missing targets. The original report and provider-final message remain unchanged.

The original Markdown inputs are copied with a `.md.txt` suffix to preserve their bytes and make clear they are archival text. Their original relative links are source context; use this README for working packet links. Offline review scripts and outputs are under [review/scripts](review/scripts/).

## Integrity

`source-copy-map.json` records every copied source, destination, byte count, SHA-256 and qualification. It also records the intentionally excluded event-stream digest. `SHA256SUMS.txt` covers all packet files except itself.
