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
Every intake holds a lease from its first admission check through its durable outcome.
An intake accepted before closure may finish admission; independent runs admitted during drain
remain queued for restart. `withAdmission` extends this boundary across an inbound source's
receipt/dedupe and linkage writes, using its scoped `startRun`. The callback must await those
writes and cannot reuse its capability after returning. A closed intake is refused before
allocation; a racing drain cannot invalidate a scope after its receipt has been saved.
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

The final quiescence decision is atomic with wake/intake admission: commands reserve a lease
before their first await. Drain rechecks after asynchronous recovery and delivery cleanup,
then validates lease generation, executor/family queue state and due wakes before sealing
without another await. A later input, signal, resume or cancellation is refused before a write;
a later timer delivery retains its durable row for restart. A wake accepted during cleanup
holds drain through its continuations, including a child created afterwards. Open intake
leases hold ownership only until their writes settle; durable parks still do not hold drain.

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
  failure-reporting deadline, never an automatic normal-shutdown deadline. Harness cleanup
  uses its own five-second bound: the Claude process must close, and the Codex CLI's output
  must end after its turn is aborted (`cancelGraceMs`).
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

- N10: Codex descendant cleanup depends on the SDK cancellation contract and, on Windows, on
  the CLI's own job object. The SDK keeps the CLI's process private, so GraphGoblin cannot end
  a process the CLI started. When such a process keeps the CLI's output open after the abort,
  force reports `HARNESS_TERMINATION_UNCONFIRMED` after five seconds and enters `force-failed`;
  that process survives **Force exit** as well (it is outside Node's kill-on-close job) and must
  be ended by hand. Whether the installed CLI can leave such a process is a live-provider check.
- N11: cron advances a slot before listener admission. The admission gate prevents ordinary
  stopped polling from consuming slots, but closing admission between the gate and the
  asynchronous store write retains the pre-existing slot/admission race. Atomic cron-slot
  admission remains outside this bolt.
- N12: on POSIX the SDK starts the Codex CLI in the gateway's process group, unlike scripts and
  the Claude CLI, which start in their own. A terminal Ctrl+C signals the whole foreground group,
  so the CLI may receive it too. This is unverified (no POSIX host in the 2026-10-26 checks) and
  the SDK patch below is limited to `windowsHide`.
- N13: Windows `taskkill` addresses a PID. A root that exits on its own between the decision to
  kill it and taskkill opening it frees its PID, which Windows may reuse. A root Node has already
  seen exit is never signalled (below); the remaining window is the taskkill start-up time.

## Browser implementation amendment (2026-10-24, #319)

The application shell now observes the existing controller through its typed routes.
It offers only advertised wait/force choices, with an explicit force confirmation
and a separate failed-cleanup exit confirmation. Existing run snapshots supply pinned
loop names. Shutdown snapshots include an opaque concurrency token, and browser
choices send it as `x-graphgoblin-shutdown-token`. The token names the gateway
incarnation, a revision and the phase: the controller's only addition is that revision,
which advances on every phase entry and every accepted wait, so a phase that recurs
does not revive an earlier token. A synchronous comparison before dispatch rejects a
stale choice with the current 409 snapshot. This prevents a delayed force from
acknowledging cleanup failure caused by another tab or overriding a later choice to
keep waiting. A token change also resets confirmation, and keyboard focus moves to the
notice heading when the confirmation it replaced is gone. Unconditional API/operator
requests retain the existing semantics; drain, force and engine behaviour are unchanged.
A stale action's 409 is a current-state snapshot. Tab lifecycle only observes, and
network failures never resend actions. The UI does not initiate drain or change D-038,
force, seal or recovery semantics. Observation polls every 10 seconds while the gateway
runs and every 2 seconds during shutdown (engineering choices bounding idle request
cost); it stops on the stopped phase or an error, and after a transport failure the
application's reachability probe refetches it once the API answers again, besides the
explicit check. Ready/exiting continue observing until HTTP closes, so the last notice does not stay
permanently at stopping after a confirmed control response.
A disconnected gateway is labelled stopped or disconnected, not fabricated as an
observed `stopped` response. No new architecture decision is introduced.

## Acceptance fixes amendment (2026-10-26, #319)

Independent acceptance found three gaps in the shutdown model the browser choice relies on
([record](../qa/2026-10-26-acceptance-fixes-319-205/README.md)).

- **Provider CLIs get their own console on Windows.** `@openai/codex-sdk` 0.160.0 spawned the
  Codex CLI without `windowsHide`, so the CLI shared the gateway's console. A terminal Ctrl+C
  reached it directly and it exited with `STATUS_CONTROL_C_EXIT` (`0xC000013A`) during what
  should have been a normal drain. No SDK release up to 0.164.0 sets the option, so a pnpm
  patch (`patches/@openai__codex-sdk@0.160.0.patch`, `patchedDependencies` in
  `pnpm-workspace.yaml`) adds `windowsHide: true` to that one spawn and changes nothing else.
  With every stdio stream piped, libuv then starts the CLI with its own hidden console, as the
  script runner and the Claude runner already did. A terminal Ctrl+C reaches only the gateway,
  which drains, and a running Codex turn keeps running until it finishes or the operator forces.
  Re-check the patch whenever the SDK version changes.
- **A Codex turn has a bounded termination acknowledgement.** The SDK's event stream ends only
  when the CLI's stdout closes, and a process the CLI started can hold that pipe after the abort
  kills the CLI. The harness now stops waiting `cancelGraceMs` (five seconds) after the abort
  and fails the turn with `HARNESS_TERMINATION_UNCONFIRMED`; `cancel()` reports the same. Force
  then concludes as `force-failed` with the run in `unconfirmedRunIds` and offers Force exit, as
  for script trees. GraphGoblin still cannot end that process itself (N10).
- **A process that already exited counts as released on Windows.** `taskkill /T /F` exits 128
  when no process has the PID. A root Node has already seen exit is no longer signalled; for a
  128, the root is released once Node reports its exit. Any other taskkill failure stays
  unconfirmed. Callers still confirm release only when the root's output closes, so a
  descendant that inherited it still yields an unconfirmed termination after five seconds.
