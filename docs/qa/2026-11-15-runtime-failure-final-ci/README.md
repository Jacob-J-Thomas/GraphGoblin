# PR #485 final current-head CI evidence

This packet preserves both CI attempts on PR #485’s 693e head, their complete decoded logs and coverage archives, and root readbacks binding the tested merge, timeout, retry, carried-forward jobs, and curation acceptance. It records CI evidence only.

The earlier PR #485 runs on heads 5082 and 656a are already recorded in the sibling [runtime-failure CI packet](../2026-11-15-runtime-failure-ci/README.md); they are linked there rather than copied here. This packet makes no review, merge, or owner-acceptance claim.

## Tested identity and outcomes

PR head: `693ea3c9d05359f6ebee8822dd566c99c3e4973c`, tree `7e611f71ac8b3693d574b8f08869d68fed19af4b`, target/main `f91bd69b79dc417a2997ddb9c7670cb33df7597c`. Both attempts tested the same GitHub synthetic merge `955dccf755f5f34387f990ff47fa49c7bbf45f55`, tree `7e611f71ac8b3693d574b8f08869d68fed19af4b`, with parents target then PR head.

| Run attempt                                           | Gates                                            | Other jobs                                                                | Coverage result                                                                                         |
| ----------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [43745479496 attempt 1](attempt-693e-1/README.md.txt) | Cancelled by the official 30-minute job deadline | Browser, Windows launcher, and Template image succeeded                   | Incomplete: 9,413 passed, 38 skipped across 10 completed groups; three group results were not produced. |
| [43745479496 attempt 2](attempt-693e-2/README.md.txt) | One Gates-only retry succeeded in 32/32 steps    | The three original successful job records were carried forward, not rerun | Complete: 9,605 passed, 41 skipped across 13 groups; all line and branch floors passed.                 |

Attempt 1 started at 18:13:04 UTC and the Gates log records cancellation at 18:43:20 UTC. The official annotation states: “The job has exceeded the maximum execution time of 30m0s.” No test assertion failure appears in the completed Gates output; the cancelled coverage step and later skipped gates provide no passing result for the missing groups. The 10-group coverage archive is retained in the attempt-1 folder.

The one bounded retry re-executed only Gates, job 132918799467, from 18:51:22 to 19:11:48 UTC. No source, workflow, test, coverage threshold, or timeout policy changed between attempts. Root’s disposition says the underlying timing variation remains unestablished and that a separate individual browser-measurement subprocess issue is unrelated to this whole-job timeout. The three other job IDs retained their original timestamps; see the [carried-job timing readback](provenance/root/runtime-485-ci-693e-attempt2-carried-jobs-root-readback.json). Their original logs and qualifications are in attempt 1.

## Qualifications

Attempt 1’s Browser job passed 481 tests and skipped one live test; Windows launcher passed 14 tests but uploaded no native artifact; Template image loaded four templates. These are not new executions in attempt 2. The first attempt’s Browser performance mode was optional and strict routing performance was off; its hosted browser runner was Linux. The Windows upload warning and the exact Browser and Template qualifications are in the [attempt-1 report](attempt-693e-1/README.md.txt).

Attempt 2 completed the full Gates coverage task with 13 package groups. The full package table, 41 skip counts, advisory/audit outcomes, warning-only dependency findings, cache qualifications, and exact artifact hashes are in the [attempt-2 report](attempt-693e-2/README.md.txt). Its Browser, Windows, and Template records are carried-forward results from attempt 1.

## Provenance and retained corrections

The official timeout annotations, bounded retry decision and response, carried-job timestamps, full terminal metadata, timeout disposition, and current-head CI acceptance are copied under [provenance/root](provenance/root/). Root accepted the attempt-1 packet as a preserved cancelled attempt and accepted the corrected attempt-2 report. The latter acceptance records the two narrative corrections and the exact hashes of the earlier derived report, manifest, and checksum file; those three files are retained byte-for-byte under [provenance/attempt2-pre-root-correction](provenance/attempt2-pre-root-correction/). The corrected packet hashes are listed in the current attempt-2 manifest.

The job logs, step snapshots, metadata, artifact archives, and coverage summaries are byte-exact copies. Each source packet’s derived `README.md` is byte-exact but renamed to `README.md.txt`; the pre-correction attempt-2 report is preserved the same way. Relative links inside those report copies retain their original source layout and may not resolve from this packet. Use this wrapper’s links and the sibling runtime-failure CI packet for navigable destinations. The copied per-attempt `evidence-manifest.json` and `SHA256SUMS.txt` remain unchanged context records whose paths refer to the original source packet. The top-level [source-copy-map.json](source-copy-map.json) and [SHA256SUMS](SHA256SUMS) identify and verify the actual publication paths.

## Evidence files

- Attempt 1: [full report](attempt-693e-1/README.md.txt), [Gates log](attempt-693e-1/job-logs/gates.decoded.log), [coverage artifact](attempt-693e-1/artifacts/coverage-artifact-14175356541.zip), [root readback](provenance/root/runtime-485-ci-693e-attempt1-root-readback.json), and [curation acceptance](provenance/root/runtime-485-ci-693e-attempt1-curation-root-acceptance.json).
- Attempt 2: [full report](attempt-693e-2/README.md.txt), [Gates log](attempt-693e-2/gates.decoded.log), [coverage artifact](attempt-693e-2/coverage-artifact-14176387060.zip), [current-head CI acceptance](provenance/root/runtime-485-ci-693e-current-root-acceptance.json), and [corrected curation acceptance](provenance/root/runtime-485-ci-693e-attempt2-curation-root-acceptance.json).
