# Troubleshoot

Read the run's failure banner and event log first. Record the run ID, failing node, code, and message before changing anything. Use the [failure-code reference](03-run-and-observe.md#act-on-failure-reasons) for every contract code.

## Find the symptom

| Symptom                                                                                | Likely cause                                                                                                                                                   | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Harness preflight says not authenticated; a run fails with `HARNESS_NOT_AUTHENTICATED` | The selected harness login is missing or expired for the API process user.                                                                                     | Run `codex login` or `claude auth login` as that user, check preflight again, and resume only a resumable failure.                                                                                                                                                                                                                                                                                                                                                                                                           |
| Codex cannot be started                                                                | Missing executable, platform binary, or wrong `GG_CODEX_BINARY`.                                                                                               | Check preflight's message; correct the native executable override or reinstall the needed CLI/dependencies. Turn errors can appear as `HARNESS_TURN_FAILED`.                                                                                                                                                                                                                                                                                                                                                                 |
| Claude preflight fails or Claude cannot be started                                     | The owner-installed CLI is missing, not signed in with Claude.ai, older than 2.1.285, missing a required capability, or is running on an unsupported platform. | On native Windows, run `claude --version`, sign in with `claude auth login` as the API user, and check `GG_CLAUDE_BINARY` or `%USERPROFILE%\.local\bin\claude.exe`. Read the safe problem shown by preflight; do not share raw auth output.                                                                                                                                                                                                                                                                                  |
| Claude reports `HARNESS_UNSUPPORTED_POLICY`                                            | The requested policy is unsupported, or runtime init/tool evidence advertises an unexpected plugin, skill or tool.                                             | Select `read-only`/`never` or `danger-full-access`/`never`; remove explicit `networkAccess: false`, `webSearch: true`, nonempty capabilities and raw `configOverrides`. For a named unexpected component, update GraphGoblin or report the CLI version and the safe error name. Keep the policy checks enabled.                                                                                                                                                                                                              |
| Claude reports `HARNESS_PROTOCOL_ERROR` after green preflight                          | Unknown pre-init record, malformed metadata/evidence, inconsistent session or incomplete result. Unknown post-init status records are ignored.                 | Preflight checks prerequisites without a model turn. Read the detected CLI version and record `type`/`subtype` in the safe diagnostic. Update GraphGoblin or report this Claude CLI version and the safe error. CLI 2.1.287 UI metadata and bundled plugin-authoring components are supported. Do not share raw streams, auth output or account rate-limit details.                                                                                                                                                          |
| Claude cancellation reports `HARNESS_TERMINATION_UNCONFIRMED`                          | The adapter could not confirm that the Claude CLI process tree stopped.                                                                                        | Treat the run as a failed, nonresumable termination, not as cancelled. Stop any remaining CLI process, inspect the run and workspace effects, then start a new run only after confirming it is safe.                                                                                                                                                                                                                                                                                                                         |
| Claude model `claude-fable-5-1` is unavailable                                         | The model is disabled in the catalog, or the Claude CLI is not ready.                                                                                          | Enable Fable in Settings and inspect Harness preflight; install a supported CLI and sign in as the API user. Opus and Fable use the same technical checks.                                                                                                                                                                                                                                                                                                                                                                   |
| Codex rejects the model ID                                                             | The selected ID is unavailable to your account or misspelled.                                                                                                  | Correct the node model or `defaults.byHarness.codex.model` in the loop, owner settings, or `GG_DEFAULTS`. The catalog does not verify account access. Publish a new version for node/loop changes; restart for process defaults.                                                                                                                                                                                                                                                                                             |
| Codex reports denied writes                                                            | The node uses a read-only sandbox, or writes outside its allowed workspace.                                                                                    | Choose the intended fixed working directory and `workspace-write` for a node that should edit it. Publish and start the corrected version. Check actual target permissions; full access is not required for ordinary workspace edits.                                                                                                                                                                                                                                                                                        |
| A run stays waiting                                                                    | It needs input, a matching signal, a timer, a heartbeat condition, or a child result.                                                                          | Read `waiting.kind`. Submit the form or use `provide_input`/`send_signal`; inspect the child or probe. Resume is for paused/failed runs, not answering a wait.                                                                                                                                                                                                                                                                                                                                                               |
| A paused run does not accept input                                                     | Pause holds execution; the input endpoint requires waiting status.                                                                                             | Resume first, then answer when the input wait appears.                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| SSE disconnects or arrives in bursts behind a proxy                                    | Proxy buffering or idle timeout.                                                                                                                               | Disable buffering, allow streaming and heartbeat traffic, extend the idle timeout, and reconnect with the last sequence. See the curl commands below.                                                                                                                                                                                                                                                                                                                                                                        |
| Webhook returns 401 `TIMESTAMP_MISSING`                                                | Timestamp/body HMAC has a missing, ambiguous or invalid timestamp header.                                                                                      | Send one `x-graphgoblin-timestamp` header as ISO 8601 or Unix seconds.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Webhook returns 401 `TIMESTAMP_OUT_OF_WINDOW`                                          | Clock skew or an old/future timestamp for timestamp/body HMAC.                                                                                                 | Synchronise clocks and sign a fresh delivery inside `authentication.windowSeconds`. Freshness applies only to authentication.                                                                                                                                                                                                                                                                                                                                                                                                |
| Webhook returns 401 `SIGNATURE_INVALID`                                                | Wrong secret, header, digest format, or changed body bytes.                                                                                                    | Use the worked signing example, the configured header, and the exact body bytes sent.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Webhook returns 202 but no run appears                                                 | The input is saved, pending, a historical filtered delivery, failed admission or already consumed by an explicit key.                                          | Inspect Events delivery state and run links. Pending admission recovers with the same intent/run ID. Identical unkeyed bodies may start separate runs; authored-key duplicates remain acknowledged.                                                                                                                                                                                                                                                                                                                          |
| Webhook returns 404 `HOOK_NOT_FOUND` or 503 `HOOK_NOT_READY`                           | Disabled/unknown endpoint, absent HMAC secret, or endpoint authentication differs from its pinned definition.                                                  | Fetch enabled trigger paths after publishing, check the safe configuration summary and set the referenced secret for HMAC. None needs no secret.                                                                                                                                                                                                                                                                                                                                                                             |
| Webhook returns 429 `RATE_LIMITED`                                                     | Endpoint rate limit exceeded.                                                                                                                                  | Honour `retry-after` and reduce sender traffic.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Webhook returns 400 `BODY_INVALID`, 413, or 422 `EXPRESSION_FAILED`                    | Invalid UTF-8/JSON for the chosen body mode, over 1 MiB raw bytes, or an expression failure.                                                                   | JSON must be nonempty valid JSON (literal null is valid); Text allows empty UTF-8 and Bytes accepts arbitrary bytes. Keep raw input within 1 MiB and test authored expressions.                                                                                                                                                                                                                                                                                                                                              |
| Webhook returns 422 `KEY_INVALID`                                                      | An explicit key expression returned null, undefined, empty string or more than 512 characters.                                                                 | Correct the expression and resend. Invalid keys save no input. Whitespace strings remain literal; omit the expression when each delivery should be independent.                                                                                                                                                                                                                                                                                                                                                              |
| Webhook returns 400 `EVENT_TYPE_AMBIGUOUS` or 422 `EVENT_TYPE_INVALID`                 | Repeated event headers, or control/overlong scalar event metadata.                                                                                             | Send a single header and a control-free event name up to 128 characters. Missing/blank/nonscalar extraction uses the configured fallback.                                                                                                                                                                                                                                                                                                                                                                                    |
| Starting a run returns 400 `INVALID_INPUT`                                             | The input does not match the manual trigger's `inputSchema`.                                                                                                   | Read the `errors` in the response and correct the input.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Starting a run returns 404 `LOOP_NOT_FOUND` or 409 `VERSION_NOT_PUBLISHED`             | Wrong loop ID, no published version, or a draft version without `allowDraft`.                                                                                  | Check the ID, publish, or pass `allowDraft` true with the draft's `versionId`.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| A run fails with `MAX_ITERATIONS`                                                      | A node was about to start more often than the loop's `maxIterations`, usually a decision routing back without an exit.                                         | Fix the routing, or raise `maxIterations` in a new version if the repeats are intended.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| The editor says "The draft changed on the server"                                      | Another tab, device, or API client saved this loop's draft after the editor loaded it.                                                                         | Choose **Reload server draft** to take theirs or **Overwrite with this copy** to keep yours.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Loops and runs are missing after an update                                             | The default data directory moved from `./data` to `~/.graphgoblin`.                                                                                            | Set `GG_DATA_DIR` to the old directory, or stop the API and move its contents.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `--preflight` or the install script reports `FAIL`                                     | A check that blocks runs failed: Node is not 22.x, data directory not writable, broken master key or database, or Codex missing or logged out.                 | Read the check's detail, fix it, and run the command again; `WARN` lines do not block a start.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| PowerShell reports that `pnpm.ps1` cannot be loaded                                    | The execution policy blocks npm's PowerShell shims.                                                                                                            | Call `pnpm.cmd` (or `codex.cmd`) instead.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `another GraphGoblin process holds <path>`                                             | An API or key-creation command owns the data-directory lock; a malformed lock or unverifiable PID may also refuse startup.                                     | Stop the owning process and let shutdown finish before starting again or using `--create-api-key`; changing ports does not bypass the lock. Locks and `.reclaim` sidecars with a dead PID, or this process's own PID without an in-process hold, are reclaimed automatically. For a malformed or unverifiable file, inspect its PID and remove only that file after verifying that all GraphGoblin processes using this directory have stopped. Compose forwards signals through an init and allows 90 seconds for shutdown. |
| API fails with `EADDRINUSE`                                                            | Another process occupies `GG_PORT`, often an existing API.                                                                                                     | Stop the older process or choose a free port and update your UI URL and `GG_API_URL` for MCP.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| SQLite reports locked/busy                                                             | Another API or database tool is holding a write lock.                                                                                                          | Close the other writer and run one API per database. Back up before investigating; preserve the database and its journal files. The connection config uses a five-second busy timeout.                                                                                                                                                                                                                                                                                                                                       |
| The UI is stale after a backend update                                                 | A waiting service worker or cached app shell.                                                                                                                  | Click **Update** in **A new version is available**. If no toast appears, confirm the served build and follow the stale-UI steps below.                                                                                                                                                                                                                                                                                                                                                                                       |
| The UI asks for an API key                                                             | `GG_REQUIRE_API_KEY=true`; this browser has no key, or its key was revoked.                                                                                    | Paste a key. For the first key, stop the API, run `node apps/api/dist/main.js --create-api-key <name>` with the server's environment, then restart (see [Settings](06-settings-and-secrets.md#the-first-key-from-the-command-line)).                                                                                                                                                                                                                                                                                         |
| The UI returns 404                                                                     | `GG_WEB_DIST` is empty or points at a missing build, or the checkout was not built.                                                                            | Run `pnpm build`, or set `GG_WEB_DIST` to a built web directory containing `index.html`.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Settings defaults change but a run uses another model                                  | A node value or loop default wins over the owner default.                                                                                                      | Clear the node or loop value, or change it; owner defaults apply from the next run start or resume.                                                                                                                                                                                                                                                                                                                                                                                                                          |

## HTTP probe exceeds 64 KiB

HTTP polls and heartbeat probes fail above 65,536 decompressed response bytes with
`HTTP_PROBE_BODY_OVERFLOW`; partial JSON is never presented as success. Find polls
in API log warnings named `poll trigger failed` with that code and the loop/trigger
identity. Find heartbeat failures by the same run failure code in the inspector.

Single-result HTTP probes formerly parsed the full JSON while slicing the body
preview, so a previously working query can now fail. GitHub REST pages containing
30–100 issues can exceed the cap. Narrow query parameters such as the page size,
or use a single-result script probe, which keeps its 10 MiB capture and full JSON
parsing. Items-mode script probes remain limited to 64 KiB. See
[Polling and heartbeat probes](04-triggers.md#poll-without-inbound-access).

## Check harnesses and the gateway

Run in PowerShell:

```powershell
codex --version
codex login
codex login status
Invoke-RestMethod 'http://127.0.0.1:4747/healthz'
Invoke-RestMethod 'http://127.0.0.1:4747/harness/preflight'
```

For Claude Code on native Windows, run `claude --version`, use `claude auth login` if needed,
and inspect the safe result from the same `/harness/preflight` endpoint. The adapter requires
version 2.1.285 or newer with the required capabilities and accepts only Claude.ai account authentication.

Runtime verification accepts built-in plugin names only when their path and source also
identify them as built-in. A diagnostic name containing path separators or email syntax
appears as `<invalid>`; plugin paths and source strings are omitted from diagnostics.

In Bash, replace the last two lines with:

```bash
curl -sS http://127.0.0.1:4747/healthz
curl -sS http://127.0.0.1:4747/harness/preflight
```

The harness preflight checks the executable selected by the API. Codex defaults to the SDK's bundled CLI; Claude defaults to `%USERPROFILE%\.local\bin\claude.exe`. Set `GG_CODEX_BINARY` or `GG_CLAUDE_BINARY` to select another executable. In API-key mode, include a bearer header for preflight.

Change a conflicting port before restarting:

```powershell
$env:GG_PORT = '4749'
pnpm.cmd --filter @graphgoblin/api start
```

```bash
GG_PORT=4749 pnpm --filter @graphgoblin/api start
```

Then open the new UI URL and set the MCP gateway origin in the terminal that launches Codex or MCP:

```text
http://127.0.0.1:4749/app/
```

```powershell
$env:GG_API_URL = 'http://127.0.0.1:4749'
```

## Recover a disconnected stream

Reconnect with the last event ID, using your actual run ID and cursor. In Bash:

```bash
RUN_ID='<run-id>'
LAST_SEQ=12
curl -N -H 'Accept: text/event-stream' -H "Last-Event-ID: $LAST_SEQ" \
  "http://127.0.0.1:4747/runs/$RUN_ID/events"
```

In PowerShell:

```powershell
$runId = '<run-id>'
curl.exe -N -H 'Accept: text/event-stream' -H 'Last-Event-ID: 12' "http://127.0.0.1:4747/runs/$runId/events"
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

The API writes structured Pino logs, one JSON object per line, to standard output; there is no automatic log file. Set `GG_LOG_LEVEL` before startup to select `fatal`, `error`, `warn`, `info`, `debug`, `trace`, or `silent`. To capture output while viewing it, run from the repository root with the same installation environment. In PowerShell:

```powershell
node apps/api/dist/main.js | Tee-Object -FilePath graphgoblin-api.log
```

In Bash, which also captures startup errors written to standard error:

```bash
node apps/api/dist/main.js 2>&1 | tee graphgoblin-api.log
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

## Unreadable run history

Startup can log `HISTORY_UNREADABLE` with a run ID and a reason such as a malformed
JSON field or the sequence and type of an invalid event. Healthy current-format runs
continue recovery. Startup checks active runs and terminal runs awaiting finalization,
so its log names damaged recovery candidates only. `GET /runs/diagnostics` also checks
finalized terminal history. The ordinary `GET /runs` list and the web Runs page silently omit unreadable run rows; if an expected run is missing, check diagnostics.

`GET /runs/:id` and MCP `get_run` decode only the run row, so a snapshot can look normal
while its events or thread are damaged. An unreadable run row or stored thread yields
`500 STORED_RUN_INVALID`; an unreadable event page yields `500 STORED_EVENT_INVALID`
(MCP reports the same codes as tool errors). If events or thread reads fail this way,
query `GET /runs/diagnostics` with a key holding `runs:read` to identify the damaged
history, then repair or delete it explicitly as described below. Diagnostics covers
all runs belonging to that key's owner. Follow `nextCursor` until null; each request
checks at most 20 runs and 2,000 events. The diagnostic does not change a stored status;
a damaged run's snapshot may still say queued, running, or waiting. No execution is
recovered for that damaged run.

**Manual disposition:** Stop the API before editing SQLite. Repair the specifically named
row by hand to match the current contract, then restart and check `GET /runs/diagnostics`
again. Deletion of unrelated loops works while the damaged run is isolated. Alternatively,
explicitly delete the containing loop using the existing
`DELETE /loops/:id` path once all its runs are terminal. That deletion removes the loop
and all its history, not just the damaged run; there is currently no individual-run
deletion endpoint. If a damaged row still represents active work, manually repair it to
a valid terminal run record before choosing loop deletion. Recovery never repairs,
archives, reconstructs, deletes, or resets damaged data automatically.

An unsupported whole-store format or a database/schema/I/O failure is a separate startup
error. Do not reset the whole store to dispose of one damaged run.

Return to the [User guide](README.md), or read [API, streaming, and MCP](../07-api-and-streaming.md) and [Frontend and PWA](../09-frontend-and-pwa.md) for design context.
