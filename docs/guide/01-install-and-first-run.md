# Install and make a first run

## Check prerequisites

Install Git, Node 22 or newer, pnpm, and the Codex CLI. The repository pins pnpm 12.8.1 and the Codex SDK to 0.160.0. The API runs turns through the CLI bundled with that SDK; you need your own Codex CLI to log in and, for the [Codex plugin](05-mcp-and-codex-plugin.md), version 0.117.0 or newer (verified with 0.160.0). Check them in PowerShell or Bash:

```powershell
git --version
node --version
pnpm --version
codex --version
codex login
codex login status
```

If PowerShell's execution policy blocks `pnpm.ps1` (or `codex.ps1`), call `pnpm.cmd` (or `codex.cmd`) instead, everywhere this guide shows `pnpm` or `codex` in a PowerShell block.

Run the API as the same operating-system user who logged into Codex. GraphGoblin uses that login and stores no Codex credentials.

> Coming in 1.0: An install script and container image. Use the source installation below today; no release image or installer is provided by this checkout.

## Clone and build

Replace the repository URL placeholder with the clone URL from your repository host:

```powershell
git clone <repository-url> GraphGoblin
Set-Location GraphGoblin
pnpm install
pnpm build
```

## Start the API and web app

From the repository root, set absolute directories and keep the service on localhost. In PowerShell:

```powershell
$repoRoot = (Get-Location).Path
$env:GG_HOST = '127.0.0.1'
$env:GG_PORT = '4747'
$env:GG_DATA_DIR = Join-Path $repoRoot 'data'
$env:GG_WEB_DIST = Join-Path $repoRoot 'apps/web/dist'
$env:GG_REQUIRE_API_KEY = 'false'
$env:GG_DEFAULT_MODEL = 'gpt-6-luna'
$env:GG_DEFAULT_EFFORT = 'low'
pnpm --filter @graphgoblin/api start
```

In Bash:

```bash
export GG_HOST=127.0.0.1 GG_PORT=4747
export GG_DATA_DIR="$PWD/data" GG_WEB_DIST="$PWD/apps/web/dist"
export GG_REQUIRE_API_KEY=false GG_DEFAULT_MODEL=gpt-6-luna GG_DEFAULT_EFFORT=low
pnpm --filter @graphgoblin/api start
```

The start script runs the built entry point. Its source and runtime paths are:

```text
apps/api/src/main.ts
apps/api/dist/main.js
```

To run that entry directly, keep the same environment and use the repository root:

```powershell
node apps/api/dist/main.js
```

| Variable                 | Default and use                                                                                                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GG_HOST`                | `127.0.0.1`. Change it only when you intend to accept remote connections; the API logs a warning when it listens beyond localhost without API keys.                     |
| `GG_PORT`                | `4747`. Choose another free port if needed.                                                                                                                             |
| `GG_DATA_DIR`            | `./data`, resolved from the process working directory. Use an absolute value for repeatable restarts.                                                                   |
| `GG_DB_URL`              | `file:<data-directory>/graphgoblin.db`. Override it only to keep the database elsewhere.                                                                                |
| `GG_WEB_DIST`            | Unset. Point it at the built web directory to serve the UI.                                                                                                             |
| `GG_REQUIRE_API_KEY`     | `false`. Set `true` for credentialed API access after [creating a key](06-settings-and-secrets.md#create-api-keys). The current web app requires local trusted mode.    |
| `GG_MASTER_KEY`          | Unset. Base64 of 32 bytes; otherwise the key lives in `<data-directory>/master.key`. See [Preserve the master key](06-settings-and-secrets.md#preserve-the-master-key). |
| `GG_DEFAULT_MODEL`       | `gpt-6-luna`. Use a model available to your Codex account.                                                                                                              |
| `GG_DEFAULT_EFFORT`      | `low`. Node and loop settings can override it.                                                                                                                          |
| `GG_CODEX_BINARY`        | Unset, so the SDK uses its bundled Codex binary. Set an absolute native executable path to override it.                                                                 |
| `GG_MAX_CONCURRENT_RUNS` | `4`, range 1 to 64. Runs executing at once; parked runs do not count.                                                                                                   |
| `GG_TIMER_POLL_MS`       | `1000`. How often timers, cron schedules, and poll triggers are checked.                                                                                                |
| `GG_HOOK_RATE_LIMIT`     | `60`. Webhook deliveries accepted per endpoint per minute.                                                                                                              |
| `GG_LOG_LEVEL`           | `info`. One of `fatal`, `error`, `warn`, `info`, `debug`, `trace`, or `silent`.                                                                                         |
| `GG_SWAGGER_UI`          | `true`. Serves interactive API documentation at `/docs`; the OpenAPI document is always at `/openapi.json`.                                                             |

Boolean variables accept `true`, `false`, `1`, `0`, `yes`, or `no`. An invalid value stops startup with an `invalid configuration` message.

The default data directory and built web directory are:

```text
./data
apps/web/dist
```

With the filtered start command, a relative data directory is relative to the API package (`apps/api`). The explicit directory above avoids creating different databases when you switch start commands.

Open the UI. The server root redirects here:

```text
http://127.0.0.1:4747/app/
```

If this returns 404, check the web-directory setting and confirm that the built directory contains the shell:

```text
apps/web/dist/index.html
```

## Check readiness and run the starter graph

Open **Settings**, then read **Harness preflight**. It checks whether the configured Codex CLI runs and reports a logged-in state. You can also request it from a second terminal:

```powershell
Invoke-RestMethod 'http://127.0.0.1:4747/harness/preflight'
```

```bash
curl -sS http://127.0.0.1:4747/harness/preflight
```

> Coming in 1.0: A general first-run preflight for Node, data-directory access, and master-key setup. The current preflight checks the harness only; the planned general endpoint is unavailable:
>
> ```http
> GET /system/preflight
> ```

1. Open **Loops**, enter a name in **New loop name**, and click **Create**. The editor opens on a starter graph that connects a manual trigger to an exit.
2. Click **Publish**, then **Run**, and click **Start run**. The inspector opens and should show a succeeded run.
3. Follow [Build a loop](02-build-a-loop.md) to insert an inference node and have Codex produce a result.

## Locate your data

Under the configured data directory, the API creates these files and directories:

```text
data/
  graphgoblin.db
  graphgoblin.db-wal    (may exist while SQLite uses WAL)
  graphgoblin.db-shm    (may exist)
  master.key
  artifacts/<kind>/<content-hash>
  workspaces/<run-id>/
```

SQLite holds definitions, versions, runs, events, settings, encrypted secrets, API-key hashes, and trigger state. Artifacts hold transcripts and other stored payloads. Temporary workspaces live under the data directory; fixed workspaces can live elsewhere. The master-key file is created on first start unless you supply `GG_MASTER_KEY`; preserve it with the database. See [Back up and restore](06-settings-and-secrets.md#back-up-and-restore).

## Stop and restart safely

Before maintenance, let queued and running work finish, or pause or cancel it and wait for executing nodes to settle. Press **Ctrl+C** in the API terminal. The process closes HTTP, stops scheduling new work, waits for executing runs to settle, and closes SQLite. Shutdown can wait on outstanding work, so let the process exit before starting another API against the same database.

Restart with the same environment and start command. Boot applies pending migrations, recovers active runs, restores timers, and re-arms published triggers. Paused runs stay paused. A node that was executing when the process stopped runs again, so make scripts idempotent and inspect their side effects before resuming. For longer stops, choose an appropriate [cron missed-fire policy](04-triggers.md#schedule-with-cron).

Read [Security and distribution](../11-security-and-distribution.md) for the intended deployment posture. Continue with [Build a loop](02-build-a-loop.md).
