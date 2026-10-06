# Phase 3/4 adversarial code fixes R1–R4

Implemented from `49c2f6a` on 2026-10-06. Changes remain uncommitted for the orchestrator. Edge checks use the built app with `e2e/server.ts`, an isolated in-memory API on an ephemeral port. Port 4747 and the owner's data directory are not used.

## Changes and reproductions

- **R1, incomplete cron draft:** `apps/web/src/forms/cron/control.tsx` reports unfinished builder state and its error through the existing parse-error channel at `expression` (validation and badge path `config.expression`). The last valid expression stays in the contract. Clearing the last weekly checkbox is a commit; number/time entry remains typing. Completing, raw editing, Custom, and discard clear the blocker in their own action. `control.test.tsx` starts at Monday 07:30, unticks Monday, and checks the reported error, serialized days, commit kind and retained expression. `NodeEditorDialog.test.tsx` closes/reopens, undoes/redoes and discards the same incomplete state. `store.test.ts` checks one history step and exact restoration; `EditorPage.test.tsx` checks readiness, the badge and publish refusal without a publish API call. Edge `e2e/undo.spec.ts` repeats the actual dialog, checkbox, publish refusal, remount, shortcut undo/redo and one-step toolbar undo.
- **R2, safe manual-route reset:** `apps/web/src/editor/Canvas.tsx` computes automatic replacements at the final moved-card position before clearing manual routes. A replacement that enters any card keeps the manual route, dotted with Crosses a card and an announcement. `Canvas.test.tsx` reproduces tips (190, 61) and (694, 61), detour `[250, 300, 650]`, obstacle at (330, 0), size 184 by 122, and another card moved onto the detour. Its paired case moves the original obstacle away and requires a safe reset. Both are one move to undo. Edge `e2e/edge-routes.spec.ts` uses a real pointer drag, checks the saved route, actual SVG crossings, dotted state, warning, announcement and undo; the existing safe loop-back reset regression remains.
- **R3, touch port targets:** `apps/web/src/styles/canvas.css` expands port hit boxes to 44 by 44 px and output rows to 44 px with their existing 2 px gap under the coarse-pointer query. `NodeCard.tsx` supplies CSS hooks; fine-pointer rows stay 18 px with a 2 px gap. Edge `e2e/responsive.spec.ts` measures both dimensions in both themes and checks non-overlapping output spacing. The sweep's touch evidence, README, docs/09 and CHANGELOG are updated.
- **R4, performance criteria:** `apps/web/e2e/routing.spec.ts` enforces median whole-cache-miss routing p95 below 4 ms on every run and keeps each drag below 16 ms. Under `GG_ROUTING_STRICT_PERF=1`, every drag also requires frame p95 at or below 16.7 ms beside the existing added-frame p95 below 4 ms. Absolute frame values are rounded to 0.001 ms solely for RAF floating-point subtraction noise. The #18 QA record and docs/09 describe which assertions apply locally/manually and on every run.

## Verification

- Targeted unit regression: **145 passed** across five files.
- `pnpm.cmd typecheck`: **20 tasks successful**; `pnpm.cmd lint`: **11 tasks successful**. Both emitted Turbo cache I/O warnings, `Access is denied. (os error 5)`.
- `pnpm.cmd format:check`: all matched files formatted. Tokens: **136 files checked**. Contrast: **0 failing enforced pairs**. Generated docs: up to date.
- `pnpm.cmd --filter @graphgoblin/web test:coverage --maxWorkers=2`: **89 files, 980 tests passed**; statements **99.04%**, branches **96.50%**, functions **99.34%**, lines **99.61%**. Two workers contained memory use; `apps/web/coverage/` is retained. PowerShell's initial redirection treated pnpm's script announcement on stderr as `NativeCommandError` (wrapper status 1); the test and threshold report itself passed.
- `pnpm.cmd build`: **11 tasks successful**, run once before Edge; same Turbo cache warning.
- Requested four-file Edge suite: **66 passed, 1 failed** in 3.8 minutes. The failure was an old expectation that the source-covered forward route should reset. R2 correctly retains it because its automatic replacement also enters the covering card. The revised expectation was verified by rerunning **the complete `edge-routes.spec.ts` alone under normal machine load: 10 passed** in 39.2 seconds. The other files passed: routing **23**, responsive **20**, undo **14**.
- Both new R1/R2 Edge reproductions passed; both coarse-pointer themes passed the dimensions and multi-output spacing assertions. The sweep's **26 actual touch measurements** were copied from these Edge attachments, including 44 by 44 px ports in both themes.
- Supplemental web typecheck passed after the final spec edits. A supplemental lint scan during E2E found **5,316 errors solely in generated `test-results/.playwright-artifacts-*/traces/resources/*.js`**; the requested pre-build repository lint passed, and direct ESLint on the revised `edge-routes.spec.ts` and `responsive.spec.ts` passed. No lint configuration or exclusions were changed.

Edge channel: `msedge`, version **154.0.4258.53**, 1440 by 900 viewport, one worker. Initial Edge output also warned that `NO_COLOR` was ignored because `FORCE_COLOR` was set; isolated reruns removed `NO_COLOR` from their child environment. This is a local QA run, not a new GitHub runner measurement.

## Routing measurements

Each graph gets three five-second drags per repeat, three repeats per mode. Whole-cache-miss routing includes geometry preparation, invalidation and identity reuse. The raw records retain samples, per-drag p95s, idle baseline, browser and assertion targets. Rounded display values below do not change any routing or added-frame assertion.

| Mode   | Nodes / edges | Routing medians by repeat (ms) | Every drag routing p95 (ms) | Frame p95 (ms)   | Added-frame p95 (ms) |
| ------ | ------------- | ------------------------------ | --------------------------- | ---------------- | -------------------- |
| normal | 100 / 200     | 1.300 / 1.200 / 1.300          | 1.200 to 1.500              | 8.400 to 16.700  | -8.300 to 8.200      |
| normal | 300 / 600     | 2.200 / 2.200 / 2.500          | 2.200 to 2.900              | 8.500 to 16.700  | 0.000 to 8.300       |
| strict | 100 / 200     | 1.400 / 1.300 / 1.400          | 1.200 to 1.700              | 16.600 to 16.700 | 0.000 to 8.200       |
| strict | 300 / 600     | 2.500 / 2.500 / 2.500          | 2.200 to 2.800              | 16.700 to 16.700 | 0.000 to 8.200       |

- Without strict mode: **69 / 69 passed** in 3.4 minutes.
- With `GG_ROUTING_STRICT_PERF=1`: **67 passed, 2 failed** in 3.7 minutes. Repeat 3 failed the unchanged **added-frame p95 below 4 ms** assertion at both sizes: idle p95 **8.5 ms**, drag p95 **16.7 ms**, added p95 **8.2 ms**. All recorded absolute frame p95s met the new **at most 16.7 ms** criterion; routing medians met **below 4 ms**, with each drag well below **16 ms**. Earlier strict repeats had idle p95 around 16.5 to 16.7 ms and met both frame gates. This run was already the routing file alone. A further isolated strict single-run check under normal machine load produced **22 passed, 1 failed** in 1.2 minutes: 100-node routing median **1.5 ms**, frames **16.6 to 16.7 ms**, added frames **0.0 to 0.1 ms**; 300-node routing median **2.2 ms**, frames **16.7 ms**, idle **8.4 ms**, added frames **8.3 ms**, failing only the existing added-frame assertion. Raw rerun records: [100 nodes](routing-strict-rerun/performance-review-100-repeat-1.json), [300 nodes](routing-strict-rerun/performance-review-300-repeat-1.json). The limits were not relaxed.

| Mode   | Nodes | Repeat 1                                                    | Repeat 2                                                    | Repeat 3                                                    |
| ------ | ----- | ----------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------- |
| normal | 100   | [JSON](routing-normal/performance-review-100-repeat-1.json) | [JSON](routing-normal/performance-review-100-repeat-2.json) | [JSON](routing-normal/performance-review-100-repeat-3.json) |
| normal | 300   | [JSON](routing-normal/performance-review-300-repeat-1.json) | [JSON](routing-normal/performance-review-300-repeat-2.json) | [JSON](routing-normal/performance-review-300-repeat-3.json) |
| strict | 100   | [JSON](routing-strict/performance-review-100-repeat-1.json) | [JSON](routing-strict/performance-review-100-repeat-2.json) | [JSON](routing-strict/performance-review-100-repeat-3.json) |
| strict | 300   | [JSON](routing-strict/performance-review-300-repeat-1.json) | [JSON](routing-strict/performance-review-300-repeat-2.json) | [JSON](routing-strict/performance-review-300-repeat-3.json) |

The four-file suite also retained its [100-node](routing-suite/performance-review-100-repeat-1.json) and [300-node](routing-suite/performance-review-300-repeat-1.json) records (medians 1.2 and 2.2 ms).
