# Round-2 changed files and line ranges

New-side line ranges against 12a96af9. Deletion-only hunks use their adjacent line.
Round-2 captures and helpers are indexed separately in ARTIFACTS.json.

## Root

| File           | Lines |
| -------------- | ----- |
| `CHANGELOG.md` | 7     |

## apps/api

| File                                       | Lines                      |
| ------------------------------------------ | -------------------------- |
| `apps/api/src/structured-deadline.test.ts` | 129, 138, 147-154, 243-250 |

## apps/web

| File                                                          | Lines |
| ------------------------------------------------------------- | ----- |
| `apps/web/src/editor/LoopSettingsPanel.tsx`                   | 75-77 |
| `apps/web/src/settings/sections/ExecutionDefaultsSection.tsx` | 14-18 |

## Documentation and record

| File                                                         | Lines                                 |
| ------------------------------------------------------------ | ------------------------------------- |
| `docs/05-execution-engine.md`                                | 552-553, 555, 557-559                 |
| `docs/07-api-and-streaming.md`                               | 74, 84-92                             |
| `docs/decisions/ADR-0051-structured-completion-deadlines.md` | 3-4, 6, 26, 36-37                     |
| `docs/guide/02-build-a-loop.md`                              | 102-109, 389-395                      |
| `docs/guide/06-settings-and-secrets.md`                      | 327-334                               |
| `docs/qa/2026-10-23-wp-f3-270/ARTIFACTS.json`                | 2, 239-240                            |
| `docs/qa/2026-10-23-wp-f3-270/REPORT.md`                     | 8-13, 17, 29, 45-58, 155-156, 196-209 |

## packages/adapter-codex

| File                                            | Lines                                    |
| ----------------------------------------------- | ---------------------------------------- |
| `packages/adapter-codex/src/structured.test.ts` | 2-4, 136, 138-143, 146-154, 173, 175-191 |

## packages/api-client

| File                                          | Lines                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/api-client/openapi.json`            | 320-321, 326, 333-334, 339, 346, 352, 4684-4685, 4690, 4697-4698, 4703, 4710, 4716, 5788-5789, 5794, 5801-5802, 5807, 5814, 5820, 9054-9055, 9060, 9067-9068, 9073, 9080, 9086, 9102, 9105, 13561-13562, 13567, 13574-13575, 13580, 13587, 13593, 13601, 13603-13604, 14676-14677, 14682, 14689-14690, 14695, 14702, 14708, 14716, 14718-14719 |
| `packages/api-client/src/generated/schema.ts` | 2561, 2566-2567, 3710, 3715-3716, 3966, 3971-3972, 4659, 4664-4665, 5793, 5798-5799, 6049, 6054-6055                                                                                                                                                                                                                                           |

## packages/contracts

| File                                                        | Lines     |
| ----------------------------------------------------------- | --------- |
| `packages/contracts/src/__golden__/export-every-field.json` | 21, 24    |
| `packages/contracts/src/__golden__/loop-every-field.json`   | 17, 20    |
| `packages/contracts/src/__golden__/loop-kitchen-sink.json`  | 17, 20    |
| `packages/contracts/src/__golden__/loop-minimal.json`       | 10, 13    |
| `packages/contracts/src/loop.ts`                            | 19, 46-58 |

## packages/domain

| File                                                                      | Lines                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/domain/src/__golden__/export-every-field.json`                  | 24                                                                                                                                                                                                                            |
| `packages/domain/src/__golden__/export-kitchen-sink.json`                 | 24                                                                                                                                                                                                                            |
| `packages/domain/src/__snapshots__/upgrade-composed.test.ts.snap`         | 67, 142, 217, 393                                                                                                                                                                                                             |
| `packages/domain/src/convert-v3-v4/__snapshots__/conversion.test.ts.snap` | 371, 1000, 1169, 1493, 2152, 2279, 2463, 2647, 3074, 3442, 3773, 3951, 4079, 5270, 6551, 7569, 7737, 8366, 8979, 9578, 9896, 10485, 11059, 11608, 11813, 12008, 12165, 12366, 12558, 12713, 12897, 13217, 13557, 13897, 14674 |

## packages/engine

| File                                              | Lines                                            |
| ------------------------------------------------- | ------------------------------------------------ |
| `packages/engine/src/completion-deadline.test.ts` | 1-36                                             |
| `packages/engine/src/completion-deadline.ts`      | 1, 8, 14, 50, 55, 57, 65, 69-71                  |
| `packages/engine/src/primitive-evaluator.test.ts` | 20-21                                            |
| `packages/engine/src/primitive-evaluator.ts`      | 21-22, 318, 320, 324-331                         |
| `packages/engine/src/structured-deadline.test.ts` | 181-244, 245, 247-255, 260-264, 266-267, 312-315 |

## Shared-file scope

- docs/07: pinned-limits section only (74 and 84-92); WP-D4 Event routes and WP-E1 stream sections untouched.
- guide 02: settings table (102-109) and limits guidance (389-395); WP-F2b editor/model work untouched.
- guide 06: visible-limits guidance (327-334), additive.
- docs/05: structured-completion section only (552-559); shutdown, admission and thread reconciliation unchanged.
- No round-2 container or RunManager edit. Generated client edits only reorder the existing limit fields.
