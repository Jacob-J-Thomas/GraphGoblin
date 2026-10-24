# ADR-0049 - Normal drain and explicit force-stop

Date: 2026-10-23. Status: Accepted for the owner-approved bounded change #224.

## Decision

The container owns one shutdown controller. Main translates native SIGINT/SIGTERM and
closes HTTP only when the controller reports ready. Authenticated `GET /system/shutdown`
(`system:read`) observes it; `POST /system/shutdown` (`system:write`) accepts exactly
`{action: "drain" | "wait" | "force"}`. The first native signal requests drain. Signals within 1,000 ms of the preceding accepted signal are
coalesced because pnpm and the foreground process group can deliver one Ctrl+C twice.
A later signal requests managed force, including during startup. Startup closes independent admission as soon as stop is received, including before recovery
dispatch; ownership remains until startup settles. Grace/interactive drain begins after startup
so HTTP controls can remain reachable. Closing a browser tab only stops observation.

The ordinary sequence is running -> draining -> awaiting-choice -> draining (wait) or
forcing (force) -> ready -> stopped. Early quiescence goes directly from draining to ready.
A drain observation failure is `drain-failed`; incompatible controls return 409 with current
state rather than starting another doomed sequence. A failure of this stop's explicit native
interruption is `force-failed`, retaining HTTP, SQLite and the lock for inspection. A further
explicit force request or deliberate later signal acknowledges the failure and enters
`exiting`: main exits with code 1 without disposing SQLite or deleting the lock. The recorded
failure stays durable; the next start reclaims the dead owner's lock. Earlier unconfirmed
terminations appear in `unconfirmedRunIds` but do not veto an otherwise completed shutdown.
A wait is valid only during an open drain and never schedules another countdown.

Independent admission closes synchronously before drain is awaited. Manual, cron, webhook,
poll, Event, replay and unrelated resume cannot create work. Inbound Event ingestion checks
the public manager admission boundary before allocating or inserting its record/dedupe key;
refusal returns 503 `SHUTTING_DOWN`. Webhooks return 503 `WEBHOOK_ADMISSION_FAILED`.
Commit-time checks also refuse starts whose admission/preflight was already in flight.
Cron leaves due slots untouched when admission is closed; poll refusals consume no durable
business key. Existing independent queue entries remain durable and unstarted.

**D-038: drain ends when no executor is active, no captured family member is queued, and
no family wake is due. Durable parks and paused runs do not hold drain.** Captured started
runs and their children remain the allowed family while the drain is open. Input, signals,
cancellation, child continuations and timers remain usable; a wake during drain becomes
runnable work and holds ownership until it finishes or parks again. Already-due timers and
wait timeouts are delivered before quiescence is declared. Future timers, input/external-signal
waits, parents waiting on such children, and paused runs retain their status, waiting record
and resumability. After restart, past wall-clock waits become eligible; pauses stay paused.

D-021 remains in force: stop the webhook retry sweep and wake delivery backoffs; allow an
in-flight delivery attempt to record its bounded outcome, but do not start another attempt.
Pending receipts and pending deliveries are durable recovery work.

Force aborts active executors and interrupts queued members of the captured family.
It never fails existing durable parks or paused runs, including parked parents and children.
During force, timer delivery and child-result wakes defer to restart, and input/signal/resume
controls refuse further wakes. A parked parent therefore remains parked even if its executing
child is interrupted. An executor still committing a park when aborted remains an interrupted executor; this does
not turn a pre-existing durable park into a force target.
A heartbeat script probe's authored timeout remains predicate input, including unconfirmed
termination evidence. Its first abort cause distinguishes that timeout from an explicit stop:
only an unconfirmed termination initiated by this stop blocks store release.

A successful cleanup records `run.failed` with `RUN_INTERRUPTED_BY_STOP`, node identity and
`details.attempt`, and an external-effect uncertainty marker. Attempt zero records a boundary with no open node attempt. It never fabricates successful output
or user cancellation. These failures are non-resumable: forced scripts and harness work must
not be blindly repeated. An operator can inspect evidence and explicitly replay if appropriate.
Cleanup failure remains `SCRIPT_TERMINATION_UNCONFIRMED` or
`HARNESS_TERMINATION_UNCONFIRMED`, rather than being masked by force. No column or migration
0019 is required; current failure/event contracts carry the evidence.

Native Windows `taskkill` must exit zero, and the process must close. Root-only fallback
cannot establish descendant cleanup. A nonzero exit, launch failure or missing close by the
cleanup deadline is an explicit failure. POSIX scripts use a detached process group.
Codex uses the SDK cancellation contract; native tests use a controlled fake CLI, not a
live provider. Existing installed-provider tree guarantees retain their documented limits.

Only after runnable family work, executor finalization and in-flight delivery cleanup settle does
the controller close SSE (including inspectors of queued runs). Main then closes HTTP,
stops timers/manager, closes SQLite, releases the directory lock and exits zero.

The container's resource finalizer is separate from normal `stop()`: main invokes it after
readiness and HTTP close, and failed-start cleanup uses the same finalizer. Component fixtures
can freeze dispatch and dispose an idle executor/store to test a physical SQLite reopen without
fabricating a managed force event. This is storage-boundary evidence; native crash/restart evidence
uses actual process death. Operator controls always use the drain/force sequence.

## Engineering parameters

- `GG_SHUTDOWN_GRACE_MS`: 300,000 ms (five minutes) by default; positive integer up to
  Node's timer maximum 2,147,483,647 ms. This gives interactive work several minutes to
  finish before notifying the operator. Tests can select a shorter grace. Expiry exposes
  choices and writes a warning; it never interrupts anything.
- Drain observation: 50 ms. It observes runnable quiescence and delivers already-due family wakes without spinning and bounds
  local notification latency. Actual work retains the configured timer poll interval.
- Script cleanup acknowledgement: five seconds after explicit termination. This is a
  failure-reporting deadline, never an automatic normal-shutdown deadline. Existing
  harness cleanup uses its own five-second bound.
- Signal coalescing: 1,000 ms from each accepted signal. This covers duplicated forwarding of
  each foreground keypress, including force, without letting a forwarded duplicate
  acknowledge failed cleanup. A signal after an API-initiated stop requests force.
- Failed-stop exit response flush: 100 ms after explicit acknowledgement. This lets the
  HTTP control response flush before the mandatory nonzero exit; it is not a cleanup timer.
- Example Compose `stop_grace_period`: one hour, to allow operator deliberation beyond
  the application's five-minute notice. Docker still SIGKILLs after that external bound.
  For indefinite drain, use the API while the service is running, and stop Compose after
  drain completes; a supervisor hard deadline cannot provide indefinite waiting.

These are engineering choices, not owner-selected numeric requirements.

## Follow-on boundary

#319 can consume phase, timestamps, grace, active run IDs and choices and send wait/force.
This change adds no browser prompt, launcher or interactive UI. It does not implement
#320 child-creation idempotency, #321 uncertain crash outcomes, #343 targeted Events or
#186 bounded stream replay. Those owners retain their existing boundaries.

## Residual risks

- N10: Codex descendant cleanup on Windows depends on the SDK cancellation contract;
  this bolt does not establish a stronger installed-provider process-tree guarantee.
- N11: cron advances a slot before listener admission. The admission gate prevents ordinary
  stopped polling from consuming slots, but closing admission between the gate and the
  asynchronous store write retains the pre-existing slot/admission race. Atomic cron-slot
  admission remains outside this bolt.
