# ADR-0051: Engine-owned structured-completion deadlines

Status: implemented in PR #392; independent review approved with required fixes.
The reviewer passed the real-adapter check on `12a96af9`. Independent QA at `f2fce3ae`
found missing stored-definition defaults and repair provenance; round-3 corrections
await independent review and QA.
Date: 2026-10-23.
Updated: 2026-10-24.

The old process `EngineSettings.structuredTimeoutMs` declared a 120,000 ms limit in
the API but no caller enforced it. Stalled repair calls also held capacity after a
run deadline. Enforcing a formerly invisible constant would introduce a hidden stop.

Move the configuration into visible `LoopSettings.structuredTimeoutMs` and the
run's pinned execution limits. A positive integer sets milliseconds per LLM decision evaluation or output-transform
repair through `StructuredPort`;
omission/null means Unlimited, with no finite default. The editor's Limited suggestion
is 120,000 ms, chosen to match the former declared value, not an owner-approved default.
The upper bound is 31,536,000,000 ms (one year), matching the run deadline's range.
This additive default introduces no deadline for existing records.

Choose a one-off data migration (`0019_completion_deadline_defaults`) rather than
schema decoding on every repository read. The read path currently returns stored JSON;
Zod defaults are not applied by Drizzle or by response serialization. Missing
`structuredTimeoutMs` therefore produced `500 RESPONSE_INVALID` despite parsing as null.
Pre-#243 definitions missing `runDeadlineSeconds` had the same defect on the identical
read path in current main. The migration materializes both absent deadline fields as null.
It preserves explicit null/finite values, malformed JSON and invalid authored values.

Unconditional read decoding was tested and rejected: it broke all five existing
retired-Event API regressions (#242), whose precise refusal diagnostics and terminal-run
finalization deliberately inspect the retired definition. The data migration fixes current
stored defaults while preserving those established paths, without adding a compatibility
schema, tolerant reader or alternate definition representation.

The migrator transaction rewrites every `loop_versions.definition` (draft, published and
immutable draft-run snapshot), existing run pins, queued-event pins, and saved webhook
admission intents (run pin, queued pin and optional snapshot definition). It temporarily
lifts and restores the exact snapshot-update trigger inside that same transaction.
Exports, API version/detail reads and new run pins then use definitions with materialized
defaults; existing run/event/admission decoders continue using their current schemas.
The migration is idempotent and startup records it once. No authored limit is changed.
It follows #116's `0018` as `0019`, with a journal timestamp after every shipped migration so upgraded stores apply it.

The unused engine constructor setting is removed, with an embedding upgrade note.

A single engine boundary handles LLM decision evaluations and output-transform repairs
through the structured port with a
child AbortController, timer and single settlement. It bounds even a port that never
settles, propagates parent cancellation and run deadlines, checks elapsed time when a
busy event loop delays a timer, and handles both late fulfillment and rejection.
Long timers re-arm in chunks no larger than Node's 2,147,483,647 ms timer range.
Timeout is the resumable `STRUCTURED_COMPLETION_TIMEOUT` with `details.timeoutMs`;
Both paths retain the completion provider, resolved model and effort in
`details.provenance`. A deliberate Resume can repeat a read-only evaluation after its external cause clears.
No automatic retry is introduced. Explicit run cancellation remains status `cancelled`
and has no timeout failure code. Existing terminal-event arbitration remains authoritative.

CodexStructured owns adapter resource cleanup, explicitly calls session.cancel() on
abort and forwards the signal through CodexHarness to the SDK/provider process. The
engine does not wait indefinitely for a broken adapter before releasing its slot.
The harness retains its existing bounded cancellation cleanup; no new kill grace is
introduced here. Real process termination requires the separate adapter QA script.
Late fulfillments and non-abort rejections are warned once; acknowledgement of the
forwarded abort reason or an AbortError is normal cleanup and is not a late result.

Unlimited disables only this cutoff. Explicit node/run deadlines remain independent;
classifier calls retain their existing provider controls. Inference output-schema repairs are turns on the node's own `HarnessPort` session,
not separate `StructuredPort` completions. They share the initial turn's explicit node
`timeoutSeconds` (failure `INFERENCE_TIMEOUT`) and run deadline; `structuredTimeoutMs`
does not govern them. The same-session regression exercises a repair past the structured
cutoff, then verifies failure at the configured node timeout. This decision
adds no spending, token, subscription, provider-turn or usage budget.
