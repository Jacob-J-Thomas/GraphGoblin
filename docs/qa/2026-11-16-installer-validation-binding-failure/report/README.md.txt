# #436 corrected baseline attempt stopped in preflight

The corrected baseline reached the hosted binder and ran 0 of 32 cases. The execution-v2 preparation retained the original binder's hard-coded driver seal. The job supplied the reviewed native-v2 seal, so the binder rejected it before opening either packet, binding the checkout or outputs, launching the driver, or starting ETW. The full native matrix and process witness remain unobserved. [Hosted Windows job](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/43803466920/job/133088873299)

## First failure

- `bind-before.stderr` records Node 22.23.4 assertion `ERR_ASSERTION` at `bind.mjs:67:8`. The actual admitted driver seal was `ea5250650dc7f7b7815dd88c20476c50931ef29ae93467da1169c930aab47c1a`. The binder expected retired seal `6b4be7674b608a8583415dd75e642d483249d789eca678e14b641af958918926`. The frozen binder's line 12 defines that old literal and line 67 compares the admission field before its full packet checks. The exact original stderr and supervisor first failure are retained.
- Binder PID 1584, parent 7956, was born at 04:25:14.2178380 UTC and exited 1 at 04:25:14.3032306. Separate stream close recorded 04:25:14.3167312, 0 stdout bytes and 683 stderr bytes. There was no binder deadline. The supervisor recorded `nativeDriver: null`, `caseCount: null`, and `closingIdentityVerified: false`. No ETL or process-witness case evidence was created.
- The ordinary build and existing Windows launcher acceptance completed successfully. The build receipt records Node 22.23.4, exit 0 and equal index hashes before and after. The original native suite passed 17 tests. The isolated #436 step failed, and its always-upload step succeeded.

## Bound evidence and limits

Actions run 43803466920, attempt 1, job 133088873299 tested carrier head `f0e1f75ad81e83605dfdcb19f6745cf4aa3d6877` with actual PR merge `463e96b69de23f569bb1c8599860b3d804cf6874`, tree `1bf191aee4851996888935ca982ce973a2cd2f8f`, and first parent `be633141be5a0cd2b4f960a46761fabbf2cb82c7`. Independent Git object readback matched the workflow, all 48 allowed carrier changes, and 18 raw packet files including both seals. The archived build receipt matched the admission digest, and the binder launch recorded the archived admission digest. This checks the committed inputs and bootstrap receipts. The completed runtime inventory and closing comparison are unavailable.

Artifact 14196599189 is 5,798 bytes and contains 10 files. Its independently downloaded ZIP matched GitHub's SHA-256 `28edc9172a5cf7c3b2068a7d5c4af6c706a9d8d492435a6d6ad744a7be4d7c94`. The decoded job log is 98,177 UTF-8 bytes, SHA-256 `59b2ce2056da2598e0f2afbf3cc3aa05f1edf1992628095d13368721a91add7d`, with leading BOM and final CRLF preserved. No hosted retry or product edit occurred for this readback.

The correction needs a new execution packet with the reviewed native-v2 seal consistently pinned in the binder, admission example and carrier example. Verify those three values against the exact native manifest and the workflow's admitted driver choice before another dispatch. The packet and member validation can then run with the same scope and exact-seal checks.
