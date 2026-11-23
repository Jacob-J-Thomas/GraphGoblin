# Inspector focused regressions

The corrected 11-file selection ran once on the formatted Opus source with Node v22.23.4 and pnpm 12.8.1. Vitest used one worker, no retries, and the existing timeouts. It exited 1. Seven files passed and four failed. Across 164 tests, 159 passed and five failed. All 11 expected file paths appear in the report. The original selection preflight found two missing paths and ran zero tests. [Original preflight](FIRST-SELECTION-PREFLIGHT.json) · [Command and stream pins](COMMAND.json) · [Raw JSON](vitest-results.json)

| File and line | Observed failure |
| --- | --- |
| [RunInspectorPage.offline.test.tsx:331](G:/ggq/gg-i5-offline-inspector/GraphGoblin/apps/web/src/runs/RunInspectorPage.offline.test.tsx:331) | Reconnect with a held pre-loss read observed two additional run GETs where the assertion expected one. Pause was enabled by that point. |
| [SessionRecoveryControls.test.tsx:181](G:/ggq/gg-i5-offline-inspector/GraphGoblin/apps/web/src/runs/inspector/SessionRecoveryControls.test.tsx:181) | Both cases, gate expired and failure changed, observed `queued = false` where `true` was required. The failures preceded the gate/failure change and POST assertions. |
| [Timeline.test.tsx:364](G:/ggq/gg-i5-offline-inspector/GraphGoblin/apps/web/src/runs/inspector/Timeline.test.tsx:364) | Pressing Home did not focus the first long-sequence row, #10593. The later key assertions were not reached. |
| [WaitPanel.test.tsx:248](G:/ggq/gg-i5-offline-inspector/GraphGoblin/apps/web/src/runs/inspector/WaitPanel.test.tsx:248) | The queued answer case observed `queued = false` where `true` was required. The failure preceded gate expiry and the zero-POST assertion. |

The 25 protected provenance cases and 38 query reconnect cases passed. Formatted author files, selected tests, the three protected core files, checkout index, lockfile, modules manifest, virtual-store lock, and source-after receipt matched before and after. The common index remained absent. The heavy slot has been released. [Source before](BEFORE.json) · [Source after](AFTER.json) · [Summary](RESULT.json)
