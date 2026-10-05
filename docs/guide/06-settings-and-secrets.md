# Manage settings and secrets

## Open Settings

Open **Settings** from the navigation bar:

```text
/app/settings
```

Choose the colour theme under **Appearance** (below), and manage **Model catalog**, **Classifier models**, **Defaults**, **Secrets**, and **API keys** here, and check **Harness preflight**. The **Install** card explains the browser's PWA installation action. With `GG_REQUIRE_API_KEY=true` the app shell still loads, asks for a key on the first 401, and keeps it in this browser; **This browser's API key** shows it and **Forget key** removes it (other open tabs follow).

## Confirm destructive actions

Deleting a model, deleting a classifier model, deleting a secret, or revoking a key opens the same named confirmation used on Loops. **Keep** receives focus; Keep or Escape cancels without changing anything. **Confirm delete** or **Confirm revoke** starts the request, disables both buttons until it finishes, and announces progress. Escape cannot dismiss a pending request, even with repeated presses. API errors (including 404 when an item was already removed) stay visible until you dismiss or retry. Dismissing a 404 refreshes the list to remove the stale row. Focus returns to the action, or its section heading if the row disappears. These actions cannot be undone. Model deletion applies only to LiteLLM entries; harness entries have no Edit or Delete actions and remain available to enable or disable. Classifier deletion applies only to classifiers you registered; built-in Jev can only be enabled or disabled (see [Configure classifier models](#configure-classifier-models)). A deleted `jev-api-key` secret also returns at the next start if `GG_JEV_API_KEY` is still set (or its `JEV_API_KEY` fallback applies).

Only the API key marked **This browser** adds the browser sign-out warning. Other active keys still warn that their clients receive 401 immediately. In trusted mode no key is marked; if this browser stores a key, every active row instead explains that revoking it may sign this browser out and that **Forget key** in Settings clears it.

## Choose the theme

**Appearance → Theme** switches between **Dark** (the default) and **Light**. The change applies at once, without a reload, and this browser remembers it: the app opens in your theme on the next visit, with no flash of the other one, and other open tabs switch too. Use Tab to reach the control and the arrow keys to change it. The choice is per browser, kept in `localStorage` (`graphgoblin-theme`); a private window or blocked site data opens in Dark. A **System** option that follows the operating system will come with the installer.

## Choose a model and effort

Use the **Enabled** switch in a model's row to enable or disable it. Tab reaches each switch; Space or Enter toggles it. The switch is named **Enable &lt;display name&gt;** and shows **Enabling…** or **Disabling…** with a busy indicator while it saves. It ignores further activation until the request finishes, then announces **Enabled** or **Disabled**. Keyboard focus stays on the switch while saving; moving to another control keeps that focus. A refused request restores its previous state and announces the reason. Disabling a model removes it from new **Default model** choices; enabling it restores the choice. A saved default stays selected as **&lt;name&gt; (disabled)** or **&lt;id&gt; (not in catalog)**, with a reminder that runs keep using it until you choose another model or **(server default)**. Catalog entries do not prove your account has access.

Harness models offer only the enable switch. Local models served through LiteLLM will appear in the catalog once the LiteLLM adapter is configured. Until local entries exist, **Add model**, **Edit**, and **Delete** are hidden and the catalog names this guide section. With a LiteLLM entry in the list, **Add model** appears and only LiteLLM rows offer **Edit** and **Delete**. Removing a local model leaves its loops referencing that model.

Toggle and model-form refusals use plain sentences: **Harness models can only be enabled or disabled.** (`MODEL_MANAGED_BY_HARNESS`); **LiteLLM is not configured. Adding local models is not available yet.** (`LITELLM_NOT_CONFIGURED`); and **This model is no longer in the catalog.** (`MODEL_NOT_FOUND`). A toggle refused with 404 refreshes the catalog, announces the reason in the section, and focuses its heading if the focused row disappears. LiteLLM creation remains unavailable until the adapter ships.

On upgrade, every old row becomes `harness`, including hand-added rows. Hand-added rows keep their values but cannot be edited/deleted; disable them if unwanted. User-edited seeded names, efforts, and default efforts re-sync from the shipped catalog at startup, while enabled is preserved. The seeded Codex entries list `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`; Codex maps `max` to `xhigh`. The enabled entries populate the Settings default-model selector. The engine does not enforce catalog membership or effort lists.

Scripts that PUT an entry to toggle it must switch to PATCH. For example (replace the base URL with your gateway):

```bash
curl -X PATCH "$GG_API_URL/model-catalog/codex/gpt-6-luna" \
  -H 'Content-Type: application/json' -d '{"enabled":false}'
```

```powershell
Invoke-RestMethod -Method Patch -Uri "$env:GG_API_URL/model-catalog/codex/gpt-6-luna" `
  -ContentType 'application/json' -Body '{"enabled":false}'
```

With API keys enabled, include a bearer key with `settings:write`; listing needs `settings:read`. PATCH returns the full entry (200) or `MODEL_NOT_FOUND` (404). PUT/DELETE against harness rows, including old hand-added ones, return `MODEL_MANAGED_BY_HARNESS`; PUT requesting a new `source: "litellm"` returns `LITELLM_NOT_CONFIGURED`. LiteLLM PUT retains the existing source, preserves enabled when omitted, and requires default effort to belong to efforts.

Validation and publication warn with `MODEL_DISABLED` or `MODEL_NOT_IN_CATALOG` when an explicit inference model, a decision's Codex model (only when its strategy includes Codex), or loop `settings.defaults.model` is disabled or missing from the relevant catalog: the inference node's selected harness for `config.model`, and Codex for decision Codex models and loop-default models. Node warnings identify the node and relative field path (`config.model` or `config.codex.model`); defaults identify `settings.defaults.model`. Warnings do not block publishing or execution. Back up before upgrade. [ADR-0018](../decisions/ADR-0018-model-catalog-source.md) needs no SQL rollback for `0004` alone; after `0005`, follow the [CHANGELOG rollback steps](../../CHANGELOG.md#upgrade-notes) to restore the pre-upgrade data backup or put the required loop-default harness field back while the API is stopped. SQL rollback does not recover edited seed metadata.

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

The editor's Model dropdowns use this same catalog: inference nodes filter by their Harness, and loop defaults and decision Codex settings use Codex. Enabled entries show both display name and id; disabled entries are hidden unless already selected. Missing or disabled saved models and unsupported saved efforts stay in place with a field warning. Use **Model catalog in Settings** below a picker to return here. Choose **(loop default)** in a node or **(owner default)** in loop settings to leave its model unset. Effort choices follow the selected catalog model, with its default effort shown in the unset choice as guidance only. Leaving effort unset preserves the resolution order above. Without a catalog model selected, all six effort levels are offered. An unavailable catalog makes the current model and effort read-only until **Retry model catalog** or automatic query recovery succeeds; Model shows the shared notice and retry, and Effort refers to it. A failed refresh keeps cached choices editable with a notice that the catalog may be out of date. Recovery never substitutes values.

## Configure classifier models

**Settings → Classifier models**, below the model catalog, lists the classifiers a decision's `jev` strategy can use to choose a route: the built-in **Jev** first, then the ones you register. Each row shows the provider and the model name it sends, what it can answer (**Choice / classification**, **Noul**, **Score**; decisions use Choice), whether it is configured, and an **Enabled** switch. Configured and enabled are separate: **Needs a key** means the secret the classifier sends is missing, blank, or unreadable, with the reason and an **Open Secrets** link that takes you to [Store secrets](#store-secrets); **Configured** only means its settings are complete, not that the endpoint answers.

Built-in Jev uses the alias `jev-latest` and the secret `jev-api-key` (see [Store secrets](#store-secrets)). It can only be enabled or disabled. Disabling it also stops Exit predicates that use Jev: they fail with `DECIDER_UNAVAILABLE` when evaluated.

### Register a classifier you host

An open-source classifier registers as an HTTP endpoint that speaks the Jev-compatible Choice protocol, `POST <endpoint>/v1/systemone` ([the contract](../06-harness-integration.md#http-classifier-endpoint-contract-decided-adr-0021)). GraphGoblin does not install or run models. For Kev, start its owner's server as [the Kev research note](../research/jev.md#kev-http-protocol-verification-2026-10-05) describes; it listens on port 8008 by default. Then choose **Add classifier** and fill in:

| Field             | Kev                                                                |
| ----------------- | ------------------------------------------------------------------ |
| Id                | `kev`: a lowercase letter, then lowercase letters, digits, `_ . -` |
| Display name      | `Kev 4B`                                                           |
| Provider model id | `kev-latest`                                                       |
| Endpoint          | `http://127.0.0.1:8008`, the API root without `/v1/systemone`      |
| Capabilities      | **Choice / classification**                                        |
| Bearer secret     | **(none)**, unless you started Kev with `KEV_API_KEY` (see below)  |

**Save classifier** checks the fields first and explains each problem beside its field. The id cannot change later, because loops refer to it, and `jev` and existing ids are taken. **Add classifier** waits until the list has loaded, so the id can be checked against it, and adding never replaces an existing classifier: if another tab or script registered the same id in the meantime, Settings says so, saves nothing, and refreshes the list. A new classifier starts disabled: switch it on when its server is running.

If the server wants a bearer key (Kev does when `KEV_API_KEY` is set), store the key in **Secrets** first, then choose its name under **Bearer secret**. With a secret, the endpoint must use `https://` unless its host is loopback (`localhost`, `127.0.0.0/8`, or `[::1]`), so a key is never sent in clear text across a network. Saving a classifier with a secret needs an API key with both `settings:write` and `secrets:write`; without the second, Settings says so and saves nothing. Choosing **(none)** on an edit removes the secret.

**Edit** changes everything but the id and keeps the enabled state. **Delete** asks first: decision nodes that select the classifier keep its id, their Jev strategy is skipped (a later strategy runs, or the run fails with `DECISION_NO_ROUTE` when Jev is the only one) until you choose another model, and drafts that still select it cannot be published. The secret it used stays in Secrets.

### Choose a classifier in a decision

Open the decision node and pick under **Jev → Model**. The first option, **Jev (jev), the default**, leaves the choice out of the loop so the built-in applies; the others are the enabled classifiers that answer Choice, with **(needs a key)** after any that still lack their key. Choosing another classifier adds the decision's Jev settings for you; **Add jev options** adds them without changing the model (for **Min confidence**, say). Changing the model keeps the decision's other Jev settings. Each choice is one step for Undo.

Kev reports a rescaled confidence, `(p - 1/K) / (1 - 1/K)` for the chosen label's probability `p` and `K` routes, so a threshold means more than it does for a raw probability: with two routes, a `minConfidence` of 0.5 needs a probability of 0.75. Below the threshold, the next strategy runs.

### When a selected classifier is unavailable

The node editor never clears a selection by itself. A selected classifier that was disabled, deleted, or no longer answers Choice stays selected, marked **(disabled)**, **(not in catalog)**, or **(no Choice)**, with the reason and the remedy under the field. When the decision's strategy does not include Jev, the selection is not checked yet, and the text says what to fix before you add Jev to the strategy. The node's warnings and errors follow changes you make in Settings (enabling, disabling, deleting, or setting a key) without editing the loop. The editor's checks agree with the API's:

- **Disabled** or **needs a key**: a warning on the node. Publishing still works; at run time the Jev strategy is skipped and the next strategy runs. With no next strategy the warning says the decision cannot currently produce a route, and the run would fail with `DECISION_NO_ROUTE`.
- **Not in the catalog** or **no Choice**: an error that blocks publishing the draft until you choose another model or register the classifier again. A loop published before keeps running and skips the strategy, as above.

Choosing the issue in the node's badge opens the node with **Model** focused. Scripts and agents use the same catalog over REST: `GET /classifier-models` and `PUT` (with `If-None-Match: *` to create without replacing; an existing id answers 409 `CLASSIFIER_EXISTS`), `PATCH` (`{ "enabled": true }`), and `DELETE /classifier-models/{id}`; see [API, streaming, and MCP](../07-api-and-streaming.md#classifier-catalog-decided-adr-0021).

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

The secret's deletion confirmation spells out those effects for webhook triggers, webhook return channels, and script `env` values written as `secret:<name>`. Deleting `jev-api-key` also warns that Jev decisions turn off until the key is set again, and that startup re-seeds it if `GG_JEV_API_KEY` is set. Deleting a secret that a registered classifier sends as its bearer key names that classifier: it will need a key, and decisions that select it skip their Jev strategy until the secret is set again. **Classifier models** shows the change at once, as it does when you set a secret.

Secret reads never send plaintext back to the browser or API client. Server-side resolution supplies the Jev key to Jev and script values to the invoked process, so values can leave the process for their intended consumer. Scripts and external tools can print secrets into their output; avoid that and redact sensitive thread content before forwarding it. The secret store does not automatically scrub arbitrary output or earlier event-log entries.

## Create API keys

Create a key in **Settings → API keys** (**Create key** grants the wildcard scope) or over REST, and copy the token immediately: it is shown once. Keep an administrative key before switching authentication on, or create the first one from the command line as below.

When keys are required, **This browser** marks the key that authenticated the latest key-list request. The marker refreshes when you enter, forget, or change the stored key, including changes from another tab. The API returns a required `current` boolean on list items, without revealing tokens or hashes; key creation still returns only metadata and the one-time token. In trusted mode no row is marked, even if a valid key is stored. A stored key is still sent in trusted mode, revoking it shows the API key panel, and **Forget key** in Settings recovers access without it.

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

A missing, malformed, or revoked key returns 401 on private routes; a key lacking the route's scope returns 403 `FORBIDDEN`. A wrong key is rejected even in trusted mode, and presenting a scoped key in trusted mode still limits it to its own scopes. Public routes remain exempt; see the [full list](../07-api-and-streaming.md#public-routes-decided-by-implementation-2026-10-03). Keep the API on localhost and use [MCP's key configuration](05-mcp-and-codex-plugin.md#start-the-mcp-server) for agent clients.

Revoke an unused key in **Settings → API keys**, or through REST:

```http
DELETE /api-keys/{id}
```

**Revoke** names the key and warns that clients using it receive 401 immediately. Successful revocation closes the confirmation when the server confirms the request; refreshing the key list runs separately. Only the row marked **This browser** adds: "Revoking this key will sign this browser out and show the API key panel. Enter another valid key to continue." After that revocation, the rejected refresh shows the API key panel and focus moves to its input without waiting for the retry. Revoking another key leaves this browser signed in. If a key is stored but no row is marked, every active row instead explains that it may be this browser's stored key and that **Forget key** in Settings clears it.

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
