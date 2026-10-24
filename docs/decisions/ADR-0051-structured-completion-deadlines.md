# ADR-0051: Engine-owned structured-completion deadlines

Status: implemented; independent review and real-provider QA remain separate.
Date: 2026-10-23.

The old process `EngineSettings.structuredTimeoutMs` declared a 120,000 ms limit in
the API but no caller enforced it. Stalled repair calls also held capacity after a
run deadline. Enforcing a formerly invisible constant would introduce a hidden stop.

Move the configuration into visible `LoopSettings.structuredTimeoutMs` and the
run's pinned execution limits. A positive integer sets milliseconds per completion;
omission/null means Unlimited, with no finite default. The editor's Limited suggestion
is 120,000 ms, chosen to match the former declared value, not an owner-approved default.
The upper bound is 31,536,000,000 ms (one year), matching the run deadline's range.
This additive default introduces no deadline or storage rewrite for existing records.
The unused engine constructor setting is removed, with an embedding upgrade note.

A single engine boundary handles LLM route calls and structured repair calls with a
child AbortController, timer and single settlement. It bounds even a port that never
settles, propagates parent cancellation and run deadlines, checks elapsed time when a
busy event loop delays a timer, and handles both late fulfillment and rejection.
Long timers re-arm in chunks no larger than Node's 2,147,483,647 ms timer range.
Timeout is the resumable `STRUCTURED_COMPLETION_TIMEOUT` with `details.timeoutMs`;
a deliberate Resume can repeat a read-only evaluation after its external cause clears.
No automatic retry is introduced. Explicit run cancellation remains status `cancelled`
and has no timeout failure code. Existing terminal-event arbitration remains authoritative.

CodexStructured owns adapter resource cleanup, explicitly calls session.cancel() on
abort and forwards the signal through CodexHarness to the SDK/provider process. The
engine does not wait indefinitely for a broken adapter before releasing its slot.
The harness retains its existing bounded cancellation cleanup; no new kill grace is
introduced here. Real process termination requires the separate adapter QA script.

Unlimited disables only this cutoff. Explicit node/run deadlines remain independent;
classifier calls retain their existing provider controls. Inference turns, including
same-session repairs through HarnessPort, retain their node/run signals. This decision
adds no spending, token, subscription, provider-turn or usage budget.
