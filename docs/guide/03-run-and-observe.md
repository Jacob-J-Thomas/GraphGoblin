# Run and observe

## Start from the UI

Open a published loop in the editor, select **Run**, choose its manual trigger, fill in the input form, and click **Start run**. The UI opens the inspector for the new run. Runs started here record the invocation source `manual.ui`.

The Runs screen lists runs across loops and filters by loop, status, and parent. Its browser routes are:

```text
/app/runs
/app/runs/<run-id>
```

## Start through the API

Start under the loop ID using this implemented route:

```http
POST /loops/{id}/runs
```

Save this request body in a file:

```text
start.json
```

```json
{
  "triggerNodeId": "start",
  "input": { "topic": "event-sourced workflows" },
  "return": [{ "kind": "caller" }]
}
```

Send it from Bash, replacing the loop ID with the ID from your imported [first loop](02-build-a-loop.md#import-a-complete-first-loop):

```bash
LOOP_ID='<loop-id>'
curl -sS -X POST "http://127.0.0.1:4747/loops/$LOOP_ID/runs" \
  -H 'Content-Type: application/json' \
  --data-binary @start.json
```

The response is HTTP 202 with a `run` object. Save `run.id`; execution continues in the background. Specify `triggerNodeId` when selecting among several triggers. `input` must match the manual trigger's schema; `return` adds channels to the exit's channels. Optional `versionId` pins a particular version. To try an unpublished draft, supply its `versionId` and set `allowDraft` true; the UI runs published versions.

In API-key mode, add the bearer header to each API request:

```bash
-H "Authorization: Bearer $GG_API_KEY"
```

## Start through MCP

Configure [MCP](05-mcp-and-codex-plugin.md), then call `list_loops`, `describe_loop`, and `start_run`. The start input for the example loop is:

```json
{
  "loopId": "first-summary",
  "triggerNodeId": "start",
  "input": { "topic": "event-sourced workflows" }
}
```

Pass the returned `runId` to `wait_for_run`. Repeat until `finished` is true; handle input waits with `provide_input`. These starts record `manual.mcp`.

## Read the lifecycle

| Status | What to do |
| --- | --- |
| `queued` | Wait for a worker. The process defaults to four concurrent executing runs. |
| `running` | Observe the active node and live progress. |
| `waiting` | Read `waiting.kind`: input, timer, signal, heartbeat, or child. Parked runs release their worker. |
| `paused` | Resume when you want execution to continue. |
| `succeeded` | Read the exit's result. |
| `failed` | Read the failure object, or the exit's failure outcome, and decide whether to resume or start a corrected version. |
| `cancelled` | Inspect completed side effects before starting again. |
| `exhausted` | Inspect the last result and the exit's iteration or duration limit. |

The last four statuses are terminal for streaming and waiting. A failed run can be explicitly resumed. Each run pins its version, starts at iteration 1, and logs node starts, patches, routing decisions, waits, and completion.

## Use the inspector

Select an event in **Timeline** to reconstruct the thread at that sequence. Select a `node.finished` event to see its patch with before/after values. Expand **Node progress** for harness progress, usage, decisions, and heartbeat events. Read **Result** or the failure banner at the top.

When **Input requested** appears, answer the prompt using the generated form and click **Submit input**. Signal waits show **Send signal**. Timers, heartbeats, and child waits show the reason and any wake time.

Use **Pause** to request a hold; an executing node can finish before the next node is held. **Resume** appears for paused runs. **Cancel run** persists a cancellation request and stops work cooperatively; wait for cancelled status and remember that cancellation does not undo filesystem or external side effects.

The current UI hides controls on terminal runs. After fixing an external cause of a resumable failure, use `resume_run` through MCP or this API request:

```bash
RUN_ID='<run-id>'
curl -sS -X POST "http://127.0.0.1:4747/runs/$RUN_ID/resume"
```

Editing the loop does not change a failed run's pinned config. For a config or graph fix, publish a corrected version and start a new run. For a run ended by an exit with a failure outcome, inspect its result and start again as appropriate. Follow resumed failed runs through API snapshots and event pages or MCP; the current inspector retains its original terminal event and does not restart its live subscription.

> Coming in 1.0: Complete historical thread reconstruction for child runs. The current inspector starts history from empty collections, omitting the inherited seed. Fetch the server's current child thread when inherited values matter:
>
> ```http
> GET /runs/{id}/thread
> ```

> Coming in 1.0: Replay at a selected node, creating a new run with its earlier input. Neither the inspector action nor this planned route exists yet:
>
> ```http
> POST /runs/{id}/replay
> ```

## Stream events and reconnect

Use Bash and curl's no-buffer option:

```bash
RUN_ID='<run-id>'
curl -N -H 'Accept: text/event-stream' \
  "http://127.0.0.1:4747/runs/$RUN_ID/events?after=0"
```

Each frame carries `id` (the event sequence), `event` (the type), and `data` (the JSON event). Heartbeat comments arrive every 15 seconds. After a disconnect, reconnect using the last received ID, for example 12:

```bash
curl -N -H 'Accept: text/event-stream' -H 'Last-Event-ID: 12' \
  "http://127.0.0.1:4747/runs/$RUN_ID/events"
```

The query's `after` overrides the header when both are supplied. Replay includes events after the cursor, then tails live events. The stream closes after `run.finished`, `run.failed`, or `run.cancelled`; reconnecting beyond a terminal event ends after replay. Without the SSE Accept header, the same route returns an event page with `items` and `nextAfter`.

## Read returns and child runs

Set the exit's `return.mapping` to produce a payload. The default `none` produces no result or deliveries. Choose these channels:

| Channel kind | Delivery |
| --- | --- |
| `caller` | The run snapshot's `result`; MCP callers read it through waiting or fetching; a parent receives it through its subloop mapping. |
| `webhook` | JSON POST to `url`; `secretRef` supplies HMAC signing when the secret resolves. |
| `file` | Write `path` in `json`, `markdown`, or `text` format. Relative paths resolve against the run workspace; absolute paths are used as given. |
| `event` | Publish `eventType` on the inbound bus, starting matching event triggers subject to chain guards. |
| `log` | Write the result to the API's logger. |

Webhook and event channels wrap the mapped result with `runId`, `loopId`, and `outcome`. Delivery happens after `run.finished`; a delivery failure records `return.failed` and does not change the finished status. SSE closes at the terminal event, so read a subsequent JSON event page to check delivery events:

```bash
curl -sS "http://127.0.0.1:4747/runs/$RUN_ID/events?after=0&limit=1000"
```

A subloop creates a separate child run with its own version, thread, and log. The parent waits with kind `child`. Use **parent run** and **child runs** links to move between them. By default the parent gets `lastOutput.value` containing `status`, `outcome`, `result`, and `childRunId`; a downstream decision can branch on that status. A failed or cancelled child does not automatically fail the parent. Cancelling the parent cancels active children.

## Act on failure reasons

A handler failure looks like this inside the run snapshot's `failure` field:

```json
{
  "code": "SCRIPT_EXIT_CODE",
  "message": "script exited with code 3",
  "nodeId": "check",
  "resumable": true,
  "details": { "exitCode": 3, "stderr": "review needed", "stdout": "" }
}
```

Read `code`, `message`, `nodeId`, `resumable`, and any `details`. After fixing an external cause, resume when the failure is marked resumable. Publish and start a new run when the correction changes the pinned definition. The contract lists every code below; some are reserved and current lower-level exceptions can appear as `INTERNAL_ERROR` instead.

| `RunErrorCode` | Action |
| --- | --- |
| `HARNESS_NOT_INSTALLED` | Install Codex or correct the executable setting; check harness preflight. Missing executable errors during a turn can also appear as `HARNESS_TURN_FAILED`. |
| `HARNESS_NOT_AUTHENTICATED` | Log into Codex as the API process user, then resume. |
| `HARNESS_QUOTA_EXHAUSTED` | Wait for quota or rate-limit recovery, or resolve account access, then resume. |
| `HARNESS_TURN_FAILED` | Read the harness message and progress; check model availability, sandbox, CLI, and provider connectivity. |
| `WORKING_DIRECTORY_MISSING` | Check the workspace path and permissions. The current filesystem adapter creates missing directories; filesystem failures can instead report `INTERNAL_ERROR`. |
| `SCRIPT_EXIT_CODE` | Fix the program or its patch output; add a route in a new version for an expected nonzero outcome. |
| `SCRIPT_TIMEOUT` | Resolve the slow program, or increase its timeout in a new version. |
| `INFERENCE_TIMEOUT` | Resolve slow harness work, or increase the node timeout in a new version. |
| `OUTPUT_SCHEMA_MISMATCH` | Inspect raw output and repair attempts; correct the prompt, schema, or repair policy in a new version. |
| `SUBLOOP_DEPTH_EXCEEDED` | Reduce nesting or revise the depth setting in a new version. |
| `SUBLOOP_NOT_FOUND` | Publish the referenced child or correct its loop/version reference, then start an appropriate version. |
| `DECISION_NO_ROUTE` | Make the expression or decider return a declared label; check strategy availability and confidence settings. |
| `DECIDER_UNAVAILABLE` | Configure Jev's key or use an available strategy in a new version; exit predicates need their selected decider. |
| `SECRET_MISSING` | Create the named secret on the server, then resume. |
| `TEMPLATE_ERROR` | Correct Liquid syntax and referenced values; timestamp templates must render valid dates. |
| `EXPRESSION_ERROR` | Correct JSONata, its input assumptions, or the patch produced by a mapping. |
| `WAIT_TIMEOUT` | Arrange the required input or signal sooner, or revise timeout behaviour in a new version. |
| `HEARTBEAT_EXHAUSTED` | Check the probe and condition; revise beat/deadline limits or exhaustion behaviour if needed. |
| `RETURN_DELIVERY_FAILED` | Check the destination and signing secret. Current delivery failures use `return.failed` events, rather than this reserved run-failure code; arrange redelivery explicitly. |
| `INTERNAL_ERROR` | Preserve the run ID, log, and failure details; investigate or report the defect before retrying side effects. |

Use [Troubleshooting](07-troubleshooting.md) for concrete checks. See [Execution engine](../05-execution-engine.md) and [API and streaming](../07-api-and-streaming.md) for design context.
