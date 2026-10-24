# ADR-0049 - Normal drain and explicit force-stop

Date: 2026-10-23. Status: Accepted for the owner-approved bounded change #224.

## Decision

The container owns one shutdown controller. Main translates native SIGINT/SIGTERM and
closes HTTP only when the controller reports ready. Authenticated `GET /system/shutdown`
(`system:read`) observes it; `POST /system/shutdown` (`system:write`) accepts exactly
`{action: "drain" | "wait" | "force"}`. The first native signal requests drain; a second
signal requests managed force, including repeated signals during startup. Startup closes independent admission as soon as stop is received, including before recovery
dispatch; ownership remains until startup settles. Grace/interactive drain begins after startup
so HTTP controls can remain reachable. Closing a browser tab only stops observation.

The sequence is running -> draining -> awaiting-choice -> draining (wait) or forcing
(force) -> ready -> stopped. Early completion can go directly from draining to ready.
A drain/force observation or executor-cleanup failure moves to force-failed and retains HTTP, SQLite and the lock;
there is no success exit or automatic retry from that state. Inspect the recorded failure
and native processes before manually terminating or restarting. Repeated requests are
idempotent. A wait acknowledges the choice without scheduling another countdown.

Independent admission closes synchronously at the manager before drain work is awaited.
Manual, cron, webhook, poll, Event, replay and unrelated resume cannot create new work.
A commit-time check also refuses starts whose admission/preflight was in flight. Existing
independent queue entries remain durable and unstarted for the next process. Drain captures
started logical runs, including parked and paused runs, and their queued children. New
children can be admitted only for this active family. Their nodes, timers and input/wake
continuations keep using ordinary execution capacity. A parked parent releases its slot.
Paused started work can require an explicit resume, cancel or force before drain completes.

D-021 remains in force: stop the webhook retry sweep and wake delivery backoffs; allow an
in-flight delivery attempt to record its bounded outcome, but do not start another attempt.
Pending receipts and pending deliveries are durable recovery work.

Force aborts all active executors and fails parked/queued members of the active family.
A successful cleanup records `run.failed` with `RUN_INTERRUPTED_BY_STOP`, node identity and
`details.attempt`, and `effectMayHaveHappened: true`. Attempt zero records a boundary with no open node attempt. It never fabricates successful output
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

Only after logical work, executor finalization and in-flight delivery cleanup settle does
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
- Drain observation: 50 ms. It observes logical completion without spinning and bounds
  local notification latency. Actual work retains the configured timer poll interval.
- Script cleanup acknowledgement: five seconds after explicit termination. This is a
  failure-reporting deadline, never an automatic normal-shutdown deadline. Existing
  harness cleanup uses its own five-second bound.
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
