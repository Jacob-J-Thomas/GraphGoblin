# Working in this repository

GraphGoblin is a pnpm + Turborepo monorepo in TypeScript. Read `docs/README.md` first; `docs/12-implementation-plan.md` says what is being built now and `docs/decisions/` records settled decisions.

## Layout

- `packages/contracts` - Zod schemas and types. Depends on zod only.
- `packages/domain` - pure logic over the contracts. No I/O.
- `packages/engine` - executor, run manager, node handlers, written against ports. `@graphgoblin/engine/testing` has fakes for every port.
- `packages/adapter-*` - one package per external concern. Adapters never import each other.
- `apps/*` - composition roots: `api`, `mcp`, `web`, `plugin-codex`.
- `tooling/` - shared config and the repository gate scripts.

Layer rules are enforced by `pnpm check:layers` (declared workspace dependencies) and `pnpm check:deps` (dependency-cruiser). Reach other packages only through their `@graphgoblin/*` entry points.

## Rules

- Every package must keep unit-test coverage above 90% of lines and branches. `pnpm test:coverage` fails otherwise. Do not lower thresholds or add exclusions beyond generated code.
- Run `pnpm build` before testing or linting a package that depends on another; dependents resolve `dist/`.
- Only permissive licences (MIT, Apache-2.0, BSD, ISC). `pnpm check:licenses` enforces the allowlist in `tooling/license-allowlist.json`; add a line to `docs/research/licenses.md` for every new dependency.
- Relative imports use explicit `.js` extensions (NodeNext). Zod 4: use `.prefault({})` for object defaults whose fields have defaults.
- Keep docs in sync: a behaviour change updates the relevant numbered doc; a decision change adds an ADR.
- Commits carry no assistant attribution of any kind.

## Commands

```
pnpm install
pnpm build
pnpm test:coverage
pnpm lint
pnpm check          # typecheck, lint, layers, deps, coverage, licences
```
