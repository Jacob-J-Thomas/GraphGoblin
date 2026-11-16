# PR #497 formal review, scan 1

This packet archives the completed Claude Opus scan 1 and root triage for PR #497. Scan 1 returned READY; this is not the final independent review, merge approval, or owner acceptance. A separate Astra MAX scan 2 was running when this packet was prepared; no scan 2 report or verdict is included.

## Reviewed identity and result

| Ref                    | Commit                                     |
| ---------------------- | ------------------------------------------ |
| PR head                | `2732dd34457bcd9a7007e89c3fa11fe085af764c` |
| Target                 | `be633141be5a0cd2b4f960a46761fabbf2cb82c7` |
| Tree                   | `d064706fb48def7bacac5e434f96825c5850d214` |
| Tested synthetic merge | `80c581ebc95de2000c25ed2b5995d5a648fa95ba` |

The full [scan 1 report](full-report.md.txt) is preserved byte-for-byte, with its original Markdown extension mapped to `.md.txt`. The [root dispositions](root-dispositions.md.txt) are likewise preserved unchanged. Root published the report and dispositions in [PR #497 comment 6912181315](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/497#issuecomment-6912181315) and independently matched the exact comment readback.

The report found no introduced P0, P1, or confirmed P2 defect. It records unresolved U1 and follow-up candidate R1; root triaged them as separate parked issues: R1 to [#498](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/498), a future permanent regression improvement, and U1 to [#499](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/499), an unconfirmed OneDrive/cloud-reparse compatibility investigation. U1 has no native OneDrive installer or sync-stage reproduction. The report's pre-existing CI artifact observation O1 is a duplicate of [#496](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/496). These dispositions do not add a merge gate.

## Corrected qualifications

The report contains a count transcription error: it says Gates had 28 steps. Root checked the terminal job records and corrected the count to 32 successful Gates steps; the report remains unchanged. The report's ReFS aside is not proof of safety on ReFS: the recorded native evidence came from Windows/NTFS contexts, and ReFS identity/collision behavior was not exercised. This packet makes no ReFS support claim.

The scan is a static review, not a native installer reproduction. In particular, U1 remains unverified for an actual OneDrive-backed Desktop or sync-stage placeholder. The report's detailed scope, reasoning, and limitations are in the preserved full report. The separately accepted [current-head CI packet](../2026-11-16-installer-validation-final-ci/README.md) archives the ordinary four-job CI evidence; it does not resolve U1.

## Provider receipt and exclusions

The [derived provider receipt](provider-receipt-derived.json) records the configured and actual model, xhigh launch effort, successful exit, 59 turns, and selected actual model-usage counters. It contains the exact source byte counts and SHA-256 hashes for `launch.json`, `result.json`, and `exit.json`; the raw provider files are not copied. The private `events.jsonl`, raw `result.json`, and `stderr.log` are excluded. The report remains the review artifact of record.

Scan 1 used 1 of 3 formal review slots and is READY only. The source-copy map records included source paths and byte hashes; the SHA-256 inventory covers each packet file except itself.
