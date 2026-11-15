# PR #485 current-head CI — attempt 1

Run [43745479496](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/43745479496) (run 883, attempt 1) tested PR #485 head `693ea3c9d05359f6ebee8822dd566c99c3e4973c` (tree `7e611f71ac8b3693d574b8f08869d68fed19af4b`) against main `f91bd69b79dc417a2997ddb9c7670cb33df7597c`. GitHub created synthetic merge `955dccf755f5f34387f990ff47fa49c7bbf45f55`, with the same tree and parents target then head. The four job logs identify that synthetic merge checkout. Run start: 2026-11-15 18:13:04 UTC. Terminal update: 18:43:26 UTC.

This packet records only run 43745479496 attempt 1. The run concluded `cancelled`: Gates exceeded the configured 30-minute maximum. The official check annotation says “The job has exceeded the maximum execution time of 30m0s”; the log records cancellation, not a failing test assertion. The workflow run began at 18:13:04 UTC, and the Gates log records cancellation at 18:43:20 UTC. A later, single Gates-only retry was started and is collected separately; it is not part of this packet.

## Terminal jobs

| Job              | Result                           | Qualification                                                                      |
| ---------------- | -------------------------------- | ---------------------------------------------------------------------------------- |
| Gates            | Cancelled at the 30-minute limit | Unit/coverage step did not conclude; four later checks were skipped.               |
| Browser          | Success                          | 481 passed, 1 live test skipped; optional strict routing performance mode was off. |
| Windows launcher | Success                          | 14 passed; the upload step found no native evidence files.                         |
| Template image   | Success                          | Four installed templates loaded offline without writable storage.                  |

The workflow ran four jobs; no separate Routing job appeared.

### Gates

The first 22 listed steps completed successfully, including build, acceptance suites, typecheck, lint, format check, layer and dependency rules, migration no-op, design-token checks, shipped-template checks, and Chromium installation. “Unit tests with coverage thresholds” was cancelled when the job hit its time limit. The subsequent licence, generated-docs, design-contrast, and dependency-audit steps were skipped. Coverage report upload succeeded. The official annotation also records the GitHub Actions Node.js 20 deprecation notice and that those actions were forced to run on Node.js 24; this was a warning, not the cancellation cause.

Ten package coverage groups had completed when the job was canceled: 9,413 passed, 38 skipped (9,451 total). Their reported line and branch percentages all exceed 90%, but this is incomplete evidence: the full coverage task did not finish, and three groups reported by the earlier successful run on head 656a (tooling, plugin-claude, plugin-codex) have no result in this attempt. Do not treat this run as a passing coverage gate.

| Package                   |    Passed | Skipped |   Lines | Branches |
| ------------------------- | --------: | ------: | ------: | -------: |
| contracts                 |       304 |       0 |  99.40% |   94.73% |
| domain                    |       460 |       0 |  98.74% |   95.98% |
| engine                    |     1,812 |       0 |  96.94% |   91.22% |
| adapter-codex             |       641 |       5 |  99.23% |   95.41% |
| adapter-jev               |        34 |       5 |  98.80% |   96.77% |
| infrastructure            |     1,149 |       8 |  97.80% |   93.18% |
| api                       |     1,937 |      20 |  95.78% |   90.61% |
| api-client                |       103 |       0 | 100.00% |   97.30% |
| mcp                       |        62 |       0 |  96.95% |   94.23% |
| web                       |     2,911 |       0 |  98.60% |   94.30% |
| **Completed-group total** | **9,413** |  **38** |       — |        — |

The uploaded coverage artifact (ID 14175356541) is 19,702 bytes, SHA-256 `b295e98b3a92670ac884733953ef99686375063173187a2dc05e417da8dae526`. Its extracted contents include ten `coverage-summary.json` files, matching the ten groups recorded above. The archive and extracted summaries are retained under [artifacts](artifacts/), and [artifact-validation.json](artifact-validation.json) records the archive digest and a byte/hash comparison of every extracted entry with its ZIP member. The three unreported package groups are not present in this artifact.

### Browser

The functional suite succeeded on Edge 157.0.4341.60 and Node v22.23.4: 481 passed, 1 skipped, one worker, zero retries, 25.8 minutes. The skip is `live.spec.ts`, which requires `LIVE=1`, Codex CLI/provider login and quota; CI used `LIVE=0`. Optional `GG_ROUTING_STRICT_PERF` was off.

Logged drag measurements were 100-node frame p95 16.7/16.8/16.8 ms and routing p95 2.2–2.9 ms (median 2.4 ms); 300-node frame p95 33.3/33.3/16.8 ms and routing p95 3.2–5.6 ms (median 4.3 ms). Those measurements do not establish the disabled strict 17 ms frame bound. The job ran on a Linux hosted runner; its Windows user-agent value is metadata, not native Windows browser evidence.

### Windows launcher and template image

The Windows launcher job succeeded on Windows with Node v22.23.4: 14 tests passed, zero failed or skipped. Its upload step succeeded but logged that `.tmp/windows-launcher-*/` contained no files, so no native launcher artifact was uploaded. The log also records the Node action runtime warning and Node deprecation notices.

The template-image job succeeded, building 9/9 tasks and loading four installed templates offline without writable storage: starter (4 draft nodes), implementation (11), review (10), and qa (11). Its Linux log notes the shared workspace lockfile forced the legacy deploy implementation.

### Comparison and limits

The earlier successful run on head 656a is [attempt 1 on head 656a](../current-ci-656a/README.md); it completed all 13 coverage groups. The current Gates log’s completed web coverage phase took 635.86 seconds, compared with 496.95 seconds in that earlier log. The cause of the timing difference is not established. These wall times are not evidence of a test regression.

## Captured evidence

The canonical job logs are the decoded files below. The apply-patch template capture has one extra trailing line feed and is retained only as a noncanonical capture; the decoded template log is authoritative. The Windows `.partial` file is a byte-identical duplicate of the decoded Windows log.

- [Gates log](job-logs/gates.decoded.log) · [Gates steps](job-logs/gates.steps.json)
- [Browser log](job-logs/browser.decoded.log) · [Browser steps](job-logs/browser.steps.json)
- [Windows launcher log](job-logs/windows-launcher.decoded.log) · [Windows steps](job-logs/windows-launcher.steps.json)
- [Template image log](job-logs/template-image.decoded.log) · [Template steps](job-logs/template-image.steps.json)
- [Coverage archive](artifacts/coverage-artifact-14175356541.zip) · [Extracted coverage summaries](artifacts/coverage/)
- [Run snapshot](run-terminal.json) · [Terminal jobs and step results](terminal-jobs.json)
- [Synthetic merge metadata](merge-commit-response.json) · [Final coverage artifact metadata](coverage-artifact-metadata.json)
- [Authoritative terminal jobs readback](root-readbacks/runtime-485-ci-693e-attempt1-jobs.json) · [Official timeout annotations](root-readbacks/runtime-485-ci-693e-timeout-annotations.json)
- [Initial PR/run/jobs snapshot](initial-snapshot.json) · [Initial artifact listing](artifacts-snapshot-initial.json)

[SHA-256 inventory](SHA256SUMS.txt) covers every retained packet file except itself. `evidence-manifest.json` records each path, byte count, digest, and provenance class. No retry output or repository files are included.
