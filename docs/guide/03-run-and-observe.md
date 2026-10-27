# Run and observe

## Start from the UI

Runs start from the **Runs** screen. Click **New run** and choose a published loop. Then choose its version (the current one unless you pick an older published version; the run keeps the version it started with), one of its manual triggers, and the input, in a form generated from the trigger's `inputSchema`. The input is checked against that schema before anything is sent, and a refusal from the API is shown under the form. Click **Start run**; the inspector opens for the new run. You can start more runs of the same loop while earlier ones are still running. Runs started here record the invocation source `manual.ui`.

In the editor, **Open in Runs** (in the toolbar, and in the notice after a publish) opens New run with that loop already chosen. Until the loop has a published version it is disabled and says why. The editor itself starts no runs.

The Runs screen lists runs across loops and filters by loop, status, and parent; with a loop filter set, **New run** starts with that loop chosen. The chosen loop is part of the address, so a link or a reload keeps it. Use **Load more** on Runs or Events to append older history. Runs keeps the selected loop, status and parent filters; changing a filter starts that history. Loaded rows remain visible if a later page fails, and the same button retries it.

Its browser routes are:

<!-- guide-example: run-urls -->

```text
/app/runs
/app/runs/new
/app/runs/new?loop=<loop-id>
/app/runs/<run-id>
```

## Start through the API

Start under the loop ID using this implemented route:

<!-- guide-example: start-request -->

```http
POST /loops/{id}/runs
```

Save this request body in a file:

<!-- guide-example: start-filename -->

```text
start.json
```

<!-- guide-example: start-body -->

```json
{
  "triggerNodeId": "start",
  "input": { "topic": "event-sourced workflows" },
  "return": [{ "kind": "caller" }]
}
```

Send it, replacing the loop ID with the ID of your imported [first loop](02-build-a-loop.md#import-a-complete-first-loop). The ID is the 26-character value in the editor's URL. In Bash:

<!-- guide-example: start-bash -->

```bash
LOOP_ID='<loop-id>'
curl -sS -X POST "http://127.0.0.1:4747/loops/$LOOP_ID/runs" \
  -H 'Content-Type: application/json' \
  --data-binary @start.json
```

In PowerShell:

<!-- guide-example: start-powershell -->

```powershell
$loopId = '<loop-id>'
$started = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:4747/loops/$loopId/runs" `
  -ContentType 'application/json' -InFile start.json
$started.run.id
```

The Bash examples in this guide use `curl`. In Windows PowerShell, `curl` is an alias for `Invoke-WebRequest`, so call `curl.exe` there and quote arguments that start with `@`.

The response is HTTP 202 with a `run` object. Save `run.id`; execution continues in the background. Specify `triggerNodeId` when selecting among several triggers. `input` must match the manual trigger's schema, or the request fails with 400 `INVALID_INPUT`. `return` adds channels to the exit's channels. Optional `versionId` pins a particular version. A loop with no published version returns 404 `LOOP_NOT_FOUND`, and a draft `versionId` without `allowDraft` returns 409 `VERSION_NOT_PUBLISHED`. To try an unpublished draft, supply the draft's `versionId` (from `GET /loops/{id}`) and set `allowDraft` true. The run answers with a new `versionId`: a snapshot of the draft taken at start, which later draft edits never change. The UI runs published versions.

Every run keeps the definition it started with until it finishes, through waits, pauses, restarts and replays. `run.pinned` names it: `label` reads like `Review v3` or `Review draft v4`, and `defaults` holds the Settings and process model defaults the run inherited at start. Editing the loop, publishing a new version or changing Settings affects only runs started afterwards.

In API-key mode, add the bearer header to each API request. In Bash, add this option to `curl`:

<!-- guide-example: auth-bash -->

```bash
-H "Authorization: Bearer $GG_API_KEY"
```

In PowerShell, add this parameter to `Invoke-RestMethod`:

<!-- guide-example: auth-powershell -->

```powershell
-Headers @{ Authorization = "Bearer $env:GG_API_KEY" }
```

## Start through MCP

Configure [MCP](05-mcp-and-codex-plugin.md), then call `list_loops`, `describe_loop`, and `start_run`. The start input for the example loop is:

<!-- guide-example: start-mcp -->

```json
{
  "loopId": "first-summary",
  "triggerNodeId": "start",
  "input": { "topic": "event-sourced workflows" }
}
```

Pass the returned `runId` to `wait_for_run`. Repeat until `finished` is true; handle input waits with `provide_input` using the observed `waiting.waitId` as `waitId`. These starts record `manual.mcp`.

## Read the lifecycle

| Status      | What to do                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------ |
| `queued`    | Wait for a worker. The process runs four runs at once by default; set `GG_MAX_CONCURRENT_RUNS` to change it.       |
| `running`   | Observe the active node and live progress.                                                                         |
| `waiting`   | Read `waiting.kind`: input, timer, signal, heartbeat, or child. Parked runs release their worker.                  |
| `paused`    | Resume when you want execution to continue.                                                                        |
| `succeeded` | Read the exit's result.                                                                                            |
| `failed`    | Read the failure object, or the exit's failure outcome, and decide whether to resume or start a corrected version. |
| `cancelled` | Inspect completed side effects before starting again.                                                              |
| `exhausted` | The graph gave up repetition. Inspect the gate's stopping limit and returned work value.                           |

The last four statuses are terminal for streaming and waiting. Use the current server `recovery.resume` decision to determine whether Resume is available; the failure flag alone is not permission. A terminal Failure or Exhausted exit cannot resume. Each run pins its definition (its `versionId` and `pinned`), starts at iteration 1, and logs node starts, patches, routing decisions, waits, and completion.

## Use the inspector

Select an event in **Timeline** to reconstruct the thread at that sequence. Select a `node.finished` event to see its patch with before/after values. Expand **Node progress** for harness progress, usage, decisions, exit evaluations, and heartbeat events. Read **Result** or the failure banner at the top.

Decision evaluation details show the selected stable port and evaluator-specific observation: a route ID for Expression/LLM, or Choice/Noul/Score evidence for a classifier. LLM confidence is informational. Classifier rejection retains its proposed evidence without claiming a selected route. The corresponding output paths are `portId`, `provenance` and `observation`.

`exit.evaluated` records the terminal outcome: Success, Failure or Exhausted. Read **Result** for its returned value, `null` included; Exhausted does not wrap or replace it. When the exit's Returns is None, **Exit evaluation** says that no value was returned by configuration, not by failure, and names the destinations that received nothing, from the exit and from the start request. An exit with no destinations is identified as a quiet exit. **Exit evaluation** also shows the last gate decision: which route it chose on which pass, and whether a limit stopped the repeat.

Gate **Evaluation details** show previous/current passes, maximum passes, optional run time in seconds, elapsed time from run start, and which limit stopped a repeat. The observed choice remains visible even when **Selected port** is `limit-reached`. **Label** names the chosen route as the run's version authored it, and **Criterion** shows the criterion a classifier Choice option or Noul side gave the classifier. Passes start at 1 and can be read by expressions at `gates.<nodeId>.passes`.

`decision.made` identifies the evaluator kind, selected option ID, confidence where applicable, and actual resolved provider/model/effort. The option ID is also its output port. LLM confidence is self-reported information, not a calibrated probability. Converted historical events preserve known skip diagnostics; unknown old values display as unknown rather than invented settings. New decisions never try another evaluator.

When **Input requested** appears, answer the prompt using the generated form and click **Submit input**. Signal waits show **Send signal**. Timers, heartbeats, and child waits show the reason and any wake time.

Use **Pause** to request a hold; an executing node can finish before the next node is held. **Resume** continues paused runs and eligible failures with the same run ID. Its visible explanation says why an unavailable action cannot run. A run paused while it was waiting (for input, a signal, a timer, or a child run) goes back to that same wait with its deadlines intact; a timer that came due meanwhile fires right after the resume. **Cancel run** persists a cancellation request and stops work cooperatively; wait for cancelled status and remember that cancellation does not undo filesystem or external side effects.

After fixing an external cause, review the inspector's server eligibility. A pointer multi-click is one choice; review any new failure before resuming again. Resume retains this run and retries its failed child in place when the parent owns recovery; the child links the exact parent. That ownership stays with the parent while its accepted recovery is pending. Consent covers the reviewed child failure; a later uncertain failure needs fresh review and consent. Uncertain scripts require **Recover script** and explicit retry consent. Missing sessions use **Start fresh session** on the failed inference run. Opening or cancelling a recovery dialog runs nothing.

API callers first read `recovery` from `GET /runs/{id}` and review its decisions, then send that `observedSeq`. A stale or repeated choice returns 409 `RECOVERY_STALE`. These examples perform the read; run the POST only after reviewing eligibility. In Bash:

<!-- guide-example: resume-bash -->

```bash
RUN_ID='<run-id>'
SNAPSHOT=$(curl -sS "http://127.0.0.1:4747/runs/$RUN_ID")
printf '%s\n' "$SNAPSHOT"
SEQ=$(printf '%s' "$SNAPSHOT" | node -pe "JSON.parse(require('fs').readFileSync(0, 'utf8')).recovery.observedSeq")
curl -sS -X POST "http://127.0.0.1:4747/runs/$RUN_ID/resume" \
  -H 'Content-Type: application/json' -d "{\"observedSeq\":$SEQ}"
```

In PowerShell:

<!-- guide-example: resume-powershell -->

```powershell
$runId = '<run-id>'
$snapshot = Invoke-RestMethod -Uri "http://127.0.0.1:4747/runs/$runId"
$snapshot.recovery | Format-List
$body = @{ observedSeq = $snapshot.recovery.observedSeq } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:4747/runs/$runId/resume" `
  -ContentType 'application/json' -Body $body
```

Windows PowerShell gives a POST without a body a form content type, which the API refuses with 415 `UNSUPPORTED_MEDIA_TYPE`. The examples therefore send the observed JSON command.

Pause and input retain their state-conflict errors. Resume and Replay return typed current eligibility refusals; see [ADR-0061](../decisions/ADR-0061-recovery-eligibility.md) for the complete list.

Editing the loop does not change a failed run's pinned config. For a config or graph fix, publish a corrected version and start a new run. For a run ended by an exit with a failure outcome, inspect its result and start again as appropriate. An open inspector follows a resumed run live, whichever client resumed it; API snapshots, event pages and MCP show the same attempt.

Child runs reconstruct like any other run: their first event, `run.queued`, carries the thread the parent seeded (`initialThread`), so the inspector shows inherited messages and values at every event. Runs recorded before that field existed start from empty collections; `GET /runs/{id}/thread` always returns the server's current thread.

## Replay from a node

To debug a node, fork a new run at it with the same input it had: the fork starts from the recorded thread just before that node first started, on the same pinned definition. The source may be in any status. Nothing before the chosen node runs again unless the graph routes back to it. **Replay runs the path again for a new run:** scripts, provider turns, child runs and deliveries after that node run again. The inspector's picker names the effectful nodes that can be reached. The source's effects, result, history and own recorded deliveries stay unchanged; the fork performs its own exit delivery. A path into the current uncertain script requires an additional explicit confirmation. This example replays **summarise**, so it calls the provider again. In Bash:

<!-- guide-example: replay-bash -->

```bash
RUN_ID='<run-id>'
SNAPSHOT=$(curl -sS "http://127.0.0.1:4747/runs/$RUN_ID")
printf '%s\n' "$SNAPSHOT"
SEQ=$(printf '%s' "$SNAPSHOT" | node -pe "JSON.parse(require('fs').readFileSync(0, 'utf8')).recovery.observedSeq")
curl -sS -X POST "http://127.0.0.1:4747/runs/$RUN_ID/replay" \
  -H 'Content-Type: application/json' -d "{\"nodeId\":\"summarise\",\"observedSeq\":$SEQ}"
```

In PowerShell:

<!-- guide-example: replay-powershell -->

```powershell
$runId = '<run-id>'
$snapshot = Invoke-RestMethod -Uri "http://127.0.0.1:4747/runs/$runId"
$snapshot.recovery | Format-List
$body = @{ nodeId = 'summarise'; observedSeq = $snapshot.recovery.observedSeq } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:4747/runs/$runId/replay" `
  -ContentType 'application/json' -Body $body
```

The response is 202 with the new `run`; open it at `/app/runs/<new-run-id>`. Its invocation and first event record `replayOf` (source run and node). The first event also records the actual `initialThread`: the inspector starts there, preserving inherited values, messages, visit counters and gate passes, then adds the fork's own execution. `GET /runs/{id}/thread` returns this seed while the fork is still queued. MCP callers use the `replay_run` tool with `runId`, `nodeId` and the reviewed `observedSeq`, then `wait_for_run` using the new ID. A node the source never reached answers 409 `REPLAY_NODE_NOT_REACHED`. The fork does not carry the source's Codex session or working directory, and a subloop node in the fork starts a new child run. See [Execution engine](../05-execution-engine.md#replay-and-debugging-decided-by-implementation-2026-10-03) for the exact rules.

The new inspector shows its exact run ID and links its source. Repeat clicks and stale tabs cannot create a second fork from the same observed intent. A repeated Replay returns `RECOVERY_STALE` with the existing fork ID; open that fork instead. Admission and intent deduplication commit together, and the source log stays unchanged.

## Stream events and reconnect

Use curl's no-buffer option. In Bash:

<!-- guide-example: events-bash -->

```bash
RUN_ID='<run-id>'
curl -N -H 'Accept: text/event-stream' \
  "http://127.0.0.1:4747/runs/$RUN_ID/events?after=0"
```

In PowerShell:

<!-- guide-example: events-powershell -->

```powershell
$runId = '<run-id>'
curl.exe -N -H 'Accept: text/event-stream' "http://127.0.0.1:4747/runs/$runId/events?after=0"
```

Each frame carries `id` (the event sequence), `event` (the type), and `data` (the JSON event). Heartbeat comments arrive every 15 seconds. After a disconnect, reconnect using the last received ID, for example 12:

<!-- guide-example: reconnect-bash -->

```bash
curl -N -H 'Accept: text/event-stream' -H 'Last-Event-ID: 12' \
  "http://127.0.0.1:4747/runs/$RUN_ID/events"
```

The query's `after` overrides the header when both are supplied. Replay includes events after the cursor, then tails live events. Execution ends at `run.finished`, `run.failed`, or `run.cancelled`. The stream stays open through return finalization and settles only on the id-less `stream.complete` control after lifecycle and durable-tail confirmation, including when the terminal cursor was already consumed. EOF alone requires reconnecting from the last received cursor. Without the SSE Accept header, the same route returns an event page with `items` and `nextAfter`.

## Read returns and child runs

Set the exit's `returns` JSONata expression to produce a payload, and `destinations` to select channels. `returns` defaults to `none`; `destinations` defaults to `caller`. With `none`, the run has no result and no destination receives anything, including channels added by the start request's `return`. Choose None with no destinations for a deliberate quiet exit. The exit editor shows which of these applies. Choose these channels:

| Channel kind | Delivery                                                                                                                                  |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `caller`     | The run snapshot's `result`; MCP callers read it through waiting or fetching; a parent receives it through its subloop mapping.           |
| `webhook`    | JSON POST to `url`; `secretRef` supplies HMAC signing when the secret resolves.                                                           |
| `file`       | Write `path` in `json`, `markdown`, or `text` format. Relative paths resolve against the run workspace; absolute paths are used as given. |
| `log`        | Write the result to the API's logger.                                                                                                     |

Exits do not publish Events; to use one loop's result in another, call it with a Subloop node. Webhook channels wrap the mapped result with `runId`, `loopId`, and `outcome`. Delivery happens after `run.finished` and does not change execution status. The inspector's Webhook delivery section and `run.deliveries` show pending, delivered or failed after N attempts, the identity and the last typed error. Webhooks retry eligible failures up to five times, with 10-second deadlines and 2/5/10/20-second delays. Every attempt sends the same `Idempotency-Key`. Receivers must implement their own deduplication if duplicate effects are unacceptable; GraphGoblin does not assume they do. Orderly stop lets an in-flight request finish within its existing deadline and starts no new attempt; pending delivery resumes on the next start with the same identity and budget. Deleting a loop stops its pending deliveries. A timeout, truncated acknowledgement or interrupted process means the effect may have happened. Other return sinks still record `return.failed`. SSE remains open through pending delivery and completes only after durable finalization; a failed delivery also finalizes without changing execution status. Run snapshots expose `finalizedAt` separately from execution status. Fetch the run or read JSON event pages to inspect durable `delivery.*` evidence:

<!-- guide-example: returns-bash -->

```bash
curl -sS "http://127.0.0.1:4747/runs/$RUN_ID/events?after=0&limit=1000"
```

<!-- guide-example: returns-powershell -->

```powershell
(Invoke-RestMethod "http://127.0.0.1:4747/runs/$runId/events?after=0&limit=1000").items |
  Where-Object { $_.type -like 'return.*' }
```

A subloop creates a separate child run with its own version, thread, and log. The parent waits with kind `child` and continues only after the child finishes; the child's exit ends the child, not the parent, which goes on to its own next node and exit. Use **parent run** and **child runs** links to move between them. By default the parent gets `lastOutput.value` containing `status`, `outcome`, `result`, and `childRunId`; a downstream decision can branch on that status. A child whose exit returns `none` gives no `result` (the field is absent, not `null`). A child that ends through a Failure or Exhausted exit is ordinary data for the parent, which continues. A child that fails while running (a script error, a provider failure, a bug) fails the parent at its subloop node with the same failure code and resumability, as if that work had run inline; the parent's failure links the **failed child run**. Fix the cause and **Resume** the parent: it resumes the same child, whose failed node runs again. Cancelling a child cancels the parent waiting for it, and cancelling the parent cancels active children.

## Act on failure reasons

`SCRIPT_START_FAILED` means the runner proved the command did not start. Fix the start configuration, then Resume. `SCRIPT_OUTCOME_UNCERTAIN` means the previous attempt may already have produced its effect before its disposition was recorded. Recovery leaves it failed; **Recover script** opens an explicit choice: **Resume** runs it again in this run, **Replay** starts a new run from the failed node, **Cancel** leaves it failed. Both retry choices may repeat the effect. `failure.script` identifies the visit, dispatch, execution state and any known exit code. Completed nonzero exits still use `SCRIPT_EXIT_CODE`.

A handler failure looks like this inside the run snapshot's `failure` field:

<!-- guide-example: failure-shape -->

```json
{
  "code": "SCRIPT_EXIT_CODE",
  "message": "script exited with code 3",
  "nodeId": "check",
  "resumable": true,
  "details": { "exitCode": 3, "stderr": "review needed", "stdout": "" }
}
```

Read `code`, `message`, `nodeId`, `resumable`, any `details`, and `inference` submission provenance when present. After fixing an external cause, resume when the failure is marked resumable. Publish and start a new run when the correction changes the pinned definition. The contract lists every code below; some are reserved and current lower-level exceptions can appear as `INTERNAL_ERROR` instead.

Non-pinned generic Codex failures permit Resume even when the adapter reports `retriable: false`
for a lost stream or CLI exit. Generic Claude failures require the adapter's `retriable`
evidence. Unsupported policy, invalid configuration and rejected arguments remain
non-resumable for both. Uncertain delivery also requires a usable session: an accepted Codex
turn can continue its recorded conversation; an inherited ID without authored-task acceptance
cannot authorize continuation.

| `RunErrorCode`                                                      | Action                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HARNESS_NOT_INSTALLED`                                             | Install Codex or correct the executable setting; check harness preflight. Missing executable errors during a turn can also appear as `HARNESS_TURN_FAILED`.                                                                                         |
| `HARNESS_NOT_AUTHENTICATED`                                         | Log into Codex as the API process user, then resume.                                                                                                                                                                                                |
| `HARNESS_QUOTA_EXHAUSTED`                                           | Wait for quota or rate-limit recovery, or resolve account access, then resume.                                                                                                                                                                      |
| `HARNESS_TURN_FAILED`                                               | Read the harness message and progress; check model availability, sandbox, CLI, and provider connectivity.                                                                                                                                           |
| `HARNESS_TRANSPORT_FAILED`                                          | Inspect transport/service connectivity and submission provenance. Only positively unsubmitted transient work retries once automatically.                                                                                                            |
| `HARNESS_OUTPUT_LIMIT`                                              | A transport/protocol resource bound was exceeded. Inspect output size; GraphGoblin did not accept a silently truncated result.                                                                                                                      |
| `RUN_DEADLINE_EXCEEDED`                                             | This run reached its pinned elapsed deadline. Start a new run with a longer deadline or No run deadline; the expired run is not resumable.                                                                                                          |
| `HARNESS_DELIVERY_UNCERTAIN`                                        | Inspect `failure.inference` and the visit's acceptance marker. When eligible, Resume continues only a usable session. An inherited previous/named ID without authored-task acceptance is insufficient; use Replay from the node when non-resumable. |
| `HARNESS_SESSION_MISSING`                                           | The provider refused the recorded conversation. Resume is unavailable. Inspect the failed run and use Replay from the node for a deliberate attempt; named-session lookup still applies.                                                            |
| `HARNESS_TERMINATION_UNCONFIRMED`                                   | Stop the remaining owned CLI process and inspect workspace effects before deliberately replaying or starting a new run. Resume is unavailable.                                                                                                      |
| `WORKING_DIRECTORY_MISSING`                                         | Check the workspace path and permissions. The current filesystem adapter creates missing directories; filesystem failures can instead report `INTERNAL_ERROR`.                                                                                      |
| `SCRIPT_EXIT_CODE`                                                  | Fix the program or its patch output; add a route in a new version for an expected nonzero outcome.                                                                                                                                                  |
| `SCRIPT_OUTCOME_UNCERTAIN`                                          | Inspect the possible external effect; explicitly Resume or Replay only when you choose to run it again. Cancel leaves it failed.                                                                                                                    |
| `SCRIPT_TIMEOUT`                                                    | Resolve the slow program, or increase its timeout in a new version.                                                                                                                                                                                 |
| `STRUCTURED_COMPLETION_TIMEOUT`                                     | Inspect the configured completion deadline and provider cause; Resume deliberately, or adjust the loop limit and start a new run.                                                                                                                   |
| `INFERENCE_TIMEOUT`                                                 | Resolve slow harness work, or increase the node timeout in a new version.                                                                                                                                                                           |
| `OUTPUT_SCHEMA_MISMATCH`                                            | Inspect raw output and repair attempts; correct the prompt, schema, or repair policy in a new version.                                                                                                                                              |
| `ARTIFACT_WRITE_FAILED`                                             | Repair artifact storage, then explicitly resume to continue the recorded provider session with a continuation prompt.                                                                                                                               |
| `SUBLOOP_DEPTH_EXCEEDED`                                            | Reduce nesting or revise the depth setting in a new version.                                                                                                                                                                                        |
| `SUBLOOP_NOT_FOUND`                                                 | Publish the referenced child or correct its loop/version reference, then start an appropriate version.                                                                                                                                              |
| `LOOP_UPGRADE_REQUIRED`                                             | An exit still publishes an Event (retired). Use a Subloop call and publish; hand-repair versions and drafts; snapshots need loop deletion or a reset.                                                                                               |
| `EVALUATION_INVALID_RESPONSE` / `EVALUATION_RESULT_REJECTED`        | Correct the provider response, declared option IDs or classifier threshold, then replay or start a new run; no other kind is tried.                                                                                                                 |
| `EVALUATION_UNAVAILABLE`                                            | Restore the selected model or credentials before resuming.                                                                                                                                                                                          |
| `EVALUATION_EXPRESSION_FAILED` / `EVALUATION_INVALID_CONFIGURATION` | Correct the expression or configuration and start a replay/new run.                                                                                                                                                                                 |
| `EVALUATION_PROVIDER_FAILED`                                        | Restore transient service/network/authentication failures and resume when allowed; deterministic request errors require a corrected new run.                                                                                                        |
| `DECIDER_UNAVAILABLE`                                               | Configure Jev's key or use an available strategy in a new version; classifier decisions need their selected evaluator.                                                                                                                              |
| `SECRET_MISSING`                                                    | Create the named secret on the server, then resume.                                                                                                                                                                                                 |
| `TEMPLATE_ERROR`                                                    | Correct Liquid syntax and referenced values; timestamp templates must render valid dates.                                                                                                                                                           |
| `EXPRESSION_ERROR`                                                  | Correct JSONata, its input assumptions, or the patch produced by a mapping.                                                                                                                                                                         |
| `WAIT_TIMEOUT`                                                      | Arrange the required input or signal sooner, or revise timeout behaviour in a new version.                                                                                                                                                          |
| `HEARTBEAT_EXHAUSTED`                                               | Check the probe and condition; revise beat/deadline limits or exhaustion behaviour if needed.                                                                                                                                                       |
| `HTTP_PROBE_BODY_OVERFLOW`                                          | An HTTP heartbeat response exceeded 64 KiB. Narrow the response or use a script probe; no successful beat or partial JSON was recorded.                                                                                                             |
| `MAX_NODE_VISITS`                                                   | Fix unintended cycles, raise maximum visits, or explicitly choose Unlimited for intentional execution.                                                                                                                                              |
| `RETURN_DELIVERY_FAILED`                                            | Reserved run-failure code. Check `run.deliveries` and `delivery.finished` for webhook outcomes; other sinks use `return.failed`. Delivery never changes execution status.                                                                           |
| `EVENT_INVALID`                                                     | Generated event violates a contract bound. Read the failure, correct its source, then start or replay. Successful values are never trimmed.                                                                                                         |
| `INTERNAL_ERROR`                                                    | Preserve the run ID, log, and failure details; investigate or report the defect before retrying side effects.                                                                                                                                       |

Use [Troubleshooting](07-troubleshooting.md) for concrete checks. See [Execution engine](../05-execution-engine.md) and [API, streaming, and MCP](../07-api-and-streaming.md) for design context.

### Visible execution limits

In the editor's Loop tab, Maximum node visits defaults to 10 and No run deadline is
selected by default. Settings also lists these defaults. To add a deadline, choose
Limited and enter seconds (the suggested value is 3600). With no deadline, long waits,
heartbeats and polling runs continue until an authored exit, Cancel or another explicit
limit/failure. Choose Unlimited visits explicitly to remove the visit cutoff; its warning
explains that authored exits and Cancel remain available.
Marked repeat decisions use Maximum passes; choose Unlimited there for indefinite passes.
Existing authored gate time checks and node timeouts still apply. The run inspector's
Execution limits card shows the pinned values and absolute deadline, even after edits.
An authored deadline includes waits, pauses and downtime; expiry fails RUN_DEADLINE_EXCEEDED.

Provider/service limits can still fail a run. Quota exhaustion fails explicitly; GraphGoblin
has no cost, token, subscription or provider-turn budget. Authors can implement usage-aware
script/decision nodes. Only a positively unsubmitted transient transport failure retries
once; uncertain accepted work is never blindly resent.

## Keep or approve particular history

In **Runs**, select the exact run rows you want to review, then choose **Review delete-ready history**. You can also review one run in its inspector. The dialog lists each selected ID and any protection reason. Confirming approves those records for future cleanup under storage pressure; it does not delete anything now. New runs stay retained. Success and failure follow the same rules.

Active and paused runs, unfinished terminal work and history needed by retained parent, child or replay runs remain protected. Select required related history together; a protected record refuses the whole selection. Shared artifacts needed by retained history stay protected. Cancel or close the dialog to change nothing. If the selection changes while you review it, cancel and review again.

Use **Withdraw delete-ready mark** before cleanup to keep the selected history; related parent, child and replay history becomes retained too. Resuming or creating new dependencies automatically withdraws affected older approvals. Deleting a loop is a separate explicit consent: its confirmation covers all of that loop's history. Its existing active-run and admission protections still apply; terminal runs do not need a delete-ready mark. Other loops' history stays, a surviving child's parent association is cleared, and the inspector explains a missing relative.

### When storage is low

On upgrade, the gateway applies migration 0022 for explicit history approval and 0023 for resource ownership, after 0021 for observation indexes. Existing history stays retained and existing files are not retroactively claimed.

Delete-ready approval can be consumed automatically while storage is low. Cleanup removes only confirmed, finalized history that no retained parent, child or replay run requires, together with positively owned, unshared resources. Review the permanent history/workspace/artifact consequence before confirming. Withdraw the mark before cleanup starts if you want to keep it. Age, success, failure and future-history preferences never approve deletion.

The subtle storage notice links to Runs. If nothing eligible can be cleaned, it asks you to review history or free disk space; it never silently expands the selection or resets your store. Shared resources, links, pre-existing unproven files and retained artifacts stay protected. Older files may remain because their ownership cannot be proved. A failed/interrupted cleanup keeps its durable job for another pass. Large or unprovable resources can stay preserved even after their approved run history is gone. Artifacts of approved runs are reclaimed only when the retained history is small enough to prove them unreferenced: at most 2,000 JSON documents and 2 MiB for each proof. Above either bound, artifacts stay kept; eligible owned workspaces can still be reclaimed. Workspace reference verification runs in bounded batches; large stores can take several passes before workspaces are reclaimed. Unknown directories remain protected. The kept count includes deferred cleanup work and stays independent of the current batch. Cleanup starts after the API is listening and yields while removing files. Successful review or withdrawal clears those selected IDs; runs removed during a refresh leave the selection, while retained runs outside a filter remain selected.

Removing SQLite history can make pages reusable without shrinking the database file. File-byte counts describe unlinked file lengths, not a guarantee about physical disk space. No automatic low-space compaction runs. Free additional disk space if the warning persists; GraphGoblin does not promise unlimited storage.

A retained template-directory run that ended without using a directory does not hold back workspace cleanup. A live run with an unresolved dynamic directory remains protected until it resolves or ends; a literal template protects only its known directory. Data directories reached through junctions, symbolic links or Windows short names work normally; links inside managed resource folders remain protected. After marking or withdrawing history, keyboard focus returns to the selection count and the result is announced.
