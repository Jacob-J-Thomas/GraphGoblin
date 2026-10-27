# Troubleshoot

Read the run's failure banner and event log first. Record the run ID, failing node, code, and message before changing anything. Use the [failure-code reference](03-run-and-observe.md#act-on-failure-reasons) for every contract code.

## Inference prompt delivery

Inspect `failure.inference.submission` and the visit's `harness.turn` / `harness.submission`
events. A session ID or init announcement alone proves no prompt acceptance.

For non-pinned generic failures, Codex permits Resume even when the adapter reports
`retriable: false` for an exit or lost stream. Claude requires the adapter's `retriable`
evidence. Both still need a usable session for uncertain recovery; pinned unsupported-policy,
configuration and argument refusals remain non-resumable.

| Case                                                                                                                   | Action                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Definitely not submitted (`definitely-not-submitted`)                                                                  | Fix the external cause and Resume when eligible: the exact saved authored/repair task uses its original session selection. Unsupported policy, invalid configuration and rejected arguments need a corrected definition and a new run; the failed run's definition is pinned.                                                                     |
| Delivery uncertain (`HARNESS_DELIVERY_UNCERTAIN`, or a specific timeout/quota/storage cause with `delivery-uncertain`) | When eligible, Resume continues a usable recorded session. An inherited previous/named ID without authored-task acceptance is insufficient. When non-resumable, inspect possible effects and use **Replay from the node** for a deliberate attempt. Stop an unconfirmed native process first.                                                     |
| Session missing (`HARNESS_SESSION_MISSING`)                                                                            | Preserve and inspect the failed run. Resume is refused. Use **Replay from the node** for a deliberate attempt; named-session lookup can still select the same missing conversation. To change that policy, correct the definition and start a new run. For eligible failures use the explicit Start fresh session control described below (#265). |

## Find the symptom

For `SCRIPT_OUTCOME_UNCERTAIN`, the previous script attempt may already have produced its effect before its result was recorded. Recovery leaves it failed. Inspect the external system, then choose **Recover script**: **Resume** runs it again in the same run; **Replay** runs it in a new run from the failed node; **Cancel** leaves the run failed. Either retry may repeat the effect. `SCRIPT_START_FAILED` instead means the runner proved the command did not start; correct the missing command or start configuration and explicitly Resume. Nonzero completed exits retain `SCRIPT_EXIT_CODE`. The failure's `script` fields identify the visit, dispatch, state and known exit code.

After upgrading, an unfinished script visit from an earlier build may have no dispatch marker even though it already produced an effect. Recovery classifies it as `SCRIPT_OUTCOME_UNCERTAIN` with a visit ID and no dispatch ID; it does not run the command. The same failure and recovery choices remain available if writing a dispatched script's progress or completion failed. Repair the storage fault, inspect any external effect, then choose Resume or Replay knowingly, or leave the run failed with Cancel. No store reset or migration is required.

| Symptom                                                                                | Likely cause                                                                                                                                                   | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Harness preflight says not authenticated; a run fails with `HARNESS_NOT_AUTHENTICATED` | The selected harness login is missing or expired for the API process user.                                                                                     | Run `codex login` or `claude auth login` as that user, check preflight again, and resume only a resumable failure.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Codex cannot be started                                                                | Missing executable, platform binary, or wrong `GG_CODEX_BINARY`.                                                                                               | Check preflight's message; correct the native executable override or reinstall the needed CLI/dependencies. Turn errors can appear as `HARNESS_TURN_FAILED`.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Claude preflight fails or Claude cannot be started                                     | The owner-installed CLI is missing, not signed in with Claude.ai, older than 2.1.285, missing a required capability, or is running on an unsupported platform. | On native Windows, run `claude --version`, sign in with `claude auth login` as the API user, and check `GG_CLAUDE_BINARY` or `%USERPROFILE%\.local\bin\claude.exe`. Read the safe problem shown by preflight; do not share raw auth output.                                                                                                                                                                                                                                                                                                                                                                 |
| Claude reports `HARNESS_UNSUPPORTED_POLICY`                                            | The requested policy is unsupported, or runtime init/tool evidence advertises an unexpected plugin, skill or tool.                                             | Select `read-only`/`never` or `danger-full-access`/`never`; remove explicit `networkAccess: false`, `webSearch: true`, nonempty capabilities and raw `configOverrides`. For a named unexpected component, update GraphGoblin or report the CLI version and the safe error name. Keep the policy checks enabled.                                                                                                                                                                                                                                                                                             |
| Claude reports `HARNESS_PROTOCOL_ERROR` after green preflight                          | Unknown pre-init record, malformed metadata/evidence, inconsistent session or incomplete result. Unknown post-init status records are ignored.                 | Preflight checks prerequisites without a model turn. Read the detected CLI version and record `type`/`subtype` in the safe diagnostic. Update GraphGoblin or report this Claude CLI version and the safe error. CLI 2.1.287 UI metadata and bundled plugin-authoring components are supported. Do not share raw streams, auth output or account rate-limit details.                                                                                                                                                                                                                                         |
| Claude cancellation reports `HARNESS_TERMINATION_UNCONFIRMED`                          | The adapter could not confirm that the Claude CLI process tree stopped.                                                                                        | Treat the run as a failed, nonresumable termination, not as cancelled. Stop any remaining CLI process, inspect the run and workspace effects, then start a new run only after confirming it is safe.                                                                                                                                                                                                                                                                                                                                                                                                        |
| Claude model `claude-fable-5-1` is unavailable                                         | The model is explicitly disabled (`MODEL_DISABLED`) or absent from the supported catalog (`MODEL_NOT_IN_CATALOG`).                                             | Enable the catalog entry if disabled, or choose a supported identity if absent. Auth, quota and transport failures are separate prerequisite/execution errors; inspect Harness preflight and choose Retry preflight.                                                                                                                                                                                                                                                                                                                                                                                        |
| Codex rejects the model ID                                                             | Execution rejected the selected ID for this account, or the ID is misspelled.                                                                                  | Correct the node model or `defaults.byHarness.codex.model` in the loop, owner settings, or `GG_DEFAULTS`. The catalog does not verify account access. Publish a new version for node/loop changes; restart for process defaults.                                                                                                                                                                                                                                                                                                                                                                            |
| A Codex command fails with `CreateProcessWithLogonW failed: 267`                       | The command's working directory is missing or longer than 258 characters (`CreateProcessAsUserW failed: 267` in the unelevated sandbox).                       | The run transcript does not show a command's own directory. Open the worker's Codex session log (`%USERPROFILE%\.codex\sessions`, file name containing the node's session ID) and read that tool call's `workdir`. Check that this `workdir` exists and has at most 258 characters, whether or not it matches the node's working directory (a command may use another directory on purpose). A `workdir` that drops a segment of the node's directory is a probable typo by the worker, as in the diagnosed case, and needs no GraphGoblin change. [Diagnosis](../qa/2026-10-19-wp-f5-launch-diagnosis.md). |
| Claude preflight says the executable could not be started; `claude --version` works    | A working `claude --version` may use another executable or account. Otherwise the API's `TEMP`/`TMP` may be too long: 234 characters or more.                  | First check, for the account running the API, the executable it uses (`GG_CLAUDE_BINARY`, else `%USERPROFILE%\.local\bin\claude.exe`), that this account is signed in, and the API's `TEMP` and `TMP`. If those paths have 234 characters or more, the Claude check directory exceeds the Windows 258-character working-directory limit: set both to a shorter directory and retry preflight.                                                                                                                                                                                                               |
| Codex reports denied writes                                                            | The node uses a read-only sandbox, or writes outside its allowed workspace.                                                                                    | Choose the intended fixed working directory and `workspace-write` for a node that should edit it. Publish and start the corrected version. Check actual target permissions; full access is not required for ordinary workspace edits.                                                                                                                                                                                                                                                                                                                                                                       |
| A run stays waiting                                                                    | It needs input, a matching signal, a timer, a heartbeat condition, or a child result.                                                                          | Read `waiting.kind`. Submit the form or use `provide_input`/`send_signal`; inspect the child or probe. Resume is for paused/failed runs, not answering a wait.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| A paused run does not accept input                                                     | Pause holds execution; the input endpoint requires waiting status.                                                                                             | Resume first, then answer when the input wait appears.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| SSE disconnects or arrives in bursts behind a proxy                                    | Proxy buffering or idle timeout.                                                                                                                               | Disable buffering, allow streaming and heartbeat traffic, extend the idle timeout, and reconnect with the last sequence. See the curl commands below.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Webhook returns 401 `TIMESTAMP_MISSING`                                                | Timestamp/body HMAC has a missing, ambiguous or invalid timestamp header.                                                                                      | Send one `x-graphgoblin-timestamp` header as ISO 8601 or Unix seconds.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Webhook returns 401 `TIMESTAMP_OUT_OF_WINDOW`                                          | Clock skew or an old/future timestamp for timestamp/body HMAC.                                                                                                 | Synchronise clocks and sign a fresh delivery inside `authentication.windowSeconds`. Freshness applies only to authentication.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Webhook returns 401 `SIGNATURE_INVALID`                                                | Wrong secret, header, digest format, or changed body bytes.                                                                                                    | Use the worked signing example, the configured header, and the exact body bytes sent.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Webhook returns 202 but no run appears                                                 | The input is saved, pending, a historical filtered delivery, failed admission or already consumed by an explicit key.                                          | Inspect Events delivery state and run links. Pending admission recovers with the same intent/run ID. Identical unkeyed bodies may start separate runs; authored-key duplicates remain acknowledged.                                                                                                                                                                                                                                                                                                                                                                                                         |
| Webhook returns 404 `HOOK_NOT_FOUND` or 503 `HOOK_NOT_READY`                           | Disabled/unknown endpoint, absent HMAC secret, or endpoint authentication differs from its pinned definition.                                                  | Fetch enabled trigger paths after publishing, check the safe configuration summary and set the referenced secret for HMAC. None needs no secret.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Webhook returns 429 `RATE_LIMITED`                                                     | Endpoint rate limit exceeded.                                                                                                                                  | Honour `retry-after` and reduce sender traffic.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Webhook returns 400 `BODY_INVALID`, 413, or 422 `EXPRESSION_FAILED`                    | Invalid UTF-8/JSON for the chosen body mode, over 1 MiB raw bytes, or an expression failure.                                                                   | JSON must be nonempty valid JSON (literal null is valid); Text allows empty UTF-8 and Bytes accepts arbitrary bytes. Keep raw input within 1 MiB and test authored expressions.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Webhook returns 422 `KEY_INVALID`                                                      | An explicit key expression returned null, undefined, empty string or more than 512 characters.                                                                 | Correct the expression and resend. Invalid keys save no input. Whitespace strings remain literal; omit the expression when each delivery should be independent.                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Webhook returns 400 `EVENT_TYPE_AMBIGUOUS` or 422 `EVENT_TYPE_INVALID`                 | Repeated event headers, or control/overlong scalar event metadata.                                                                                             | Send a single header and a control-free event name up to 128 characters. Missing/blank/nonscalar extraction uses the configured fallback.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Starting a run returns 400 `INVALID_INPUT`                                             | The input does not match the manual trigger's `inputSchema`.                                                                                                   | Read the `errors` in the response and correct the input.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Starting a run returns 404 `LOOP_NOT_FOUND` or 409 `VERSION_NOT_PUBLISHED`             | Wrong loop ID, no published version, or a draft version without `allowDraft`.                                                                                  | Check the ID, publish, or pass `allowDraft` true with the draft's `versionId`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| A run fails with `MAX_ITERATIONS`                                                      | A node was about to start more often than the loop's `maxIterations`, usually a decision routing back without an exit.                                         | Fix the routing, or raise `maxIterations` in a new version if the repeats are intended.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| The editor says "The draft changed on the server"                                      | Another tab, device, or API client saved this loop's draft after the editor loaded it.                                                                         | Choose **Reload server draft** to take theirs or **Overwrite with this copy** to keep yours.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Loops and runs are missing after an update                                             | The default data directory moved from `./data` to `~/.graphgoblin`.                                                                                            | Set `GG_DATA_DIR` to the old directory, or stop the API and move its contents.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Startup says `GraphGoblin did not start: this build cannot open the store`             | The store is in an older format, has no valid format marker, or is a damaged format-4 store. No stored data was changed.                                       | Keep running the build that wrote it, repair a damaged store by hand, or start fresh with the reset the message prints; see [Reset and start fresh](08-offline-upgrade.md).                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Import returns 400 `LOOP_FORMAT_UNSUPPORTED`                                           | The file is a loop export or definition in another format; this build does not convert it.                                                                     | Re-create the loop, or export it again from a build that writes format 4; see [Old exports](08-offline-upgrade.md#old-exports).                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| The editor shows **Unsupported device draft**                                          | This browser holds a draft of the loop from an older build. It is not converted or overwritten.                                                                | Export it if you want its contents, then **Discard this device draft**; only this browser's copy is removed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `--preflight` or the install script reports `FAIL`                                     | A check that blocks runs failed: Node is not 22.x, data directory not writable, broken master key or database, or Codex missing or logged out.                 | Read the check's detail, fix it, and run the command again; `WARN` lines do not block a start.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| PowerShell reports that `pnpm.ps1` cannot be loaded                                    | The execution policy blocks npm's PowerShell shims.                                                                                                            | Call `pnpm.cmd` (or `codex.cmd`) instead.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `another GraphGoblin process holds <path>`                                             | An API or key-creation command owns the data-directory lock; a malformed lock or unverifiable PID may also refuse startup.                                     | Stop the owning process and let shutdown finish before starting again or using `--create-api-key`; changing ports does not bypass the lock. Locks and `.reclaim` sidecars with a dead PID, or this process's own PID without an in-process hold, are reclaimed automatically. For a malformed or unverifiable file, inspect its PID and remove only that file after verifying that all GraphGoblin processes using this directory have stopped. Compose forwards signals through an init and allows one hour for shutdown.                                                                                  |
| API fails with `EADDRINUSE`                                                            | Another process occupies `GG_PORT`, often an existing API.                                                                                                     | Stop the older process or choose a free port and update your UI URL and `GG_API_URL` for MCP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| SQLite reports locked/busy                                                             | Another API or database tool is holding a write lock.                                                                                                          | Close the other writer and run one API per database. Back up before investigating; preserve the database and its journal files. The connection config uses a five-second busy timeout.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| The UI is stale after a backend update                                                 | A waiting service worker or cached app shell.                                                                                                                  | Click **Update** in **A new version is available**. If no toast appears, confirm the served build and follow the stale-UI steps below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| The UI asks for an API key                                                             | `GG_REQUIRE_API_KEY=true`; this browser has no key, or its key was revoked.                                                                                    | Paste a key. For the first key, stop the API, run `node apps/api/dist/main.js --create-api-key <name>` with the server's environment, then restart (see [Settings](06-settings-and-secrets.md#the-first-key-from-the-command-line)).                                                                                                                                                                                                                                                                                                                                                                        |
| The UI returns 404                                                                     | `GG_WEB_DIST` is empty or points at a missing build, or the checkout was not built.                                                                            | Run `pnpm build`, or set `GG_WEB_DIST` to a built web directory containing `index.html`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Settings defaults change but a run uses another model                                  | A node value or loop default wins over the owner default.                                                                                                      | Clear the node or loop value, or change it; owner defaults apply from the next run start or resume.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

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

## Read harness readiness

`GET /harness/preflight` reports the seven server states below; `checking` is client-only while
no result exists yet. Settings shows the label on each returned harness badge, then the problem
with its next step. After fixing the cause, choose
**Retry preflight** in that card (or **Retry Claude preflight** / **Retry Codex preflight** in the
node editor). See [readiness lookup behavior](../09-frontend-and-pwa.md#claude-readiness-and-saved-selections)
for first load, background rechecks, offline pauses, completed lookup failures and transport wording.

| State              | Label             | What to do                                                                                                                                                                                                       |
| ------------------ | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checking`         | Checking…         | The first check has not answered yet. Wait for it.                                                                                                                                                               |
| `unknown`          | Unknown           | The check timed out or returned empty/unrecognised login output, even with exit 0. Sign-out is not established. Check that the CLI starts and responds, then retry preflight.                                    |
| `ready`            | Ready             | CLI version, required flags and local login passed. Account access to a model is not verified.                                                                                                                   |
| `cli-missing`      | CLI not found     | Install the CLI or set `GG_CLAUDE_BINARY` / `GG_CODEX_BINARY`, then retry preflight.                                                                                                                             |
| `cli-incompatible` | CLI update needed | Update that CLI; the problem names the version or missing option. Then retry preflight.                                                                                                                          |
| `auth`             | Sign-in needed    | The CLI reported sign-out, a wrong Claude account method or an authentication failure (including HTTP/API 401/403). Run `claude auth login` / `codex login` for the API's Windows account, then retry preflight. |
| `quota`            | Usage limit       | The CLI reported HTTP/API 429 or an account allowance limit, even if it also mentions network settings. Wait for the allowance to reset, then retry preflight; keep the selected model.                          |
| `transport`        | Connection failed | Check the connection and provider service status, then retry preflight; keep the model.                                                                                                                          |

Model unavailable is reserved for a disabled model or an identity removed from GraphGoblin's
supported catalog. Enable a deliberately disabled entry or choose a supported entry. A failed
catalog lookup says unknown and preserves the saved choice. Catalog listings and requested effort
choices do not establish provider entitlement. Draft create, import, template draft and save do
not probe readiness; validate, publish, preflight and run start do, sharing one probe per harness
within the operation and checking distinct harnesses concurrently (D-017). Publication is blocked
with the specific readiness reason when prerequisites are not ready.

`authenticated` omitted from a preflight response means login was not established, rather than
signed out. A confirmed signed-out Claude status is `auth`, including JSON on stdout with exit 1.
An empty response or `{}` on exit 0 instead shows "Unknown" with
"Claude readiness could not be confirmed. Check that the Claude CLI starts and responds, then retry preflight."
(or Codex).
The unknown result omits `authenticated`; it does not ask you to log in based only on missing output.
The [no-turn evidence precedence](../06-harness-integration.md#no-turn-readiness-179)
keeps explicit status evidence ahead of incidental network wording and explains Claude's
stderr/stdout conflict rule. No model turn is used to resolve an uncertain login.

No readiness check starts a model turn. Native no-turn process evidence and disposable QA steps
are recorded in the [WP-F1 report](../qa/2026-10-19-wp-f1-readiness/README.md).

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

## Structured completion timeout

`STRUCTURED_COMPLETION_TIMEOUT` means an LLM decision evaluation or output-transform
repair through the structured port exceeded
the loop's **Structured completion milliseconds** limit. The failure names that limit
and stores it in `details.timeoutMs`; the inspector shows the pinned value. The provider
is aborted, the run slot is released and a late result cannot update the thread. Inspect
the external cause and use Resume for a deliberate attempt when appropriate, or change
the loop limit and start a new run. Choose Unlimited to remove this completion cutoff;
run deadlines and node timeouts still apply. Explicit Cancel ends as `cancelled`, with
no timeout failure. This limit measures elapsed time, not tokens or provider allowance.

## Gateway is draining (#224)

A first Ctrl+C (SIGINT) or SIGTERM stops independent starts. Active work can still finish,
including children created during drain and timer/input/signal continuations that wake while
other work still holds the drain. A future timer, input/signal wait, parent waiting on a parked
child or paused run does not hold shutdown: its durable state recovers unchanged at restart.
Past wall-clock waits become eligible after restart; paused runs stay paused. The API and inspector
remain available. After five minutes by default, the log says to keep waiting or explicitly
force. Read `GET /system/shutdown` for phase and active run IDs; configure the notification
with `GG_SHUTDOWN_GRACE_MS`. With an API key, use `system:read` / `system:write` scopes.

Send `POST /system/shutdown` with JSON `{ "action": "wait" }` to acknowledge waiting,
or `{ "action": "force" }` to interrupt. A second Ctrl+C or SIGTERM at least one second after the first also explicitly forces.
Signals inside the second after each accepted signal are coalesced because pnpm may forward a duplicate of one
keypress.
Wait has no hidden kill timer. Cancelling a particular run remains a separate command.
Every browser page now shows the drain notice (#319), active runs linked to their
inspectors, and **Keep waiting** / **Force stop**. Force requires confirmation naming
the work and warning that external effects may be uncertain. Closing, reloading or
navigating a tab only changes observation; none sends a shutdown action. Starting a
drain remains a terminal/API operation.

If another tab acts first, a 409 shows the current gateway state. A changed phase
or restarted gateway closes any open force confirmation and requires a fresh choice. A lost action
response has an unknown outcome and is never automatically retried. After HTTP
closes, **Gateway stopped or disconnected** keeps the last state without repeated
shutdown polling; **Check gateway state** explicitly checks after restart. This
message alone does not prove process exit or resource release. Read access needs
`system:read`; actions need `system:write`; optional run names use `runs:read`.

Forced runs show `RUN_INTERRUPTED_BY_STOP`, the node and attempt, and possible external
effects. They do not automatically resume. Inspect what happened before explicitly replaying.
An unconfirmed termination caused by this force leaves the listener, store and lock held in
`force-failed`. Inspect logs and native processes. For a Codex turn this is
`HARNESS_TERMINATION_UNCONFIRMED`: GraphGoblin asked the Codex CLI to stop, but the turn did not
end within five seconds. Usually a process the CLI started still holds its output open; the CLI
itself or that process may still be running, and GraphGoblin cannot reach a process the CLI
started. Find any remaining process by its command line (for example in Task Manager's Details
tab with the Command line column shown) and end it yourself, before or after **Force exit**. A further force request or deliberate later
signal exits with code 1 after a 100 ms response-flush allowance, retains the failure and leaves
the lock for next-start reclamation. Earlier unconfirmed failures appear in `unconfirmedRunIds`
but do not trap a later normal stop. A drain observation failure uses `drain-failed`; invalid
controls (including wait before drain and force after a drain failure) return 409 with current phase. An orderly stop releases the lock
only after executor cleanup, stream/listener closure and SQLite closure.

Docker Compose still imposes its own one-hour hard deadline. To wait indefinitely, initiate
API drain while the service is running, then stop Compose after the API exits. A Docker
SIGKILL cannot record managed force evidence.

On Windows, use the API controls when stopping from another process. Windows `taskkill`
and Node's programmatic `child.kill('SIGINT'/'SIGTERM')` bypass JavaScript signal handlers;
they cannot establish managed drain/force evidence. The real signal cases run on Linux CI.
Ctrl+C in the gateway's own terminal window does work on Windows: scripts, the Claude CLI and
the Codex CLI each run with their own hidden console, so the keypress reaches only the gateway,
which drains while their work continues. A Windows-only test drives this with a real console
Ctrl+C (`apps/api/src/shutdown-console.test.ts`).

## A provider conversation is missing

`HARNESS_SESSION_MISSING` means the provider no longer has the selected conversation,
for example after removal, expiry or changing the provider's home directory. The
failure names the harness, handle and origin. Plain Resume cannot restore it.

In the run inspector choose **Start fresh session for <node>** only when you want
to repeat that node's authored task without its prior provider conversation. Selected
loop inputs and the configured context mode, model and effort stay the same. Earlier
provider actions are not undone. Leaving the choice untouched keeps the run failed;
reload and gateway restart preserve it. The recovery note records who chose and when.

API callers read the failed event's sequence and post `{ "nodeId": "worker",
"failureSeq": 17 }` to `/runs/{id}/recover-session` with `runs:write`. A stale or
repeated choice returns 409: inspect the current failure before acting again.
Failures recorded by an older gateway without the new typed provenance require a
deliberate new run/replay; upgrading does not rewrite historical failures.

A containing subloop run retains the original non-resumable failure in history.
Recover the failed inference child via its child-run link, then use the API Resume
on the containing run. The gateway verifies the same owned child's later durable
resume and current absence of a runtime failure; before that recovery it rejects Resume.

## Recovery eligibility and Replay (#256)

Read the inspector's explanation for the current action. Resume retains the run ID and follows its next attempt. A completed `SCRIPT_EXIT_CODE` failure remains resumable: fix the program, then Resume. Non-resumable stop/deadline/unconfirmed-termination failures stay unavailable for Resume. A failed child directs recovery to its exact parent, which retries the same child.

Replay is a deliberate new run at a reached node, including inference and subloop nodes, across source run statuses. It runs scripts, provider turns, child runs and deliveries on the new path again; the picker names knowable nodes on possible paths. It never undoes source effects or re-sends source-owned delivery records; the fork performs its own deliveries. A missing session does not prohibit Replay, although a named policy may look up the same missing session again. Use Start fresh session for #265's explicit same-run recovery. A path into the current uncertain script also needs explicit consent that its effect may already have happened.

If `RECOVERY_STALE` names an existing replay ID, open that run. The admitted fork and its observed intent are one transaction; there is no separate consumed-intent-without-fork window. Otherwise refresh and review current eligibility. API/MCP commands send `observedSeq` from that read, and `retryUncertainScript: true` only after deliberate uncertain-script consent. See [ADR-0061](../decisions/ADR-0061-recovery-eligibility.md).
