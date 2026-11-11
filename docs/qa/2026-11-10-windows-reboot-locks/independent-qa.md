> Superseded readiness conclusion: the six narrow passes below did not establish independent-process exclusion. Subsequent QA reproduced 4, 3, 4 and 4 simultaneous owners and blocked the initial candidate. See [the race finding](cross-process-race-finding.md) and [the corrected guard verification](guard-regression.md) for the current outcome.

# Independent ownership QA — 2026-11-10

Candidate: `4cc66d26` (`codex/windows-reboot-lock-recovery`), built with Node `v22.23.4`.
Scope: the built API's exported ownership functions and the built read-only launcher helper. This is independent touched-system QA, not an Opus PR review.

## Historical initial outcome

Six process-level scenario groups passed in the final run. No confirmed ownership-safety defect was found. All fixture processes and files were disposable; the owner's store, gateway, port 4747, shortcuts, Windows permissions, and repository implementation were untouched. The unrelated live Node fixture survived every ownership check and exited normally on stdin EOF during cleanup.

| Scenario                                                                                                                                  | Result | Evidence                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A live unrelated PID with a different recorded OS creation identity across the directory lock, database lock, and both reclamation guards | PASS   | Read-only helper reported free without changing any file hash; guarded acquisitions replaced only stale ownership records, wrote the current process identity, and preserved database/unrelated sentinels. |
| Matching live identity in each of the four ownership files independently                                                                  | PASS   | Helper reported held, acquisition refused, and all file hashes remained unchanged.                                                                                                                         |
| PID-only, null, numeric and malformed identity fields                                                                                     | PASS   | Each stayed held with its original bytes.                                                                                                                                                                  |
| Failed identity-provider executable lookup with a live PID and different recorded identity                                                | PASS   | Both helper and direct API check remained held; acquisition refused and file hashes were unchanged.                                                                                                        |
| New writer unable to establish its own identity                                                                                           | PASS   | Actionable WMI/PowerShell error, with no ownership files created.                                                                                                                                          |
| Six concurrent in-process contenders for a proven stale record                                                                            | PASS   | Exactly one acquired ownership; five refused; normal release removed only the acquisition's record.                                                                                                        |

## Artifacts and reproduction

- `independent-qa.mjs`: standalone probe, imports the candidate's built modules.
- `independent-qa-output.log`: six passing scenario records.
- `independent-qa-results.json`: runtime, fixture identity, retained fixture directory and durations.
- `independent-probe-timing.mjs`: identical direct PowerShell/CIM command timing probe.
- Retained successful fixture directory: `independent-process-FDTxqX` beside this report.

Run with the project-scoped Node 22 runtime:

```powershell
$env:PATH = "$env:USERPROFILE\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64;$env:PATH"
node C:\Users\98jak\graphgoblin-qa\2026-11-10-launcher-recovery\independent-qa.mjs
```

Built module SHA-256 values inspected:

- `apps/api/dist/data-dir-lock.js`: `007A07A167782D6504C5CB154009EF2F4BBE2EA9B2B2457B21B91F98C7ED3D53`
- `apps/api/dist/windows-process-identity.js`: `0C28C91E12E7E904FFBA7A28C2E6554114294C5468D906BD1DFDE965CA57B682`
- `apps/api/dist/instance-identity.js`: `816F33867C839294004D04A8BAA9923FD241D933C0C72DA199EC246EBE16B09F`

## Transient result and limitations

An intermediate run returned an unknown identity for the first real live-process probe while other repository gates were running. This occurred before any lock mutation. The production helper deliberately suppresses underlying probe errors, so this observation alone does not establish whether it timed out, failed to start, or encountered another transient. Three immediately subsequent direct executions of the identical CIM command completed in 426 ms, 385 ms and 381 ms, each returning the same creation identity with empty stderr. The final complete run above passed. The orchestrator was notified to correlate this with full-gate load and startup reliability; no unsafe reclamation was observed.

An earlier unavailable-provider test incorrectly passed a nonexistent `SystemRoot` to Node itself and caused Node's cryptographic initialization to fail before loading GraphGoblin. The harness was corrected to alter that variable only after Node initialization. This was a test-harness fault, not a GraphGoblin finding.

No actual operating-system reboot was performed. PID reuse was simulated by attaching a different valid creation identity to a real unrelated live process, which directly exercises the new distinction. Native launcher, Chrome UI, cross-process launch concurrency, full repository gates, CI and Opus PR review are separate evidence owned by the orchestrator.
