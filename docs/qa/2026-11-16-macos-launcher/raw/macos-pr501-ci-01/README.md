# PR 501 hosted CI evidence

Captured 2026-11-16 for [draft PR 501](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/501), workflow run 43942201334 (CI #904). The run completed with conclusion **failure**. No retry, cancellation, source change, review, or PR update was made by this observer.

## Source binding

- Head: `14fd41d3b0a58b0f4dfb4e614c2067d861c29129`, tree `426f38727cbd3b5f0df8d79bc2dfb93e749d089b`.
- Base `main`: `6d7fcc9838d831fe1be3c3cf52c90a2f33e8f5b1`, tree `430d34fda9d7e91752a7dbc93794242b4c17a5aa`.
- GitHub Actions checked out synthetic merge `532791c53dedf95d66f0b34f218df5fd6ef5d136`, with tree `426f38727cbd3b5f0df8d79bc2dfb93e749d089b` and parents base/head. Confirmed by GitHub commit metadata and the macOS artifact's `versions.txt`.
- Full PR metadata, changed filenames, and commit bindings are in `pr-metadata.json`, `changed-filenames.json`, and `source-bindings.json`.

## Job results

| Job | Result | Evidence |
| --- | --- | --- |
| macOS launcher (133562382795) | **Failed** | Build passed; Mac API integration passed: 10 files, 203 passed, 8 skipped. Swift native/presentation compilation failed; installer/gateway acceptance was skipped. |
| Windows launcher (133562382715) | Passed | 25 passed, 0 failed, 0 skipped. Native evidence upload warned that `.tmp/windows-launcher-*/` was missing, so GitHub retained no Windows artifact. |
| Gates (133562382928) | **Failed** | 2,123 passed, 29 skipped across 136 files. API function coverage was 89.54% against 90%; other API metrics passed. Later licence, generated-doc, contrast, and dependency-audit steps were skipped. |
| Browser (133562382312) | Passed | Edge suite: 481 passed, 1 skipped of 482. The skipped test is the provider-only `live.spec.ts`; browser coverage/exclusions passed. |
| Template image (133562382668) | Passed | Distributed image build and offline/read-only installed-template load steps passed. |

The Swift compiler errors are retained in `macos-job-133562382795.log`. They cover the `quitting` closure escaping annotation, the `LogDirectory.open` call at `Diagnostics.swift:176`, and `mode_t`/Int32 comparisons across `Installation.swift`, `LaunchInputs.swift`, and `NativeFiles.swift`. The runner used macOS 15.8.2 arm64, Xcode 16.4, SDK 15.5, Swift 6.1.2, Node 22.23.5, and pnpm 12.8.1; this is not the owner's Swift 6.3.1 Mac result.

## Artifacts and local evidence

- `macos-launcher`, artifact 14262918796: 3,155 bytes, SHA-256 `c76ee02f69687abe3cff731edaad2aab042942dee02767ae65cc7b1163aadf2e`. Archive and extracted toolchain/compiler files are retained.
- `coverage`, artifact 14264252486: 11,226 bytes, SHA-256 `08fb94a17c1cb622a3d85ae4952b103ae49839bc17d6ef228e9ab1355952bc65`. Per-file summaries show `macos-log/guard.ts` 27/44 functions, `macos-local-key.ts` 4/4, `managed-log/guard.ts` 13/14, `serve.ts` 11/21, and changed `data-dir-lock.ts` 26/28. Only the API global function total fell below its threshold.
- Decoded job logs are retained for all five jobs. Their SHA-256 values are in `logs-sha256.json`; terminal job/step states and artifacts are in `workflow-jobs-final.json` and `artifacts-final.json`.

