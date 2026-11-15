# PR #480 current-head CI evidence

This packet records the five CI jobs observed for PR #480 candidate head **5a31678f5a8611ae3a89a1f6aefe797d7106a08e**. All five jobs completed successfully on attempt 1. The full original job logs and GitHub run/job snapshots are retained below.

## Checkout identity and retarget timing

At capture, the PR was open and draft, targeting **main** at **1cfca9bce3967c9d41950266c83aab636667e0ab**, with head **5a31678f5a8611ae3a89a1f6aefe797d7106a08e**. The PR’s current synthetic merge was **6ae1eff7c27ca49e941b8bb5c4e18f32d34ef7d6**, tree **c247968a388b1c74e7727ec27d4fe465ebfde0d0**, parents **1cfca9b...** and **5a31678...**.

All five job logs instead show checkout of **b08bf0ea5f304bd1bfb83b58dd2588607fb943a8**, tree **c247968a388b1c74e7727ec27d4fe465ebfde0d0**, parents **48dddb1af1239bbdddc7d7c9c8b0e47c0431c6c6** and **5a31678...**. The run began before the PR retarget was observed. Thus the logs do not show a merge commit with current main as parent. The tested and current synthetic merge trees match exactly, while their parent lists differ. The separate [root equivalence record](root-ci-retarget-equivalence.md.txt) documents the workflow inspection and the limits of transferring this result; fresh independent assessment of current-target equivalence remains necessary.

The [checkout identity extracted from each log](checkout-identity-from-logs.json), [retarget context](retarget-context.json), run snapshots, and complete logs preserve the provenance. Current PR status is only a readback at the recorded time.

## Job results

| Job                           | Result                                                                                                                                                                                                                                                 | Evidence                                                                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser 132715112244          | 481 passed, 1 skipped, zero Playwright retries. The skipped test is the live Codex provider inference flow.                                                                                                                                            | [Full log](job-132715112244-browser.log)                                                                                                                      |
| Template image 132715112372   | Passed. The Docker image built 9 tasks and ran with no network, read-only filesystem, dropped capabilities, and no-new-privileges. Listed starter, implementation, review, and QA templates with 4, 11, 10, and 11 draft nodes.                        | [Full log](job-132715112372-template.log)                                                                                                                     |
| Windows launcher 132715112380 | 14 passed, 0 failed, 0 skipped. Artifact upload found no files at its configured path; this warning was nonfatal.                                                                                                                                      | [Full log](job-132715112380-windows.log)                                                                                                                      |
| Routing 132715112049          | Passed the normal pull-request routing limits. GG_ROUTING_STRICT_PERF was blank, so the stricter manual-dispatch limits were not active. Frame p95 was about 33.3–33.4 ms; the normal pull-request gate does not bound frame p95.                      | [Full log](job-132715112049-routing.log), [raw routing artifact files](routing-performance-artifact/), [routing summary](routing-summary-from-artifact.json)  |
| Gates 132715112409            | Typecheck, lint, generated docs, contrast, licenses, dependency audit, and coverage task completed successfully. The audit reported 21 vulnerabilities: 8 low and 13 moderate; no high/critical finding was reported at the configured high threshold. | [Full log](job-132715112409-gates.log), [coverage summary parsed from log](coverage-summary-from-log.json), [coverage artifact summaries](coverage-artifact/) |

The routing run measured three drags for each graph size:

| Nodes | Routing p95 values (ms) | Median of three (ms) | Frame p95 (ms) | Normal PR routing limit   |
| ----- | ----------------------- | -------------------- | -------------- | ------------------------- |
| 100   | 7.3, 5.0, 4.7           | 5.0                  | 33.4           | Pass: each <16; median <8 |
| 300   | 7.9, 5.0, 5.5           | 5.5                  | 33.3–33.4      | Pass: each <16; median <8 |

The optional strict manual-dispatch threshold (<4 ms median routing and <17 ms frame p95) was inactive. The observed frame p95 does not meet that optional threshold, but it is not a normal pull-request gate and this packet does not claim a strict-dispatch pass or a frame-rate acceptance.

## Coverage

The Gates log reports 9,394 tests passed and 41 skipped across 13 packages. Every package exceeded 90% lines and branches. Minimum branch coverage was 90.55% (API); minimum line coverage was 95.0% (plugin-claude).

| Package        | Tests passed / skipped | Branch |  Lines |
| -------------- | ---------------------: | -----: | -----: |
| contracts      |                304 / 0 | 94.73% |  99.4% |
| domain         |                459 / 0 | 96.08% | 98.73% |
| engine         |              1,795 / 0 | 91.33% |  97.0% |
| infrastructure |              1,149 / 8 | 93.18% |  97.8% |
| adapter-codex  |                641 / 5 | 95.41% | 99.23% |
| adapter-jev    |                 34 / 5 | 96.77% |  98.8% |
| api            |             1,917 / 20 | 90.55% | 95.77% |
| api-client     |                103 / 0 |  97.3% |   100% |
| tooling        |                175 / 2 | 91.67% | 96.89% |
| web            |              2,738 / 0 | 94.23% | 98.59% |
| mcp            |                 62 / 0 | 94.23% | 96.95% |
| plugin-codex   |                  9 / 1 | 91.66% | 95.58% |
| plugin-claude  |                  8 / 0 | 95.23% |  95.0% |

## Retained evidence

- [Run and job API snapshots](run-43682228998-final.json) · [routing run](run-43682229004-final.json) · [job snapshots](jobs-43682228998-final.json) · [routing job snapshot](jobs-43682229004-final.json). Initial and intermediate readbacks are also retained.
- [Coverage artifact readback](artifact-readback.json) identifies the downloaded artifact ID, ZIP hash, and all 13 extracted coverage summary hashes. The [routing artifact summary](routing-summary-from-artifact.json) records the artifact ID, ZIP hash, both JSON file hashes, effective environment value, and thresholds.
- [Curation manifest](curation-manifest.json) maps retained evidence to its source and records byte counts and SHA-256 hashes. [SHA256SUMS](SHA256SUMS) verifies every packet file other than itself. [Link checks](link-checks.json) records local README link validation.
- Raw job logs, raw metadata, and extracted artifact JSON remain unchanged. The coverage summary parsed from the Gates log is a derived convenience view; use the complete raw log and original artifact summaries as primary evidence.

These results establish successful CI jobs for the captured candidate tree, with the checkout-parent qualification above. They do not establish owner acceptance, formal review sign-off, or any broader release-readiness conclusion.
