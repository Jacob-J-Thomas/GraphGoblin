# PR 484 current-head CI evidence

Captured 2026-11-15 UTC for [GraphGoblin PR #484](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/484). This external packet preserves the first and only current-head CI attempt. All four triggered CI jobs passed; this is CI evidence, not a review, merge, or owner-acceptance receipt.

## Exact tested source

- PR head: `08651317c485062eb90367e1df3f7632f8e1a6c7`
- Base `main`: `15ce9a1dd12e87b7f7cb5f853aaecf68d6188afd`
- Actions run: `43715831258`, run `879`, attempt `1`, `pull_request` event; completed `success` from `2026-11-15T12:49:52Z` through `2026-11-15T13:17:31Z`.
- GitHub synthetic merge checkout: `98d2bc2c473d3167a39ae966f9dfb9e2f00904fe`, tree `c5d6d7f505e52b5ccf07b4bcb791777761dc45df`; parents in order: base `15ce9a1dd12e87b7f7cb5f853aaecf68d6188afd`, then PR head `08651317c485062eb90367e1df3f7632f8e1a6c7`.
- All four complete raw job logs record checkout of `refs/remotes/pull/484/merge` and the exact synthetic merge SHA. See [tested checkout identity](job-metadata/tested-checkout-identity.json), [synthetic merge commit metadata](job-metadata/synthetic-merge-commit.json), [final run](job-metadata/run-final.json), and [final jobs](job-metadata/jobs-final.json).

## CI job results

| Job              | Result  | Observed outcome                                                                                                                                                                                                                     |
| ---------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Template image   | Success | Built the distributed image and loaded four installed templates in a container with network disabled and read-only filesystem: starter (4 draft nodes), implementation (11), review (10), and qa (11).                               |
| Windows launcher | Success | Node `v22.23.4`; native launcher acceptance passed 14/14 tests with 0 failures and 0 skips. The upload step itself succeeded, but Actions warned that no files matched `.tmp/windows-launcher-*/`; no Windows artifact was uploaded. |
| Gates            | Success | Build, acceptance steps, static gates, coverage, audit, and artifact upload all passed.                                                                                                                                              |
| Browser          | Success | Edge channel, Node `v22.23.4`; the functional browser suite ran with zero retries and one worker: 481 passed, 1 skipped (482 total) in 22.3 minutes.                                                                                 |

Turbo reported 12/12 standalone Build tasks successful with 0 cached. The combined coverage pipeline reported 22/22 tasks successful with 9 cached dependency-build tasks; 13 distinct coverage groups actually ran.

The full logs and step/job metadata are in [raw-logs](raw-logs/) and [job-metadata](job-metadata/). The only retained Actions artifact is the Gates `coverage` archive, [coverage.zip](artifacts/coverage.zip) (artifact ID `14163695356`, 21,946 bytes). Its SHA-256 is `f4b532ce0b6ac44ff3862b11a5cc1f9cc28b22edcec423d8c0d5c4ee83dbf981`, matching the Actions upload log. The Windows upload-step success does not represent an artifact; the final artifact list contains only `coverage`.

## V8 coverage results

The Gates log reports 13 workspace coverage groups. Their test counts and line/branch percentages are cross-checked against the 13 JSON summaries in the downloaded artifact; all four reported coverage metrics match for every group. The package and tooling line and branch floors are at least 90%.

| Workspace                     | Tests passed | Skipped |   Lines | Branches |
| ----------------------------- | -----------: | ------: | ------: | -------: |
| `@graphgoblin/contracts`      |          304 |       0 |  99.40% |   94.73% |
| `@graphgoblin/domain`         |          460 |       0 |  98.73% |   96.09% |
| `@graphgoblin/engine`         |        1,795 |       0 |  97.00% |   91.33% |
| `@graphgoblin/infrastructure` |        1,149 |       8 |  97.80% |   93.18% |
| `@graphgoblin/adapter-codex`  |          641 |       5 |  99.23% |   95.41% |
| `@graphgoblin/adapter-jev`    |           34 |       5 |  98.80% |   96.77% |
| `@graphgoblin/api`            |        1,937 |      20 |  95.78% |   90.61% |
| `@graphgoblin/api-client`     |          103 |       0 | 100.00% |   97.30% |
| `@graphgoblin/tooling`        |          175 |       2 |  96.89% |   91.67% |
| `@graphgoblin/web`            |        2,911 |       0 |  98.60% |   94.30% |
| `@graphgoblin/mcp`            |           62 |       0 |  96.95% |   94.23% |
| `@graphgoblin/plugin-claude`  |            8 |       0 |  95.00% |   95.23% |
| `@graphgoblin/plugin-codex`   |            9 |       1 |  95.58% |   91.66% |
| **Total**                     |    **9,588** |  **41** |         |          |

The Vitest output reports 601 test files passed and 8 skipped (609 total). The 41 skipped test cases appear in these coverage groups: infrastructure (8), adapter-codex (5), adapter-jev (5), API (20), tooling (2), and plugin-codex (1). Per-file counts are preserved in the [derived gate summary](job-metadata/gate-coverage-test-summary.json) and complete [Gates log](raw-logs/gates.log). The only package-level live test skip called out explicitly in the log is `@graphgoblin/plugin-codex/src/live.test.ts` (1 test). The other skip reasons are not fully stated in the coverage summary; this packet records their observed counts and files without inferring a cause.

## Browser and routing qualifications

The single browser skip is `apps/web/e2e/live.spec.ts`, which requires `LIVE=1`, an installed Codex CLI, and provider login, and spends subscription quota. CI set `LIVE=0`; no live or paid provider test was scheduled. The ordinary browser suite used the Edge channel with zero retries and one worker. Optional historical form captures, routing screenshots, routing profiling, and strict manual routing bounds were off.

The separate Routing performance workflow did not trigger for this PR. Its exact-head workflow file filters pull requests to `apps/web/src/editor/**` and `apps/web/e2e/routing.spec.ts`; none of the 343 PR changed paths match. See the [workflow definition](workflow-definitions/routing-perf.yml), [complete changed-path list](job-metadata/pr-484-changed-paths.txt), and [path-filter readback](job-metadata/routing-path-filter-readback.json). The regular Browser job still ran the ordinary `e2e/routing.spec.ts` cases, including its measured 100-node and 300-node cases. Their observed routing p95 values were 1.4–1.9 ms at 100 nodes and 2.8–3.2 ms at 300 nodes; frame p95 values were 16.7–16.8 ms. These are results of the functional Browser job, not a separate Routing workflow run.

## Gate warnings and limitations

- `pnpm audit --audit-level=high` passed and reported 21 vulnerabilities: 8 low and 13 moderate. No high or critical finding appears in the audit summary.
- The logs include dependency deprecation warnings for Node's `url.parse()` and `punycode`, and an Actions warning that actions targeting Node.js 20 are being forced onto Node.js 24. The host Node runtime shown for Gates, Browser, and Windows was `v22.23.4`.
- Windows native acceptance passed, but its expected upload path contained no files; no native evidence artifact is available for independent download.
- No failed CI steps, cancelled jobs, or retries occurred. The separate Routing workflow was not applicable by path filter.

## Evidence inventory

- [Source-copy map](source-copy-map.json) records each retained file's origin, byte count, and SHA-256.
- [SHA256SUMS](SHA256SUMS) covers every packet file except the checksum file itself.
- [Workflow definitions](workflow-definitions/) are the exact CI and Routing workflow files fetched at the PR head; their GitHub blob metadata is next to each file.
- Raw logs are complete decoded job logs; no provider token, runner workspace, dependency tree, generated distribution, or private provider stream is included.
