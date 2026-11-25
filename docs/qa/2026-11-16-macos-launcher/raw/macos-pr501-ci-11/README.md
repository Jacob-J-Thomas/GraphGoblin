# PR 501 CI run 914 (CI11)

This packet records GitHub Actions run [44017248649](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/44017248649), which is now terminal after the subsequent PR head triggered normal cancellation.

## Run identity

- Head: `bdabca42017a49c476c8aeb5a2b3d55e7d539b01`, tree `29c7a1520fcc4db22abf19b44f1a7cbbef46dfbd`
- Base: `6d7fcc9838d831fe1be3c3cf52c90a2f33e8f5b1`
- Synthetic merge checkout: `b558263a2aade2055b688c8b4c147e1af9ae678c`, same tree, parents base then head.
- Run conclusion: cancelled.
- Job outcomes: macOS launcher failure; Windows launcher and Template image success; Gates and Browser cancelled.

## macOS results

The API integration step passed: **10 test files, 203 passed, 8 skipped (211 total)**.

The primary Swift test command completed successfully: its receipt has status 0 with no signal or error, and records **154 Swift Testing tests passed** in 6.265 seconds. The event stream has 737 valid JSONL records: 173 test starts and ends, 108 case starts and ends, a passing run-end event, and zero `issueRecorded` events. Toolchain context: macOS 15.8.2 (24H232), arm64; Xcode 16.4; Apple Swift 6.1.2 (Swift Testing runtime 6.1.0 / Testing Library 124.4).

The native installer and gateway acceptance step passed.

The macOS workflow step failed during coverage collection, before production line or region thresholds were evaluated. The `swift-zero-baseline` `llvm-cov export` command returned **status 0** and valid JSON stdout (568,359 bytes). Its 749-byte stderr contains four `profile data may be out of date - object is newer` warnings for the package test bundle, `GraphGoblin`, `GraphGoblinLauncherInstaller`, and `PresentationFixture`. The coverage acceptance script rejected the nonempty warning stderr and stopped. This packet keeps the command receipt, JSON stdout, exact warnings, the script failure in the job log, and the successfully merged profile (263,992 bytes). No full production line/region report or threshold result was captured.

The V8 artifact contains ten selected package summaries, but the Gates job was cancelled during Unit tests with coverage. These snapshots do not establish completion of the shared coverage gate.

| Package summary present | Lines | Branches |
| --- | ---: | ---: |
| apps/api | 95.22% | 90.66% |
| apps/mcp | 96.95% | 94.23% |
| adapter-codex | 99.23% | 95.41% |
| adapter-jev | 98.80% | 96.77% |
| api-client | 100.00% | 97.30% |
| contracts | 99.40% | 94.73% |
| domain | 98.74% | 95.98% |
| engine | 96.94% | 91.22% |
| infrastructure | 97.80% | 93.18% |
| tooling | 97.02% | 92.08% |

## Retained material

- `logs/`: decoded logs for all five jobs.
- `artifacts/macos-launcher-14298789516.zip`: complete macOS archive; SHA-256 `53d3ebdcd365ef06591bec3b3c5c5ff236a7b9ab5141ea5e90b92c37cd737998`.
- `artifacts/coverage-14300321863.zip`: complete partial V8 coverage archive; SHA-256 `2494ab54416a0f3ed5e7086bd166b2cef4cb73f626cff60bd4096fb49832ee8f`. Only compact summaries are extracted.
- `artifacts/browser-failure-14300362046.zip`: complete 20,887,482-byte browser archive; SHA-256 `f9d80dd6aa3ec7936d4ad906e887fcd63f7a31077f3f6e26bda5f7d053698711`. Preserved without expansion.
- `artifacts/extracted/`: native acceptance evidence, toolchain context, test receipts and streams, event JSONL, coverage profile inputs, merged profile, zero-baseline export, and warning stderr.
- `run-metadata.json`: GitHub run, job/step and artifact metadata, plus exact head/base/merge identity.

`SHA256SUMS` hashes every packet file except itself.
