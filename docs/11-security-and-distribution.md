# 11 - Security and distribution

## Licensing (Decided)

- Allowed licences in the dependency tree: MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, Unlicense, CC0. Anything else fails the CI allowlist check and needs an ADR to add.
- Rejected: AGPL, SSPL, BSL, Elastic, Commons Clause, Sustainable Use, and any "source-available" licence. No code is copied from n8n, Dify, or similar products.
- Agent harnesses are external engines. Codex CLI is Apache-2.0 but is still installed by the user, not bundled. The Claude Agent SDK, when it arrives post-1.0, is under Anthropic's Commercial Terms and is an optional dependency the user installs.
- The full audit of the proposed dependencies is in `research/licenses.md`.

## Credentials (Decided)

- Codex: GraphGoblin relies on the machine's `codex login` state. It never stores, reads, or proxies Codex credentials. Subscription login is the expected mode for 1.0.
- Jev: an API key stored in the secret store, referenced by name.
- GraphGoblin API keys: generated for other applications and the MCP server, hashed at rest, shown once.
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
- Preflight on first run checks Node version, Codex CLI presence and login, the data directory, and the master key source.
- Updates to the PWA are delivered through the service worker prompt. Updates to the backend are a new image or a `pnpm install` plus restart; migrations run at boot.

## Multi-tenant checklist for later (recorded)

Owner scoping enforced in every repository method, auth provider with OIDC, per-user secret keys, remote runners with isolation, Postgres, scheduler lease, rate limits per owner, audit log of control actions.
