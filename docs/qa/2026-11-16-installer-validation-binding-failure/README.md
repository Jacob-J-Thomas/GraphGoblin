# #436 corrected-baseline hosted binding failure

This packet preserves the first corrected-baseline preflight failure for the #436 Windows installer validation work. It is evidence of a frozen-input binding mismatch, not an installer run or product result.

## Windows job result

Windows job 133088873299 in attempt 1 of Actions run [43803466920](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/43803466920/job/133088873299) completed its hosted build successfully and passed the existing native launcher suite (17 tests). The later corrected-baseline preflight failed before launching the driver. This packet does not claim that the full Actions run or all jobs passed.

The binder's `bind-before` check compared the admitted native-v2 driver seal `ea5250650dc7f7b7815dd88c20476c50931ef29ae93467da1169c930aab47c1a` with its stale hard-coded v1 seal `6b4be7674b608a8583415dd75e642d483249d789eca678e14b641af958918926`. It rejected the input at `bind.mjs:67:8` with `ERR_ASSERTION` before opening either packet, binding checkout/build outputs, launching the driver, or starting ETW. The driver ran 0/32 installer cases. There is no process-witness or runtime-inventory result from this attempt.

## Identity and preserved evidence

Run 43803466920 attempt 1, Windows job 133088873299, used test-only carrier head `f0e1f75ad81e83605dfdcb19f6745cf4aa3d6877`; actual merge `463e96b69de23f569bb1c8599860b3d804cf6874`, tree `1bf191aee4851996888935ca982ce973a2cd2f8f`, first parent `be633141be5a0cd2b4f960a46761fabbf2cb82c7`. The [sealed report](report/README.md.txt) preserves the exact mismatch and stop point. The [job log](evidence/windows-job.decoded.log) is byte-exact. The [artifact ZIP](evidence/artifact-14196599189.zip) is 5,798 bytes, SHA-256 `28edc9172a5cf7c3b2068a7d5c4af6c706a9d8d492435a6d6ad744a7be4d7c94`, with 10 members. The [member inventory](evidence/artifact-member-inventory.json) maps its contents; extracted members are not duplicated. The original 23-row source manifest is preserved, and all rows were checked against copies or ZIP members.

No retry, source edit, driver, ETW, or installer case ran for this readback. The next packet must use the reviewed native-v2 seal consistently in the binder, admission example, and carrier example. No product implementation or review verdict is included here.

The [source-copy map](source-copy-map.json) records source paths, destinations, sizes, and SHA-256 values. The [packet SHA-256 inventory](SHA256SUMS.txt) covers every packet file except itself.
