# GraphGoblin PR 501 CI packet 08

Read-only evidence for [GitHub Actions run 44010913704](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/44010913704), run 911, attempt 1. The run was for PR 501 at exact head `f2b163cd37a5a28887af9897059a46be96e58b2e`, tree `d337c72e4d789c299a2e1b23fb411d88863248bc`, targeting `main` at `6d7fcc9838d831fe1be3c3cf52c90a2f33e8f5b1`. Synthetic merge `d1003f6489cd612d988e7d99f913fa450ee42cf0` has ordered parents base then head and the same tree.

The workflow run ended `cancelled`. Terminal jobs: Gates `cancelled` during unit tests with coverage thresholds; Template image `success`; Windows launcher `success`; macOS launcher `failure`; Browser `cancelled` during the functional browser suite.

The macOS API integration step passed 203 tests across 10 files with 8 skipped. Native installer/gateway acceptance passed 2/2. Primary `swift test` exited 1 with no signal/error object; stdout was empty and stderr was 319,462 bytes. Its raw stream ended with `error: fatalError`, without an explanatory compiler diagnostic. The failure-only serial build also exited 1 without a diagnostic or signal. A bounded inventory hashed 22 of 28 expected test objects; six missing objects are in Presentation support sources. The final serial `-primary-file` was `Presentation/Support/LiveAppKit.swift`, whose object is missing. The report scan found no matching compiler crash reports. The run contains 56 primary compiler invocations, each with exactly one `-primary-file`. This localizes the incomplete build but does not establish its cause. No test result or native coverage counters were produced.

The partial V8 coverage archive contains six package summary JSON files. Gates was cancelled while the shared unit/coverage job was running, so the archive is not a complete repository gate result. The 16,689,612-byte Browser artifact archive is preserved intact and was not expanded. The original macOS artifact archive and all five decoded job logs are retained.

The Mac artifact preserves the original Swift streams, failure-only serial build streams, object inventory, report scan, toolchain, sentinel and acceptance records. Exact sizes and SHA-256 values are in `run-metadata.json` and `SHA256SUMS.txt`.

No rerun, manual cancellation, retry, workflow edit, source edit or repository change was made by this observer.