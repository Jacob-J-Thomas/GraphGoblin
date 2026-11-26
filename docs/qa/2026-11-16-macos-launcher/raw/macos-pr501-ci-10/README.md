# PR 501 CI run 913 (CI10)

This packet records GitHub Actions run [44014916376](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/44014916376) for PR 501. It preserves raw CI outputs and artifact archives; the run was later cancelled by the next PR head.

## Run identity

- Head: `c2b3f34c60f4ecb642ace4727f60ac72999dc644`, tree `f2d42eb64c3fe2d23b03c22d83a17e7184cc21cb`
- Base: `6d7fcc9838d831fe1be3c3cf52c90a2f33e8f5b1`
- Synthetic merge checkout: `57cd106bfb15c0cf1280f29908d07b89575255c4`, tree `f2d42eb64c3fe2d23b03c22d83a17e7184cc21cb`, parents base then head
- Run window: 2026-11-17 04:07:10Z to terminal update 04:27:15Z
- Run conclusion: cancelled after the subsequent PR head triggered normal cancellation behavior.

## Job outcomes

| Job | Final state |
| --- | --- |
| macOS launcher | failure |
| Windows launcher | success |
| Template image | success |
| Gates | cancelled during Unit tests with coverage |
| Browser | cancelled during Functional browser suite |

The macOS API integration step passed: **10 test files, 203 passed, 8 skipped (211 total)**. The native installer and gateway acceptance step passed.

### Swift native tests and coverage

The primary `swift test` command exceeded its 270,000 ms wrapper timeout: `spawnSync /usr/bin/xcrun ETIMEDOUT`, wrapper signal `SIGKILL`, status null. Its recorded stdout is 57,058 bytes and stderr is 371,329 bytes.

Swift Testing did start. The retained event stream contains **726 valid JSONL records**: 173 `testStarted`, 171 `testEnded`, 102 `testCaseStarted`, 101 `testCaseEnded`, and five `issueRecorded` events. At the function level, 154 starts and 153 ends were recorded. Case 71 of `committedChildExitProducesItsBoundedDiagnosticCategory(code:)` started but had no matching end before termination. No final test summary or native coverage result was captured.

The five recorded failure events are in the raw stream. They concern a refused-connection store observation, a cold child still observed as running, refused-diagnostic exit code (22 vs 25), held-store quit exit code (22 vs 40), and a child-exit diagnostic category (`cannot-verify` vs `child-exited`). The artifact also preserves the exact source locations and assertion text.

The separate failure-only serial build succeeded, recorded all 28/28 expected compilation objects, and had no matching macOS diagnostic reports. This diagnostic result does not change the primary test timeout or provide coverage counters.

## Coverage material

The V8 coverage artifact contains ten selected package summaries, but the Gates job was cancelled while Unit tests with coverage was running. It does not establish completion of the shared coverage gate.

The native coverage archive retains sentinel reports and receipts. No full native line/region threshold result was produced because the primary test invocation timed out before completion.

## Retained material

- `logs/`: decoded logs for all five jobs.
- `artifacts/macos-launcher-14298667257.zip`: complete macOS archive; SHA-256 `dddc55bde339458f57bdcd5ff13bbe297b2e526f717b1ba3348c1e900e261676`.
- `artifacts/coverage-14299326746.zip`: complete partial V8 coverage archive; SHA-256 `d9444331498ba0aa2e04c200e7ab7de6ef926edcd2d374520d6f44f8bbfb9fbf`. Only compact package summaries are extracted.
- `artifacts/browser-failure-14298743824.zip`: complete 20,878,868-byte browser archive; SHA-256 `074d0c3f974fa6387e09a04ababfefabb4e486dfe43c610eafba98717cce0119`. The archive is preserved without expansion.
- `artifacts/extracted/`: native acceptance evidence, toolchain context, raw test and event receipts, diagnostic build, and selected coverage reports.

`run-metadata.json` stores GitHub run/job/step/artifact metadata and exact synthetic merge identity. `SHA256SUMS` hashes every file in this packet except itself.
