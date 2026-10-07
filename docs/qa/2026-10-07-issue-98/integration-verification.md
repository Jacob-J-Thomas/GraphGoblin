# Issue 98 integration verification — 2026-10-07

This child targets `codex/aidlc-foundations`, based on `2f98219fb43620b56d6ae4473db85a35f34d1d16`. GPT-6.1 Sol implemented contracts, execution, API and offline conversion; GPT-6 Luna implemented the editor and inspector. The parent orchestrator reviewed the integration, reproduced and verified peer findings, and ran the repository and browser gates. Opus implementation review and the normal GitHub Codex review are recorded against immutable commits in the PR. This document does not substitute for their results or the required owner review of the running product.

## Required gates

- Frozen install and final `pnpm.cmd build`: passed (11 build tasks).
- `pnpm.cmd typecheck`: passed (20 tasks); `pnpm.cmd lint`: passed (11 tasks). The final browser-fixture-only changes also receive the focused web checks.
- `pnpm.cmd exec turbo run test:coverage --concurrency=1`: passed, all 12 package tasks, 2,534 tests including the 47 tooling assertions; 11 intentional live-test skips. Eight unchanged package results came from this worktree's earlier successful cache entries.
- Layers, dependency graph (using Node 22), design tokens, licence allowlist, generated docs, contrast table, formatting and whitespace checks: passed. The dependency graph reports one existing orphan warning. Audit at high severity passed; the existing moderate development-only esbuild advisory is tracked in [#114](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/114).
- `pnpm.cmd test:upgrade`: 8 passed, zero skipped, against built distribution entry points. It runs separately after build in CI; buildless unit tests do not invoke this acceptance file.
- The converted AIDLC example graph assertions passed all eight scenarios. Existing historical trial exports remain original evidence, not silently rewritten current inputs.
- One actual Codex Choice and one actual Jev Choice passed; see [core verification](core-verification.md) for exact selections and limits. Skipped live tests are not claimed as verified.

| Package        | Tests passed | Statements | Branches | Functions |  Lines |
| -------------- | -----------: | ---------: | -------: | --------: | -----: |
| contracts      |          131 |       100% |     100% |      100% |   100% |
| domain         |          253 |     96.80% |   93.32% |    96.17% | 98.14% |
| engine         |          355 |     97.78% |   93.65% |    97.17% | 98.79% |
| infrastructure |          182 |     98.44% |   91.48% |    98.05% | 99.07% |
| adapter-codex  |           73 |     98.76% |   98.01% |    97.56% | 99.65% |
| adapter-jev    |           20 |     98.68% |   98.07% |      100% |   100% |
| api-client     |           45 |       100% |   99.30% |      100% |   100% |
| api            |          355 |     97.15% |   92.21% |    95.35% | 98.56% |
| mcp            |           29 |     93.86% |   95.30% |    92.94% | 95.23% |
| plugin-codex   |            9 |     95.52% |   95.45% |      100% | 95.23% |
| web            |        1,035 |     98.29% |   95.10% |    98.69% | 99.02% |

The first concurrent coverage run stopped on a native SQLite fixture cleanup timeout and exposed one stale classifier focus assertion. The file-backed test had completed its restore assertions, then Windows retained a database handle during recursive cleanup. Its complete disposable recovery fixture is now retained under ignored `.tmp`, with the same assertions and 45-second limit. The final one-package-at-a-time run passed; no threshold, coverage exclusion or timeout was relaxed.

## Browser verification

Headless installed Edge 154.0.4258.62 exercised the built app against the real API with isolated in-memory stores and scripted providers. The full 242-case run finished with 220 passed, 21 failed and one intentional LIVE skip. All 21 failures subsequently passed focused reruns after precise fixture and accessible-label corrections: an 18-case passing subset, the catalog/defaults case, and the final two-case delayed-focus/streaming batch. This is complete case coverage across the original run and its fix deltas, not a claim that a second full suite ran clean in one invocation.

Covered positive and negative behavior includes all three explicit evaluators, actual loopback classifier HTTP, disabled/missing selections, strict unknown-model and effort rejection, per-harness defaults, numeric display labels with stable IDs, keyboard access to eight ports, option removal/undo, save/reload, responsive dialogs and touch targets in both themes, ordinary script/inference port labels, subloop inspection, typed run failures and replay.

The final streaming scenario asserts all sequences 1–1,212, exactly 1,200 progress events, one session, one usage and one exit-evaluation event. Observed: 2,277 ms live completion with a scripted 1,500 ms turn, four live run fetches, 552 ms fresh open and 285 ms historical-event selection. Original routing benchmarks passed with median routing p95 of 1.6 ms for 100 nodes/200 edges and 3.5 ms for 300 nodes/600 edges.

Browser corrections preserved the behavioral assertions: keyboard activation for visually hidden radios, explicit expression authoring after switching evaluator kind, current strict admission and harness-scoped defaults, a disposable removable catalog row for testing a previously valid model disappearing, current error severity and accessible field names, and accessible event-button names rather than concatenated DOM text. Canvas and connection controls append a stable ID only when it differs from the label, keeping ordinary port names concise.

The original subloop stall did not recur once the test scripted its own child turn, and both subsequent checks passed. Its original cause was not conclusively established. This evidence does not claim a discovered production subloop defect.

## Offline conversion and preservation

See [runtime verification](runtime-verification.md) and the [upgrade guide](../../guide/08-offline-upgrade.md). Tests cover stopped-directory locking, native read-only inventory, old-format and nonterminal-run refusal, complete backup including an external database and actual committed WAL, stale/partial manifests, owner-reviewed ambiguous decisions and consumers, failed-run dispositions including subloop parents, rollback of DDL and data, exact restoration and a second approved upgrade.

Conversion preserves stable route IDs and unrelated user JSON, keeps original facts in an audit, and requires full replay/checkpoint agreement. Device-draft tests verify original raw export and preservation across active/aside conflicts, editing, reload and storage failure; failed preservation blocks autosave. No installed instance, original data directory, running service or live workspace was upgraded by this verification.

## Remaining delivery gates

The PR must record and triage the independent Opus review and normal `@Codex review`, then obtain the owner's running-product acceptance before merging into the feature branch. Use “Part of #98”; do not close the issue on an agent's behalf.

Issue 38 remains the actual human question/context session; this cutover preserves today's question/context behavior. Issue 33 is held behind that session, and issues 97/99, Claude support, GitHub triggers and templates are separate delivery slices. The final feature-to-main PR must remain unmerged.

## Review-fix delta, 2026-10-07

Codex review at `4689ba4` found that a database symlink could make a purported backup retain a reference to the database being upgraded. The fix refuses linked database/WAL/SHM paths and linked ancestors before backup or mutable SQLite access, checks physical backup-parent containment, and refuses linked data roots with actionable physical-path guidance. Ordinary non-database links remain preserved as links, without claiming their external content is snapshotted. Containment also rejects descendants whose names begin with two dots, such as `..backup`.

Fresh-checkout CI exposed missing `.tmp` parents in two native fixtures; both now create the parent before `mkdtemp`. Upgrade acceptance after the fix: 11 cases, 9 passed, 2 explicit Windows file-symlink permission skips, no failures. Portable directory-junction cases passed; Linux file-symlink checks remain for CI.

The decision dialog now displays Evaluation before Answer through a layout-only order hint. Its original schema/resolver and field paths remain unchanged. Focused keyboard/order/value-preservation checks, web typecheck and changed-file lint passed. Root inspected actual built-app screenshots at 1280 by 720 and 360 by 740: all three evaluator choices are visible on opening, and the narrow dialog remains within the viewport.

`pnpm.cmd exec vitest run --coverage --maxWorkers=2` in `apps/web` passed all 1,037 tests across 94 files: statements 98.31%, branches 95.09%, functions 98.75%, lines 99.03%. A prior concurrent run passed 1,036 cases and timed out in the existing inference undo/focus case; this bounded rerun passed with unchanged assertions and timeout. The latest full build passed all 11 tasks.

The focused Edge delta passed 16 of 17 cases. The remaining case completed the decision/run but exposed a pre-existing inspector refresh race: its timeline contained `run.finished succeeded` while the header retained an earlier `running` snapshot. Source comparison and the captured trace establish the event-before-status race predates this branch. It is deferred to [#116](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/116); the test remains unchanged and this run is not claimed fully green. Responsive, touch-target, eight-option keyboard, option-removal, evaluator-switch and form-control cases passed.

The first Opus implementation review exhausted its 80-turn limit without a verdict. It is incomplete, not approval. A bounded recovery review is required, and owner running-product acceptance remains pending.
