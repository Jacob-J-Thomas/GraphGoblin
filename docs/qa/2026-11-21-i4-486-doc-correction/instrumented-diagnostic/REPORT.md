# Bounded instrumented PWA diagnostic

**The original Linux CI missed-reload failure was not reproduced. The exact target passed twice locally. The bounded preceding-case invocation failed on a different offline-banner assertion, then Playwright replaced its worker before the target passed. The original cause remains unresolved and CI run 44934348117 remains FAILED.** No product fix, commit, CI retry, timeout increase or assertion change was made.

## Exact binding and execution counts

New worktree: `G:/ggq/gg-i4-553-browser-diagnostic/GraphGoblin`, branch `codex/gg-i4-553-browser-diagnostic`, base/head `29e165e14fdda138300ba2a34585ddd47268b475`, tree `d50fb576f1ef4498cb30e52521198575d6d0ebd4`. Six disclosed files contain uncommitted diagnostic instrumentation; the index is unchanged. `diagnostic.patch`, `diagnostic-files.json` and `diagnostic-source/` preserve the exact tracked patch plus the new observer helper.

Node **22.23.4**, pnpm **12.8.1**, Playwright **1.63.0**, installed **msedge 158.0.4370.33**, platform **Windows/win32**. CI used the same Edge channel/version on **Linux**. This platform difference and observer effects prevent treating local results as a pristine CI reproduction.

| Invocation | Actual result | Target detail |
| --- | --- | --- |
| Isolated exact case | Exit 0; 1 passed | 6,274 ms, workerIndex 0, retry 0 |
| Three immediately preceding PWA cases + target | **Exit 1; 3 passed, 1 failed** | Target 6,296 ms, **replacement workerIndex 1**, retry 0 |

These are **2 invocations / 5 test-result records: 4 passed, 1 failed**, including **2 passing target records**. They are not added to or substituted for the original CI counts. Every test retained the existing 60,000 ms deadline, zero retries and original assertions. The original target block is byte-identical after removing only the disclosed diagnostic catch/logging additions; 128 assertion/timeout-bearing lines across the spec also match. `oracle-and-provenance.json` records this proof and unchanged config/lockfile.

## What the instrumentation actually observed

Both target records captured two complete, attempt-correlated transactions. The first reached the real worker, obtained clean/dirty acknowledgements and replied `accepted:false` with the dirty-session reason. After the dirty tab closed, the second reached the worker, acquired the exclusive lock, completed preparation, sent COMMIT, entered activation, observed worker/controller progress and reloaded. The worker and page both recorded `accepted:true`. The existing final assertions, including one reload and two guarded APPLY messages, passed.

See each attempt’s `events.jsonl` and `target-protocol-summary.json` for exact attempt IDs, timestamps, held/pending scoped-lock snapshots and worker-version/controller observations. No target `apply-timeout`, first-body error or cleanup error occurred. The newly added target failure handlers therefore remain **unexercised error paths**; their source logs and rethrows the body error before finally and records reset failure separately without swallowing either.

The sequence’s **different failure** was original `pwa.spec.ts:518` (instrumented line 522): after cold offline reload, “Loops needs the GraphGoblin API” became visible, but exact text **“You are offline”** was absent throughout the existing **10,000 ms** assertion window. The retained error-context and inspected screenshot show **“Cannot reach the GraphGoblin API”** instead. The reconnect portion was not reached. Its normal `context.setOffline(false)` cleanup completed; the assertion is preserved in JSON results and test-end error records.

The first two predecessors passed. After the third failed, Playwright restarted worker 0 as worker 1 before executing the target. **This is not a completed same-worker predecessor comparison.** The target’s second pass neither explains the original missing reload nor clears the sequence invocation’s failure. No further runs were performed.

## Instrumentation reach and limits

- Production worker: console observations around APPLY/capability/preparation/COMMIT/ABORT/exclusive-lock/activation/result stages; scoped `navigator.locks.query()` snapshots at APPLY and exclusive grant; an activation-event observer.
- Page guard and registration: console observations around existing lease, acknowledgement, result, controller and reload operations.
- Test observer: console listener, extra CDP sessions with the ServiceWorker domain enabled, worker registration/version events, and one-second **read-only** registration/lock/status-text samples.
- Test spec: observer hooks and the target’s separate body/cleanup error logging; global setup: child/server PID logging only.

No explicit online/offline setter, fetch, storage write or UI mutation was added by observation code. Nevertheless, extra CDP sessions, reads and logging can affect timing or browser behavior. **The Windows offline-banner observation is instrumented evidence, not a proven pristine product defect. Neither observed issue is classified as flakiness.** There were 1 isolated and 5 sequence sampler errors, all “Execution context was destroyed, most likely because of a navigation”; they were retained as observer errors and did not alter test outcomes.

The original Linux evidence still proves the second click’s missing main-frame navigation, Checking-to-unknown-warning transition around 15 seconds, and the later finally/reset error after teardown. Its missing MessagePort/worker lifecycle stream remains missing. Successful local transactions cannot fill that historical causal gap. Root may retain an explicit unresolved follow-up; these results support no speculative production correction or CI waiver.

## Preparation and resource accounting

The initial estimate was one install and one build. Actual preparation, with root-authorized corrections, was:

1. **Install command 1 failed** before product execution because an empty redirected cache hid offline pnpm policy metadata. Its log/receipt are retained as `setup-failed-install*`.
2. Copied the existing local metadata cache read-only into this packet (1,030 files, 392,778,625 bytes, inventory in `cache-copy.json`). **Install command 2 succeeded offline**, reusing 801 packages from `G:/.pnpm-store`, downloaded 0, scripts disabled, independent node_modules.
3. **Build command 1 failed** resolving the fresh checkout’s unbuilt workspace `@graphgoblin/api-client` default export. Its raw log/receipt remain.
4. After checking CI’s ordinary dependency-first build sequence, **build command 2** ran the dependency-aware Turbo web closure: 9/9 build tasks succeeded. No unit/coverage/general gates were run. `built-output-before-tests.json` hashes 1,193 outputs; **all 1,193 remained exact after normal worker reset/teardown**.

One instrumentation-generation attempt stopped on a non-unique static insertion anchor before any build/test. Partial diagnostic files and failure record are retained. Two additional static separator-check assertions failed; final character inspection confirmed the correct JSONL separator before tests. These are preparation/tooling failures, not extra product diagnostic attempts. No network fallback, browser install or paid provider was used. Temporary/cache data was kept on G and removed only after zero-process checks. No peak-disk measurement is claimed.

## Privacy and precise cleanup

`privacy-review.json` inventories **all 5 retained local trace archives / 344 members** and scans textual trace/network/source/resource data plus attempt JSON/JSONL/error-context records. It found **0 GraphGoblin/device/provider/GitHub credential-pattern candidates, 0 nonempty sensitive HTTP header values, and 0 nonempty API-key localStorage records**. Captured control calls were worker build/reset; there was **no `/apps` keyed-extra-instance or `/api-keys` request**. Three selected retained frames were inspected: the offline failure showed only the task app; the latest target frames were blank during reload/teardown and do not supply positive UI evidence. No credentials or unrelated private pixels were visible in these selected frames. This is a bounded static scan, not proof against every encoding or every image in every trace.

These runs used **two process-local `:memory:` databases**, main `createTestApp`, `requireApiKey=false`, fake harnesses and a fixed source-defined test master-key construction. The latter is not an owner/provider secret. No generated API key was observed or needed. **No reusable disk task store remains and no revocation is claimed.** D208’s earlier two-store decision was not applied to these runs.

The filesystem scratch root was exactly `G:/ggq/delivery-evidence/2026-11-17-five-intents/i4-553-browser-reproduction-01/temp`, with fixture prefix `gg-api-`. **Random mkdtemp suffixes were not logged before fixture auto-removal; exact deleted scratch names are unobserved.** The source proving `:memory:`, trusted local mode and automatic scratch removal is narrowly retained in `store-privacy-source-excerpts.json`. No extra execution was used to reconstruct paths.

`cleanup.json` records **23 exact task PIDs**, including main server PIDs **45852** (isolated) and **42844** (sequence), runner/worker/build/setup/browser processes captured in receipts and the in-run process snapshot. After normal teardown: **0 recorded PIDs alive, 0 exact task command-line matches, 0 owned listeners, 0 surviving `gg-api-*` scratch directories**. No forced process termination occurred. Then only this packet’s cache/temp directories were removed after absolute path-bound checks; no original sealed bytes or other worktree/store were altered. The isolated diagnostic worktree and its builds are retained for inspection.

Final readback preserved delivery **29e**, Claude author **67d5957cfeb5ed65c0b3e6708f3543a30fbe5b40**, an empty diagnostic index diff, all 1,193 build hashes and the original diagnosis seal **87/87**. No source commit, provider/account operation, owner-store access, CI rerun or GitHub publication occurred.

**Disposition: bounded diagnostic complete; original missed-reload cause unresolved; separate instrumented Windows offline-banner failure retained; full CI/acceptance remains failed.** `SHA256SUMS.json` seals every retained packet member except itself; its digest is supplied separately.
