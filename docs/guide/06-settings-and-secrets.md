# Manage settings and secrets

## Open Settings

Open **Settings** from the navigation bar:

```text
/app/settings
```

Manage **Model catalog**, **Defaults**, **Secrets**, and **API keys** here, and check **Harness preflight**. The **Install** card explains the browser's PWA installation action. Keep the current UI in localhost trusted mode; it has no API-key entry flow, and enabling `GG_REQUIRE_API_KEY` also guards the UI's pages and assets.

## Choose a model and effort

Use **Add model** or **Edit** to record a Codex model ID, display name, allowed efforts, default effort, and enabled state. Choose a default effort that belongs to the entry's allowed efforts. Catalog entries are seeded locally; they do not prove your account has access to a model. Use the ID your Codex account accepts.

The canonical effort values are `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`; the Codex adapter maps `max` to `xhigh`. Model support still depends on Codex. The enabled catalog entries populate the Settings default-model selector, but the engine does not currently enforce catalog membership or effort lists.

For execution today, set `model` and `effort` on the inference node or in loop `defaults`, or set the API's environment before startup:

```powershell
$env:GG_DEFAULT_MODEL = 'gpt-6-luna'
$env:GG_DEFAULT_EFFORT = 'low'
```

```bash
export GG_DEFAULT_MODEL=gpt-6-luna GG_DEFAULT_EFFORT=low
```

Restart the API after changing process defaults. Resolution is node value, then loop default, then API-process default; Codex settings on your machine do not override these explicit execution options.

> Coming in 1.0: Owner defaults wired into execution. The Settings page saves `defaultModel` and `defaultEffort`, but the engine currently uses the process defaults shown above when node and loop values are absent.

## Store secrets

In **Secrets**, enter a name and value, then click **Set secret**, or send `PUT /secrets/{name}` with a body of `{ "value": "..." }`. Names start with a letter and contain up to 128 letters, digits, `_`, `.`, or `-`. Values are write-only: listing returns names and timestamps, and setting a secret returns metadata rather than the value. Loop configs carry references; the server resolves them during execution. Do not paste secret values into prompts, expressions, or ordinary config fields.

Store your Jev API key with this exact name:

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

Create a key while local trusted mode is enabled, copy the token immediately, and keep an administrative key before switching authentication on. **Create key** in the UI grants the wildcard scope. Use REST to request narrower write scopes:

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

The response's `token` is returned once; SQLite stores its hash. Omitting `scopes` grants `*`. Authenticate with:

```http
Authorization: Bearer <saved-token>
```

| Implemented write scope | Operations                                                     |
| ----------------------- | -------------------------------------------------------------- |
| `loops:write`           | Create, import, save, publish, and delete loops.               |
| `runs:write`            | Start, cancel, pause, resume, provide input, and send signals. |
| `settings:write`        | Change settings and the model catalog.                         |
| `secrets:write`         | Set and delete secrets.                                        |
| `api-keys:write`        | Create and revoke keys.                                        |
| `events:write`          | Submit inbound events.                                         |
| `*`                     | All checked operations; UI-created keys use this scope.        |

> Coming in 1.0: Read-scope enforcement described by the API design. Today authenticated keys can read owner data regardless of their write scopes; the current read routes do not perform separate scope checks.

Set the requirement in the API terminal and restart:

```powershell
$env:GG_REQUIRE_API_KEY = 'true'
```

```bash
export GG_REQUIRE_API_KEY=true
```

A missing, malformed, or revoked key returns 401; an insufficient write scope returns 403. A wrong key is rejected even in trusted mode. Public health, version, OpenAPI, API-doc, and signed webhook routes remain exempt. Keep the API on localhost and use [MCP's key configuration](05-mcp-and-codex-plugin.md#start-the-mcp-server) for agent clients.

Revoke an unused key in Settings while using trusted mode, or through authenticated REST:

```http
DELETE /api-keys/{id}
```

## Preserve the master key

By default the API generates a random 32-byte master key and stores its base64 form here:

```text
<data-directory>/master.key
```

Alternatively, supply `GG_MASTER_KEY` containing base64 that decodes to exactly 32 bytes. Keep that same value across restarts and restores. Secrets are encrypted directly with AES-256-GCM using this master key and a fresh nonce per value. Replacing the key does not re-encrypt existing rows; it makes them unreadable. Protect the key file and backup with operating-system permissions.

> Coming in 1.0: The planned OS-keyring source and per-secret envelope key wrapping. The current implementation reads a file or environment master key and encrypts secret values directly with it.

## Back up and restore

1. [Stop the API safely](01-install-and-first-run.md#stop-and-restart-safely) and confirm the process has exited.
2. Copy the entire data directory, including the database, any WAL/SHM files, master key, artifacts, and temporary workspaces. Store the backup securely because it contains both encrypted secrets and their decryption key.
3. Preserve any custom `GG_DB_URL` database location separately. Save environment configuration and an environment-supplied master key securely. Back up fixed workspaces, return files outside the data directory, and Codex session storage separately if you need them for continuation.

For the repository-root layout used in [Installation](01-install-and-first-run.md), copy to a new destination in PowerShell:

```powershell
$backupSource = Join-Path (Get-Location).Path 'data'
$backupDestination = Join-Path (Get-Location).Path ('backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
Copy-Item -LiteralPath $backupSource -Destination $backupDestination -Recurse
```

In Bash:

```bash
cp -R data "backup-$(date +%Y%m%d-%H%M%S)"
```

Restore into an empty destination with the API stopped; do not overlay a different live database or master key. Copy the saved data, point `GG_DATA_DIR` at that restored directory, restore `GG_DB_URL` if overridden and `GG_MASTER_KEY` if supplied, and start the API. Preserve the same workspace locations for runs that reference them. Boot migrates and recovers runs and re-arms triggers, so review schedules and missed-fire policies before restoring onto a connected machine.

Loop exports are useful for version control but omit runs, secret values, and artifacts; they do not replace a data backup.

> Coming in 1.0: Manual run and loop history purge controls described in the retention plan. They are absent from Settings today; deleting a loop is not a supported substitute for history maintenance.

Read [Security and distribution](../11-security-and-distribution.md) for design context. Continue with [Troubleshooting](07-troubleshooting.md).
