# GraphGoblin PR 501 CI packet 04

Read-only evidence for [GitHub Actions run 44004433813](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/44004433813), run 907, attempt 1. It was created for PR 501 at exact head `ccaf0201a8a6de706f6241d5535a257468503487`, tree `22cf13b1be652cb852792b3ecdbdecf7ff2cfe05`, targeting `main` at `6d7fcc9838d831fe1be3c3cf52c90a2f33e8f5b1`. Synthetic merge `bc479518fe36f0a32ed39bb03f9798761d89d126` has parents base then head and the same tree.

The workflow run ended `cancelled` after CI05 was started. Terminal jobs: Browser `cancelled` during the functional browser suite; Template image `success`; Windows launcher `success`; macOS launcher `failure` at Swift coverage; Gates `cancelled` during Design token rules.

The first native failure is a compile diagnostic in `PublisherTests.swift:133:72`: Swift Testing `#require` reports that `fixture.receipts.named(filename)` can throw but is not handled. The macOS API integration suite passed 10 files, 203 tests passed and 8 skipped. Native installer/gateway acceptance passed 2/2. Coverage counters were not produced, so no native percentage is reported.

The original `macos-launcher` and `browser-failure` artifact archives, all five decoded job logs, selected raw Swift test stderr/JSON and sentinel/source-roster records are preserved. The Browser artifact archive is kept intact and was not expanded. No V8 coverage artifact was uploaded before Gates was canceled. Exact sizes and SHA-256 values are in `run-metadata.json` and `SHA256SUMS.txt`.

No rerun, manual cancellation, workflow edit, source edit, or repository change was made by this observer.