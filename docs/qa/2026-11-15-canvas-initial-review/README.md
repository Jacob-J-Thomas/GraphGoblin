# Canvas initial independent review — scan 1

This packet preserves the first of three formal review scans for the corrected #207 canvas candidate submitted through PR #478. The full report and brief are byte-preserving copies at [report.md.txt](evidence/source/report.md.txt) and [brief.md.txt](evidence/source/brief.md.txt). Exact source hashes are listed in [raw-copy-manifest.json](raw-copy-manifest.json); the one intentionally omitted artifact is identified by hash in [omissions.json](omissions.json).

## Review result and identities

Scan 1 of 3 returned **CHANGES REQUIRED** against the immutable `993` candidate compared with the `bf9` stack. The report records F1 and F2 as fixes required and marks P3 `DEFER-ISSUE`, recommending a dedicated placement change. The root disposition later parked P3 in #479. The node-drag probe and exact-`993` native evidence were still pending. This packet adds no review scan and makes no claim of native proof or final approval.

The exact report SHA-256 is `c05e27490c8a1299d5fc697d3393ae754b03cd858fef7fedf51f48efc506585d`; the brief SHA-256 is `29ad1871789e6639e02b06c0e3570e8b71419e91d656f8cfe9f4934b1a9e2a5c`. The immutable candidate identity is in [identity.json](evidence/source/identity.json), and non-QA paths are recorded separately in [non-qa-paths.txt](evidence/source/non-qa-paths.txt) with the corresponding scoped [non-QA diff](evidence/source/non-qa.diff).

## Disposition and evidence readbacks

The packet includes the source/evidence identity and PR publication readbacks, plus the root-verified disposition record. That record contains the exact body submitted with #478 comment `6886454200` and the add-comment response ID. It includes PR body/state readback but no separate GET of the posted comment, so comment persistence was not independently read back in this artifact. The follow-up #479 issue object records its exact body and labels. See [source-and-evidence-readback.json](evidence/source/source-and-evidence-readback.json), [publication-readback.json](evidence/source/publication-readback.json), and [disposition-publication-readback.json](evidence/source/disposition-publication-readback.json).

## Omission and limits

The generated full `exact.diff` is not copied: it is 30,138,128 bytes and duplicates the Git source diff. Its exact SHA-256 (`40b767888f7368021072da29847bac6020d761a2dada43c53a4d684c7cb5d277`) and size are preserved in `omissions.json`. The smaller non-QA diff and all review reports/readbacks are included. Original source artifacts remain untouched.

This is scan 1 of 3 only. Do not infer that the candidate has passed all review or native gates; the node-drag probe, exact-`993` native evidence, later scans, and any owner disposition remain outside this packet.

`SHA256SUMS.txt` covers all packet files other than itself. `.gitattributes` marks copied evidence as binary so Git does not normalize line endings.
