# WP-F2b round 5: merge resolution and verification (#204)

## 1. Branch and worktree

- Branch: `codex-wp-f2b-harness-switch` (PR #378).
- Worktree: `.claude/worktrees/codex-wp-f2b-harness-switch` under the GraphGoblin checkout.
- Starting HEAD: `492b283b49747e91470d94dca7028caa4eeb6c3d`.
- Merge parent: `e41008dbbaaa65e4e702226e39909fb0718ecba6` (`main`).
- Uncommitted; resolution prepared for orchestrator staging and commit. The four paths remain unmerged in the index because no staging or merge-finalization command was run.

## 2. Per bolt

For #204, the merge preserves explicit compatible selection, inherited unset values, loop-before-Settings defaults, disabled-default handling, first-load waiting, failed-lookup retention, cancellation, undo, saved values and adapter-request agreement. The existing web/API suites passed, and the committed served script passed **27 behavioral cases plus its environment check**, in one full invocation on port **5670**. There were no failed served cases.

The served cases include `B2-loop-sibling`, `B1-no-wait`, `B3-first-load`, `no-extra-lookups`, `cached-catalog-failure`, `B1-all-failed`, `pending-prompt-edit`, `undo-persistence`, `restart`, `recipe-ui` and `B2-disabled-loop-and-settings`. See [all verdicts and observed values](served-results.json), [execution parameters](served-execution.json) and [stdout](served.log.txt).

F1's shared readiness/query files and Claude probe implementation match the merge parent's contents exactly (normalized line endings): [comparison](f1-preservation.json). Thus the final sign-out-on-exit-zero and ranked diagnostic implementation is retained; no readiness vocabulary or adapter behavior was changed by this resolution.

## 3. Files changed

Every shared-file resolution is listed below. Line ranges refer to the resolved files.

| File                                        | Lines           | Resolution                                                                                                                                                                                                                                                                                   |
| ------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/editor/ClaudePolicyField.tsx` | 5; 28-39; 53-54 | Kept `HarnessReadiness`, the stable parent `usePreflight()` observer and typed child prop from #204. Dropped main's duplicate child observer declaration, which would shadow the prop and restore switch-remount probes. F1's shared readiness calculation, policy checks and labels remain. |
| `apps/web/src/forms/fields/model.tsx`       | 15-20; 29-80    | Kept `keys` and `HarnessPreflightItem`: the switch uses them for action-time cache reads and its disabled observer. Retained the existing shared readiness and picker behavior. No refetch or fallback path was added.                                                                       |
| `docs/06-harness-integration.md`            | 98-143; 458-466 | Took main's trigger-start wording, replay exception, explicit sign-out text and diagnostic-evidence wording in all five hunks. Kept #204's short switch-rule cross-reference exactly once.                                                                                                   |
| `docs/09-frontend-and-pwa.md`               | 246; 626-727    | Preserved main's replay-seed and readiness text, and retained the full `Explicit node harness changes (#204)` section at 682-727. Neither description was discarded or duplicated.                                                                                                           |
| `CHANGELOG.md`                              | 16              | Root formatting removed one duplicate blank line in the already-staged union. No bullet wording changed.                                                                                                                                                                                     |
| `docs/qa/2026-10-22-wp-f2b-round-5/`        | New evidence    | This report, logs, aggregate coverage, served results/lifecycle and preservation metadata.                                                                                                                                                                                                   |

The protected `docs/qa/2026-10-22-wp-f2b-qa/` directory, including its served script, is byte-identical to the pre-format snapshot: **71 files unchanged**, with no additions or removals. See [protection record](protection.json). No F2a catalog membership, model efforts, policy source or engine inference path was edited.

## 4. Tests

No tests were added or edited: this round resolves conflicts in existing behavior. A new regression's pre-fix failure is therefore not applicable.

| Package | Test result                                       | Lines              | Branches           | Statements | Functions |
| ------- | ------------------------------------------------- | ------------------ | ------------------ | ---------- | --------- |
| Web     | 1,555 passed; 123 files                           | 98.93% (7090/7166) | 94.90% (7295/7687) | 98.02%     | 98.51%    |
| API     | 750 passed, 6 skipped; 55 passed files, 2 skipped | 97.93% (1804/1842) | 93.13% (1288/1383) | 96.49%     | 94.25%    |

Both packages exceed 90% lines and branches with unchanged thresholds. Coverage ran directly for each package, sequentially; web used the requested `--maxWorkers=1`. Neither suite failed or was rerun. API skips are the opt-in live/performance suites and platform-guarded native-process cases; no live-provider turns were enabled.

Coverage includes both web `harness-switch.test.tsx` files, the policy/readiness components, API `harness-switch.test.ts`, `model-readiness.test.ts`, `nested-readiness.test.ts` and `readiness-evidence.test.ts`. See [web log](web-coverage.log.txt), [API log](api-coverage.log.txt), [web coverage](web-coverage-summary.json) and [API coverage](api-coverage-summary.json).

The served replay used Node **v22.14.0**, Edge **155.0.4283.62**, and the fixture CLIs. Its two API process exits were observed: [lifecycle](served-lifecycle.json). `served-api-last.log.txt` is the last server instance's log, not a concatenation of both instances.

## 5. Gates

All commands ran in PowerShell with Node 22 first on PATH. [Recorded commands, exits and durations](gates.json) preserve the original results.

| Command                                                           | Result                                                                                                                         |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `git diff --check`                                                | Passed after resolution and at closeout; final marker scan found no conflict markers.                                          |
| `pnpm.cmd format`                                                 | Passed; only additional tracked formatting change was the CHANGELOG blank line.                                                |
| `pnpm.cmd typecheck`                                              | Passed, 20 tasks.                                                                                                              |
| `pnpm.cmd lint`                                                   | Passed, 11 tasks.                                                                                                              |
| `pnpm.cmd check:docs`                                             | Passed.                                                                                                                        |
| `pnpm.cmd format:check` (first verification)                      | **Failed**, exit 1: the newly written `resolution.json` needed formatting. This failure is retained in `format-check.log.txt`. |
| `pnpm.cmd exec prettier --write` (new evidence JSON)              | Passed; corrected the evidence formatting.                                                                                     |
| `pnpm.cmd check:tokens`                                           | Passed.                                                                                                                        |
| `pnpm.cmd check:layers`                                           | Passed.                                                                                                                        |
| `pnpm.cmd check:deps`                                             | Passed.                                                                                                                        |
| `pnpm.cmd build`                                                  | Passed, 11 tasks.                                                                                                              |
| `pnpm.cmd --filter @graphgoblin/web test:coverage --maxWorkers=1` | Passed.                                                                                                                        |
| `pnpm.cmd --filter @graphgoblin/api test:coverage`                | Passed.                                                                                                                        |
| Committed served check with the requested overrides               | Passed, exit 0; 27 cases plus environment, no rerun.                                                                           |
| `pnpm.cmd format:check` (final verification)                      | **Passed**, exit 0; see `format-check-final.log.txt`.                                                                          |

The full served invocation was `node docs/qa/2026-10-22-wp-f2b-qa/round-3/served-checks.mjs`, with `QA_PORT=5670`, `QA_OUTPUT_DIR=docs/qa/2026-10-22-wp-f2b-round-5`, `QA_TEMP_PREFIX=gg-wp-f2b-r5-served-` and `QA_ONLY` unset. Port 5670 was free before startup.

The aggregate gate runner returned 1 because it preserves the first format-check failure; web and API coverage each exited 0. Turbo emitted Windows cache-access warnings during successful commands; these are retained in the logs.

## 6. Docs

Docs 06 keeps main's **manual trigger start** wording and explains that replay does not perform that admission preflight: it can return 202, execute earlier mutations and then fail at the unready harness. Its sign-out and ranked-evidence wording is also retained.

Docs 09 keeps main's text and the full authoring rule: unset values inherit, explicit selections resolve **loop default, Settings default, then ecosystem default**, first-time in-flight lookups are awaited, failed checks retain authored values, and catalog failures hold publication with **Validation unavailable**. Runtime model resolution remains unchanged.

The union CHANGELOG retains #204's existing upgrade instruction: rebuild API and web together with the regenerated client for `ecosystemDefault`; no store migration or reset. No new ADR, contract, generated reference or README change was needed for conflict resolution. Generated-doc verification passed.

## 7. Decisions and parameters

- Preserve both implementations through the shared readiness interface; do not reintroduce an observer in the remounting policy child.
- Preserve main's precise trigger-start/replay distinction and retain one full switch description in docs 09 with the short docs 06 reference.
- Use the committed collector unchanged, once, with the exact requested overrides. Standalone Playwright specs were not rerun in this round; the served replay runs Edge.
- Evidence edits remove local paths and terminal color codes only. Test counts, case verdicts, request counts, timings and process-exit observations are retained. Coverage JSON contains aggregate totals; raw per-file reports remain in package coverage directories.

## 8. Caveats and open items

No product, unit-test, coverage or served-replay failure was observed. The evidence-only formatting failure above remains recorded and must not be represented as an initial pass.

The orchestrator must stage the four resolved paths, the CHANGELOG whitespace change and the new evidence, then create the merge commit. This run did not stage, commit, merge, abort, reset, checkout, stash, rebase or push. Independent QA of the resulting committed merge remains the orchestrator's next step; this report is not independent sign-off.

Under COMMON's no-directory-deletion rule, these disposable roots remain for orchestrator cleanup:

- `%TEMP%/gg-wp-f2b-r5-5af44eddefb94710bc7626d42501f526` (gate logs, test scratch and protected-file snapshot).
- `%TEMP%/gg-wp-f2b-r5-served-Zvdutn` (served fixture binaries and store; API processes exited).

The owner's app/store was not used, no live-provider turns ran, and no external dependencies or links were created.
