# Install and make a first run

## Check prerequisites

Install Git, Node 22 or newer, pnpm, and the Codex CLI. The repository pins pnpm 12.8.1 and the Codex SDK to 0.160.0. The API runs Codex turns through the CLI bundled with that SDK; you need your own Codex CLI to log in and, for the [Codex plugin](05-mcp-and-codex-plugin.md), version 0.117.0 or newer (verified with 0.160.0). Claude Code is an optional, separately installed harness for native Windows only; GraphGoblin does not install or bundle its CLI. Check the standard prerequisites in PowerShell or Bash:

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

To use Claude Code, install and sign in to the native Windows CLI as the same operating-system
user who runs the API. The adapter accepts version `2.1.285` or newer with the required capabilities and fails closed on
older versions, missing capabilities or unsupported platforms. It looks for `%USERPROFILE%\.local\bin\claude.exe`; set `GG_CLAUDE_BINARY`
to the owner-installed executable when it is elsewhere. Run `claude auth login`, then confirm
**Harness preflight** in Settings. GraphGoblin reports the safe authentication category only; do
not share raw CLI authentication output. CLI capability and login checks are reported independently.
Opus 5.5 and Fable 5.1 follow the same technical readiness checks. See [Claude Code in harness integration](../06-harness-integration.md#claude-code-adapter-26).

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

The data directory is `~/.graphgoblin` unless `GG_DATA_DIR` is set when you run the script (and when you start the API). A missing or logged-out Codex CLI fails its harness check. A missing or logged-out Claude CLI is a warning while no Claude defaults are configured; it fails preflight if you configure a Claude default. Run the relevant login command as the API user and check **Harness preflight** again.

Then start the API from the repository root and open the address it printed:

```powershell
pnpm.cmd start
```

## Run the container image

The image holds the API, the web app, and the Codex CLI, for one user on a trusted network. Build and start it with Docker Compose from the repository root:

```bash
docker compose up -d --build
```

The compose file publishes port 4747 on the host's loopback only, keeps the data directory in the `graphgoblin-data` volume (`/data` in the container), and mounts your Codex login (`~/.codex`) into the container, so run `codex login` on the host first. The image does not contain Claude Code; its native-Windows adapter refuses the container platform. To use an OpenAI API key instead, set `OPENAI_API_KEY` in the compose file's `environment`. Check readiness while the server runs; stop it before creating a key with a one-off container using the same volume, then restart:

```bash
docker compose exec graphgoblin node apps/api/dist/main.js --preflight
docker compose stop graphgoblin
docker compose run --rm graphgoblin node apps/api/dist/main.js --create-api-key owner
docker compose up -d graphgoblin
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
$env:GG_DEFAULTS = '{"byHarness":{"codex":{"model":"gpt-6-luna","effort":"low"}}}'
pnpm.cmd start
```

In Bash:

```bash
export GG_DATA_DIR="$HOME/graphgoblin-data"
export GG_DEFAULTS='{"byHarness":{"codex":{"model":"gpt-6-luna","effort":"low"}}}'
pnpm start
```

Run one API process per data directory. The API takes `<data-directory>/graphgoblin.lock` before opening the database, applying migrations, or recovering runs. If its PID is still alive, a second start exits 1 with `another GraphGoblin process holds <path>`, even on a different port. A dead PID's lock, or one naming this process's own PID without an in-process hold, is replaced automatically; a malformed lock or an owner whose death cannot be verified is refused. Stop the API before `--create-api-key`, which takes the same lock to write the database. Read-only `--preflight` can run alongside a server. If you override `GG_DB_URL`, processes using that same database must also use the same `GG_DATA_DIR`.

`pnpm --filter @graphgoblin/api start` is equivalent. The start scripts run the built entry point. Its source and runtime paths are:

```text
apps/api/src/main.ts
apps/api/dist/main.js
```

To run that entry directly, keep the same environment and use the repository root:

```powershell
node apps/api/dist/main.js
```

| Variable                 | Default and use                                                                                                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GG_HOST`                | `127.0.0.1`. Change it only when you intend to accept remote connections; the API logs a warning when it listens beyond localhost without API keys.                                                                       |
| `GG_PORT`                | `4747`. Choose another free port if needed.                                                                                                                                                                               |
| `GG_DATA_DIR`            | `~/.graphgoblin` (`/data` in the container image). A relative value is resolved from the process working directory.                                                                                                       |
| `GG_DB_URL`              | `file:<data-directory>/graphgoblin.db`. Override it only to keep the database elsewhere.                                                                                                                                  |
| `GG_WEB_DIST`            | Unset: the checkout's `apps/web/dist` when it has been built. Point it at another built web directory, or set it empty to serve no UI.                                                                                    |
| `GG_REQUIRE_API_KEY`     | `false`. Set `true` to require a key on [every non-public route][public-routes]; the web app then asks for one. See [the first key](06-settings-and-secrets.md#create-api-keys).                                          |
| `GG_MASTER_KEY`          | Unset. Base64 of 32 bytes; otherwise the key lives in `<data-directory>/master.key`. See [Preserve the master key](06-settings-and-secrets.md#preserve-the-master-key).                                                   |
| `GG_DEFAULTS`            | JSON harness-keyed defaults, e.g. `{"byHarness":{"codex":{"model":"gpt-6-luna","effort":"low"}}}`. Old default-model/effort environment variables are rejected with upgrade guidance.                                     |
| `GG_CODEX_BINARY`        | Unset, so the SDK uses its bundled Codex binary. Set an absolute native executable path to override it.                                                                                                                   |
| `GG_MAX_CONCURRENT_RUNS` | `4`, range 1 to 64. Runs executing at once; parked runs do not count.                                                                                                                                                     |
| `GG_TIMER_POLL_MS`       | `1000`. How often timers, cron schedules, and poll triggers are checked.                                                                                                                                                  |
| `GG_HOOK_RATE_LIMIT`     | `60`. Webhook deliveries accepted per endpoint per minute.                                                                                                                                                                |
| `GG_LOG_LEVEL`           | `info`. One of `fatal`, `error`, `warn`, `info`, `debug`, `trace`, or `silent`.                                                                                                                                           |
| `GG_SWAGGER_UI`          | `true`. Serves interactive API documentation at `/docs`; the OpenAPI document is always at `/openapi.json`.                                                                                                               |
| `GG_JEV_API_KEY`         | Unset. Seeds the encrypted `jev-api-key` secret at startup only when absent; the secret store wins. Falls back to `JEV_API_KEY` only when unset, not when empty. See [secrets](06-settings-and-secrets.md#store-secrets). |

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

With `GG_REQUIRE_API_KEY=true` the [public shell][public-routes] still loads and asks for an API key on the first 401; paste a key [created on the command line](06-settings-and-secrets.md#the-first-key-from-the-command-line). The key is kept in this browser until you choose **Forget key** in Settings.

## Check readiness and run the starter graph

The first-run preflight checks Node, the data directory, the master key, the database and pending migrations, the Codex harness (installed and logged in), the optional Jev key, and the default model. Each check is `ok`, `WARN` (works, or is set up on first start), or `FAIL` (runs will not work until it is fixed). It changes nothing and is safe before the first start. From the repository root, with the same environment as the server:

```powershell
node apps/api/dist/main.js --preflight
```

It prints a table and exits 1 when any check failed. Before the first start the master key and database are warnings, because the start creates them. While the API runs, the same report is available over HTTP (`GET /system/preflight` needs a key when keys are required; see [Public routes][public-routes]):

```bash
curl -sS http://127.0.0.1:4747/system/preflight
```

**Settings → Harness preflight** in the UI, and `GET /harness/preflight`, show the Codex check alone.

1. Open **Loops**, enter a name in **New loop name**, and click **Create**. The editor opens on a starter graph that connects a manual trigger to an exit.
2. Click **Publish**, then **Open in Runs**, and click **Start run**. The inspector opens and should show a succeeded run.
3. Follow [Build a loop](02-build-a-loop.md) to insert an inference node and have Codex produce a result.

## Locate your data

Under the configured data directory, the API creates these files and directories:

```text
~/.graphgoblin/
  graphgoblin.db
  graphgoblin.db-wal    (may exist while SQLite uses WAL)
  graphgoblin.db-shm    (may exist)
  graphgoblin.lock      (PID and start time; held while the API owns the directory)
  master.key
  artifacts/<kind>/<content-hash>
  workspaces/<run-id>/
```

SQLite holds definitions, versions, runs, events, settings, encrypted secrets, API-key hashes, and trigger state. Artifacts hold transcripts and other stored payloads. Temporary workspaces live under the data directory; fixed workspaces can live elsewhere. The master-key file is created on first start unless you supply `GG_MASTER_KEY`; preserve it with the database. See [Back up and restore](06-settings-and-secrets.md#back-up-and-restore).

## Stop and restart safely

Before maintenance, let queued and running work finish, or pause or cancel it and wait for executing nodes to settle. Press **Ctrl+C** in the API terminal. The process closes HTTP, stops scheduling new work, waits for executing runs to settle, closes SQLite, and releases its lock. SIGTERM follows the same shutdown path. Shutdown can wait on outstanding work, so let the process exit before starting another API or creating a key against the same data directory. After an abrupt exit, the next start replaces the lock only if its recorded PID is dead.

Restart with the same environment and start command. Boot applies pending migrations, recovers active runs, restores timers, and re-arms published triggers. Paused runs stay paused. A node that was executing when the process stopped runs again, so make scripts idempotent and inspect their side effects before resuming. For longer stops, choose an appropriate [cron missed-fire policy](04-triggers.md#schedule-with-cron).

Read [Security and distribution](../11-security-and-distribution.md) for the intended deployment posture. Continue with [Build a loop](02-build-a-loop.md).

[public-routes]: ../07-api-and-streaming.md#public-routes-decided-by-implementation-2026-10-03
