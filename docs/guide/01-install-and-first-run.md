# Install and make a first run

## Check prerequisites

Install Git, Node 22 or newer, pnpm, and the Codex CLI. The repository pins pnpm 12.8.1 and the Codex SDK to 0.160.0. The API runs turns through the CLI bundled with that SDK; you need your own Codex CLI to log in and, for the [Codex plugin](05-mcp-and-codex-plugin.md), version 0.117.0 or newer (verified with 0.160.0). Check them in PowerShell or Bash:

```powershell
git --version
node --version
pnpm.cmd --version
codex --version
codex login
codex login status
```

PowerShell blocks in this guide call `pnpm.cmd`, because Windows PowerShell's default execution policy blocks the `pnpm.ps1` shim. If it blocks `codex.ps1` too, call `codex.cmd`. Bash blocks use `pnpm` and `codex`.

Run the API as the same operating-system user who logged into Codex. GraphGoblin uses that login and stores no Codex credentials.

There are three ways to install: the install script (recommended), the container image, or the manual steps the script performs. All of them start from a clone. Replace the repository URL placeholder with the clone URL from your repository host:

```powershell
git clone <repository-url> GraphGoblin
Set-Location GraphGoblin
```

## Install with the script

The install script checks Node 22 or newer and pnpm, prints `codex login status`, runs `pnpm install --frozen-lockfile` and `pnpm build`, creates the data directory, runs the [first-run preflight](#check-readiness-and-run-the-starter-graph), and prints the start command and the UI address. It needs no administrator rights and is safe to run again; it exits non-zero when a prerequisite is missing, a step fails, or a preflight check fails. In PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install.ps1
```

In Bash (Linux, macOS, or Git Bash on Windows):

```bash
bash scripts/install.sh
```

The data directory is `~/.graphgoblin` unless `GG_DATA_DIR` is set when you run the script (and when you start the API). A missing or logged-out Codex CLI is reported as a warning by the script and as a failed harness check by the preflight; run `codex login` and run the script again.

Then start the API from the repository root and open the address it printed:

```powershell
pnpm.cmd start
```

## Run the container image

The image holds the API, the web app, and the Codex CLI, for one user on a trusted network. Build and start it with Docker Compose from the repository root:

```bash
docker compose up -d --build
```

The compose file publishes port 4747 on the host's loopback only, keeps the data directory in the `graphgoblin-data` volume (`/data` in the container), and mounts your Codex login (`~/.codex`) into the container, so run `codex login` on the host first. To use an OpenAI API key instead, set `OPENAI_API_KEY` in the compose file's `environment`. Check readiness and create keys inside the container:

```bash
docker compose exec graphgoblin node apps/api/dist/main.js --preflight
docker compose exec graphgoblin node apps/api/dist/main.js --create-api-key owner
```

Without Compose:

```bash
docker build -t graphgoblin .
docker run -d --name graphgoblin -p 127.0.0.1:4747:4747 -v graphgoblin-data:/data -v "$HOME/.codex:/home/node/.codex" graphgoblin
```

Inside the container the API listens on `0.0.0.0`, so it warns that it is reachable beyond localhost without API keys. Keep the port on the host's loopback, or set `GG_REQUIRE_API_KEY=true` before publishing it more widely. On a Linux host the mounted `.codex` directory must be readable and writable by uid 1000, the container's `node` user. See [Security and distribution](../11-security-and-distribution.md#container-image-decided-by-implementation-wp-f2) for the image's layout and size.

## Install manually

The script's steps, by hand:

```powershell
pnpm.cmd install --frozen-lockfile
pnpm.cmd build
node apps/api/dist/main.js --preflight
```

## Start the API and web app

From the repository root:

```powershell
pnpm.cmd start
```

With no configuration the API listens on `127.0.0.1:4747`, keeps its data in `~/.graphgoblin`, and serves the web app this checkout built (`apps/web/dist`). Set variables from the table below to change that. For example, in PowerShell:

```powershell
$env:GG_DATA_DIR = 'D:\graphgoblin-data'
$env:GG_DEFAULT_MODEL = 'gpt-6-luna'
$env:GG_DEFAULT_EFFORT = 'low'
pnpm.cmd start
```

In Bash:

```bash
export GG_DATA_DIR="$HOME/graphgoblin-data" GG_DEFAULT_MODEL=gpt-6-luna GG_DEFAULT_EFFORT=low
pnpm start
```

`pnpm --filter @graphgoblin/api start` is equivalent. The start scripts run the built entry point. Its source and runtime paths are:

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
| `GG_DATA_DIR`            | `~/.graphgoblin` (`/data` in the container image). A relative value is resolved from the process working directory.                                                     |
| `GG_DB_URL`              | `file:<data-directory>/graphgoblin.db`. Override it only to keep the database elsewhere.                                                                                |
| `GG_WEB_DIST`            | Unset: the checkout's `apps/web/dist` when it has been built. Point it at another built web directory, or set it empty to serve no UI.                                  |
| `GG_REQUIRE_API_KEY`     | `false`. Set `true` to require a key on every non-public route; the web app then asks for one. See [the first key](06-settings-and-secrets.md#create-api-keys).         |
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
~/.graphgoblin
apps/web/dist
```

Earlier development builds defaulted to `./data` under the working directory. If you kept data there, set `GG_DATA_DIR` to that directory, or stop the API and move its contents to `~/.graphgoblin`.

Open the UI. The server root redirects here:

```text
http://127.0.0.1:4747/app/
```

If this returns 404, check the web-directory setting and confirm that the built directory contains the shell:

```text
apps/web/dist/index.html
```

With `GG_REQUIRE_API_KEY=true` the shell still loads and asks for an API key on the first 401; paste a key [created on the command line](06-settings-and-secrets.md#the-first-key-from-the-command-line). The key is kept in this browser until you choose **Forget key** in Settings.

## Check readiness and run the starter graph

The first-run preflight checks Node, the data directory, the master key, the database and pending migrations, the Codex harness (installed and logged in), the optional Jev key, and the default model. Each check is `ok`, `WARN` (works, or is set up on first start), or `FAIL` (runs will not work until it is fixed). It changes nothing and is safe before the first start. From the repository root, with the same environment as the server:

```powershell
node apps/api/dist/main.js --preflight
```

It prints a table and exits 1 when any check failed. Before the first start the master key and database are warnings, because the start creates them. While the API runs, the same report is available over HTTP (it needs a key when keys are required):

```bash
curl -sS http://127.0.0.1:4747/system/preflight
```

**Settings → Harness preflight** in the UI, and `GET /harness/preflight`, show the Codex check alone.

1. Open **Loops**, enter a name in **New loop name**, and click **Create**. The editor opens on a starter graph that connects a manual trigger to an exit.
2. Click **Publish**, then **Run**, and click **Start run**. The inspector opens and should show a succeeded run.
3. Follow [Build a loop](02-build-a-loop.md) to insert an inference node and have Codex produce a result.

## Locate your data

Under the configured data directory, the API creates these files and directories:

```text
~/.graphgoblin/
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
