# Windows reboot ownership recovery

Base: `ad5439133a4506f8d8634ae2a6730dd65533ffee`. Node 22.23.4, native Windows.

## Change contract

The owner reported an access-denied launcher dialog after reboot and authorized diagnosis, local
repair, a warranted preventive PR, up to three adversarial Claude Opus 5.5 PR reviews with direct
PR comments, and merge/local update after passing checks and review.

The installed executable and configured Node runtime were readable and executable. Both store
locks referred to the previous gateway PID, now reassigned to a protected Windows process whose
creation time was after the recorded lock and boot boundary. Reading `Process.HasExited` produced
Win32 error 5. The owner confirmed successful shortcut startup after the two independently proven
stale records were backed up and removed. No workflow, settings, database, permissions or unrelated
process was changed. The earlier automatic approval rejection of an agent-triggered installed
gateway launch was respected; the owner performed the successful shortcut test.

Scope: Windows ownership identity, shared read-only launcher/API policy, diagnostics and regressions.
No crash supervisor, autostart, installer redesign, provider behavior or data conversion. Existing
follow-ups #434–#438 remain separate. No stored data reset or migration is needed.

Invariants: one writer per canonical store/database; no takeover on ambiguous identity; no unrelated
process termination; acquisition alone reclaims proven stale records under an exclusive guard;
read-only probes preserve bytes; release checks the acquisition token.

## Current correction evidence

The first candidate's readiness conclusion was withdrawn after independent direct-process QA
reproduced multiple simultaneous owners. [The correction report](guard-regression.md) records
that P1, all four Opus pass-one findings as `FIX-IN-PR`, the new immutable-marker directory guard,
and final **14/14 native** and **72/72 focused** passes. It retains the failing reproduction and
raw corrected output. These engineering results do not claim an actual reboot test or replace
the final Opus/CI gates recorded on PR #457.

## Initial executable evidence (superseded for readiness)

The retained raw output is in `focused-tests.txt` and `native-tests.txt` beside this report.

| Check                                                                                 | Result                                         |
| ------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `pnpm build`                                                                          | PASS, 11/11 tasks                              |
| API focused Vitest: `windows-process-identity`, `data-dir-lock`, `instance-identity`  | PASS, 66/66 tests                              |
| `pnpm test:windows-launcher`                                                          | PASS, 12/12 tests, 137.6 s                     |
| Foreign live PID with former identity in both locks and both reclamation guards       | PASS, concurrent cold starts admit one gateway |
| Matching creation identity, PID-only record, protected system PID                     | PASS, locks unchanged and no gateway log write |
| Wrong configuration/store, shared external database and malformed ownership           | PASS, refusal preserves existing owner/bytes   |
| Native shell link and HWND metadata cold relaunch, detached lifetime and normal drain | PASS                                           |
| Plain-health and eight silent TCP listener trials                                     | PASS, no takeover                              |

Full repository gates, independent QA, exact reviewed heads, Opus comment links and final CI/merge
status are recorded in the PR. No actual host reboot was performed for these regressions; they
exercise the distinguishing OS identity mismatch while the unrelated process remains live.

## Upgrade

Follow ADR-0069: stop the previous gateway cleanly, rebuild and update the launcher executable,
preserving its existing configuration and shortcuts. Confirm health, both shells, one gateway,
and matching Windows creation identities in both new ownership records. Older abandoned PID-only
records require independent stale-owner proof if their PID has been reused; they are not converted.
Abandoned regular-file `.reclaim` guards are also refused in the new physical-directory protocol
and require verified manual cleanup; no guard-format converter runs.
