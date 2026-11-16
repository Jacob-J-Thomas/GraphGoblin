# PR500 first CI attempt archive

This packet preserves PR500's first hosted CI attempt and the read-only diagnosis of its Gates cancellation. The later single Gates-only retry is being tracked separately; no retry result is included here.

## Identity and result

- PR #500 was tested at head `1c04263bcbfd93056e77ee98a9c5d705df26ea88`, target `e21c24be9cef109ef438fd2df4c1583bc570b1cb`. Synthetic merge `91a9396677b61cb88a802543e5fec5b379870541` had tree `332d414fea68cb2fffdd1c2baca620491ce1f341` and parents target then head.
- CI run `43863219176`, attempt 1. Gates job `133285078837` ran 12:04:07–12:34:24 UTC and was canceled at the 30-minute job limit; the official check annotation records “The job has exceeded the maximum execution time of 30m0s.”
- Gates completed ten package coverage groups: 9,528 passed / 46 skipped. The ten artifact members all meet the 90% line and branch floors. `tooling`, `plugin-codex`, and `plugin-claude` have no terminal coverage group or artifact member. The coverage job did not pass; licence, generated docs, design-token contrast, and dependency-audit checks were skipped.
- The other three jobs succeeded on this first attempt. Browser reported 481 passed / 1 declared LIVE skip, with zero retries and one worker; the optional strict performance mode was off. Template image loaded four catalog entries. Windows launcher reported 25 passed / 0 failed / 0 skipped, but its upload step found no matching evidence files, so no Windows artifact exists.

## Limits and diagnosis

The ten-group ZIP is the partial coverage artifact, not proof that the full 13-group coverage gate passed. Its exact archive digest, member hashes, and metrics are in [the member map](attempt-1/coverage-members.json). The saved `*.decoded.log` files are connector-decoded text captured as UTF-8; their hashes identify these saved decoded representations, not GitHub's original compressed job-log response. The downloaded coverage ZIP is retained as original artifact bytes.

The [read-only diagnosis](diagnosis/report.md.txt) confirms the deadline annotation and records the bounded timing comparison without assigning an unverified root cause. It recommends keeping Gates incomplete and tracking the recurrence under #488. No product change, assertion change, workflow change, CI retry, or formal review was performed in this diagnosis. [The full diagnostic readback](diagnosis/readback.json) and its original checksum seal are retained.

## Packet verification

[source-copy-map.json](source-copy-map.json) maps all retained files to their batch source paths with exact sizes and SHA-256 hashes. [SHA256SUMS.txt](SHA256SUMS.txt) seals each packet file except itself. The capture includes the first-attempt API metadata, all four job logs/steps, terminal job/run/PR snapshots, the official Gates annotation, the partial coverage archive and its member map, plus the bounded diagnosis. No signed download URL or authentication material is included.
