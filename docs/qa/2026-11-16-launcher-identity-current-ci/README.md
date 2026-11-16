# PR #492 current CI evidence

This packet preserves the first current-head CI run for PR #492. It records CI evidence only; it does not make a review, merge, or owner-acceptance claim.

## Tested identity

| Ref                    | Commit                                     |
| ---------------------- | ------------------------------------------ |
| PR head                | `6f383da798872aa0e6bd1e0de1fdcd4e702de9ae` |
| Target                 | `9fa8b2474c7290adb800c5e26be73511095cae25` |
| Tested synthetic merge | `5e386d5cc9ed4b022d15ade32d04fcd89c367688` |
| Merge tree             | `decd1ca26c9bd63d942e939e65e2b2604d7f2652` |

The synthetic merge has the target as first parent and the PR head as second parent. Its tree matches the published PR head. The terminal readback identifies run 43790735875 (run 890, attempt 1), which completed successfully. The first-page PR-triggered workflow lookup returned one CI run and no separate routing run; see the [workflow list](ci/metadata/workflows-for-head.json) and [terminal PR](ci/metadata/pr-492.json), [run](ci/metadata/run-43790735875.json), [jobs](ci/metadata/jobs-terminal.json), and [synthetic merge](ci/metadata/synthetic-merge-5e386d5.json) records.

## Job results

| Job                             | Result                                   | Captured evidence                                                                             |
| ------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------- |
| Gates (133048320097)            | Success; all 32 reported steps succeeded | [Full decoded log](ci/gates/gates.decoded.log), [steps](ci/gates/steps.json)                  |
| Browser (133048319866)          | Success; 481 passed, 1 skipped           | [Full decoded log](ci/browser/browser.decoded.log), [steps](ci/browser/steps.json)            |
| Template image (133048319973)   | Success; four installed templates loaded | [Full decoded log](ci/template/template-image.decoded.log), [steps](ci/template/steps.json)   |
| Windows launcher (133048320156) | Success; 17 passed, 0 failed or skipped  | [Sealed Windows narrative](windows/README-source.md.txt), [Windows evidence folder](windows/) |

### Gates

The project runtime was Node v22.23.4 with pnpm 12.8.1. The coverage run reported 9,619 passed and 41 skipped tests across 13 package coverage groups. All 13 groups met the 90% line and branch floors. The exact coverage archive is [coverage-14192079834.zip](ci/coverage/coverage-14192079834.zip) (22,040 bytes, SHA-256 `68506d5c108574bcbdd11856ddea6d02940345f8045496a7b4fcc84c01095a27`). [Member hashes and coverage percentages](ci/coverage/coverage-members-readback.json) identify all 13 summaries.

The licence allowlist checked 226 packages. The configured dependency audit threshold passed with 8 low and 13 moderate advisories. Dependency-cruiser reported four warning-only `no-orphans` findings and zero errors. The log also contains Node deprecation warnings and a GitHub Actions notice that actions targeting Node 20 were forced to Node 24; these action-host notices are distinct from the project’s Node 22 runtime.

### Browser

The job scheduled 482 tests: 481 passed and the provider-gated `live.spec.ts` test was skipped because CI sets `LIVE=0`. It used Microsoft Edge 157.0.4341.60 on a Linux runner, one worker, and zero retries. The Windows user-agent text in the performance payload is browser metadata, not evidence of a Windows runner.

Optional `GG_ROUTING_STRICT_PERF` bounds were off. Ordinary routing tests passed. The reported frame p95 values were 33.3–33.4 ms for the 100- and 300-node measurements, while the optional strict target is 17 ms; this run does not establish strict-bound conformance. The browser failure-evidence upload step was skipped because the suite succeeded.

### Windows launcher and template image

The hosted Windows job exercised both a real directory junction and a true directory symbolic link. The sealed report records 4 cold starts, 8 warm reuses, 8 mismatch refusals, and 4 managed drains. The Windows uploader produced no native artifact; the full native records remain in the job log and the [Windows artifact listing](windows/actions-artifacts.json).

The Template image job loaded starter (4 draft nodes), implementation (11), review (10), and qa (11) from a read-only, no-network container. Its log includes a shared workspace lockfile warning that configuration forces the legacy deploy implementation.

## Provenance and limits

The [root CI acceptance](provenance/435-current-ci-root-acceptance.json) binds the head, target, synthetic merge, all four successful jobs, coverage result, browser qualification, and Windows native outcome. The [coverage readback](provenance/435-coverage-root-readback.json) records its independent 13-member verification; the [Windows readback](provenance/435-hosted-candidate-root-acceptance.json) verifies the sealed native packet.

At the terminal PR readback, #492 was still open and draft. The root receipt records that Claude Opus scan 1 had started with no verdict yet; this packet makes no formal-review claim. The separate [baseline](../2026-11-16-launcher-identity-baseline/README.md), [implementation](../2026-11-16-launcher-identity-implementation/README.md), and [candidate QA](../2026-11-16-launcher-identity-candidate/README.md) packets preserve their own evidence tiers.

The [source-copy map](source-copy-map.json) maps each included source file to its byte-exact packet copy. The [SHA-256 inventory](SHA256SUMS.txt) covers every packet file except itself. The nested Windows README and its source checksum file are preserved under renamed filenames; the copy map retains their original names and hashes.
