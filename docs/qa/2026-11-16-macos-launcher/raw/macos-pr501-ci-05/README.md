# GraphGoblin PR 501 CI packet 05

Read-only evidence for [GitHub Actions run 44005567835](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/44005567835), run 908, attempt 1. It was created for PR 501 at exact head `448168ab73727516bb8c4c824545cf4278cf84db`, tree `3625c6c5af27fbbcd5c2af3e385a1a0d908827b1`, targeting `main` at `6d7fcc9838d831fe1be3c3cf52c90a2f33e8f5b1`. Synthetic merge `3508d2d8feaeea16f2d813aa478215883d6ddf24` has parents base then head and the same tree.

The workflow run ended `cancelled` after CI06 was started. Terminal jobs: Browser `cancelled` during the no-retry functional suite; Template image `success`; Windows launcher `success`; macOS launcher `failure` at Swift coverage; Gates `cancelled` during Unit tests with coverage thresholds.

The Swift command record has status 1, stdout empty, and stderr ending only with `error: fatalError`; the record has no signal or structured error field. No test summary or source/test diagnosis is present. Native coverage counters were not produced. The macOS API integration suite passed 10 files, 203 tests passed and 8 skipped; native installer/gateway acceptance passed 2/2.

The original `macos-launcher`, `coverage`, and `browser-failure` artifact archives are preserved. All five decoded job logs and the complete small native artifact evidence are retained. The coverage archive contains seven package V8 summary JSON files (65,925 bytes total); Gates was canceled during the coverage-threshold step, so this partial archive does not establish a complete V8 gate result. The 7.3 MB browser artifact is preserved as an archive without expansion.

No root cause is inferred from `fatalError`; no rerun, manual cancellation, workflow edit, source edit, or repository change was made by this observer. Exact sizes and SHA-256 values are in `run-metadata.json` and `SHA256SUMS.txt`.