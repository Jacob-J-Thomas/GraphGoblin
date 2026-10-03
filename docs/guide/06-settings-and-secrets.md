# Manage settings and secrets

## Open Settings

Open **Settings** from the navigation bar:

```text
/app/settings
```

Manage **Model catalog**, **Defaults**, **Secrets**, and **API keys** here, and check **Harness preflight**. The **Install** card explains the browser's PWA installation action. With `GG_REQUIRE_API_KEY=true` the app shell still loads, asks for a key on the first 401, and keeps it in this browser; **This browser's API key** shows it and **Forget key** removes it (other open tabs follow).

## Choose a model and effort

Use **Add model** or **Edit** to record a Codex model ID, display name, allowed efforts, default effort, and enabled state. Choose a default effort that belongs to the entry's allowed efforts. Catalog entries are seeded locally; they do not prove your account has access to a model. Use the ID your Codex account accepts.

The canonical effort values are `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`; the Codex adapter maps `max` to `xhigh`. Model support still depends on Codex. The enabled catalog entries populate the Settings default-model selector, but the engine does not currently enforce catalog membership or effort lists.

Set `model` and `effort` on the inference node or in loop `defaults`, set owner defaults in **Defaults** (below), or set the API's environment before startup:

```powershell
$env:GG_DEFAULT_MODEL = 'gpt-6-luna'
$env:GG_DEFAULT_EFFORT = 'low'
```

```bash
export GG_DEFAULT_MODEL=gpt-6-luna GG_DEFAULT_EFFORT=low
```

Restart the API after changing process defaults. Resolution is node value, then loop default, then the owner default from Settings, then the API-process default; Codex settings on your machine do not override these explicit execution options.

The owner defaults in **Settings → Default model** and **Default effort** (`PUT /settings` with `defaultModel` and `defaultEffort`) need no restart: they are read each time a run starts or resumes, so a change applies to the next run. Choose **(server default)** to remove one and fall back to the process default. `defaultEffort` must be an effort level the API knows; anything else is refused with 400.

## Store secrets

In **Secrets**, enter a name and value, then click **Set secret**, or send `PUT /secrets/{name}` with a body of `{ "value": "..." }`. Names start with a letter and contain up to 128 letters, digits, `_`, `.`, or `-`. Values are write-only: listing returns names and timestamps, and setting a secret returns metadata rather than the value. Loop configs carry references; the server resolves them during execution. Do not paste secret values into prompts, expressions, or ordinary config fields.

To configure Jev without pasting a key into Settings, set the machine environment variable `GG_JEV_API_KEY` once and start the API in a process that inherits it. An existing `JEV_API_KEY` works unchanged when `GG_JEV_API_KEY` is unset. After migration and before Jev initializes, startup seeds the local owner's encrypted secret only when it is absent. The secret store wins over both variables: restarting with a different environment value never overwrites an existing secret. An explicitly empty `GG_JEV_API_KEY` disables seeding, including the fallback. No plaintext file or secret value is logged; the startup message only says `seeded jev-api-key from GG_JEV_API_KEY`.

Once seeded, the key stays available across restarts even if the environment variable is removed. To rotate it, use **Set secret** or `PUT /secrets/{name}`. Deleting it refreshes Jev immediately; a later API start seeds it again if the variable is still set. A read-only preflight before first startup may warn that the Jev secret is missing; it does not seed secrets.

For Docker Compose, uncomment the `GG_JEV_API_KEY` line in `docker-compose.yml` to forward the host environment variable, including the `JEV_API_KEY` fallback, into the API container. The key value stays in the environment rather than the compose file.

You can also store your Jev API key manually with this exact name:

```text
jev-api-key
```

The Jev decider uses it for decisions. Setting or deleting it refreshes that adapter without a restart. Without it, Jev is unavailable; a decision with a later Codex or expression strategy can fall through. Webhook signing uses the name in `signature.secretRef`; outbound signing uses the return channel's `secretRef`.

For a script environment variable, use this reference syntax:

```json
{
  "env": { "SERVICE_TOKEN": "secret:service-token" }
}
```

A missing secret fails the run with `SECRET_MISSING`; set it and resume. A missing webhook signing secret makes the endpoint answer 503 `HOOK_NOT_READY`, and a missing return-channel secret sends the delivery unsigned.

Secret reads never send plaintext back to the browser or API client. Server-side resolution supplies the Jev key to Jev and script values to the invoked process, so values can leave the process for their intended consumer. Scripts and external tools can print secrets into their output; avoid that and redact sensitive thread content before forwarding it. The secret store does not automatically scrub arbitrary output or earlier event-log entries.

## Create API keys

Create a key in **Settings → API keys** (**Create key** grants the wildcard scope) or over REST, and copy the token immediately: it is shown once. Keep an administrative key before switching authentication on, or create the first one from the command line as below.

### The first key, from the command line

With `GG_REQUIRE_API_KEY=true` from the start, `POST /api-keys` already needs a key. Create the first one from the command line instead; it writes straight to the database for the local owner, prints the token once, and does not start the server. Stop any API using the data directory first: the command takes the same exclusive lock as the server and exits 1 if another process holds it. Run it from the repository root with the same environment as the server (at least the same `GG_DATA_DIR`), after `pnpm build`:

```powershell
node apps/api/dist/main.js --create-api-key owner
node apps/api/dist/main.js --create-api-key ci --scopes loops:write,runs:write
```

In the container image, stop the API, create the key in a one-off container using the same mounted data volume, then restart:

```bash
docker compose stop graphgoblin
docker compose run --rm graphgoblin node apps/api/dist/main.js --create-api-key owner
docker compose up -d graphgoblin
```

Without `--scopes` the key gets `*`. The token is printed to standard output only, never logged, and only its hash is stored. Restart the server after the command exits and releases its lock. Paste the key into the web app when it asks for one, or send it as a bearer token.

### More keys over REST

Use REST to request narrower write scopes:

```http
POST /api-keys
```

Save this body:

```text
key.json
```

```json
{
  "label": "Codex loop runner",
  "scopes": ["runs:write"]
}
```

```bash
curl -sS -X POST 'http://127.0.0.1:4747/api-keys' \
  -H 'Content-Type: application/json' --data-binary @key.json
```

```powershell
$created = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:4747/api-keys' `
  -ContentType 'application/json' -InFile key.json
$created.token
```

The response's `token` is returned once; SQLite stores its hash. Local trusted mode and callers whose key holds `*` may grant any scopes; omitting `scopes` grants `*` only for them. A scoped caller needs `api-keys:write` to create a key and must list `scopes` explicitly, or the API returns `400 VALIDATION_FAILED`. It may grant only scopes it holds itself, including read scopes implied by its write scopes (`loops:write` covers `loops:read`), and may never grant `*`. An unheld scope or `*` returns `403 SCOPE_NOT_DELEGABLE`, with the offending scopes in `detail` and `errors.scopes`; no key is created. An explicit empty list creates a key with no access. Authenticate with:

```http
Authorization: Bearer <saved-token>
```

Every private route needs a scope, reads included: `<resource>:read` for `GET` requests and `<resource>:write` for everything else. A write scope includes the read scope of the same resource, so a `runs:write` key can follow the runs it starts.

| Scope                             | Operations                                                                                                                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `loops:read`, `loops:write`       | Read and validate loops; create, import, save, publish, and delete them.                                                                                                                                |
| `runs:read`, `runs:write`         | Read runs, threads, and events; start (`POST /loops/{id}/runs`), cancel, pause, resume, replay, input, signals.                                                                                         |
| `settings:read`, `settings:write` | Read and change settings and the model catalog.                                                                                                                                                         |
| `secrets:read`, `secrets:write`   | List secret names; set and delete secrets.                                                                                                                                                              |
| `api-keys:read`, `api-keys:write` | List keys; create and revoke them. A scoped key may create keys only with scopes it holds itself (write implies read) and must list them explicitly; only `*` keys or local trusted mode can grant `*`. |
| `events:read`, `events:write`     | List inbound events; submit them.                                                                                                                                                                       |
| `system:read`                     | The preflight reports (`/system/preflight`, `/harness/preflight`).                                                                                                                                      |
| `*`                               | Everything; UI-created keys use this scope.                                                                                                                                                             |

A key without the needed scope gets 403 `FORBIDDEN`. See [API, streaming, and MCP](../07-api-and-streaming.md) for the exact rules.

A key carrying only a read scope cannot grant the corresponding write scope; a disallowed grant returns 403 `SCOPE_NOT_DELEGABLE`, and a scoped caller that omits `scopes` gets 400 `VALIDATION_FAILED` ([ADR-0016](../decisions/ADR-0016-api-key-scope-delegation.md)).

Set the requirement in the API terminal and restart:

```powershell
$env:GG_REQUIRE_API_KEY = 'true'
```

```bash
export GG_REQUIRE_API_KEY=true
```

A missing, malformed, or revoked key returns 401; a key lacking the route's scope returns 403 `FORBIDDEN`. A wrong key is rejected even in trusted mode, and presenting a scoped key in trusted mode still limits it to its own scopes. Public health, version, OpenAPI, API-doc, and signed webhook routes remain exempt. Keep the API on localhost and use [MCP's key configuration](05-mcp-and-codex-plugin.md#start-the-mcp-server) for agent clients.

Revoke an unused key in **Settings → API keys**, or through REST:

```http
DELETE /api-keys/{id}
```

## Preserve the master key

By default the API generates a random 32-byte master key and stores its base64 form here:

```text
<data-directory>/master.key
```

Alternatively, supply `GG_MASTER_KEY` containing base64 that decodes to exactly 32 bytes. Keep that same value across restarts and restores. Secrets are encrypted directly with AES-256-GCM using this master key and a fresh nonce per value. Replacing the key does not re-encrypt existing rows; it makes them unreadable. Protect the key file and backup with operating-system permissions.

> After 1.0: The planned OS-keyring source and per-secret envelope key wrapping. The current implementation reads a file or environment master key and encrypts secret values directly with it.

## Back up and restore

1. [Stop the API safely](01-install-and-first-run.md#stop-and-restart-safely) and confirm the process has exited.
2. Copy the entire data directory, including the database, any WAL/SHM files, master key, artifacts, and temporary workspaces. Store the backup securely because it contains both encrypted secrets and their decryption key.
3. Preserve any custom `GG_DB_URL` database location separately. Save environment configuration and an environment-supplied master key securely. Back up fixed workspaces, return files outside the data directory, and Codex session storage separately if you need them for continuation.

For the default data directory used in [Installation](01-install-and-first-run.md), copy to a new destination in PowerShell:

```powershell
$backupSource = Join-Path $HOME '.graphgoblin'
$backupDestination = Join-Path $HOME ('graphgoblin-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
Copy-Item -LiteralPath $backupSource -Destination $backupDestination -Recurse
```

In Bash:

```bash
cp -R "$HOME/.graphgoblin" "$HOME/graphgoblin-backup-$(date +%Y%m%d-%H%M%S)"
```

Restore into an empty destination with the API stopped; do not overlay a different live database or master key. Copy the saved data, point `GG_DATA_DIR` at that restored directory, restore `GG_DB_URL` if overridden and `GG_MASTER_KEY` if supplied, and start the API. Preserve the same workspace locations for runs that reference them. Boot migrates and recovers runs and re-arms triggers, so review schedules and missed-fire policies before restoring onto a connected machine.

Loop exports are useful for version control but omit runs, secret values, and artifacts; they do not replace a data backup.

> After 1.0: Manual run and loop history purge controls described in the retention plan. They are absent from Settings today; deleting a loop is not a supported substitute for history maintenance.

Read [Security and distribution](../11-security-and-distribution.md) for design context. Continue with [Troubleshooting](07-troubleshooting.md).
