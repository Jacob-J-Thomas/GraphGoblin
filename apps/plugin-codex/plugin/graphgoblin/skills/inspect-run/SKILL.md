---
name: inspect-run
description: Summarise what a GraphGoblin run did, from its event log and context thread. Use when the user asks why a run failed, what a run produced, or what happened in the last run of a loop.
---

# Inspect a GraphGoblin run

Use the `graphgoblin` MCP tools. Do not change the run (no cancel, pause, input, or signals) unless the user asks.

## 1. Find the run

- If the user gave a run id, use it.
- Otherwise call `list_runs` (filter by `loopId` from `list_loops`, and by `status`, for example `["failed"]` for "the last failure"). Runs come newest first. Ask if more than one could be meant.

## 2. Collect the facts

1. `get_run`: status, outcome, iteration, current node, `waiting`, `result`, `failure`.
2. `read_run_events` from `after: 0`, then again with `after` set to `nextAfter` while `hasMore` is true. For a very long log, read the first page and the last pages (the final events explain the outcome).
3. `get_run_thread` when you need the content: `messages`, `vars`, `outputs` per node, `lastOutput`, `artifacts`, and `counters.usage`.

The same data is available as the resources `graphgoblin://runs/{id}/events` and `graphgoblin://runs/{id}/thread` if your client reads resources.

## 3. Summarise

Write a short report for the user:

- **Outcome**: status, outcome, how long it took (`createdAt` to `finishedAt`), iterations.
- **Path**: the nodes in the order they ran (`node.started` and `node.finished` events), with decisions taken (`decision.made`: route and reasoning) and loop-backs (`iteration.incremented`).
- **Agent work**: for inference nodes, what the harness did (`harness.session` and `node.progress` events), the final message, and token usage (`harness.usage`).
- **Waits**: `run.waiting` and `run.woken`, input asked for and given (`input.received`), signals (`signal.received`), heartbeats, and child runs (`child_run.started`, `child_run.finished`).
- **Returns**: `return.delivered` or `return.failed` per return channel.
- **Result or failure**: the returned value, or `failure.code`, `failure.message`, and the failing node. Quote the event that shows the cause.
- **Next step**: one suggestion when it helps (rerun with different input, fix the loop with `$design-loop`, answer a waiting run with `$run-loop`).

Keep raw JSON out of the summary unless the user asks for it; quote only the fields that matter.
