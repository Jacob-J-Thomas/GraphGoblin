# ADR-0069 - Windows lock ownership includes process creation identity

Date: 2026-11-10. Status: Accepted for the owner-requested reboot startup repair.

## Problem

After a reboot, Windows reused the PID in two abandoned GraphGoblin ownership files for an
unrelated protected system process. The launcher called `Process.HasExited` on that process and
reported only "Access is denied". The API's PID-only probe would also have refused the stale
locks. The owner confirmed startup worked after those two proven pre-reboot records were backed
up and removed; no database, settings or workflows were reset.

## Decision

On Windows, each newly acquired ownership record includes `windowsCreationTime`, the owning
process's `Win32_Process.CreationDate` expressed as an invariant UTC FILETIME decimal string.
This is the OS creation identity, not the wall-clock time the lock was written. Microsoft
documents [PID reuse and CreationDate](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-process).
Comparing exact identities avoids elapsed-time estimates and clock-change assumptions.

The API reads this identity through the system Windows PowerShell executable with no profile,
a five-second timeout and bounded output. It caches only its own identity; other PIDs are queried
again for each ownership observation. A Windows writer that cannot establish its own identity
refuses before acquiring any lock and names the WMI/PowerShell prerequisite.

A confirmed dead PID or the existing unheld self-PID rule still permits reclamation. For another
live or uncheckable PID, a valid recorded Windows identity and a different successfully observed
identity also establish staleness. Missing, invalid, denied, timed-out or ambiguous identity
observations never establish staleness. PID-only records cannot prove reuse and remain held
while their PID exists. No lock-format converter or timestamp heuristic is introduced. Other
platforms retain the existing PID policy.

The launcher uses the built API's read-only `instance-identity.js --store-state` helper instead
of maintaining a second process-liveness policy. It checks both the data directory and the
configured database, including their reclamation guards, without acquiring or deleting anything.
Actual reclamation remains exclusively in the API's guarded acquisition path. The existing
one-writer invariant, canonical paths, token-checked release and serialized acquisition remain.

This supersedes only ADR-0064's PID-only ownership precheck. Held or unverifiable ownership is
reported as an ownership problem with inspection guidance, rather than a raw access-denied error.
No unrelated process is stopped and permissions are never relaxed.

## Upgrade and verification

Rebuild the API and reinstall the launcher together; preserve its configuration and shortcuts.
Cleanly stop the previous gateway before updating so its PID-only records are released normally.
For an abandoned older record whose PID has been reused, verify the actual process and boot
history, back up the unchanged record, and remove only the independently proven stale lock.
Never infer staleness from a process name or an access denial alone. No database migration,
data reset, workflow rewrite or export/client format change is needed.

Unit tests cover identity success/failure, bounded probes, self caching, repeated foreign-PID
checks, stale/matching/unknown ownership, the main and database locks and reclamation guards.
Native Windows acceptance seeds former identities onto a real live unrelated PID, exercises
concurrent cold launches, verifies new identities and retains matching, PID-only and protected-PID
refusals. These simulate reuse without rebooting the test host. Actual reboot observation remains
separate from these deterministic process-level regressions.
