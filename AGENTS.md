# Working in this repository

GraphGoblin is a pnpm + Turborepo monorepo in TypeScript. Read `docs/README.md` first; `docs/12-implementation-plan.md` says what is being built now and `docs/decisions/` records settled decisions.

## Layout

- `packages/contracts` - Zod schemas and types. Depends on zod only.
- `packages/domain` - pure logic over the contracts. No I/O.
- `packages/engine` - executor, run manager, node handlers, written against ports. `@graphgoblin/engine/testing` has fakes for every port.
- `packages/infrastructure` - Node implementations of the engine ports, one folder per concern (`src/sqlite`, `src/fs`, `src/process`, `src/http`, `src/scheduler`), each with its own `index.ts` and an `@graphgoblin/infrastructure/<folder>` subpath. Folders may import each other.
- `packages/adapter-*` - reserved for optional external-service adapters with their own dependency (`adapter-codex`, `adapter-jev`). New packages only at real boundaries: a different runtime, reuse by several apps, or an optional or licence-sensitive dependency (ADR-0014). Otherwise add a folder.
- `apps/*` - composition roots: `api`, `mcp`, `web`, `plugin-codex`.
- `tooling/` - shared config and the repository gate scripts.

Layer rules are enforced by `pnpm check:layers` (declared workspace dependencies) and `pnpm check:deps` (dependency-cruiser). Reach other packages only through their `@graphgoblin/*` entry points.

dependency-cruiser 18 refuses Node 23. Where the default Node is 23, run `check:deps` with the nvm Node 22 binary without switching versions: `& "$env:APPDATA\nvm\v22.14.0\node.exe" node_modules/dependency-cruiser/bin/dependency-cruiser.mjs packages apps --config .dependency-cruiser.cjs` (PowerShell; from Git Bash use `"$APPDATA/nvm/v22.14.0/node.exe"`).

## Rules

- Every package must keep unit-test coverage above 90% of lines and branches. `pnpm test:coverage` fails otherwise. Do not lower thresholds or add exclusions beyond generated code.
- `pnpm typecheck` runs `tsc -b tsconfig.build.json && tsc -p tsconfig.json` in every package, so test files and fixtures are type-checked too; fix their types rather than casting to `any`.
- Tests, lint, and typechecking need no prior build: every workspace package lists a `development` export condition pointing at its TypeScript source, which TypeScript, Vitest, and ESLint resolve. Node at runtime loads `dist/`, so run `pnpm build` before starting an app. A new workspace package must follow the same export-map shape.
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
