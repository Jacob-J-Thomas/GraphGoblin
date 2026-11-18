# #466 probe-test lifecycle: implementation evidence (Claude Opus 5.5 implementer)

Base `6d7fcc9838d831fe1be3c3cf52c90a2f33e8f5b1`, branch `codex/gg-20261117-probe-466`, uncommitted
candidate (see `candidate.diff`, `candidate-status.txt`). Windows 11, Node v22.23.4 (project runtime),
pnpm 12.8.1, Vitest 5.0.3. No real Codex provider/model call was made by any added or scratch case;
the fixture CLI is the repository-owned `packages/adapter-codex/src/fixtures/readiness-cli.mjs`.
The unchanged adapter suite's pre-existing "probes the actual installed SDK CLI without a model
turn" case ran inside the adapter coverage gate (08); it runs no prompt, session or model request.

## Retained earlier observation (not produced here)

`C:/Users/98jak/graphgoblin-qa/2026-11-10-launcher-recovery/check.log` (SHA-256
`7dd4b2551789b8117f857ae8ac57ce7572331b3e2c329d71bed827f321ffe5d9`) lines 720-725: the long-path case
failed at 5058 ms and the following collision case at 5079 ms on Windows; its failure detail is not
retained in that log. A root from that run, `%TEMP%\gg-codex-collision-ICON6s` (created
2026-11-10T23:34:58Z), still exists and was left untouched.

## Order of work and results (first attempts unless labelled)

| File                                                 | What                                                                                                          | Result                                                                                               |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 00-install.log                                       | `pnpm install --frozen-lockfile`                                                                              | exit 0                                                                                               |
| 01-baseline-focused.log                              | base file, focused                                                                                            | 4/4, exit 0                                                                                          |
| 02-red-old-lifecycle-regressions.log                 | negative control v1: old lifecycle substituted into the first version of the lifecycle regressions            | 2 failed by 5000 ms timeout, 5 passed, exit 1                                                        |
| 03-red-old-lifecycle-regressions-v2.log              | negative control v2 after restructuring the regressions to assert state at case finish (second control run)   | 2 failed by assertion, 5 passed, exit 1                                                              |
| 04-ab-old-lifecycle.log + 04-ab-old-observation.json | real Vitest runner: A times out (1000 ms, hang at `login status`), B checks for A's late calls; OLD lifecycle | A x, B x; B saw A's late rm calls, its TEMP stubs wiped, A's fake CLI pid 37272 running at B's start |
| 05-ab-new-lifecycle.log + 05-ab-new-observation.json | same A/B, corrected lifecycle                                                                                 | A x (timeout + reported late failure), B passed: A settled, 0 running, 0 ms wait, no late calls      |
| 06-green-focused.log                                 | final candidate, focused                                                                                      | 7/7, exit 0                                                                                          |
| 07-stability-sample.log                              | 5 additional sequential runs (not retries)                                                                    | 5 x 7/7, exit 0                                                                                      |
| 08-adapter-coverage.log                              | `pnpm test:coverage --filter=@graphgoblin/adapter-codex`                                                      | 645 passed / 4 skipped (live.test.ts), stmts 98.3, branches 95.61, funcs 99.32, lines 99.42; exit 0  |
| 09-typecheck.log                                     | `pnpm typecheck --filter=@graphgoblin/adapter-codex`                                                          | 4 tasks, exit 0                                                                                      |
| 10-lint.log                                          | `pnpm lint --filter=@graphgoblin/adapter-codex`                                                               | exit 0                                                                                               |
| 11-format-check.log                                  | `pnpm format:check` (sparse checkout; historical QA packets omitted)                                          | exit 0                                                                                               |
| 12-, 14-                                             | leftovers from the old-lifecycle controls and suite runs, inspected then removed by exact path                | 6 removed, 2 foreign left                                                                            |
| 13-platform-cli-hang-observation.txt                 | unchanged `cli.test.ts` hang case (identical to base) leaves a `gg-codex-probe-*` in real %TEMP% on Windows   | platform/product observation, not this change                                                        |

`*-surviving-processes.txt`: no `readiness-cli.mjs` process from this worktree after any run. On
Windows libuv puts non-detached children in a kill-on-close job object, so a worker exit also ends a
leaked child; the in-test assertions at case finish are the meaningful evidence, not the post-run
listing.

`controls/`: the control generator (`make-old-lifecycle-control.mjs`), control and A/B scratch
sources (`*.ts.txt`, never left in the worktree), their diffs, PowerShell helpers, and
`post-control-edits.diff` showing that edits after the controls were comment-only.
`vitest-runner-facts.txt`: installed runner behaviour the design depends on.

## Publication and limits

Root independently verified all 41 original manifest entries. The [publication manifest](publication-manifest.json) binds raw records to their original paths and hashes. The original report remains byte-preserved as [README.md.txt](README.md.txt); this readable report corrects its description of the sparse checkout, which retained the tracked contrast fixture. [Provider receipt](provider-receipt.json) records the actual Claude implementation model and completion without private provider streams. Separate independent behavior QA, opposite-family formal review, current-head CI and final audit remain pending; #503 is not waived.
