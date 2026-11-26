# ADR-0091: Bounded startup ownership cleanup

Status: Accepted under delegated delivery decisions FUP-044 and FUP-091, 2026-11-25.

## Context

API startup takes a data-directory lease and, for a file database, a database lease before it
opens SQLite (ADR-0069 records the Windows ownership identity). Two setup cleanup paths could lose
the reason startup failed (#560). A failed write of a newly created lock record closed its handle
twice and let a close or unlink failure replace the write failure. A failed `createContainer`
setup closed SQLite and released both leases inside nested `finally` blocks, so a cleanup failure
replaced the original failure, and the read-only client's close could replace a store refusal.
Releasing a lease after a SQLite close failed could also admit a second writer while the first
connection might still be open.

Windows recovery had two related limits. A process releasing its own recovery guard rolled back
its main lock whenever removing the emptied guard reported `EPERM`, even when a verified live
successor had already published its own guard there (#542). Recovery marker reads that failed
for reasons other than disappearance escaped without an operation label, and failed read-only
probes during `EPERM` classification went unreported (#537). Merged #582 already classifies the
acquisition-side `EPERM` and refuses a verified successor with the ordinary held refusal.

Controlled filesystem faults reproduced the cleanup losses. They do not identify the kernel cause
or the frequency of the historical Windows recovery failures.

## Decision

1. Startup cleanup reports through one API-private tagged error, `StartupCleanupError`. Its
   primary is the original failure, first in `errors` and its `cause`. Failed cleanup steps
   follow in the order attempted, each with a closed operation label and a vetted Node code or
   `UNKNOWN`, and the error lists the ownership it deliberately kept. A tagged primary is
   flattened, preserving causal order. When cleanup settles, the original error object is thrown
   unchanged. Only this type lets startup reporting look past the outer error: managed startup
   classifies the primary with the existing closed causes, and shell startup prints the primary's
   usual rendering plus one escaped line of labels, codes and retained paths, never cleanup error
   messages. An arbitrary `AggregateError` is not interpreted.
2. A newly created lock record whose write, attestation or close fails is closed exactly once. It
   is removed once, only after proof at the configured, non-followed path: a partial record by
   the physical identity its handle reported before closing, a complete record by its exact
   random-token bytes. An absent or foreign file ends only the in-process reservation and is
   never touched. If identity is unavailable, the check fails or the unlink fails, the record and
   its reservation are kept and reported as retained. The recovery guard release still follows,
   and its failure is appended behind the record's own cleanup.
3. In `createContainer` setup, a failed read-only or mutable SQLite close keeps both acquired
   leases and reports them as retained; the read-only close cannot replace a guard or catalog
   failure, and a close-only failure is its own primary. Otherwise the database lease and then the
   directory lease are each released once, even if the first release fails.
4. On Windows a process captures its just-published guard's identity with `lstat`, a listing of
   only its own marker, and `lstat`, consistent with its staged directory. A capture failure
   changes nothing else. Only after its release removed its own exact marker may an `EPERM` from
   removing the emptied guard be classified, once, by #582's positive successor criteria against
   that captured identity. A verified successor completes the release, keeping the main lock and
   claiming no reclamation. Unknown identity and every unverified state keep the filesystem error
   and the existing rollback. The private check reads the physical path instead of the in-process
   `heldPaths` shortcut; ordinary acquisition and failed-release reservations stay fail-closed.
5. A recovery marker read that would already escape is labelled `observed-marker-read` or
   `recovery-marker-read`, with its token, vetted code and original cause. Failed read-only probes
   during `EPERM` classification are attached to the unchanged `recovery-directory-remove` error as
   `probeFailures` with closed labels; their text stays off printed output. A credible mismatch is
   a decision and adds no entry. The verified acquisition successor remains exactly `held(path)`.

## Alternatives

- Release both leases after a failed SQLite close to finish cleanup: rejected, because the
  connection may still be open and another writer could start.
- Wrap cleanup failures in a plain `AggregateError`: rejected, because known refusals would lose
  their managed category and shell explanation. Classifying any `AggregateError` by its first
  entry was rejected because unrelated aggregates would be reinterpreted.
- Accept degraded generic categories for compounded faults: rejected, because it hides the cause.
- Delete a failed record by pathname alone, or retry close, unlink or `rmdir`: rejected, because a
  foreign or successor file could be removed and repeated destructive calls have no bound.
- Handle-based compare-and-delete for the guard or record: not available portably with this
  protocol. Stat, read and remove remain separate observations; one attempt per observed
  opportunity, immutable UUID markers and nonempty successor guards supply the protection.
- Treat a changed guard identity alone as a successor: rejected, because a changed empty or
  unverifiable directory proves no owner.
- Attach `EPERM` details to the verified acquisition successor refusal: superseded by FUP-091,
  which keeps #582's ordinary held refusal unchanged.

## Consequences

Operators see why startup failed and what cleanup kept. A retained lease or partial record can
block the next start until the process exits or the record is inspected, which is the intended
conservative outcome. A Windows release that meets a verified successor no longer gives up its
main lock. Pathname checks are not atomic; protection against arbitrary concurrent filesystem
changes is not claimed. Disposal of a returned container, shutdown sequencing and `serve` stop
keep their existing cleanup and are outside this decision. Maintained tests use real disposable
filesystem state with controlled faults; independent native contention and QA remain separate
evidence.
