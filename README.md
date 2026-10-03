# GraphGoblin

Design, run, and observe agent loops. A progressive web application plus a gateway backend for AI engineers who want to compose agent-harness sessions, scripts, decisions, and waits into repeatable processes.

Status: 1.0 release candidate. What changed is in [CHANGELOG.md](CHANGELOG.md); the [user guide](docs/guide/README.md) explains how to use it.

## Quick start

You need Git, Node 22 or newer, pnpm, and the Codex CLI logged in (`codex login`) as the user who runs GraphGoblin. GraphGoblin stores no Codex credentials.

### Install script

From a clone of this repository, in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install.ps1
pnpm.cmd start
```

Or in bash (Linux, macOS, or Git Bash on Windows):

```bash
bash scripts/install.sh
pnpm start
```

The script checks prerequisites, installs, builds, creates the data directory (`~/.graphgoblin`, or `GG_DATA_DIR`), and runs the first-run preflight. Then open <http://127.0.0.1:4747/app/>.

### Container

```bash
docker compose up -d --build
```

The compose file keeps data in a volume, publishes the port on the host's loopback only, and mounts your `~/.codex` login. The image is meant for one user on a trusted network.

### First run

1. Open **Loops**, create a loop, then **Publish** and **Run** the starter graph.
2. Follow [Build a loop](docs/guide/02-build-a-loop.md) to add a Codex inference node.
3. To require API keys, set `GG_REQUIRE_API_KEY=true` and create the first key with `node apps/api/dist/main.js --create-api-key <name>` (in the container: `docker compose exec graphgoblin node apps/api/dist/main.js --create-api-key <name>`).

See [Install and make a first run](docs/guide/01-install-and-first-run.md) for every option and setting.

## Repository layout

```
packages/   layers: contracts -> domain -> engine -> infrastructure, plus optional adapter-* packages
apps/       hosts: api, mcp, web, plugin-codex
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
