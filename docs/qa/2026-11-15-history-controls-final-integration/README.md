# History #480 final-parent integration evidence

This packet records source and verification evidence from the final-parent integration check. It is not a current-head CI result, native completion, or readiness sign-off.

## Integration identity

- Prior history source head: `c2cffebb7ca1bbea41ae72a37b9f232c90681906`, from prior base `993d58a781ed2f0b4d13756c39e83162307b0ccd`.
- Actual main after PR #478: `1cfca9bce3967c9d41950266c83aab636667e0ab`.
- Final-parent check head: `6b0eae62ea98ae73b22903c9922bba198e219608`, tree `5996caf9f060c899b305553fc3e359bf86990847`.
- Ordered parents recorded by the integration readback: `832c1b3271195f108dcb26b00b585b47f0eb9114`, then actual-main merge `1cfca9bce3967c9d41950266c83aab636667e0ab`.
- A separate read-only `git show` receipt confirms commit `6b0eae62ea98ae73b22903c9922bba198e219608`, its tree and ordered parents, with `GIT_OPTIONAL_LOCKS=0`; see [commit identity receipt](evidence/git-show-identity.txt).
- The readback identifies 13 product/test paths from the prior history source as the only product delta against actual main. Their source blobs match `c2cffebb7ca1bbea41ae72a37b9f232c90681906`; before/after source and index records are stable. Documentation-only conflicts were resolved by preserving both sides. No source change was made during these checks.

## Verification record

- The first focused run passed 224 tests across 13 files in 76.38 seconds. It was not rerun.
- The initial evidence wrapper exited 1 while trying to hash a missing `eslint-first.log`. ESLint emitted no output, so `Tee-Object` had not created the file; that wrapper receipt did not persist the first ESLint exit code or diagnostics, so the first lint outcome is not established by that receipt. The original error, first focused log, and initial type log are retained.
- A static-only receipt pass later recorded exit 0 for typecheck, ESLint, and Prettier. It did not rerun Vitest. The ESLint output log is intentionally zero bytes; its exit code is recorded in the JSON receipt.
- `source-before.json` and `source-after.json` preserve the 13 product/test working hashes and the unchanged index digest. [The final-parent integration readback](evidence/final-parent-integration-readback.json) records the 13-path product comparison and documentation metadata.

## Pending evidence

The preparation snapshot at 2026-11-15 05:07:32Z records `buildOrBrowserExecutions: 0`. It is metadata for native preparation only; this packet does not include driver files, browser recordings, or native run logs. At packet preparation, the separate 11-group history native run was still running. Current-head CI and Astra review for this final integration head remain future evidence.

One formal scan has been used for history #480. This packet is source-check evidence only and does not establish completion or readiness.

## Preserved records

- [First focused run](evidence/final-parent-checks/focused-first.log) and [commands](evidence/final-parent-checks/commands.json)
- [Original wrapper error](evidence/final-parent-checks/first-wrapper-error.txt), first type output, and [corrected static exit receipts](evidence/final-parent-checks/results.json)
- [Source before](evidence/final-parent-checks/source-before.json), [source after](evidence/final-parent-checks/source-after.json), and [native preparation metadata](evidence/final-parent-checks/native-preparation-readback.json)
- [Root integration readback](evidence/final-parent-integration-readback.json) and [check wrapper script](evidence/run-final-parent-checks.ps1)
- [Read-only Git commit identity](evidence/git-show-identity.txt)
- [Evidence copy and exclusion manifest](evidence-manifest.json) and [SHA-256 sums](SHA256SUMS)

No source tree, product diff, native run logs, or CI logs are duplicated here. Raw evidence files are retained with their original bytes; `.gitattributes` disables line-ending conversion for JSON, log, script, and text evidence.
