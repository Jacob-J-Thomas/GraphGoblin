# PR #497 corrected candidate: non-Windows CI evidence

This packet preserves attempt 1 of [workflow run 43823828028](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/43823828028), on PR #497 head `fb57110dd3807871c5e1ed5e4c09f4b3d55dfb3c` against base `be633141be5a0cd2b4f960a46761fabbf2cb82c7`. Root verified synthetic merge `0b0d26d5d23e88b0b004c66f2155470a24c6ebcd`, tree `be7faa5571a4065740a1212c58b0e54e8342a79f`, with ordered parents base then head. The workflow ended **cancelled**: Gates hit its maximum job duration. Browser, Template image, and the Windows launcher job succeeded. There was no separate Routing job. The Windows job's detailed log and artifacts remain with its native-QA owner and are not duplicated here.

## Gates: recurring 30-minute deadline

Gates job 133152815731 started at 07:26:08Z and completed cancelled at 07:56:25Z. Its official annotation says “The job has exceeded the maximum execution time of 30m0s”; the log also records “The operation was canceled.” The first 22 steps succeeded. The “Unit tests with coverage thresholds” step was cancelled, steps 24–27 (licence, generated docs, design-token contrast, and dependency audit) were skipped, and the always-run coverage upload succeeded.

From the Gates job start to the coverage command at 07:36:22.276Z, precoverage work took 10m14.276s. The coverage command ran until the cancellation log line at 07:56:21.438Z, a 19m59.162s window. Ten of the 13 package groups completed: 9,426 tests passed and 38 were skipped. The uploaded coverage archive (artifact 14206034649) is 19,720 bytes, SHA-256 `af2bbb54811885a53ee2c2ea988e245bff56cd9e4a2098aa3053c38d27c1ce5a`. Its ten JSON summaries are listed in [member-map.json](coverage/member-map.json); each included package meets the 90% line and branch floors. The absent summaries are `tooling`, `plugin-codex`, and `plugin-claude`. The log contains no final Turbo task-count summary, and these partial results do not convert the cancelled coverage step into a passing Gates job.

The only supported cancellation mechanism is the documented 30-minute job maximum. Timing comparisons are retained in [timing-comparison.json](provenance/timing-comparison.json): the earlier candidate attempt on head `596bbb` also reached the deadline after 20m20.478s of coverage with 13 package groups; the previously passing #435 main run completed coverage in 14m1.742s with 13 groups. These are different revisions and do not establish a code or runner-performance cause. Root recorded the recurrence on [issue #488](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/488#issuecomment-6910881749). No retry is part of this packet.

## Other jobs

- **Browser** (job 133152816250): success, 481 passed, 1 skipped, no retries, one worker, 21.6 minutes. The skipped `live.spec.ts` case requires `LIVE=1`; CI sets `LIVE=0`. Optional strict performance mode was off. It ran Edge 157.0.4341.60 on a hosted Ubuntu runner. The Windows user-agent text is browser metadata, not native Windows evidence.
- **Template image** (job 133152816093): success. The image loaded starter, implementation, review, and qa catalogs offline with 4, 11, 10, and 11 draft nodes. Its log also records the shared-lockfile/legacy-deploy warning.
- **Windows launcher** (job 133152816074): success by job metadata only. Native details are intentionally left to the separate Windows evidence owner.
- Project setup logged Node 22.23.4. The action-host Node 20 deprecation/forced-Node-24 notice is separate from the project runtime.

For the earlier attempt on head `596bbb`, see the [first-candidate non-Windows packet](../2026-11-16-installer-candidate-other-ci/README.md). For the previously passing #435 CI baseline used only as a timing reference, see the [launcher identity CI packet](../2026-11-16-launcher-identity-current-ci/README.md).

## Evidence and limits

The complete decoded Gates, Browser, and Template logs, job steps, annotations, initial and terminal run/job readbacks, and tested synthetic merge identity are included under their respective folders. The coverage ZIP is included once; its member map records exact entry hashes and percentages. Temporary signed artifact URLs and private provider streams are excluded. No job was rerun or cancelled by this collector.

See the [source-copy map](source-copy-map.json) and [SHA256SUMS.txt](SHA256SUMS.txt), which hashes every packet file except itself.
