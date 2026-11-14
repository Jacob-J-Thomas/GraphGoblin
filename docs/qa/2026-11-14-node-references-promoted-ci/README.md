# PR #474 promoted-head CI evidence

This packet records the first green CI at PR #474 head `ae8add8a791699e905540465b5ddf929d00c50eb`, based on `a817e5ccb4fd598ca56089b97b4ce55e9cb6f58c`. `status.json`, workflow/job readbacks, the source log manifest, and five decoded logs are retained byte-for-byte. The raw transport JSON files are omitted because they duplicate those decoded logs.

## Current-head CI

The [CI run](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/43622692936) and separate [routing run](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/43622692920) both passed at this head on their first attempt. No retry was used for these current-head jobs.

| Job                 | Result                                                                                                                                                                                                                                                           | Evidence                                                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Gates               | Pass. 22 coverage tasks; web 2,510 tests across 201 files; domain 428 tests across 29 files; API 1,917 passed and 20 skipped; infrastructure 1,149 passed and 8 skipped. Dependency audit passed its configured threshold with 8 low and 13 moderate advisories. | [Job](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/43622692936/job/132531751995) · [raw log](raw/gates.log)    |
| Browser             | 479 passed, 1 expected live-provider skip, no retries (`--retries=0`).                                                                                                                                                                                           | [Job](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/43622692936/job/132531752410) · [raw log](raw/browser.log)  |
| Windows launcher    | 14 passed, no skips.                                                                                                                                                                                                                                             | [Job](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/43622692936/job/132531752443) · [raw log](raw/windows.log)  |
| Template image      | Pass.                                                                                                                                                                                                                                                            | [Job](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/43622692936/job/132531752295) · [raw log](raw/template.log) |
| Routing performance | Pass. Median routing p95 was 5.7 ms at 100 nodes and 5.9 ms at 300 nodes; the largest single-drag routing p95 was 10.0 ms, under the 16 ms per-drag threshold. Drag-frame p95 was about 33.4 ms, so this is not a 60 fps claim.                                  | [Job](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/43622692920/job/132531662340) · [raw log](raw/routing.log)  |

No current coverage percentage is stated here. The individual raw logs and [log-manifest.json](raw/log-manifest.json) bind the counts, run/job identities, byte sizes, and source hashes. [Workflow readback](raw/workflows.json), [CI jobs](raw/jobs-ci.json), and [routing job](raw/jobs-routing.json) retain the job metadata.

## Earlier failure and limits

The earlier `ba3086` format failure affected two raw Markdown reports and remains preserved in the canonical [first CI packet](../2026-11-14-node-references-ci-first/README.md). The green run here is at the newer `ae8add8` head and passed on its first attempt; it is not an unchanged retry of that failure.

The [PR body snapshot](raw/pr-before-green-body-update.json) is historical metadata captured before the green-job body update. It is not the current PR body or a current status readback. Independent native promotion and formal reviews remain separate and pending; this packet makes no owner-acceptance or completion claim.

See [status.json](raw/status.json) for the head/base and first-attempt record. The packet [manifest](manifest.json), [link audit](link-checks.json), and [SHA256SUMS.txt](SHA256SUMS.txt) record source-to-copy provenance and integrity.
