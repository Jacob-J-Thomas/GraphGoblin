# #438 bounded logging implementation handoff

This packet preserves the implementation handoff and its command evidence. The implementation ran under Claude Code Opus 5.5 xhigh and exited successfully. It is not independent behavior QA, full current-head CI, formal review, or acceptance. At this checkpoint candidate QA, full CI, the opposite-family review, and the fresh Astra max audit remain pending; #438 has used 0/3 formal scans.

## Implementation and local results

The [full report](reports/full-report.md.txt) describes the bounded gateway writer, managed entry guard, private logging root, Windows launcher integration, documentation changes, and test results. [Native facts](reports/qa-native-facts.md.txt), [final touched-path hashes](reports/touched-paths-final.txt), and [built artifact hashes](reports/build-artifacts-sha256.txt) preserve source/build bindings.

The local build completed 12/12 tasks with no cache. The Windows API coverage run reported 2,062 passed and 16 skipped; lines were 95.42% and branches 91.01%. The main/subprocess suite reported 27 passed and 5 platform skips, and tooling identity reported 2 passed. API typecheck and lint, tooling lint, formatting, licence and documentation checks passed. These are scoped local results; the full repository gate and CI did not run.

The second local Windows launcher acceptance run exited 1 with 23/25 passing because this host denied creation of the directory-symlink fixture (EPERM) before the launcher code was exercised. The first run also exited 1: the same host limitation occurred, and a test port-pool exhaustion left a test-only PowerShell holder blocked. The original [run-one disposition](receipts/acceptance-run-1-disposition.md.txt) incorrectly says that closing stdin ended the holder. Root retained and terminated the exact native process handle for PID 47724 with exit code 99 at 10:44:52Z; no product process was signalled and no files were deleted. The original failed test remained failed. See the [root correction notes](root-correction/launcher-438-root-implementation-review-notes.md.txt), [initial cleanup receipt](root-correction/root-acceptance-01-unblock.jsonl), and [corrected cleanup receipt](root-correction/root-acceptance-01-unblock-v2.jsonl).

The implementation report also retains a local owner-profile ACL limitation: the default launcher folder was not private under the observed profile, so installation/launch would refuse until the ACL is corrected. No owner files or ACLs were changed. Tooling package coverage and Linux CI coverage were not measured.

## Related evidence

The [baseline packet](../2026-11-16-bounded-logging-baseline/README.md) reproduces the prior unbounded behavior: after 6,400 requests, gateway.log reached 8,660,042 bytes with zero rotations while held work succeeded. This is a baseline defect reproduction, not candidate acceptance.

The [stdio controls packet](../2026-11-16-bounded-logging-stdio-controls/README.md) qualifies the Windows observer and controlled NUL/pipe cases. Its original attempt is marked incomplete because the scratch-tree assertion found AppData; it does not prove the candidate launcher's actual handle inheritance or logging behavior.

## Archive contents and exclusions

The packet contains 91 byte-verified source copies: five report/hash/index files, 40 command receipts, 39 command-output logs, two small command helpers, and five root cleanup/correction files. Raw Markdown sources use the .md.txt suffix; the source-copy map records each original path, destination, byte count and SHA-256. Six first-failures inputs are not duplicated because each is byte-identical to a retained logs file.

Private provider events/results/stderr and final-message output, generated executables, disposable fixture/store trees, and raw gateway/store logs are excluded. The source-copy map records exclusions. SHA256SUMS.txt covers this README and all copied files except itself.
