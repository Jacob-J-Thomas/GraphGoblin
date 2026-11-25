# PR 501 CI run 915 (CI12)

This packet records terminal GitHub Actions run [44019677654](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/44019677654) for PR 501.

## Run identity and jobs

- Head: `53f41045516f1e0bfae44e3ef9a58e0b60dc3cf4`, tree `a26d690fdda84d4aae34b52b3166fdcd9e4eee00`
- Base: `6d7fcc9838d831fe1be3c3cf52c90a2f33e8f5b1`
- Synthetic merge checkout: `155d2dfa09d0ed6ec52d61d1f0840dd24098a152`, same tree, parents base then head.
- Run conclusion: **failure**, due to macOS native coverage below threshold.
- Browser, Gates, Template image, and Windows launcher: **success**.
- macOS launcher: **failure** at the native coverage threshold step.

The shared V8 coverage gate passed. The browser functional suite passed.

## macOS native results

The API integration step passed: **10 test files, 203 passed, 8 skipped (211 total)**.

The Swift test command completed with status 0 and recorded **154 tests passed** in 7.435 seconds. The native installer and gateway acceptance step also passed.

The native coverage export completed with status 0 and clean stderr. Its full JSON summary and the job log report:

- Lines: **3,439 / 3,627 (94.82%)**
- Regions: **1,775 / 2,056 (86.33%)**
- LLVM native branch denominator: **0; branch coverage is unavailable**
- `meetsThreshold`: **false**

The 90% line threshold is met; the 90% region threshold is not. The summary covers 25 source-file rows (23 executable and two declaration-only). Target results:

| Target | Lines | Regions |
| --- | ---: | ---: |
| LauncherEngine | 96.11% | 86.71% |
| LauncherPresentation | 97.73% | 95.13% |
| LauncherEntry | 41.94% | 46.15% |
| LauncherInstaller | 86.67% | 78.59% |
| InstallerEntry | 100.00% | 100.00% |
| LaunchContract | declaration-only | declaration-only |

Exact per-file counts, source hashes, mapping classifications, and branch availability are in `artifacts/extracted/macos-launcher-coverage/coverage-summary.json`. The job log prints the same aggregate counts before the coverage gate exits with status 1.

## Shared V8 coverage summaries

All 13 uploaded package/app/tooling summaries are retained. The Gates job completed successfully.

| Summary | Lines | Branches |
| --- | ---: | ---: |
| apps/api | 95.22% | 90.66% |
| apps/mcp | 96.95% | 94.23% |
| apps/plugin-claude | 95.00% | 95.23% |
| apps/plugin-codex | 95.58% | 91.66% |
| apps/web | 98.60% | 94.31% |
| adapter-codex | 99.23% | 95.41% |
| adapter-jev | 98.80% | 96.77% |
| api-client | 100.00% | 97.30% |
| contracts | 99.40% | 94.73% |
| domain | 98.74% | 95.98% |
| engine | 96.94% | 91.22% |
| infrastructure | 97.80% | 93.18% |
| tooling | 97.02% | 92.02% |

## Retained material

- `logs/`: decoded logs for all five jobs.
- `artifacts/macos-launcher-14300437287.zip`: complete native macOS archive; SHA-256 `45fcf42b2a67622c2cd2f44af84ce45f4308efd7db175ddccc263312a1d223e4`.
- `artifacts/coverage-14301353453.zip`: complete V8 coverage archive; SHA-256 `b632e292c89343e1b9341e415bf3d983e17e8a64841af74fd077ff1f38edba29`. Its 13 compact summary reports are extracted.
- `artifacts/extracted/`: native acceptance evidence, toolchain context, Swift test receipts and streams, event JSONL, LLVM profile/export, and complete per-file coverage summary.
- `run-metadata.json`: exact run, job/step, artifact, head/base, synthetic merge, Swift coverage, and V8 coverage metadata.

`SHA256SUMS` hashes every packet file except itself.
