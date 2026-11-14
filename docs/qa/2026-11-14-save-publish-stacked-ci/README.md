# PR #475 stacked-head CI evidence

This packet records the first green GitHub Actions runs for PR #475 head `1dcee36b16cc4662e8acb691e9166aff52949ad9`, based on PR #474's branch at `ae8add8a791699e905540465b5ddf929d00c50eb`. It is stacked-branch evidence, not a result against actual `main`: the parent integration, retargeting to actual `main`, and current-target verification remain required before treating this as final integration CI.

The [CI workflow run](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/43625241660) completed with all four jobs successful on the first attempt. The separate [routing performance run](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/43625241655) also passed on its first attempt at the same head. Run and job IDs are preserved in the raw [workflow](raw/workflows.json), [CI jobs](raw/jobs-ci.json), and [routing job](raw/jobs-routing.json) snapshots; these are the corresponding job permalinks:

| Job                 | Result                                                       | GitHub job                                                                                              |
| ------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Browser             | 479 passed; 1 expected live-provider test skipped; retries 0 | [132539498186](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/43625241660/job/132539498186) |
| Template image      | Passed                                                       | [132539498409](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/43625241660/job/132539498409) |
| Windows launcher    | 14/14 passed                                                 | [132539498444](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/43625241660/job/132539498444) |
| Gates               | Passed; 22 coverage tasks                                    | [132539498477](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/43625241660/job/132539498477) |
| Routing performance | Passed, first attempt                                        | [132539497940](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/43625241655/job/132539497940) |

The gate log records 2,551 web tests across 204 files, 428 domain tests across 29 files, 1,917 API tests passed with 20 skipped, and 1,149 infrastructure tests passed with 8 skipped. The configured high-severity dependency-audit gate passed; its output reports 8 low and 13 moderate findings. The browser job ran the built app on Edge with zero retries; its one skip is `live.spec.ts`, which needs a live Codex provider. The template job tested the distributed image's bundled templates without network access or writable storage.

Routing measurements in the separate job report median routing p95 values of 4.6 ms at 100 nodes and 5.1 ms at 300 nodes; the largest single routing p95 was 7.9 ms, below the 16 ms per-drag bound. Measured drag frame p95 was about 33.4 ms, so these results do not support a 60 fps claim.

The [pre-green PR body snapshot](raw/pr-before-green-update.json) was captured after the runs completed but before the PR body was updated with their green status. Its older text says current-head CI was pending and is not the live PR body. The current formal UI review is still in progress; this packet does not claim formal review completion or owner acceptance. After PR #474 is integrated into actual `main`, PR #475 must be integrated and retargeted, with its relevant CI rerun against that target before final integration claims.

The five decoded logs are preserved byte-for-byte under [raw](raw/), and [log-manifest.json](raw/log-manifest.json) records their original lengths and SHA-256 digests. The connector transport JSON files were omitted because they duplicate those decoded logs. See [manifest.json](manifest.json) for source-to-copy hashes, [link-checks.json](link-checks.json) for link verification, and [SHA256SUMS.txt](SHA256SUMS.txt) for packet integrity.
