# #436 ordinary Windows native-gate failure

This packet preserves one hosted Windows job where the build passed but the existing native launcher suite failed. GitHub then skipped the admitted #436 binder step. This is not an #436 runtime, installer, or process-witness result, and it makes no full-workflow green claim.

## Job result

Windows job 133093664323 in attempt 1 of Actions run [43804982239](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/43804982239/job/133093664323) built successfully, then the ordinary launcher suite reported 16 passed, 1 failed, and 0 skipped. The alias test passed for both a real junction and directory symlink. The failed top-level test was `independent API processes never share ownership while reclaiming a reused PID`.

Across its three recorded trials there was exactly one acquired owner and four refusals per trial. In trial 3, refused PID 952 reported `EPERM: operation not permitted, unlink` on a `graphgoblin.lock.reclaim` record. That message did not match the test's accepted ownership-refusal diagnostics. The final trial-3 lock-record assertion did not run after the refusal-regex assertion failed. The cause of the unlink error was not established. Existing issue [#471](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/471) tracks this behavior; this packet creates no issue and proposes no fix.

Because the ordinary test step failed, GitHub skipped the #436 binder step. No checksum-corrected binder, driver, ETW session, runtime binding, or installer cases ran. The 628-byte [artifact ZIP](evidence/artifact-14198461124.zip) contains only the build receipt, which records Node 22.23.4, build exit 0, and identical index hashes before and after. It is not a native execution artifact.

## Identity and evidence

Run 43804982239 attempt 1 used actual merge `190ef604417887325ab557edd31884cbed68cd26`, tree `382dcd6fa76f8b04a914787e08d9291d1672d088`, first parent `be633141be5a0cd2b4f960a46761fabbf2cb82c7`, and carrier head `36048e8f40cda520c2ec7b5865d3ff8c5bae6624`. The [sealed report](report/README.md.txt) and [Windows log](evidence/windows-job.decoded.log) preserve the detailed test failure and job record. The log is byte-exact, 80,100 bytes, with its leading BOM and final CRLF.

The [build-only ZIP](evidence/artifact-14198461124.zip) is 628 bytes, SHA-256 `44c9aaf780900553f6afee930111223d3db32200ea3d6a2d309b3a06f13dc4e7`, with one build-receipt member. The [member inventory](evidence/artifact-member-inventory.json) and [source-copy map](source-copy-map.json) record that member; the extracted copy is not duplicated. The original 15-row source manifest is retained and verified against copied files or the ZIP member. The [packet SHA-256 inventory](SHA256SUMS.txt) covers every packet file except itself.
