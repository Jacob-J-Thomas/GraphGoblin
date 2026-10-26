# ADR-0040: Node 22 LTS runtime baseline

- Status: Accepted; the `^22` range for development and gates is amended by [ADR-0058](ADR-0058-node-22-patch-floor-for-development.md) (22.22.2 or later)
- Date: 2026-10-18
- Scope: Installation, development, quality gates and built Node applications (#263).

## Context

The version file selected Node 24, the root engine range accepted every major from 22 onwards, and CI and the container selected 22. The local default Node 23.10.0 cannot run dependency-cruiser 18. A dependency's engine range alone does not verify GraphGoblin's full toolchain.

## Decision

Support Node 22 LTS (22.x). Use `.nvmrc` as CI's version source, retain `node:22-bookworm-slim` in the Dockerfile, and set root `engines.node` to `^22`. Root `devEngines.runtime` declares `name: node`, `version: ^22` and `onFail: error`: pnpm refuses installation, run, exec, filtered and package-directory commands on other majors. Do not use workspace `engineStrict`, which also enforces every dependency's engine range and rejects a clean installation on the locally available 22.14.0. Both install scripts and API preflight reject other majors with Node 22 selection guidance. No new dependency or custom preinstall mechanism is needed (D-014).

Keep the major range `^22`; do not raise it to `^22.22.2` (D-014). Several development dependencies declare patch floors up to 22.22.2: undici requires 22.19.0, react-router 22.22.0, and jsdom and related DOM packages 22.22.2; the Linux lzma binary requires 22.20. Local checks ran on 22.14.0, while CI selects the latest 22.x. This is a patch-level qualification gap the owner can close by updating their Node 22 installation; passing local checks do not establish compliance with every dependency's declared floor. Select Node 22 on PATH for the entire shell, as described in `AGENTS.md`.

Native domain adversarial probes use the asynchronous `node:module.register` source-loader API supported by 22.14. The forced run exposed six failures from their previous `registerHooks` bootstrap, which requires 22.15 or newer. One shared loader retains the same source-based probes, 128 MB heap caps, watchdogs and assertions; no compatibility branch or new dependency is added.

## Evidence and limits

The [QA record](../qa/2026-10-18-wp-a1-runtime-gates.md) distinguishes independent clean-install verification on Node 22.14.0 from subsequent local checks, and records Node 23 refusal, build, offline upgrade acceptance and forced gates. Independent review reproduced the clean-install failure with workspace `engineStrict` and verified that root `devEngines.runtime` permits Node 22.14.0 while refusing Node 23 with `ERR_PNPM_BAD_RUNTIME_VERSION`. Run gates through pnpm: direct Turbo invocation bypasses this runtime check, and Turbo hashes the declared engine range rather than the running Node version.

## Consequences

The owner must select Node 22 for their local instance before installing, building or starting it. Machine installation and runtime selection remain owner actions. Node 24 is not installed or qualified by this decision. Future major changes require a new complete gate run and reconciliation of the same declarations and instructions.
