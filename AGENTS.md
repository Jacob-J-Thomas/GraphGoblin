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

Node 22 LTS is the supported runtime; installation, development and gates need Node 22.22.2 or later, and other majors are unsupported. Select it for the whole shell before running commands. On this Windows host that is the project-scoped runtime, leaving the machine's own Node untouched: `$env:PATH = "$env:USERPROFILE\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64;$env:PATH"` in PowerShell, or `export PATH="$HOME/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64:$PATH"` in Git Bash. Confirm `node --version` reports `v22.22.2` or later. `.nvmrc`, CI and the container use major 22 (CI and the container take the latest 22.x); root `engines.node` and `devEngines.runtime` declare `^22.22.2`, with `onFail: error` refusing every pnpm command on an older Node 22 or another major. pnpm runs package scripts with the first `node` on PATH. Run gates through pnpm: calling `node_modules/.bin/turbo` directly bypasses this check, and Turbo's cache key ignores the running Node version. See ADR-0040 and ADR-0058.

## Rules

- Every package must keep unit-test coverage above 90% of lines and branches. `pnpm test:coverage` fails otherwise. Do not lower thresholds or add exclusions beyond generated code.
- `pnpm typecheck` runs `tsc -b tsconfig.build.json && tsc -p tsconfig.json` in every package, so test files and fixtures are type-checked too; fix their types rather than casting to `any`.
- Tests, lint, and typechecking need no prior build: every workspace package lists a `development` export condition pointing at its TypeScript source, which TypeScript, Vitest, and ESLint resolve. Node at runtime loads `dist/`, so run `pnpm build` before starting an app. A new workspace package must follow the same export-map shape.
- API subprocess tests build the API first through Turbo's `test` and `test:coverage` task dependencies.
- Only permissive licences (MIT, Apache-2.0, BSD, ISC). `pnpm check:licenses` enforces the allowlist in `tooling/license-allowlist.json`; add a line to `docs/research/licenses.md` for every new dependency.
- Relative imports use explicit `.js` extensions (NodeNext). Zod 4: use `.prefault({})` for object defaults whose fields have defaults.
- Keep docs in sync: a behaviour change updates the relevant numbered doc; a decision change adds an ADR.
- Clean design over backward compatibility, until the owner says otherwise (2026-10-04): the product is not released and has no production users. Do not build compatibility schemas, deprecated input paths, tolerant parsing of old data shapes, or dual code paths. Change the contract to its clean shape. A schema change within the current format is an ordinary Drizzle migration that keeps existing data; a change of the stored, export or device-draft format moves the current format and refuses older data clearly, with no converter, and the owner resets with `--reset` (ADR-0042); say so, and what exports or clients must change, in the CHANGELOG upgrade notes. The owner updates their local instance by hand when a change needs it.
- Before picking up a GitHub issue, read `docs/15-issue-workflow.md` for its gate, routing, and delivery rules.
- Commits carry no assistant attribution of any kind.

## Commands

On Windows PowerShell, call `pnpm.cmd` (the default execution policy blocks `pnpm.ps1`); Git Bash and cmd can use `pnpm` directly.

```
pnpm install
pnpm build
pnpm test:coverage
pnpm lint
pnpm docs:generate  # regenerate docs/reference after a node schema or route change
pnpm check          # typecheck, lint, layers, deps, coverage, licences, generated docs
```
