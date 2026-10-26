# #186 acceptance fix: following a long run live must not starve the gateway

Fix for D1 (High) from the [acceptance group B record](../2026-10-26-acceptance-b/README.md) of the merged #186 round 2 (PR #405), on 2026-10-26. Base: `origin/main` at `ba89f0aececa87ea44e809b8157ba00ab1314015`. The decision is recorded in [ADR-0050, "Round 2 acceptance fix"](../../decisions/ADR-0050-bounded-sse-replay.md#round-2-acceptance-fix-bounded-live-following-2026-10-26); the behaviour in [docs/09, "Live following"](../../09-frontend-and-pwa.md#live-following-186-acceptance-fix-2026-10-26).

The acceptance worktree's record was untracked when this fix started, so the link above resolves only once that record is committed; its probes (`defs.mjs`, `lib.mjs`, `p186-compare.mjs`, `p186-rate.mjs`, `p186-neighbour.mjs`, `p186-cost.mjs`) were read and adapted here, not copied.

## Cause, confirmed

Reproduced on the base build with the same workload before any change (`throughput-before.*`, `throughput-at-before.*`):

- On every stream batch (about every 100 ms while a run streams) `RunInspectorPage` invalidated the run record, `/observation` and the current thread. While the latest event was a `node.finished`, its default selection also resolved `GET /runs/{id}/thread?at=N` and `?at=N-1`. In 30 s at about 5,200 events the inspector issued 168 reads of each read model and 182 `thread?at` reads.
- `historicalThread` (`apps/api/src/run-history.ts`) starts from the run's single stored checkpoint only when it precedes the boundary. The executor rewrites that checkpoint after every node completion (`packages/engine/src/run-manager.ts`, the two `saveThread` calls after each completion append). `at=N-1` is always behind it and `at=N` usually is by the time the read runs, so both replayed the history from the admitted seed in 128-event pages. The acceptance record measured 163 ms per read at about 2,000 events and 752 ms at 10,000.
- The gateway is single-threaded, so these replays starved every run on it. After the tab closed, the queued replays kept the gateway busy: the base build's "inspector closed" phase in `throughput-at-before` ran at 6.5 events/s.

## Design

Recorded in ADR-0050; summary:

1. **No historical read on the live path.** Following live, the thread panel always shows the current thread (#116's bounded read: checkpoint boundary plus the events after it). A completion's exact patch diff (`at=N`, `at=N-1`) is read only for an explicit selection, which pauses following, as in history mode.
2. **Coalesced refreshes** (`apps/web/src/runs/live-refresh.ts`): the first change after a quiet interval refreshes at once; later changes within 500 ms, or while a refresh is in flight, merge into one trailing refresh. No change is lost and refreshes never overlap.
3. **Only reads a change can affect** (`useLiveRefresh.ts`): the run record on every refresh; `/observation` only after lifecycle, cancellation-request, exit or decision events; the current thread only after events that `replayThread` applies (new domain `THREAD_EVENT_TYPES`) and only while it is shown. A hidden change is read once when the current thread returns.

Rejected: retained checkpoints near the tail (a ring cannot cover a lagging reader of a fast loop; stride checkpoints cost storage proportional to history times thread size and add completion-path writes), a browser-side live diff (needs the server's internal replay state and reintroduces browser replay), and an API cache of historical threads (unbounded memory or misses). Details in the ADR.

## Regression tests

They fail on the base inspector and pass with the fix. Each bound is a count derived from measured elapsed time (at most one refresh starts per 500 ms), so a slower machine only lowers the observed count; none is a wall-clock threshold.

| Test                                                                                                                                | Base inspector (`regression-web-before.log.txt`, `e2e-live-follow-before.log.txt`)                               | Fix (`regression-web-after.log.txt`, `e2e-live-follow-after.log.txt`) |
| ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| web `live-follow.test.tsx` "follows a fast cycle live without historical thread reads, refreshing at most once per interval"        | fails: `expected [ '7', '6', '12', '11', '17', …(43) ] to deeply equal []` (48 `at` reads for 24 batches)        | passes                                                                |
| web `live-follow.test.tsx` "refreshes only the run record while a node streams progress"                                            | fails: `expected 13 to be 3` (current-thread reads during ten progress-only batches)                             | passes                                                                |
| web `live-follow.test.tsx` "reads a selected completion exactly once and refreshes the hidden current thread only when shown again" | fails: `expected [ '3', '4', '6', '7' ] to deeply equal [ '3', '4' ]`                                            | passes                                                                |
| Edge `e2e/live-follow.spec.ts` "following a fast run live refreshes bounded read models and reads no historical thread"             | fails at `expect(window.filter((read) => read.at !== null)).toEqual([])`: 44 `thread?at` reads in the 5 s window | passes                                                                |
| web `live-refresh.test.ts` (coalescing with fake timers, change classification)                                                     | new module; tests the scheduler itself                                                                           | passes                                                                |
| domain `replay.test.ts` "changes a thread only through the listed thread event types"                                               | new export; checks every contract event type                                                                     | passes                                                                |

The base runs of the web tests swapped in the base `RunInspectorPage.tsx` and `useRunEvents.ts` (from `git show HEAD:`) with the new test files in place, then restored the fix. The base Edge run used the base build of the web app (built before any web change) with the new spec.

## Throughput before and after

Built product (`node apps/api/dist/main.js`), disposable store, two endless cyclic runs from the acceptance probes' loop (`lib.mjs` `cycle`): A is followed in Edge, B is the unrelated neighbour. No provider is involved. Rates are A's and B's events per second over the phase; reads are every API request the inspector page issued during the phase, excluding `/system/shutdown` polling. The host was shared with other workers' sessions, so absolute rates move by tens of percent between samples; compare within a row's build.

### Aligned to the acceptance report's history lengths (`throughput-at.mjs`)

The base rows use the base web app (the base `RunInspectorPage.tsx` and `useRunEvents.ts` from `git show HEAD:`, built with `vite build --outDir` into a temporary `gg-186f-` directory) served through `GG_WEB_DIST` by the fix's API build; the fix changes no API, engine or storage code. The fix rows use the final build of this branch.

| Build | Phase                                                 | A's events       | A events/s | B events/s | Reads: run / observation / thread / `thread?at` | Reads/s | Page JS heap (MiB) | API private (MiB) |
| ----- | ----------------------------------------------------- | ---------------- | ---------: | ---------: | ----------------------------------------------- | ------: | -----------------: | ----------------: |
| Base  | no inspector (from about 3,200 events)                | 3,214 to 4,854   |      108.9 |      108.9 | -                                               |       0 |                  - |             145.4 |
| Base  | inspector following A live (from about 5,000 events)  | 5,216 to 5,440   |        7.4 |        7.4 | 168 / 168 / 168 / 182                           |   22.77 |               9.75 |               183 |
| Base  | no inspector (from about 8,200 events)                | 8,206 to 9,694   |       98.9 |       98.9 | -                                               |       0 |                  - |             168.7 |
| Base  | inspector following A live (from about 10,000 events) | 10,080 to 10,124 |        1.4 |        1.4 | 67 / 67 / 67 / 66                               |     8.7 |               9.36 |             294.1 |
| Base  | inspector closed                                      | 10,129 to 10,236 |        6.5 |        6.6 | -                                               |       0 |                  - |             295.1 |
| Fix   | no inspector (from about 3,200 events)                | 3,210 to 5,089   |      124.9 |      124.9 | -                                               |       0 |                  - |             144.1 |
| Fix   | inspector following A live (from about 5,000 events)  | 5,546 to 8,889   |      111.3 |      111.3 | 59 / 59 / 59 / 0                                |    5.89 |               9.59 |             151.1 |
| Fix   | no inspector (from about 8,200 events)                | 8,974 to 10,774  |      119.8 |      119.8 | -                                               |       0 |                  - |             151.2 |
| Fix   | inspector following A live (from about 10,000 events) | 10,891 to 14,129 |      107.9 |      107.8 | 59 / 59 / 59 / 0                                |     5.9 |                9.9 |             149.1 |
| Fix   | inspector closed                                      | 14,181 to 16,061 |      125.1 |      125.1 | -                                               |       0 |                  - |             150.5 |

Following live at about 5,000 and about 10,000 events, the base build cut both runs to 7.4 and 1.4 events/s; with the fix they kept 111.3 and 107.9 events/s against 124.9 and 119.8 without an inspector on the same gateway. The fix's inspector issued one read of each read model per refresh, 59 per 30 s (one refresh every 508 ms on average), and no `thread?at` read; the base issued 22.8 reads/s at about 5,000 events, 182 of them `thread?at`. The neighbouring run B tracked A in every phase, in both builds. The roughly 10% lower rate while following on the fix (also within the spread between no-inspector samples) includes the inspector's SSE stream and Edge rendering on the same host. API private memory stayed at 144 to 151 MiB with the fix; the base build's rose to 294 MiB while its replays ran, and its gateway was still draining queued replays after the tab closed (6.5 events/s in "inspector closed").

### Longer histories (`throughput.mjs`)

The base rows ran the whole base build (`pnpm build` at `ba89f0a`, before any change); the fix rows ran the final build of this branch.

| Build | Phase                                       | A's events       | A events/s | B events/s | Reads: run / observation / thread / `thread?at` | Reads/s | Page JS heap (MiB) | API private (MiB) |
| ----- | ------------------------------------------- | ---------------- | ---------: | ---------: | ----------------------------------------------- | ------: | -----------------: | ----------------: |
| Base  | no inspector (~5,000 events)                | 4,536 to 7,536   |       99.9 |       99.9 | -                                               |       0 |                  - |               143 |
| Base  | inspector following A live (~5,000 events)  | 7,800 to 8,044   |          4 |          4 | 209 / 209 / 209 / 204                           |   13.79 |               9.87 |             295.7 |
| Base  | no inspector (~10,000 events)               | 9,584 to 12,629  |      101.1 |      101.1 | -                                               |       0 |                  - |               296 |
| Base  | inspector following A live (~10,000 events) | 12,826 to 12,919 |        1.5 |        1.5 | 127 / 127 / 127 / 112                           |    8.17 |               9.48 |             304.7 |
| Base  | inspector in history mode (Load older)      | 12,924 to 15,071 |       71.5 |       71.5 | 231 / 231 / 231 / 0                             |   22.98 |              10.33 |             305.1 |
| Base  | inspector closed                            | 15,291 to 18,311 |      100.4 |      100.4 | -                                               |       0 |                  - |             305.7 |
| Fix   | no inspector (~5,000 events)                | 4,536 to 7,669   |      104.2 |      104.2 | -                                               |       0 |                  - |             148.6 |
| Fix   | inspector following A live (~5,000 events)  | 8,091 to 13,467  |       89.6 |       89.5 | 119 / 119 / 119 / 0                             |    5.95 |               9.77 |             145.7 |
| Fix   | no inspector (~10,000 events)               | 13,516 to 16,696 |      105.9 |      105.9 | -                                               |       0 |                  - |             150.1 |
| Fix   | inspector following A live (~10,000 events) | 16,832 to 23,789 |      115.9 |      115.9 | 119 / 119 / 119 / 0                             |    5.95 |               9.83 |             157.5 |
| Fix   | inspector in history mode (Load older)      | 23,846 to 27,491 |      121.4 |      121.4 | 60 / 60 / 60 / 0                                |    5.99 |              10.09 |             160.1 |
| Fix   | inspector closed                            | 27,536 to 31,084 |      118.2 |      118.1 | -                                               |       0 |                  - |               163 |

The first pair, with 30 to 60 s phases, reproduces the acceptance probe `p186-compare` at longer histories. The phase names give the length at which the script started waiting; the "A's events" column shows the actual range: the fix followed run A from 8,091 to 13,467 and from 16,832 to 23,789 events at 89.6 and 115.9 events/s, with 119 reads of each read model per 60 s and no `thread?at` read. In history mode (Load older) the base still issued 23 reads/s because every batch refreshed all three read models; the fix issued 6 reads/s.

## Gates

All with Node v22.23.4 from the project-scoped runtime (`environment.log.txt`), from the worktree root, on the final code (commits `5665a0a0`, `12b22dbe`).

| Gate                                                                                                           | Result                                                                                                                                                                         | Log                       |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| `pnpm build`                                                                                                   | passed, 11 of 11 tasks                                                                                                                                                         | `build.log.txt`           |
| `pnpm typecheck`                                                                                               | passed, 20 of 20 tasks                                                                                                                                                         | `gate-typecheck.log.txt`  |
| `pnpm lint`                                                                                                    | passed, 11 of 11 tasks                                                                                                                                                         | `gate-lint.log.txt`       |
| `pnpm check:layers`                                                                                            | `Layer rules: OK`                                                                                                                                                              | `gate-layers.log.txt`     |
| `pnpm check:deps`                                                                                              | passed: 0 errors, 2 warnings, both pre-existing `no-orphans` on files this fix does not touch (`packages/infrastructure/drizzle.config.ts`, `apps/web/e2e/shutdown.config.ts`) | `gate-deps.log.txt`       |
| `pnpm format:check`                                                                                            | all files formatted (rerun after this record was written)                                                                                                                      | `gate-format.log.txt`     |
| `pnpm check:tokens`                                                                                            | `Design tokens: OK (177 files checked)`                                                                                                                                        | `gate-tokens.log.txt`     |
| `pnpm docs:generate`                                                                                           | regenerated `docs/reference/nodes.md` and `api.md` with no diff (no route or schema change)                                                                                    | `gate-docsgen.log.txt`    |
| `pnpm --filter @graphgoblin/domain test:coverage`                                                              | 25 files, 328 tests passed; lines 99.4%, branches 97.66%                                                                                                                       | `gate-cov-domain.log.txt` |
| `pnpm --filter @graphgoblin/web test:coverage`                                                                 | 148 files, 1,776 tests passed; lines 98.93%, branches 94.84%; `live-refresh.ts` and `useLiveRefresh.ts` 100% lines and branches, `RunInspectorPage.tsx` 97.82% / 96.9%         | `gate-cov-web.log.txt`    |
| Edge browser suite, `GG_E2E_MAIN_PORT=6511 GG_E2E_CONTROL_PORT=6512 pnpm exec playwright test` from `apps/web` | 422 passed, 1 skipped (`live.spec.ts`, needs a live provider), 0 failed, zero retries, one worker, 28.2 min                                                                    | `e2e-full.log.txt`        |

The browser suite includes the specs the brief names: `thread-history.spec.ts` (open and reloaded inspectors through failure, outage, resume and success), `bounded-history.spec.ts` (bounded Timeline, keyboard browsing, exact threads, reload, Follow live), `live-follow.spec.ts` (on the final build: 10 reads of each read model in a 5,018 ms window while the run advanced from event 142 to 854, no `thread?at` read), and the other live-follow coverage: `qa.spec.ts` "streams 1,200 harness items into the inspector" (7 run-record reads while 1,214 events streamed, against one per 100 ms batch before), `inspector-large-values.spec.ts` (selected completions' patch diffs and exact values) and `replay-seed.spec.ts`. The six claude-harness and model-picker failures COMMON.md lists as known on main did not occur in this run. No test needed a rerun.

The API, engine, infrastructure, api-client and MCP packages are unchanged, so their suites were not rerun; the server half of the live bound (the current-thread read decodes only the checkpoint boundary and its tail) is covered by the existing engine `thread-read.test.ts`.

## Limits and follow-ups

- **Visible change.** While following live, the thread panel always shows the current thread. Round 2 showed a default-selected completion's historical thread and patch diff; the reader now selects the completion to see them. This is the behaviour change for review and behaviour QA.
- **Selected reads are unchanged.** `thread?at=N` and `N-1` for a selected event still replay the history before the boundary from the latest checkpoint at or before it (from the seed once the executor has checkpointed past it), about 1 s at 10,000 events per the acceptance record. They are user-paced, two per selection.
- **Abandoned historical reads keep running.** The server finishes a historical replay after its client has gone: the base build's gateway ran at 6.5 events/s for 15 s after the tab closed. With the fix the live path issues none, but rapid selection changes on a long run can still queue abandoned replays. Stopping the replay between pages when the request closes, or retained stride checkpoints for history mode, would bound that; both are outside this fix.
- **Evidence types are mirrored.** `OBSERVATION_EVENT_TYPES` in the web app mirrors the event types `GET /runs/{id}/observation` reads (apps/api `routes/runs.ts`); a new observation field needs a matching entry. `THREAD_EVENT_TYPES` lives beside `replayThread` with a completeness test.
- **Shared host.** Rates of the same build varied between samples: the fix's unobserved samples ranged from 104.2 to 125.1 events/s. While followed, the fix's run kept 111.3 and 107.9 events/s against 119.8 to 125.1 unobserved in the aligned pair, and 89.6 and 115.9 against 104.2 to 118.2 in the longer pair; the inspector's SSE stream and Edge ran on the same machine as the gateway.

## Files

- `lib.mjs`, `throughput.mjs`, `throughput-at.mjs`: measurement harness and scripts; `redact.mjs` replaces the profile path and machine name in this folder.
- `throughput-*.json`, `throughput-*.log.txt`: per-phase results and logs.
- `regression-web-before.log.txt`, `regression-web-after.log.txt`, `e2e-live-follow-before.log.txt`, `e2e-live-follow-after.log.txt`: regression tests before and after. `e2e-live-follow-after.log.txt` ran on the candidate build before a final cleanup in `useLiveRefresh.ts` that removed a redundant identity check from the effect cleanup; `e2e-full.log.txt` includes the same spec on the final build.
- `gate-*.log.txt`, `e2e-full.log.txt`: gate logs.
- `build.log.txt`, `environment.log.txt` and the gate logs named in "Gates".

Every capture is under 1,000,000 bytes, so nothing was dropped and there is no `NOT-KEPT.md`.
