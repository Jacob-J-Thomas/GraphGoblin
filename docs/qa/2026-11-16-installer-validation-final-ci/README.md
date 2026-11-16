# PR #497 final current-head CI evidence

This packet preserves the final ordinary CI run for PR #497 (run attempt 1). It records CI evidence only; it makes no review, merge, or owner-acceptance claim.

## Tested identity

| Ref                    | Commit                                     |
| ---------------------- | ------------------------------------------ |
| PR head                | `2732dd34457bcd9a7007e89c3fa11fe085af764c` |
| Target                 | `be633141be5a0cd2b4f960a46761fabbf2cb82c7` |
| Tested synthetic merge | `80c581ebc95de2000c25ed2b5995d5a648fa95ba` |
| Merge tree             | `d064706fb48def7bacac5e434f96825c5850d214` |

The merge commit has the target as its first parent and the PR head as its second parent. Its tree matches the PR head. CI run 43829142179 (run 898, attempt 1) completed successfully at 08:40:37Z on 2026-11-16. The fresh PR readback showed #497 open and draft. The workflow lookup returned one PR-triggered CI run and no separate Routing run; see the [run](ci/metadata/run-43829142179.json), [PR readback](ci/metadata/pr-497-readback.json), [jobs with timestamps](ci/metadata/jobs-github-api.json), [step snapshot](ci/metadata/jobs-terminal-connector.json), [workflow list](ci/metadata/workflow-runs-for-head.json), and [tested synthetic merge](ci/metadata/tested-synthetic-merge.json).

## Job results

| Job                             | Result                                   | Captured evidence                                                                           |
| ------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| Gates (133169945076)            | Success; all 32 steps succeeded          | [Full decoded log](ci/gates/gates.decoded.log), [steps](ci/gates/steps.json)                |
| Browser (133169945528)          | Success; 481 passed, 1 skipped           | [Full decoded log](ci/browser/browser.decoded.log), [steps](ci/browser/steps.json)          |
| Template image (133169945487)   | Success; four installed templates loaded | [Full decoded log](ci/template/template-image.decoded.log), [steps](ci/template/steps.json) |
| Windows launcher (133169945534) | Success; 18 passed, no failures or skips | [Full decoded log](ci/windows/windows.decoded.log), [steps](ci/windows/steps.json)          |

## Gates and coverage

The project runtime was Node v22.23.4 with pnpm 12.8.1. The build completed 12 Turbo tasks with zero cached tasks. Coverage completed 22 Turbo tasks, including 9 cached dependency-build tasks; 13 distinct package groups ran, with 9,619 passed and 41 skipped tests in total. All 13 groups met the 90% line and branch floors; the lowest group results were 95.00% lines and 90.70% branches. The [coverage archive](ci/coverage/coverage-14208778425.zip) is 22,037 bytes with SHA-256 `3cac7f524df39812d6b4684fa0a64b37c52eac779afcd93289896cadb43d1270`; [member hashes and percentages](ci/coverage/coverage-members.json) list all 13 summaries.

The licence allowlist checked 226 packages. The configured dependency audit threshold passed with 8 low and 13 moderate advisories. Dependency-cruiser reported four warning-only findings and zero errors. The run also logged dependency deprecation warnings and a GitHub Actions notice that actions targeting Node 20 were forced to Node 24; this runner notice is separate from the project Node 22 runtime.

## Browser

The job ran Microsoft Edge 157.0.4341.60 on the hosted Ubuntu runner, with one worker and zero retries. It reports 481 passed and one skipped test: `live.spec.ts`, which requires `LIVE=1`, an installed Codex CLI, and a provider login; CI used `LIVE=0`. The Windows text in the emitted browser user agent is browser metadata, not evidence of a Windows runner.

Optional `GG_ROUTING_STRICT_PERF`, screenshot, and profiling modes were off. Ordinary routing tests passed. The log reports 100-node frame p95 around 33.4 ms and 300-node frame p95 around 33.4–33.5 ms; strict 17 ms performance bounds were not enabled. The browser failure-evidence upload step was skipped because the suite passed.

## Template image and Windows launcher

The Template image job loaded starter (4 draft nodes), implementation (11), review (10), and qa (11) from a read-only, no-network container. Its log includes a shared-workspace-lockfile warning that configuration forces the legacy deploy implementation.

The hosted Windows job used Node v22.23.4 and reports 18 tests passed, 0 failed, 0 cancelled, and 0 skipped. Its upload step succeeded but logged that `.tmp/windows-launcher-*/` matched no files. The run’s final artifact inventory contains only the coverage artifact; no Windows native artifact was produced.

## Provenance and limits

The [root CI acceptance](ci/metadata/436-final-ci-root-acceptance.json) independently binds the head, tested merge, complete four-job run, coverage archive, and qualifiers. The complete run is green, but this packet makes no source-review, product-acceptance, or merge claim. The [artifact inventory](ci/metadata/artifacts.json) records the only actual run artifact. No signed download URL is retained.

Logs are the UTF-8 files written from the decoded connector text, with the returned BOM and line endings preserved. The [source-copy map](source-copy-map.json) records each source path, destination, byte count, hash, and capture method. The [SHA-256 inventory](SHA256SUMS.txt) covers all packet files except itself.
