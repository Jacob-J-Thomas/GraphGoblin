# PR 501 CI run 912 (CI09)

This packet records GitHub Actions run [44012433527](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/44012433527) for PR 501. Raw downloaded evidence is retained unchanged; the separate `backend-execution-diagnosis-01.md` is a source assessment, not a GitHub CI record or a confirmed cause.

## Run identity

- Head: `e16a387731463e1da8b3adebfbab72c10219e1da`, tree `3aeda723de043869e0240051908b0f327dcabf59`
- Base: `6d7fcc9838d831fe1be3c3cf52c90a2f33e8f5b1`
- Synthetic merge checkout: `be7ed55c142743a9eb45bf9cf42b38bbd502ad4c`, tree `3aeda723de043869e0240051908b0f327dcabf59`, parents base then head
- Run window: 2026-11-17 03:45:36Z to terminal update 04:07:29Z
- Run conclusion: cancelled after a later PR head triggered the workflow's normal cancellation behavior.

## Job outcomes

| Job | Final state |
| --- | --- |
| macOS launcher | failure |
| Windows launcher | success |
| Template image | success |
| Gates | cancelled during Unit tests with coverage |
| Browser | cancelled during Functional browser suite |

The macOS API integration step passed: **10 test files, 203 passed, 8 skipped (211 total)**. The native installer and gateway acceptance step passed.

The Swift native test-and-coverage command did not complete: `xcrun --sdk macosx swift test --arch arm64 --enable-code-coverage -Xswiftc -disable-batch-mode --verbose` was configured for 270,000 ms and ended with `spawnSync /usr/bin/xcrun ETIMEDOUT`, wrapper signal `SIGKILL`, status null. Its recorded stdout is 0 bytes; stderr is 371,329 bytes. The exact failure receipt and raw streams are in `artifacts/extracted/macos-launcher-coverage/`. No native XCTest/Swift Testing completion count or native coverage threshold result was captured in this run.

The failure-only serial diagnostic build completed with status 0. Its inventory records 28/28 expected objects and its macOS DiagnosticReports scan completed with zero matches. This is supporting diagnostic evidence; it does not turn the timed-out primary test step into a pass.

The cancelled V8 coverage job uploaded eight package summaries. They are partial because the gate job was cancelled while Unit tests with coverage was running; they do not establish completion of the shared coverage gate.

| Package summary present | Lines | Branches |
| --- | ---: | ---: |
| apps/api | 95.22% | 90.66% |
| adapter-codex | 99.23% | 95.41% |
| adapter-jev | 98.80% | 96.77% |
| api-client | 100.00% | 97.30% |
| contracts | 99.40% | 94.73% |
| domain | 98.74% | 95.98% |
| engine | 96.94% | 91.22% |
| infrastructure | 97.80% | 93.18% |

## Retained material

- `logs/`: decoded logs for all five jobs.
- `artifacts/macos-launcher-14297472224.zip`: complete macOS artifact archive; SHA-256 `43ff74985b3697969b195cbbf29aeaf8f17ffe95425798a937901fae016826ac`.
- `artifacts/coverage-14298735654.zip`: complete partial V8 coverage archive; SHA-256 `645106ddb3e21f2653326bff62e1beec26925c1d88bdfe71ae28ece705ceaf26`. Only its eight compact summaries are extracted.
- `artifacts/browser-failure-14298895080.zip`: complete 20,885,500-byte browser artifact archive; SHA-256 `5bdd995c857e0ac446207115961195e31c4631eb01433973e5831e72a143570f`. The archive is preserved without expansion.
- `artifacts/extracted/`: native acceptance evidence, toolchain context, raw Swift coverage/test receipts, streams, object roster, diagnostic report scan, and the eight selected V8 summaries.

`run-metadata.json` stores the GitHub run, exact synthetic merge identity, job/step summaries, artifact IDs, sizes, and GitHub digests. `SHA256SUMS` hashes every file in this packet except itself.
