# ADR-0058: Node 22.22.2 floor for development and gates

- Status: Accepted
- Date: 2026-10-25
- Scope: Installing dependencies, building, testing and every other pnpm command in this repository. Amends [ADR-0040](ADR-0040-node-22-runtime-baseline.md).

## Context

ADR-0040 set the runtime range to `^22` and recorded a patch-level gap: several development dependencies declare Node floors up to 22.22.2 (jsdom and related DOM packages 22.22.2, react-router 22.22.0, undici 22.19.0), while local gates ran on 22.14.0, the only Node 22 then available on the development machine. D-014 kept `^22` so that a clean install would not fail there.

The gap then blocked a security fix (register D-039). undici, reached only through jsdom as the web test environment, had a high advisory (GHSA-xjj6-f33q-929c) fixed in 8.12.2, and 8.12.x cannot load on Node 22.14: the web test workers fail to start with `Cannot read properties of undefined (reading 'bind')`. The dependency audit accepted the advisory until a qualified Node 22 was available for local gates.

On 2026-10-25 the owner directed that gates use a project-scoped Node 22 runtime meeting the recorded patch requirements, without changing the machine's global runtime. A checksum-verified Node 22.23.4 is now used for local gates; CI and the container already select the latest 22.x.

## Decision

Root `devEngines.runtime.version` and `engines.node` become `^22.22.2` (22.22.2 or later within major 22), still with `onFail: error`, so pnpm refuses installation, builds, tests and scripts on an older Node 22 with its own version message instead of a failure inside a dependency. The dependency audit's accepted advisory is removed and the lockfile takes undici 8.12.3 within jsdom's declared range; no override is added.

The built application's own runtime check is unchanged: the install scripts and API preflight still require major 22 (`SUPPORTED_NODE_MAJOR`), because the shipped app neither bundles nor imports the dependencies that carry the higher floors. Building it still needs the development floor.

## Consequences

Anyone running pnpm in this repository needs Node 22.22.2 or later on PATH; on the development machine that is the project-scoped runtime named in `AGENTS.md`. A running instance built earlier keeps running on its existing Node 22; rebuilding it needs the newer Node. ADR-0040's qualification gap is closed for local gates: they now run on a Node that meets every dependency's declared floor. Future patch floors above 22.22.2 are handled the same way: raise this range with a recorded reason rather than accepting a gap.
