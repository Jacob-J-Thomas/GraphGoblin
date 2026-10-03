# 11 - Security and distribution

## Licensing (Decided)

- Allowed licences in the dependency tree: MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, Unlicense, CC0. Anything else fails the CI allowlist check and needs an ADR to add.
- Rejected: AGPL, SSPL, BSL, Elastic, Commons Clause, Sustainable Use, and any "source-available" licence. No code is copied from n8n, Dify, or similar products.
- Agent harnesses are external engines. Codex CLI is Apache-2.0 but is still installed by the user, not bundled. The Claude Agent SDK, when it arrives post-1.0, is under Anthropic's Commercial Terms and is an optional dependency the user installs.
- The full audit of the proposed dependencies is in `research/licenses.md`.

## Credentials (Decided)

- Codex: GraphGoblin relies on the machine's `codex login` state. It never stores, reads, or proxies Codex credentials. Subscription login is the expected mode for 1.0.
- Jev: an API key stored in the secret store, referenced by name.
- GraphGoblin API keys: generated for other applications and the MCP server, hashed at rest, shown once. The first key in required-key mode comes from `node apps/api/dist/main.js --create-api-key <name> [--scopes a,b]` (see "First API key" below).
- Post-1.0 hosted: users bring their own harness API keys per the harness vendor's terms; subscription logins cannot be offered inside a hosted product.

## Secret store (Decided)

- Values are encrypted with AES-256-GCM. Each row has its own data key, wrapped by a master key. The master key comes from an environment variable or the OS keyring through `@napi-rs/keyring`, chosen at first run.
- Secrets are referenced from configs by name, for example `secret:jev-api-key`, and resolved only inside the process at execution time. They never appear in events, logs, exports, or API responses.
- The `redact` mutation operation exists partly so that values that reach the thread from scripts or harness output can be masked before they go anywhere else.

## Inbound exposure (Decided)

- The API binds to localhost by default. Changing the bind address without API keys enabled logs a prominent warning.
- Webhook endpoints are the only intentionally unauthenticated routes and are protected by HMAC signatures, replay windows, size limits, and rate limits. See 08.
- Development tunnels are limited to the hooks prefix and must authenticate at the tunnel. Polling triggers are the recommended no-inbound alternative.

## Execution posture (Decided)

- The script node executes arbitrary user programs by design. In 1.0 they run as the GraphGoblin process user on the user's own machine. This is acceptable for a single-user tool and is stated plainly in the UI.
- Codex sessions run under Codex's own sandbox with the mode set on the node. The default is `workspace-write`. `danger-full-access` is allowed but highlighted in the editor.
- Post-1.0 multi-tenant hosting requires per-run isolation, which is why the runner abstraction exists: a remote runner can be a container.

## Retention (Decided)

1.0 keeps all runs, events, and artifacts, matching the harness defaults, which keep sessions on disk indefinitely. A manual purge action per run and per loop exists in settings. Retention policies and scheduled purges are post-1.0.

## Distribution (Decided)

- The product ships as a container image and as a plain Node application installed with pnpm. Both serve the PWA from the API process.
- Preflight on first run checks Node version, Codex CLI presence and login, the data directory, and the master key source. See "First-run preflight" below.
- Updates to the PWA are delivered through the service worker prompt. Updates to the backend are a new image or a `pnpm install` plus restart; migrations run at boot.

### Install from a checkout (Decided by implementation, WP-F2)

`scripts/install.ps1` (Windows PowerShell 5.1 or PowerShell 7) and `scripts/install.sh` (bash, including Git Bash on Windows) check Node 22 or newer and pnpm, print `codex login status` (a warning, not a failure, when Codex is missing or logged out), run `pnpm install --frozen-lockfile` and `pnpm build`, create the data directory (`GG_DATA_DIR`, default `~/.graphgoblin`), run `node apps/api/dist/main.js --preflight` against it, and print the start command, the UI URL, and the `--create-api-key` command. They are idempotent, need no elevation, and exit non-zero when a prerequisite is missing, a step fails, or a preflight check fails.

`pnpm start` at the root runs the built API. When `GG_WEB_DIST` is unset the API serves the checkout's `apps/web/dist` if it has been built; an empty `GG_WEB_DIST` turns the UI off. The data directory defaults to `~/.graphgoblin` rather than a directory relative to the working directory, so `pnpm start` and `pnpm --filter @graphgoblin/api start` share one database.

### Container image (Decided by implementation, WP-F2)

- `Dockerfile` (multi-stage on `node:22-bookworm-slim`): the build stage copies only the root manifests, the lockfile, `tooling/`, `packages/`, and `apps/` (`.dockerignore` also drops build output, data directories, keys, SQLite files, `.tmp/`, `.claude/`, and `.env*` inside them; `tooling/scripts/dockerignore.test.mjs` checks the rules against sample and tracked paths), installs pnpm 12.8.1, runs `pnpm install --frozen-lockfile`, builds the API with its workspace dependencies and the web app, and runs `pnpm --filter @graphgoblin/api deploy --prod --legacy` for a self-contained API with production dependencies only. The runtime stage holds that API under `/app/apps/api`, the web app under `/app/apps/web/dist`, and a `codex` wrapper on `PATH` for the Linux Codex binary that `@openai/codex-sdk` pulls in (`codex --version` runs during the build). It runs as the non-root `node` user (uid 1000) with `GG_HOST=0.0.0.0`, `GG_DATA_DIR=/data` (a `VOLUME`), `GG_WEB_DIST=/app/apps/web/dist`, a `HEALTHCHECK` on `/healthz`, and `CMD ["node", "apps/api/dist/main.js"]`.
- `docker-compose.yml` publishes port 4747 on the host's loopback only, keeps `/data` in a named volume, mounts the host's Codex login (`~/.codex` to `/home/node/.codex`, read-write because Codex refreshes its tokens), and leaves `GG_REQUIRE_API_KEY` and `OPENAI_API_KEY` commented. Codex credentials are never part of the image: mount the login or pass an API key at run time. On a Linux host the mounted directory must be readable and writable by uid 1000.
- The image is for a single user on a trusted network. `GG_HOST=0.0.0.0` is needed inside the container, so the API logs its beyond-localhost warning unless `GG_REQUIRE_API_KEY=true`; publishing the port beyond the host's loopback without keys exposes every route, including script execution.
- Codex's own sandbox (`workspace-write` and `read-only`) relies on Linux kernel features that a default container may not grant; inference nodes inside the container were not exercised live in WP-F2.
- Size (2026-10-03, linux/amd64): 1.04 GB unpacked as Docker Desktop reports it, 259 MB compressed. The Codex binary package (`@openai/codex@0.160.0-linux-x64`) is 427 MB of it, the rest of `node_modules` about 70 MB, and the web app 8 MB.
- Smoke test (Docker Desktop 29.1.5): the container starts and reports healthy, `/healthz` answers 200, `/app/` serves the UI shell and `/` redirects to it, `node apps/api/dist/main.js --preflight` inside the container passes every check with the host's Codex login mounted read-only (without it only the harness check fails, as expected), and `--create-api-key` works through `docker exec`.

## First-run preflight (Decided by implementation, 2026-10-03)

`apps/api/src/preflight.ts` runs a fixed list of checks and reports each as `ok`, `warn` (works, but something is missing or is set up on first start), or `fail` (runs will not work until it is fixed). Nothing in it changes state or starts a Codex session.

| Check          | ok                                                                                                    | warn                                                                                                                                                 | fail                                                                                 |
| -------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Node.js        | major version 22 or newer                                                                             |                                                                                                                                                      | older than 22                                                                        |
| Data directory | exists and a new probe file can be created (exclusively, random name) and removed                     | does not exist yet (created on first start)                                                                                                          | not a directory, unreadable, or not writable                                         |
| Master key     | `GG_MASTER_KEY` or `<dataDir>/master.key` decodes to 32 bytes                                         | no key yet (generated on first start; back it up)                                                                                                    | present but not a base64 32-byte key, or unreadable                                  |
| Database       | reachable, no pending migrations                                                                      | file does not exist yet but its nearest existing ancestor is a writable directory (start creates the rest), or migrations pending (applied at start) | cannot be opened, read, or queried, or its file cannot be created                    |
| Harness `<id>` | `HarnessPort.preflight()` ok (Codex: `codex --version` and `codex login status`, two short CLI calls) |                                                                                                                                                      | not installed, not logged in, or the check threw; also when no harness is registered |
| Jev            | `jev-api-key` secret set                                                                              | no key (Jev is optional; decisions fall back to Codex), or not checkable before the database is migrated                                             |                                                                                      |
| Default model  | `GG_DEFAULT_MODEL` is an enabled catalog entry                                                        | in the catalog but disabled                                                                                                                          | not in the catalog (the default catalog before first start)                          |

- **HTTP**: `GET /system/preflight` returns `{ ok, checks: [{ id, label, status, message }] }` for the running installation; `ok` is false when any check failed. It is not a public route: it needs a key whenever keys are required, like every other non-public route. `GET /harness/preflight` remains for the harness check alone.
- **CLI**: `node apps/api/dist/main.js --preflight` (or `pnpm --filter @graphgoblin/api preflight` after `pnpm build`) reads the same environment as the server, prints the checks as a table, and exits 0 when no check failed and 1 otherwise, without starting the server. It opens the database only when its file exists, and never creates the data directory, the key, or the database, so it is safe before the first start. `GG_DB_URL` is parsed the way libsql parses it (percent-decoded, relative, `file:///C:/...`), and the server's start creates the database file's directory as well as the data directory. The writability probe opens a new randomly named file with `wx`, so it never truncates an existing file, never follows a symlink, and removes only the file it created.

## First API key (Decided, WP-F2, ADR-0015)

With `GG_REQUIRE_API_KEY=true`, `POST /api-keys` needs a key, so the first one cannot come from the API. `graphgoblin-api --create-api-key <name> [--scopes a,b]` (`node apps/api/dist/main.js ...`) reads the same environment as the server, creates the data directory and database if needed and applies migrations (as a start would), inserts a key for the local owner, prints the token once to standard output, and exits without starting the HTTP server. Nothing is logged; only the SHA-256 hash is stored. Scopes default to `*` only when `--scopes` is absent: an unknown or repeated option, a stray argument, a missing value, or a malformed scope exits 2 with the usage before anything is written. The install scripts print the command, and it works in the container through `docker compose exec`.

## Multi-tenant checklist for later (recorded)

Owner scoping enforced in every repository method, auth provider with OIDC, per-user secret keys, remote runners with isolation, Postgres, scheduler lease, rate limits per owner, audit log of control actions.
