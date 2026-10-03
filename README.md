# GraphGoblin

Design, run, and observe agent loops. A progressive web application plus a gateway backend for AI engineers who want to compose agent-harness sessions, scripts, decisions, and waits into repeatable processes.

Status: pre-1.0, under active construction. Start with [docs/README.md](docs/README.md), then [docs/12-implementation-plan.md](docs/12-implementation-plan.md) for what is being built now.

## Repository layout

```
packages/   class-library style layers: contracts -> domain -> engine -> adapters
apps/       hosts: api, mcp, web, plugin-codex
tooling/    shared configs and repository gate scripts
docs/       design, ADRs, research
```

Layer rules are enforced by `pnpm check:layers` and `pnpm check:deps`. Every package must keep unit-test coverage above 90% of lines and branches; `pnpm test:coverage` fails otherwise.

## Development

```
pnpm install
pnpm build
pnpm check        # typecheck, lint, layer rules, dependency rules, coverage, licences
```

Requires Node 22 or newer and pnpm. The Codex CLI must be installed and logged in for inferencing nodes; GraphGoblin stores no harness credentials.
