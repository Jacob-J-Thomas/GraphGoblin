# Troubleshoot

Read the run's failure banner and event log first. Record the run ID, failing node, code, and message before changing anything. Use the [failure-code reference](03-run-and-observe.md#act-on-failure-reasons) for every contract code.

## Find the symptom

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Harness preflight says not authenticated; a run fails with `HARNESS_NOT_AUTHENTICATED` | Codex login is missing or expired for the API process user. | Run the login commands below as that user, check preflight again, and resume a resumable failure. |
| Codex cannot be started | Missing executable, platform binary, or wrong `GG_CODEX_BINARY`. | Check preflight's message; correct the native executable override or reinstall the needed CLI/dependencies. Turn errors can appear as `HARNESS_TURN_FAILED`. |
| Codex rejects the model ID | The selected ID is unavailable to your account or misspelled. | Correct the node model, loop default, or `GG_DEFAULT_MODEL`. The catalog does not verify account access. Publish a new version for node/loop changes; restart for process defaults. |
| Codex reports denied writes | The node uses a read-only sandbox, or writes outside its allowed workspace. | Choose the intended fixed working directory and `workspace-write` for a node that should edit it. Publish and start the corrected version. Check actual target permissions; full access is not required for ordinary workspace edits. |
| A run stays waiting | It needs input, a matching signal, a timer, a heartbeat condition, or a child result. | Read `waiting.kind`. Submit the form or use `provide_input`/`send_signal`; inspect the child or probe. Resume is for paused/failed runs, not answering a wait. |
| A paused run does not accept input | Pause holds execution; the input endpoint requires waiting status. | Resume first, then answer when the input wait appears. |
| SSE disconnects or arrives in bursts behind a proxy | Proxy buffering or idle timeout. | Disable buffering, allow streaming and heartbeat traffic, extend the idle timeout, and reconnect with the last sequence. See the curl commands below. |
| Webhook returns 401 `TIMESTAMP_MISSING` | Missing or invalid timestamp header. | Send the required header as ISO 8601 or Unix seconds. |
| Webhook returns 401 `TIMESTAMP_OUT_OF_WINDOW` | Clock skew or an old/future delivery timestamp. | Synchronise sender/server clocks and sign a fresh delivery inside the configured replay window. |
| Webhook returns 401 `SIGNATURE_INVALID` | Wrong secret, header, digest format, or changed body bytes. | Use the worked signing example, the configured header, and the exact body bytes sent. |
| Webhook returns 409 `REPLAYED` | Its dedupe key or signature was already received inside the replay window. | Treat a duplicate as already accepted; check the event log. Give genuinely new deliveries distinct IDs rather than resending the same key. |
| Webhook returns 404 `HOOK_NOT_FOUND` or 503 `HOOK_NOT_READY` | Disabled/unknown endpoint or absent signing secret. | Fetch enabled trigger paths after publishing and set the referenced secret. |
| Webhook returns 429 `RATE_LIMITED` | Endpoint rate limit exceeded. | Honor `retry-after` and reduce sender traffic. |
| API fails with `EADDRINUSE` | Another process occupies `GG_PORT`, often an existing API. | Stop the older process or choose a free port and update your UI URL and `GG_API_URL` for MCP. |
| SQLite reports locked/busy | Another API or database tool is holding a write lock. | Close the other writer and run one API per database. Back up before investigating; preserve the database and its journal files. The connection config uses a five-second busy timeout. |
| The UI is stale after a backend update | A waiting service worker or cached app shell. | Click **Update** in **A new version is available**. If no toast appears, confirm the served build and follow the stale-UI steps below. |
| The UI returns 401 after enabling API keys | The auth hook also guards the web app, and the UI has no key-entry flow. | Use API/MCP clients with a bearer key; for the current UI, restart on localhost with trusted mode enabled. |
| The UI returns 404 | `GG_WEB_DIST` is unset or points at a missing build. | Set the built web directory using the installation commands and restart. |
| Settings defaults change but runs use the old model | Owner defaults are stored but not read by the engine. | Set execution defaults on the loop/node or in the API environment. See [Settings](06-settings-and-secrets.md#choose-a-model-and-effort). |

## Check Codex and the gateway

Run in PowerShell:

```powershell
codex --version
codex login
codex login status
Invoke-RestMethod 'http://127.0.0.1:4747/healthz'
Invoke-RestMethod 'http://127.0.0.1:4747/harness/preflight'
```

The harness preflight checks the executable selected by the API, which defaults to the SDK's bundled CLI. If that differs from your terminal's CLI, inspect `GG_CODEX_BINARY` and the reported version. In API-key mode, include a bearer header for preflight.

Change a conflicting port before restarting:

```powershell
$env:GG_PORT = '4749'
pnpm --filter @graphgoblin/api start
```

Then open the new UI URL and set the MCP gateway origin in the terminal that launches Codex or MCP:

```text
http://127.0.0.1:4749/app/
```

```powershell
$env:GG_API_URL = 'http://127.0.0.1:4749'
```

## Recover a disconnected stream

Reconnect with the last event ID in Bash, using your actual run ID and cursor:

```bash
RUN_ID='<run-id>'
LAST_SEQ=12
curl -N -H 'Accept: text/event-stream' -H "Last-Event-ID: $LAST_SEQ" \
  "http://127.0.0.1:4747/runs/$RUN_ID/events"
```

Add the bearer header when required. A stream ending after a terminal event is normal. Return-delivery events arrive after completion and need a subsequent JSON event-page request, as explained in [Run and observe](03-run-and-observe.md#read-returns-and-child-runs).

## Refresh a stale UI

Confirm the API serves the web build you expect, then reload and accept the update toast. If it remains stale, open the browser's developer tools, inspect the service worker, unregister it, and reload. Preserve or sync local drafts before clearing site storage: drafts live in IndexedDB. The service worker caches the app shell, not API responses.

The served shell and worker are:

```text
<GG_WEB_DIST>/index.html
http://127.0.0.1:4747/app/sw.js
```

## Collect logs

The API writes structured Pino logs to its terminal output; there is no automatic log file. Set `GG_LOG_LEVEL` before startup to select `fatal`, `error`, `warn`, `info`, `debug`, `trace`, or `silent`. To capture output while viewing it, run from the repository root in PowerShell with the same installation environment:

```powershell
node apps/api/dist/main.js 2>&1 | Tee-Object -FilePath graphgoblin-api.log
```

Run events are stored in SQLite and available in the inspector, through `read_run_events`, and through the event endpoint. The current thread and harness sessions can also be fetched:

```http
GET /runs/{id}/events?after=0
GET /runs/{id}/thread
GET /runs/{id}/sessions
```

Transcript artifacts live under the data directory and can be fetched using an artifact ID from the thread:

```text
<data-directory>/artifacts/transcript/<content-hash>
```

```http
GET /runs/{id}/artifacts/{artifactId}
```

MCP writes diagnostics to stderr; inspect your MCP client's captured server logs. Include the failure details and relevant event sequences when reporting a defect. Check output for sensitive values before sharing it.

Return to the [User guide](README.md), or read [API and streaming](../07-api-and-streaming.md) and [Frontend and PWA](../09-frontend-and-pwa.md) for design context.
