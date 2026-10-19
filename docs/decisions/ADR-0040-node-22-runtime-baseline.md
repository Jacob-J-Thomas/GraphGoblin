# ADR-0040: Node 22 LTS runtime baseline

- Status: Accepted
- Date: 2026-10-18
- Scope: Installation, development, quality gates and built Node applications (#263).

## Context

The version file selected Node 24, the root engine range accepted every major from 22 onwards, and CI and the container selected 22. The local default Node 23.10.0 cannot run dependency-cruiser 18. A dependency's engine range alone does not verify GraphGoblin's full toolchain.

## Decision

Support Node 22 LTS (22.x). Use `.nvmrc` as CI's version source, retain `node:22-bookworm-slim` in the Dockerfile, and set root `engines.node` to `^22`. Set `engineStrict: true` in `pnpm-workspace.yaml`, pnpm 12's project settings file; remove the old `.npmrc` line, which the installed manager did not load. Both install scripts and API preflight explicitly reject other majors with Node 22 selection guidance. No new dependency or custom preinstall mechanism is needed.

The major range permits Node 22 maintenance releases while CI follows 22.x. The locally exercised patch is 22.14.0; this does not claim that each patch was independently tested. Select Node 22 on PATH for the entire shell, as described in `AGENTS.md`, rather than selecting a different binary for one gate.

Native domain adversarial probes use the asynchronous `node:module.register` source-loader API supported by 22.14. The forced run exposed six failures from their previous `registerHooks` bootstrap, which requires 22.15 or newer. One shared loader retains the same source-based probes, 128 MB heap caps, watchdogs and assertions; no compatibility branch or new dependency is added.

## Evidence and limits

The [WP-A1 evidence record](../qa/2026-10-18-wp-a1-runtime-gates.md) records commands, results and wall times for the locked installation attempt, build, offline upgrade acceptance, forced typecheck/lint/coverage and the remaining plain gates. It also records Node 23's dependency-cruiser error, both installers' refusal text, and pnpm's observed `ERR_PNPM_UNSUPPORTED_ENGINE` refusal after the project setting was loaded. Node 22's sandbox lock-file restriction remains a verification limitation, not a successful locked install.

## Consequences

The owner must select Node 22 for their local instance before installing, building or starting it. Machine installation and runtime selection remain owner actions. Node 24 is not installed or qualified by this decision. Future major changes require a new complete gate run and reconciliation of the same declarations and instructions.
