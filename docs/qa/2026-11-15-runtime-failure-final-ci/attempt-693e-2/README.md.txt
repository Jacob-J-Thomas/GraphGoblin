# PR #485 CI after the Gates-only retry

GitHub run [43745479496](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/43745479496), run 883, attempt 2, completed successfully for PR #485 head `693ea3c9d05359f6ebee8822dd566c99c3e4973c`, tree `7e611f71ac8b3693d574b8f08869d68fed19af4b`, against main `f91bd69b79dc417a2997ddb9c7670cb33df7597c`. The tested synthetic merge was `955dccf755f5f34387f990ff47fa49c7bbf45f55`, tree `7e611f71ac8b3693d574b8f08869d68fed19af4b`, parents target then head. All attempt-2 Gates log records check out that merge.

This was the one bounded retry of the Gates job after attempt 1 timed out at the configured 30-minute maximum; no source or workflow changes occurred between attempts. The Gates job (ID 132918799467) ran 18:51:22–19:11:48 UTC and passed all 32 steps. The first-attempt packet remains separate at [current-ci-693e](../current-ci-693e/README.md) and records the timeout and original full logs.

The three other successful job records in GitHub's attempt-2 jobs response were carried forward from the original run, not executed again. The readback in [root-readbacks](root-readbacks/runtime-485-ci-693e-attempt2-carried-jobs-root-readback.json) records their earlier start/completion timestamps. Their logs and qualifications remain in the attempt-1 packet.

## Gates result

The 13 package coverage groups reported 9,605 passed and 41 skipped tests (9,646 total). Every group met the 90% line and branch floors. The raw coverage archive contains 13 `coverage-summary.json` files, byte/hash verified against the archive members and metadata digest.

| Package        |    Passed | Skipped |   Lines | Branches |
| -------------- | --------: | ------: | ------: | -------: |
| contracts      |       304 |       0 |  99.40% |   94.73% |
| domain         |       460 |       0 |  98.74% |   95.98% |
| engine         |     1,812 |       0 |  96.94% |   91.22% |
| adapter-codex  |       641 |       5 |  99.23% |   95.41% |
| adapter-jev    |        34 |       5 |  98.80% |   96.77% |
| infrastructure |     1,149 |       8 |  97.80% |   93.18% |
| api            |     1,937 |      20 |  95.78% |   90.61% |
| api-client     |       103 |       0 | 100.00% |   97.30% |
| mcp            |        62 |       0 |  96.95% |   94.23% |
| web            |     2,911 |       0 |  98.60% |   94.29% |
| plugin-claude  |         8 |       0 |  95.00% |   95.23% |
| plugin-codex   |         9 |       1 |  95.58% |   91.66% |
| tooling        |       175 |       2 |  96.89% |   91.67% |
| **Total**      | **9,605** |  **41** |       — |        — |

The skips are recorded in the full Gates log. They include live-test files in adapter-codex, adapter-jev, and plugin-codex; API live/performance, shutdown-console, and reset-sockets skips; eight infrastructure skips; and two tooling skips. Adapter-codex also has one skipped test in `src/cli.test.ts`. The log does not establish a shared cause for every per-test skip. These are test skips, not failures.

The standalone build reported 12 successful tasks and zero Turbo-cache hits. The coverage pipeline reported 22 successful tasks, including 9 cached dependency-build tasks; this is not a clean TypeScript recompile. Node was v22.23.4.

All remaining Gates checks passed: typecheck, lint, format, layer and dependency rules, migration no-op, shipped-template checks, licence allowlist (226 packages checked), generated docs, and design contrast (0 failing enforced pairs). Dependency audit passed at the configured high threshold and reported 8 low and 13 moderate advisories. Dependency-cruiser reported four warning-only no-orphan findings and zero errors. The Gates log also contains Node.js 20 action deprecation/forced-Node-24 warnings and Node `DEP0169` and `DEP0040` deprecations; these did not fail Gates. The carried-forward Template image log separately notes the shared-lockfile condition that selected legacy deploy behavior.

## Carried-forward jobs and scope

Browser, Windows launcher, and Template image retained their original successful outcomes from attempt 1. The separate Browser, Windows launcher, and Template image jobs did not execute again; Gates ran its own tooling browser measurements. See the [attempt-1 report](../current-ci-693e/README.md) for the separate jobs’ exact logs, counts, metrics, upload warning, runtime environments, and skip qualifications. In particular, do not read the carried Windows job as evidence that its missing native artifact became available.

There were four jobs in the workflow and no separate Routing job. This packet records CI only; it does not establish review approval, owner acceptance, or merge.

## Captured evidence

- [Full retry Gates log](gates.decoded.log) · [All retry Gates steps](gates.steps.json)
- [Run response](run-terminal.json) · [Jobs and step summaries](jobs-terminal.json) · [Gates job metadata](job-details.json)
- [In-progress job-list snapshot](latest-jobs-190224Z.json) · [In-progress Gates step snapshot](gates-steps-190224Z.json)
- [Coverage artifact ZIP](coverage-artifact-14176387060.zip) · [Artifact metadata](artifacts-terminal.json) · [Archive-entry verification](artifact-validation.json)
- [Carried-job timestamp readback](root-readbacks/runtime-485-ci-693e-attempt2-carried-jobs-root-readback.json)
- [Extracted coverage summaries](coverage/)
- [Evidence manifest](evidence-manifest.json) · [SHA-256 inventory](SHA256SUMS.txt)

The manifest maps each retained file to its source and records byte count and SHA-256. The inventory covers every packet file except itself.
