# ADR-0010 - Exit nodes declare a return mapping and return channels

Date: 2026-10-02. Status: Accepted.

## Context

Loops can be invoked by cron, webhooks, internal events, a human in the UI, an API client, or an agent inside a harness session using a tool or a skill. The owner wants loops to behave like functions: where, how, and whether data is returned is configurable, and loops must not rely only on workspace side effects.

## Decision

The exit node carries a `return` block: a JSONata mapping from the thread to a return payload, and a list of return channels. Channels in 1.0 are `caller`, `webhook`, `file`, `event`, and `log`. `caller` resolves automatically to the run result, the MCP tool result, or the parent run's subloop output mapping. "Where the loop recursion passes back" is an explicit loop-back edge, which keeps the loop shape visible and increments the iteration counter.

## Consequences

- Every loop has a readable contract: trigger input schema in, return payload out.
- Loops compose through the `event` channel without a parent loop.
- Delivery results are recorded per channel as events.
