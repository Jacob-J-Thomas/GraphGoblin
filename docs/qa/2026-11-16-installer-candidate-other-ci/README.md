# PR #497 original non-Windows CI attempt

This packet preserves attempt 1 of workflow run [43819015672](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/43819015672), triggered on PR #497. The run tested candidate head `596bbb654acab323e96c446d646eeccd5ffc9b07` against base `be633141be5a0cd2b4f960a46761fabbf2cb82c7`. Root verified the tested synthetic merge `30973ad7c1fb3a74d34967efc17a07bf42d593ef`, tree `916bbcb9166f290839db280e6a0db172c0582527`, with ordered parents base then head. This is the earlier candidate run; it does not provide CI evidence for the later default Node discovery correction.

The workflow concluded **failure**. Browser and Template image succeeded; Gates was cancelled at its job deadline; the separate Windows launcher job failed. No Routing job was present. The Windows failure log and native artifact are retained by the separate [candidate Windows failure packet](../2026-11-16-installer-validation-candidate-first-failure/README.md) and are not duplicated here.

## Gates deadline and coverage output

Gates job 133137523083 ran from 06:45:59Z to 07:16:09Z. The official annotation states: “The job has exceeded the maximum execution time of 30m0s”; it also reports “The operation was canceled.” The “Unit tests with coverage thresholds” step was cancelled. The licence allowlist, generated-docs, design-token-contrast, and dependency-audit steps were skipped.

The full Gates log contains 13 package coverage summaries: 9,619 tests passed and 41 were skipped. Turbo reported 22 of 22 tasks successful, with 9 cached. The uploaded coverage archive (artifact 14205555299) is 22,033 bytes with SHA-256 `275a965441bcd5e4834b4f9ef949027c6c9d2c3ebce1425625cfdae896151d8a`. Its 13 `coverage-summary.json` members were read from the ZIP and hashed in [coverage-member-map.json](raw/coverage-member-map.json); every member's line and branch percentages meet the 90% floor. These summaries do not change the cancelled step or skipped Gates checks into a successful gate result.

## Other non-Windows jobs

- **Browser** (job 133137523330): success, 481 passed, 1 skipped, 0 retries, 1 worker. The skip is the LIVE test because CI sets `LIVE=0`. The optional strict performance mode was off. This ran Edge 157.0.4341.60 on the hosted Ubuntu runner; the emitted Windows user-agent is not native Windows evidence.
- **Template image** (job 133137523754): success. The built image loaded the starter, implementation, review, and qa catalogs offline, with 4, 11, 10, and 11 draft nodes respectively.
- The project runtime logged by setup-node was Node 22.23.4. The logs also contain action-host Node 20 deprecation/forced-Node-24 notices and the Ubuntu runner migration notice. The template build emitted a shared-lockfile/legacy-deploy warning; its catalog load step still succeeded.

## Evidence contents

The raw Gates, Browser, and Template logs are retained under `raw/`, with terminal step/job metadata and the exact Gates deadline annotations. The coverage ZIP is included once; its member map records each member's byte size, SHA-256, and line/branch percentages. Initial in-progress snapshots are kept separately from the terminal run readback. Signed artifact download URLs and private provider streams are not included.

The [source-copy map](source-copy-map.json) records copied and derived evidence, along with the Windows-log exclusion. [SHA256SUMS.txt](SHA256SUMS.txt) hashes every packet file except itself.
