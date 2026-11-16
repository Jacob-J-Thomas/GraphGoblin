# PR500 Gates-only retry evidence

This packet records the one authorized Gates-only rerun for PR #500 after the first Gates job hit GitHub's explicit 30-minute deadline. It preserves the failed first attempt in the [separate first-attempt archive](../2026-11-16-bounded-logging-ci-first/README.md); that earlier timeout, its partial artifact and its records remain unchanged.

## Tested identity and attempt

- PR #500 head `1c04263bcbfd93056e77ee98a9c5d705df26ea88`, base `e21c24be9cef109ef438fd2df4c1583bc570b1cb`.
- Workflow run `43863219176`, run attempt 2, completed successfully at 13:07:32 UTC. The rerun was limited to Gates. Gates job `133304634057` ran 12:41:58–13:07:32 UTC.
- The tested synthetic merge was `91a9396677b61cb88a802543e5fec5b379870541`, tree `332d414fea68cb2fffdd1c2baca620491ce1f341`, ordered parents base then PR head. See [the merge identity](synthetic-merge-identity.json) and [run identity](run-identity.json).
- All 32 Gates job steps, including post-run steps and the `Complete job` step, succeeded. The other three jobs appear under new IDs in attempt 2 but were carried forward, not re-executed; their start/end timestamps and runner names exactly match attempt 1 in [the job-lineage record](jobs-lineage.json). Reuse their original logs from the first-attempt archive: Browser, Template image and Windows launcher.

## Gates and coverage result

The retry ran on the same Azure `westus2`, Ubuntu 26.04.1 image (`ubuntu-26.04`, image version `20261111.196.1`) as the first attempt. Project Node was v22.23.4. The coverage command began at 12:50:51.772 UTC and Turbo reported 16m32.913s; 22 tasks succeeded, with 9 cached. The run completed all 13 package coverage groups: **9,721 passed and 49 skipped**. Every line and branch floor is at least 90%.

| Package        | Passed | Skipped |  Lines | Branches |
| -------------- | -----: | ------: | -----: | -------: |
| contracts      |    304 |       0 | 99.40% |   94.73% |
| domain         |    460 |       0 | 98.74% |   95.98% |
| engine         |  1,814 |       0 | 96.94% |   91.22% |
| infrastructure |  1,149 |       8 | 97.80% |   93.18% |
| adapter-jev    |     34 |       5 | 98.80% |   96.77% |
| adapter-codex  |    641 |       5 | 99.23% |   95.41% |
| api            |  2,050 |      28 | 95.09% |   90.66% |
| api-client     |    103 |       0 |   100% |   97.30% |
| mcp            |     62 |       0 | 96.95% |   94.23% |
| web            |  2,911 |       0 | 98.60% |   94.29% |
| tooling        |    176 |       2 | 96.89% |   91.67% |
| plugin-codex   |      9 |       1 | 95.58% |   91.66% |
| plugin-claude  |      8 |       0 | 95.00% |   95.23% |

The coverage artifact is GitHub artifact `14228741923`, 22,263 bytes, API digest `sha256:74dda0bb576680e6ae62baa39827ef33b437251a8357c44d741b90cd84e7499b`. The original ZIP bytes are retained under `coverage/`; [the member map](coverage/coverage-members.json) records all 13 member hashes and exact metrics. The artifact matches the terminal log summaries.

The remaining Gates checks passed: the licence allowlist checked 226 packages; dependency audit reported 8 low and 13 moderate advisories under the configured high-severity threshold; generated docs and the design-token contrast table were current. The coverage upload succeeded.

## Carried jobs and qualifications

The successful Browser, Template image and Windows launcher statuses in run attempt 2 are carried-forward records with the same runner and timestamps as attempt 1, not fresh executions. See [job lineage](jobs-lineage.json) and reuse their original logs in the [first-attempt archive](../2026-11-16-bounded-logging-ci-first/README.md). The first Windows upload step succeeded but found no matching evidence file, so no Windows artifact was produced. The first Browser run reported 481 passed / 1 declared LIVE skip, no retries, one worker, and optional strict performance mode off; its host was Linux, not Windows. Template image loaded four catalog entries.

The same Azure image succeeded on this Gates-only retry, so the first timeout alone does not establish an image or provider cause. This packet does not change the first-attempt evidence or assert why its coverage job exceeded the limit. The bounded [first-attempt diagnosis](../2026-11-16-bounded-logging-ci-first/diagnosis/report.md.txt) keeps that cause unassigned.

## Capture and limits

[gates-job.decoded.log](job-logs/gates-job.decoded.log) is the connector-decoded job log persisted as UTF-8; its digest is for that decoded representation, not GitHub's compressed log response. The downloaded coverage ZIP is retained as original artifact bytes. The root admission and API captures are retained separately in this folder. No new Routing job appeared in the four-job run response.

CI is green on this run attempt, but this evidence is not a formal review, merge, issue completion, or owner acceptance. No further rerun is represented here. `source-copy-map.json` maps each capture and derived file; `SHA256SUMS.txt` seals all packet files except itself.
