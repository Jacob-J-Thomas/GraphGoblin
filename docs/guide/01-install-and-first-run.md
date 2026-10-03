# Install and make a first run

## Check prerequisites

Install Git, Node 22 or newer, pnpm, and Codex CLI 0.160 or newer. The repository pins pnpm 12.8.1 and the Codex SDK to 0.160.0. Run these commands in PowerShell:

```powershell
git --version
node --version
pnpm --version
codex --version
codex login
codex login status
```

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

From the repository root, set absolute directories and keep the service on localhost:

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

The start script runs the built entry point. Its source and runtime paths are:

```text
apps/api/src/main.ts
apps/api/dist/main.js
```

To run that entry directly, keep the same environment and use the repository root:

```powershell
node apps/api/dist/main.js
```

| Variable | Default and use |
| --- | --- |
| `GG_HOST` | Localhost address shown above; change only when you intend to accept remote connections. |
| `GG_PORT` | 4747; choose another free port if needed. |
| `GG_DATA_DIR` | Relative data directory shown below, resolved from the process working directory. Use an absolute value for repeatable restarts. |
| `GG_WEB_DIST` | Unset; point it at the built web directory to serve the UI. |
| `GG_REQUIRE_API_KEY` | False; set true for credentialed API access after [creating a key](06-settings-and-secrets.md#create-api-keys). The current web app requires local trusted mode. |
| `GG_DEFAULT_MODEL` | `gpt-6-luna`; use a model available to your Codex account. |
| `GG_DEFAULT_EFFORT` | `low`; node and loop settings can override it. |
| `GG_CODEX_BINARY` | Unset; the SDK uses its bundled Codex binary. Set an absolute native executable path to override it. |

The default data directory and built web directory are:

```text
./data
apps/web/dist
```

With the filtered start command, a relative data directory is relative to the API package. The explicit directory above avoids creating different databases when you switch start commands.

Open the UI:

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

> Coming in 1.0: A general first-run preflight for Node, data-directory access, and master-key setup. The current preflight checks the harness only; the planned general endpoint is unavailable:
>
> ```http
> GET /system/preflight
> ```

1. Open **Loops**, enter a name, and click **Create**. The starter graph connects a manual trigger to an exit.
2. Click **Publish**, then **Run** and **Start run**. The inspector should show a succeeded run.
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

Before maintenance, let queued and running work finish, or pause/cancel it and wait for executing nodes to settle. Press **Ctrl+C** in the API terminal; the process handles the interrupt, closes HTTP, stops scheduling new work, waits for engine work to settle, and closes SQLite. Shutdown can wait on outstanding work, so let the process exit before starting another API against the same database.

Restart with the same environment and start command. Boot applies pending migrations, recovers active runs, restores timers, and re-arms published triggers. Paused runs stay paused. Interrupted scripts can execute again, so make scripts idempotent and inspect their side effects before resuming. For longer stops, choose an appropriate [cron missed-fire policy](04-triggers.md#schedule-with-cron).

Read [Security and distribution](../11-security-and-distribution.md) for the intended deployment posture. Continue with [Build a loop](02-build-a-loop.md).
