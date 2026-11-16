# PR #490 current-head CI evidence

This packet records the first CI attempt and the single authorized Gates-only retry for PR #490. It preserves both original outcomes and identifies what actually ran during each attempt.

## Source and tested identity

- Repository: `Jacob-J-Thomas/GraphGoblin`
- PR: [#490](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/490)
- Workflow run: [CI run #887](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/43773546178), run ID `43773546178`
- Head: `497acaa602959bc828e8f1e90f2dce0a576a3492`, tree `88ade580c80b2139b5d1bf51449dca10e33184f1`
- Base: `98692c8a8c7b519e8c83e585e026d595cedc0550`
- Tested synthetic merge: `387322e7f7d2b2f4a48c149aeaea2fc4f3001996`, tree `88ade580c80b2139b5d1bf51449dca10e33184f1`, parents base then PR head
- Run attempt 2 completed at `2026-11-16T00:09:31Z` with overall success. The PR was read as open at the terminal capture.

The exact PR and synthetic-merge readbacks are in [attempt 2 metadata](attempt-2/metadata/). The run checked the merge identity above, not only the branch head.

## Attempt 1: Gates reached the workflow deadline

The original Gates job (`132994570141`) started at `23:12:38Z` and ended at `23:42:53Z`. GitHub’s check annotation reports that it exceeded the configured 30-minute maximum and was canceled. The retained [complete Gates log](attempt-1/logs/gates.log), [step list](attempt-1/steps/gates-terminal.json), and [official annotation](attempt-1/provenance/gates-terminal-root-annotation.json) preserve that first outcome.

Ten package coverage groups completed before cancellation, totaling 9,425 passed and 38 skipped tests. Their partial coverage artifact contains ten package summaries; the independent readback confirms all ten retained line and branch floors met 90%. This is not a complete 13-package coverage run. The final four Gates checks (licence allowlist, generated docs, design-token contrast, dependency audit) were skipped after the coverage job was canceled. The partial archive is retained at [coverage-14186148298.zip](attempt-1/artifacts/coverage-14186148298.zip).

The separate Browser, Windows launcher, and Template image jobs succeeded on attempt 1. Their outcomes carried forward into attempt 2; they did not execute again there.

## Attempt 2: one Gates-only retry passed

Exactly one retry was authorized for the unchanged Gates job. No source, workflow, assertion, timeout, or other CI configuration change was made between attempts. On retry, Gates job `133004478824` completed all 32 reported steps successfully. The run has four successful job records, but only Gates was newly executed:

- Gates: retry job `133004478824`, completed successfully; the complete log is [here](attempt-2/logs/gates.connector-decoded.exact.log).
- Browser: job `133004480023`, carried success from attempt 1.
- Template image: job `133004480764`, carried success from attempt 1.
- Windows launcher: job `133004511413`, carried success from attempt 1.

The three carried jobs retain their original attempt-1 start, end, and log evidence. Their timestamp readbacks are [Browser](attempt-2/provenance/carried-browser-job.json), [Template image](attempt-2/provenance/carried-template-job.json), and [Windows launcher](attempt-2/provenance/carried-windows-job.json). The run’s terminal records are in [attempt 2 metadata](attempt-2/metadata/) and the retry admission and independent readbacks are in [attempt 2 provenance](attempt-2/provenance/).

The completed Gates retry ran the build (12/12 tasks, 0 cached), typecheck (21/21, 9 cached), lint (13/13, 0 cached), and coverage (22/22, 9 cached dependency-build tasks). All 13 distinct `test:coverage` groups actually ran. The aggregate was 9,617 passed and 41 skipped tests; every package’s line and branch summary met the 90% floor. The downloaded 13-member archive is [coverage-14186694248.zip](attempt-2/artifacts/coverage-14186694248.zip); its member hashes and package totals are recorded in [the archive readback](attempt-2/artifacts/coverage-14186694248-members-readback.json).

| Coverage group |    Passed | Skipped |   Lines | Branches |
| -------------- | --------: | ------: | ------: | -------: |
| contracts      |       304 |       0 |  99.40% |   94.73% |
| domain         |       460 |       0 |  98.74% |   95.98% |
| engine         |     1,814 |       0 |  96.94% |   91.22% |
| adapter-jev    |        34 |       5 |  98.80% |   96.77% |
| infrastructure |     1,149 |       8 |  97.80% |   93.18% |
| adapter-codex  |       641 |       5 |  99.23% |   95.41% |
| api            |     1,947 |      20 |  95.80% |   90.70% |
| api-client     |       103 |       0 | 100.00% |   97.30% |
| web            |     2,911 |       0 |  98.60% |   94.30% |
| mcp            |        62 |       0 |  96.95% |   94.23% |
| tooling        |       175 |       2 |  96.89% |   91.67% |
| plugin-codex   |         9 |       1 |  95.58% |   91.66% |
| plugin-claude  |         8 |       0 |  95.00% |   95.23% |
| **Total**      | **9,617** |  **41** |         |          |

Other completed Gates checks: licence allowlist passed with 226 packages checked; generated docs passed; design contrast reported zero failing enforced pairs; dependency audit passed its high-severity threshold with 8 low and 13 moderate advisories. The dependency-cruiser output retained four `no-orphans` warnings (zero errors). Build/typecheck/lint details and their cache counts are in the complete log.

## Companion job evidence and limits

- Browser: 481 passed, one declared `LIVE` skip (the log reports `LIVE: 0`), 23.5 minutes, Edge `157.0.4341.60`, one worker and zero retries. The optional strict performance gate was off. In the 300-node measurement, the first of three frame-p95 readings was 33.2 ms against a 17 ms target; the other two were 16.8 ms. The Browser job still passed.
- Windows launcher: 14 passed, zero skipped, on Windows with project Node `v22.23.4`. The upload step succeeded but the log explicitly says no `.tmp/windows-launcher-*/` files were found, so no native evidence artifact was uploaded.
- Template image: the job passed and reported the four expected templates: starter, implementation, review, and qa.
- The configured project Node was `v22.23.4`. GitHub separately emitted an action-host warning that actions targeting Node 20 were forced to Node 24; this is distinct from the project Node runtime.
- This run contains the four jobs above; no separate Routing workflow was triggered for this change.

The initial Browser, Template, and Windows collector outputs are retained separately under [attempt 1 initial captures](attempt-1/initial-captures/). They are not represented as byte-identical provider output: Browser and Template differ from their later exact connector-decoded copies by a terminal byte, and the Windows initial capture normalized line endings. The `*.connector-decoded.exact.log` files are preserved as separate source captures. The invalid local diagnostic-parser response is excluded; it is not CI evidence.

## Follow-up and integrity

The first 30-minute cancellation and the single unchanged-head Gates retry are both retained. This result does not establish that the workflow deadline issue is resolved; follow-up is tracked in [issue #488](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/488). No second retry was run.

`source-copy-map.json` maps every retained source to its packet path with byte count, SHA-256, and capture qualification. `SHA256SUMS.txt` covers this README, the map, and all packet evidence files. ZIP hashes are checked against GitHub’s artifact metadata, and member hashes are computed from the retained archive bytes.
