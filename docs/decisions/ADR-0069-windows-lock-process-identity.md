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
bounded output and a five-second timeout for foreign PIDs. Its once-per-process self lookup gets
two attempts of at most twenty seconds each, within the default sixty-second launcher startup
budget; transient failure is retried and final failure names the probe cause. It caches only its
own identity; other PIDs are queried
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
one-writer invariant, canonical paths and token-checked release remain.

Each `.reclaim` guard is now an atomically published **nonempty directory**, prepared under a
unique sibling name and renamed into place. Its sole file is `<UUID-v4>.json`, and that UUID is
the record's ownership token. Reclamation deletes only the observed immutable marker name and
then removes only an empty directory. A delayed identity result cannot unlink a successor's
different marker; its nonempty directory also prevents a contender's rename from replacing it.
Main-lock reclamation runs only while this guard is held. A second read followed by unlink would
still leave a cross-process race, so it is not used as an atomic compare-and-delete substitute.
A crash before publication can leave an ignored `.reclaim.<UUID>.tmp` staging directory.
Old file guards, links and malformed marker directories are refused, never converted.

This supersedes only ADR-0064's PID-only ownership precheck. Held or unverifiable ownership is
reported with the exact refused path. Verified live ownership retains port/startup/shutdown
guidance; unverifiable ownership names the missing identity, timeout, process-start or WMI failure.
The helper returns a structured JSON result consumed by the launcher.
No unrelated process is stopped and permissions are never relaxed.

## Upgrade and verification

Rebuild the API and reinstall the launcher together; preserve its configuration and shortcuts.
Cleanly stop the previous gateway before updating so its PID-only records are released normally.
For an abandoned older record whose PID has been reused, verify the actual process and boot
history, back up the unchanged record, and remove only the independently proven stale lock.
Older abandoned regular-file `.reclaim` guards also require independent verification and manual
cleanup before upgrading; new binaries refuse them. Do not run old and new writers concurrently.
Never infer staleness from a process name or an access denial alone. No database migration,
data reset, workflow rewrite or export/client format change is needed.

Unit tests cover identity success/failure, bounded probes, self caching, repeated foreign-PID
checks, stale/matching/unknown ownership, the main and database locks and reclamation guards.
Native Windows acceptance seeds former identities onto a real live unrelated PID and an
inaccessible SYSTEM process whose `HasExited` access returns Windows error 5. It verifies
reclamation without stopping either process. A separate regression races five independent API
lock processes in three trials, keeping all successful acquisitions alive until every contender
reports; exactly one may own the lock. Concurrent launcher clicks separately verify the launcher
mutex. Matching identities and PID-only protected records remain refused. These simulate reuse without rebooting the test host. Actual reboot observation remains
separate from these deterministic process-level regressions.
