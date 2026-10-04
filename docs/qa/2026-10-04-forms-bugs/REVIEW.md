# PR #52 review follow-up

The worktree started clean at `0fb98fe903b9e42aecc2b72d36ddb0b8643a4ef6` on `codex-i51-forms`. Only the three requested review fixes were applied, with no commit or index action.

## Changes and regression evidence

- **Focus order:** the record Remove button now precedes the value wrapper in the DOM. Explicit grid placement keeps the visual layout unchanged. Tab follows key, Remove, value; Shift+Tab returns from value to Remove. Two new unit cases (string and JSON records) failed on the original DOM order. The updated Edge assertion also failed in dark and light before the fix, then passed with the DOM reordered.
- **Subscriptions:** leaf fields, objects, and unions use only `useController`. Arrays and records use `useCollectionField`, which reads `getValues(name)` only inside actions. Add, Remove, enum toggles, record key/value edits, and entry creation use that live collection. There is no additional `useWatch` subscription. The original script-args and nested decision-route data-loss tests pass; temporarily replacing the live getter with the controller's cached value made both fail again. The correct getter was restored in a `finally` block before verification and rebuilding.
- **Docs:** guide 02 states only that empty optional expressions count as absent with no preview, while whitespace counts as supplied. Docs/09 explicitly says unparsed JSON is retained per row and may sit on a different row after removal, a known limitation tracked separately.

## Edge typing measurements

`review-typing.mjs` starts the existing E2E server on an ephemeral port with its temporary data directory, drives the built app in headless Edge 154.0.4258.53, and stops the browser and server in `finally`. It uses identical fixtures before and after, a 1440 × 900 viewport, no CPU throttling, and 60 native keystrokes per round, two rounds per form. Timing includes Playwright input delivery and completion through two animation frames. Each round verifies that every character reached the field. No repository gates ran during the reported typing samples.

The inference fixture has 109 set mutations, 457 `data-field` groups, and 448 native/CodeMirror controls; its target is Model. The decision fixture has 64 routes, 203 groups, and 135 controls; its target is the first route Description. The reviewer did not provide the exact benchmark fixture or timing method, so the direct comparison below uses this reproducible local fixture.

| Form                  | Before round 1 | Before round 2 | Before mean | Final round 1 | Final round 2 | Final mean |
| --------------------- | -------------: | -------------: | ----------: | ------------: | ------------: | ---------: |
| Inference, 457 groups |          37.56 |          35.95 |       36.75 |         35.27 |         31.00 |      33.13 |
| Decision, 64 routes   |          22.33 |          17.71 |       20.02 |         17.00 |         15.30 |      16.15 |

All values are milliseconds per character. Both final means are below the reviewer's approximate main measurements of 35ms and 18ms. Local mean latency fell about 10% and 19%, respectively. These are short desktop measurements, with visible variation between rounds; they are not a portable performance threshold or a statistical guarantee. The reported before samples had no long tasks; the final inference first round had one Long Tasks API entry with a rounded duration of 50ms, and the other final rounds had none.

The initially tried structural-only watcher approach measured inference at 35.09/40.08ms and decision at 17.98/18.49ms per character. Since it did not clearly improve the inference mean, the final implementation uses the reviewer's alternative of reading collections inside handlers. [Trial results](review-typing-structural-trial.json) are retained; an initial baseline run made concurrently with the failing Edge focus check was replaced by the serialized baseline reported here.

Raw samples: [Before](review-typing-before.json), [Final](review-typing-after.json). Reproduce after a build:

```powershell
node docs/qa/2026-10-04-forms-bugs/review-typing.mjs before
node docs/qa/2026-10-04-forms-bugs/review-typing.mjs after
```

Each mode measures whichever production build is currently in this worktree; it does not change source or select a branch. The supplied before artifact was taken before the follow-up production edits.

## Final gates

All requested gates passed on the final code:

| Command                                              | Result                                                      |
| ---------------------------------------------------- | ----------------------------------------------------------- |
| `pnpm.cmd typecheck`                                 | Pass, all 20 tasks                                          |
| `pnpm.cmd lint`                                      | Pass, all 11 tasks                                          |
| `pnpm.cmd format:check`                              | Pass                                                        |
| `pnpm.cmd --filter @graphgoblin/web test:coverage`   | Pass, 190 tests in 31 files                                 |
| `pnpm.cmd check:layers`                              | Pass                                                        |
| `pnpm.cmd check:tokens`                              | Pass                                                        |
| `pnpm.cmd check:contrast`                            | Pass, zero failing enforced pairs                           |
| `pnpm.cmd check:licenses`                            | Pass                                                        |
| `pnpm.cmd check:docs`                                | Pass, generated references up to date                       |
| `pnpm.cmd build`                                     | Pass, all 11 tasks                                          |
| `pnpm.cmd --filter @graphgoblin/web test:e2e`        | Pass, 26 passed, one existing live test skipped; 59 seconds |
| `check:deps` with the prescribed Node 22.14.0 binary | Pass, exit 0                                                |

Web coverage: **statements 98.50% (1974/2004), branches 94.07% (1396/1484), functions 98.71% (694/703), lines 99.42% (1727/1737)**. No coverage thresholds or exclusions changed. The final E2E command adds only an `--output` path under the temporary directory, avoiding transient trace resources in lint's source scan. All test servers completed teardown. Turbo emitted a nonfatal cache access warning; the requested tasks themselves passed.

The follow-up changed `fields/shared.tsx`, `fields/structure.tsx`, `SchemaForm.test.tsx`, `e2e/forms.spec.ts`, docs/09, guide 02, and QA documentation/artifacts. The initial screenshots and the JSON editor/preview implementation were not modified.

## Scope and review limits

Indexed parse-error paths after removal/rename, duplicate-key row merging, focus after Add/Remove, whitespace-only optional expressions, and Loop-tab conflict reload behavior were not changed. The existing live Codex E2E is skipped without `LIVE=1`; this work uses the project's isolated test API. No owner server or owner data directory was used. Existing screenshots remain representative because only DOM focus order changed, not grid placement. The concurrent node dialog still needs its integration check after the orchestrator combines the worktrees.
