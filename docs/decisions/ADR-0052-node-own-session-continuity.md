# ADR-0052 - Opt-in per-node provider conversation continuity

Date: 2026-10-23. Status: Accepted (2026-10-24): reviewed by the orchestrator, live start-and-resume checks passed for Codex and Claude, independent QA found no functional defect (its gate failures were dispositioned and CI passed), final audit signed off.

## Context

Public RunManager/fake-harness baseline scenarios at `fbd48d3` reproduce that
`resume-previous` resumes the reviewer's conversation on a worker revisit, while a
shared `resume-named` key shares a conversation across nodes and runs. Neither is a
private node/run conversation. Historical #33 proposals with a hidden ten-visit
reset were not approved. The current owner scope requires opt-in continuity and
only an optional visible authored reset, preserving #244's submission provenance.

## Decision

Keep the default `session: { policy: "fresh" }`. Add one strict variant:

```ts
{ policy: 'resume-own'; resetAfterVisits?: number }
```

No separate context-mode field is needed. Fresh starts an isolated provider
conversation with the authored task and selected inputs; current main-loop context
is supplied deliberately through existing prompt templates, input transforms and
context files. Own mode adds this node's private provider history. Normal configured
outputs alone enter the shared thread. Existing previous/named policies retain
shared selection semantics, including named lookup across runs.

Own selection requires the exact run, node and harness. The first visit starts
fresh. For later visits, derive the previous durable `node.finished`'s final
`node.started.attempt` and read that existing session row. Attempts restart on each
new visit; sorting by greatest attempt can select an older visit after a retry.
Timestamps and local row status do not establish logical completion. Pending turns
are handled first by #244, even when their row says finished but `node.finished`
was not recorded. An absent completed session row stops explicitly, not fresh.

`resetAfterVisits` has no default. Its engineering bound is the positive safe-integer
range 1 through 9,007,199,254,740,991: exact integer/modulo arithmetic without an
arbitrary product-imposed reset ceiling. N durably completed visits share one
conversation; visit N+1 starts fresh. Retries, repair turns and recovery do not
advance the count. A pending refused task retains its exact prompt and original
selection even at a reset boundary. Reset changes only that provider conversation;
it never resets the shared thread, another node or loop guardrails.

## Storage and recovery

Existing `(runId, nodeId, attempt)` rows already store harness and native session ID.
The event log supplies completion count and final-attempt identity. No stored schema
changes or historical data rewrites are needed, so no migration is added.
SQLite rows/logs retain usable references after restart; adapters already resume a
native ID with full settings and no adapter-local cache. Replay forks and subloop
children have new run IDs/logs: neither handles nor reset counts carry over, even
when their initial graph threads contain copied counters or context.

#244/ADR-0045 applies to inherited own handles as well: session identity alone is
not acceptance of a new authored task. Proven refusal retries the exact task;
uncertain accepted work continues only a usable session; uncertain unaccepted work
with only an inherited handle stops non-resumably. Missing provider sessions remain
`HARNESS_SESSION_MISSING`, with no automatic fresh fallback. The explicit recovery
choice belongs to #265 and is not implemented here.

## Consequences and verification

The schema-driven editor gains the new option, contextual help and visible optional
reset without a new custom form or changes to model/effort fields. Clients must accept
the new strict variant. Existing authored definitions require no changes.

Deterministic public-interface tests cover both harness families, worker/reviewer
cycles, parallel runs, forks, children, reset boundaries and no hidden reset, stale
retry rows, selected loop input, and #244 failure provenance. Bounded real start/resume
scripts and native process restart evidence are retained under
[the #33 QA directory](../qa/2026-10-23-wp-f4-33/README.md). Fake-harness evidence does
not establish live-provider recall, retention or provider compaction guarantees.
