# GraphGoblin PR 501 CI packet 06

Read-only evidence for [GitHub Actions run 44006920517](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/44006920517), run 909, attempt 1. It was created for PR 501 at exact head `1c9051c66a46f90e826d73259ee713d91f7b1980`, tree `0c3f2303f27591f9b220bcb91f6cc6c0f9b9cb2a`, targeting `main` at `6d7fcc9838d831fe1be3c3cf52c90a2f33e8f5b1`. Synthetic merge `22105196a170a5310f02647811cfa8f3fcc8052d` has ordered parents base then head and the same tree.

The run completed with conclusion `cancelled`. Terminal jobs: Windows launcher `success`; Template image `success`; macOS launcher `failure` at Swift native tests and coverage; Gates `cancelled` during unit tests with coverage thresholds; Browser `cancelled` during the functional browser suite.

The macOS API integration step passed 203 tests across 10 files with 8 skipped. Native installer/gateway acceptance passed 2/2. The Swift coverage command exited 1 without a signal; stdout was empty and stderr was 368,176 bytes (SHA-256 `dc42c9f7bed01596df3666d3f976a4b3718648e6458f9684c8e37284724271ec`). Its raw stderr ends after the final `codesign` command with `error: fatalError`; it contains no additional diagnostic explaining the exit. The recorded toolchain was macOS 15.8.2 (24H232), Xcode 16.4, macOS SDK 15.5, Swift 6.1.2, arm64, Node 22.23.4 and pnpm 12.8.1. No Swift coverage counters were produced.

The partial V8 coverage archive contains eight package/app summary JSON files (API plus seven packages). Every included summary reports at least 90% lines and branches, but Gates was cancelled during the shared unit/coverage job and the archive does not contain a complete repository gate result. The original 20,875,943-byte Browser failure archive is preserved intact and was not expanded. The original macOS artifact is preserved with the sentinel and source records; no crash report or LLVM production coverage export was present.

All five decoded job logs and the three original artifact archives are retained. Selected raw V8 summaries and native Swift receipts are extracted. Exact file sizes and SHA-256 values are in `run-metadata.json` and `SHA256SUMS.txt`.

No rerun, manual cancellation, retry, workflow edit, source edit or repository change was made by this observer.