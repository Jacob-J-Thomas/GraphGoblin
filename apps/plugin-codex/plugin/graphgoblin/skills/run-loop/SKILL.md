---
name: run-loop
description: Start a named GraphGoblin loop with input, wait for it to finish, and report its result. Use when the user asks to run, trigger, or kick off a GraphGoblin loop or workflow by name.
---

# Run a GraphGoblin loop

You drive the loop through the `graphgoblin` MCP tools. Never call the REST API directly for this.

## 1. Find the loop

- If the user gave a loop id, use it. If they gave a name, call `list_loops` (optionally with `query` set to part of the name) and pick the loop whose name matches. `describe_loop`, `start_run`, and the other loop tools also accept the exact loop name.
- If several loops match, or none does, show the candidates (name, id, published) and ask which one.
- If the loop is not published, tell the user; start it from the draft (`allowDraft: true`) only if they agree.

## 2. Prepare the input

- Call `describe_loop`. Read `triggers`: use the manual trigger (pass its `nodeId` as `triggerNodeId` only when there are several). If `startableFromMcp` is false, tell the user the loop is not exposed to MCP and stop.
- Build `input` from what the user said so it matches the trigger's `inputSchema`. Ask for any required field you cannot infer. With no `inputSchema`, pass the user's request as input only if it is clearly useful, otherwise omit it.
- Note `inputWaits`: these nodes will pause the run to ask a question later.

## 3. Start and wait

1. Call `start_run` with `loopId` and `input`. Keep the returned `runId` and tell the user the run started.
2. Call `wait_for_run` with the `runId` (default 60 s per call; pass `timeoutSeconds` up to 600 for long loops).
3. Act on the result and repeat step 2 until `finished` is true:
   - `finished: true`: go to step 4.
   - `status: "waiting"` with `waiting.kind: "input"`: the run is asking a question. Read `waiting.prompt` and `waiting.inputSchema`. If the answer is the user's to give, ask them; otherwise answer from context. Call `provide_input` with a value that matches `waiting.inputSchema`, then wait again.
   - `status: "waiting"` with `waiting.kind: "signal"`: the run waits for `waiting.signalName`. Call `send_signal` only if the user asked you to; otherwise keep waiting or report that it is parked.
   - `status: "paused"`: ask the user whether to `resume_run`.
   - Still `queued` or `running`: call `wait_for_run` again. After several calls, give the user a short progress note (use `read_run_events` with `after` set to the last `cursor` to see new steps).

## 4. Report

- `succeeded`: give the user `run.result` (the exit node's return mapping) in readable form, plus the run id.
- `failed`: report `run.failure.code` and `run.failure.message` and the node it failed at (`failure.nodeId`). Offer to inspect it with `$inspect-run`.
- `exhausted`: the loop hit its iteration or duration limit; say which and show the last result if any.
- `cancelled`: say who or what cancelled it if the events show it.

## Errors

Tool errors start with a stable code, for example `LOOP_NOT_FOUND`, `RUN_NOT_FOUND`, `VALIDATION_FAILED`, `UNAUTHORIZED`, or `NETWORK_ERROR`. On `NETWORK_ERROR` the GraphGoblin API is not reachable: tell the user to start it (`pnpm --filter @graphgoblin/api start`) or check `GG_API_URL`. On `UNAUTHORIZED`, `GG_API_KEY` is missing or wrong. Never cancel a run unless the user asks.
