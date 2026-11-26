# GraphGoblin

Design, run, and observe agent loops. A progressive web application plus a gateway backend for AI engineers who want to compose agent-harness sessions, scripts, decisions, and waits into repeatable processes.

Status: 1.0.0 released 2026-10-03. What changed is in [CHANGELOG.md](CHANGELOG.md); the [user guide](docs/guide/README.md) explains how to use it.

## Install GraphGoblin

Use the checkout installer on the default `main` branch for Windows, macOS or Linux. It includes changes made since v1.0.0, including the optional Windows desktop launcher. The [v1.0.0 release](https://github.com/Jacob-J-Thomas/GraphGoblin/releases/tag/v1.0.0) provides source archives. The downloadable Windows installer is tracked in [#36](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/36). For a container, go to [Docker Compose](#docker-compose).

### Install from a checkout

Install Git, **Node.js 22.22.2 or newer in the 22.x series**, **pnpm 12.8.1**, and the Codex CLI. Run `codex login` as the user who will start GraphGoblin, then confirm `codex login status` reports that you’re signed in. If Windows PowerShell blocks the npm-installed `codex.ps1`, use `codex.cmd login` and `codex.cmd login status`. [Prerequisites](docs/guide/01-install-and-first-run.md#check-prerequisites)

Clone the repository and enter its directory in PowerShell or Bash.

```sh
git clone https://github.com/Jacob-J-Thomas/GraphGoblin.git
cd GraphGoblin
```

**Windows PowerShell**

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

**Bash on macOS, Linux or Windows (Git Bash)**

```bash
bash scripts/install.sh
```

The script installs the pinned dependencies, builds GraphGoblin, creates its data directory (by default `~/.graphgoblin`), and checks readiness. If preflight reports `FAIL`, correct the named check and rerun the same script. When it prints `Install complete.`, start GraphGoblin from the same checkout with **`pnpm.cmd start`** in PowerShell or **`pnpm start`** in Bash. Keep that terminal open.

### Make a first run

1. Open <http://127.0.0.1:4747/app/>. In **Loops**, enter a **New loop name** and select **Create**.
2. Select **Publish**, then **Open in Runs** and **Start run**. The starter connects a manual trigger directly to an exit. The run inspector should show **succeeded**.

To add an inference node or enable API keys, see [Build a loop](docs/guide/02-build-a-loop.md) and [Create API keys](docs/guide/06-settings-and-secrets.md#create-api-keys).

### Optional Windows desktop and taskbar launcher

With GraphGoblin running, open the app URL in Chrome and install it as a Chrome app. The launcher installer looks first under **Start menu → Chrome Apps** for Chrome’s GraphGoblin shortcut. Keep that shortcut for the installer. If the only Chrome shortcut is on the Desktop, choose a separate launcher destination with `-DesktopShortcut`. The [launcher options](docs/guide/01-install-and-first-run.md#optional-windows-desktop-and-taskbar-launcher) also cover custom ports and data directories.

For the default setup, open a second PowerShell window in the same checkout with the same Node 22 runtime on PATH.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-windows-launcher.ps1
```

The installer creates its own **GraphGoblin** shortcuts on the Desktop and in the Start menu. With a separate Chrome source shortcut, it replaces an existing `GraphGoblin.lnk` at the Desktop destination. Open GraphGoblin from one of the launcher’s shortcuts.

1. Stop the foreground gateway with **Ctrl+C** and wait for it to exit.
2. Open the new **GraphGoblin** Desktop shortcut. The launcher starts or reuses the matching gateway.
3. To use the taskbar, remove any old direct Chrome pin and pin the running GraphGoblin window.

If the window is already open, a taskbar click focuses it. To start a stopped gateway again, use the Desktop shortcut or the taskbar’s **Open new window** action. [Launcher troubleshooting](docs/guide/07-troubleshooting.md#windows-launcher)

### Optional macOS Finder and Dock launcher

On Apple Silicon running macOS 15 or later, use an already built checkout, native Node 22.22.2 or later within major 22, and Swift 6 from Xcode or the Command Line Tools. From that checkout, run:

```bash
bash scripts/install-macos-launcher.sh --node "$(command -v node)"
```

The installer creates `~/Applications/GraphGoblin.app`. Open it in Finder or keep it in the Dock. The launcher starts or reuses the matching gateway and opens your default browser. [macOS launcher setup and options](docs/guide/01-install-and-first-run.md#optional-macos-finder-and-dock-launcher)

### Docker Compose

With Git, Docker Compose and a host Codex login, clone the repository as shown above. From its root, start the service.

```sh
docker compose up -d --build
```

Compose builds the image, keeps data in the `graphgoblin-data` volume, and mounts the host’s Codex login. Open <http://127.0.0.1:4747/app/> and follow [Make a first run](#make-a-first-run). [Container setup and API keys](docs/guide/01-install-and-first-run.md#run-the-container-image)

## Repository layout

```
packages/   layers: contracts -> domain -> engine -> infrastructure, plus optional adapter-* packages
apps/       hosts: api, mcp, web, plugin-codex, plugin-claude
tooling/    shared configs and repository gate scripts
scripts/    install scripts
docs/       design, ADRs, research, user guide
```

Start with [docs/README.md](docs/README.md) for the design. Layer rules are enforced by `pnpm check:layers` and `pnpm check:deps`. Every package must keep unit-test coverage above 90% of lines and branches; `pnpm test:coverage` fails otherwise.

## Development

```
pnpm install
pnpm build
pnpm check        # typecheck, lint, layer rules, dependency rules, coverage, licences, generated docs
```

See [AGENTS.md](AGENTS.md) for the working rules.
