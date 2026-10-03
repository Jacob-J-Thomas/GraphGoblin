# ADR-0015 - Visit cap, draft conflicts, and the first API key

Date: 2026-10-03. Status: Accepted. Answers open questions 16, 17, and 18 raised by the WP-D2 adversarial QA pass (defects D28, D26, D27 in `qa/2026-10-03-wp-d2.md`).

## 1. Unbounded cycles: `maxIterations` caps visits per node (question 16, D28)

### Context

A decision that routes back to itself, or any cycle that never passes through an exit loop-back, ran until cancelled: `maxIterations` counted only exit loop-backs. The executor already yields between nodes (D02), so the API stayed responsive, but the run grew its event log without limit.

### Decision

The existing `maxIterations` loop setting stays the only loop limit and now also bounds fresh visits per node. A visit is a `node.started` with `attempt` 1; re-executions of the same visit (a wake after a wait, heartbeat, or child run; recovery after a restart; a resume after a failure) have a higher attempt and do not count. When any node would start for the (`maxIterations` + 1)th time the run fails with the new run-failure code `MAX_ITERATIONS`, `resumable: false`, with the node in `nodeId`, the message, and `details.maxIterations`. The check runs before `node.started` is recorded.

### Consequences

- Nodes inside an exit loop-back are entered once per iteration, so for them the iteration ceiling (`exhausted`) is reached first and nothing changes.
- A loop that legitimately re-enters one node many times inside a single iteration needs a higher `maxIterations`.
- `MAX_ITERATIONS` is a new member of `RunErrorCode`; clients that switch over the codes see one more value.

### Alternatives considered

- `NODE_VISIT_LIMIT` above `maxIterations` times the node count (the WP-D2 proposal): a second, derived limit that is harder to explain and still lets one node run far more often than the setting says.
- A separate `maxNodeVisits` setting: one more knob for a rare case.
