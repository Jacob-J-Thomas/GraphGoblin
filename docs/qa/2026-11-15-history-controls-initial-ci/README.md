# History controls initial-stack CI

All five jobs passed on the first recorded runs for the initial PR #480 stack. The Actions checkout in all five logs is GitHub's synthetic merge `20ded0912f50f8c425aa251a8a9b150a454fdcc5`. Its parents are the canvas base `993d58a781ed2f0b4d13756c39e83162307b0ccd` and history head `c2cffebb7ca1bbea41ae72a37b9f232c90681906`. Its tree equals the reviewed history tree `621ceb492fc333aae30b9051e06eed0be31d3461`. [Gate status](evidence/source/gate-status.json) · [CI merge Git object](evidence/source/merge-git-object.json)

| Job                 | Run / job ID               | Observed result                                                                                                                                                                                   |
| ------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gates               | 43660933831 / 132649885810 | 22 coverage tasks passed. Web had 2,680 tests across 218 files. Dependency audit passed its high-severity threshold and reported 8 low and 13 moderate findings. [Log](evidence/source/gates.log) |
| Browser             | 43660933831 / 132649885736 | 480 browser tests passed, with zero retries and one expected live-provider skip. [Log](evidence/source/browser.log)                                                                               |
| Windows launcher    | 43660933831 / 132649885585 | 14 native launcher tests passed. [Log](evidence/source/windows.log)                                                                                                                               |
| Template image      | 43660933831 / 132649885854 | Template image job passed. [Log](evidence/source/template.log)                                                                                                                                    |
| Routing performance | 43660933847 / 132649885370 | Both routing tests passed. [Log](evidence/source/routing.log)                                                                                                                                     |

The retained workflow and job records identify the completed runs and individual step conclusions. The PR body was updated with the current-stack CI result, and the fresh PR GET matched it at the same head and base. [Workflow runs](evidence/source/runs-final.json) · [CI jobs](evidence/source/jobs-final.json) · [Routing job](evidence/source/routing-job-final.json) · [PR publication readback](evidence/source/publication-readback.json)

The separately observed actual-main tip was `41bde22c80a796bf8c4bec8ab5dec8e755271f9e`. These logs establish CI on the initial canvas stack. Corrected #478 integration and a candidate on the actual main line still need fresh CI, independent native verification and Astra max sign-off. Owner acceptance and #208 closure remain open.

## Integrity

The packet preserves all 17 original artifacts, including five exact log transports and five decoded logs. The decoded UTF-8 bytes match each retained transport and the recorded SHA-256. [Log decode readback](evidence/source/decoded-logs.json) · [Raw-copy manifest](raw-copy-manifest.json) · [Omissions](omissions.json)

The checksum list covers every packet file except itself. Git text conversion is disabled for the evidence subtree. [SHA-256 checksums](SHA256SUMS.txt) · [Link check](link-checks.json)
