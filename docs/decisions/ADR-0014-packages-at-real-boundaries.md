# ADR-0014 - Packages only at real boundaries

Date: 2026-10-02. Status: Accepted. Refines the layering in ADR-0001 and `02-architecture.md`; the layers are unchanged, the mechanism that enforces them changes.

## Context

The first package layout borrowed the .NET habit of one class-library project per layer and per adapter. By M3 that meant five small Node adapter packages (`adapter-sqlite`, `adapter-fs`, `adapter-process`, `adapter-http`, `adapter-scheduler`), and the analogy was costing more than it bought:

- Each adapter carried its own manifest, two tsconfig files, a Vitest config, and its own coverage gate, for a few hundred lines of code.
- The rule that adapters never import each other forced a `TimerStorePort` into the engine only so the scheduler adapter could use the SQLite timer table. The engine never used it.
- Dependents resolved each other through `dist/`, so every change in a lower package needed a rebuild before a higher package's tests, lint, or editor saw it.

In the Node ecosystem a package is a unit of distribution and resolution, not the natural unit of layering. Layer direction can be enforced inside a package with folders and lint rules.

## Decision

1. **Packages only at genuine boundaries**: a different runtime (browser versus Node), reuse by several apps, or an optional or licence-sensitive dependency. Anywhere else, a layer or concern is a folder; where direction between folders matters, lint and dependency-cruiser rules enforce it.
2. **One infrastructure package.** The five Node adapters merge into `packages/infrastructure` (`@graphgoblin/infrastructure`, layer `infrastructure`, allowed `contracts`, `domain`, `engine`). Each concern is a folder with its own `index.ts` (`src/sqlite`, `src/fs`, `src/process`, `src/http`, `src/scheduler`), published as both the root export and a subpath such as `@graphgoblin/infrastructure/sqlite`. Folders may import each other. `TimerStorePort` leaves the engine; the scheduler folder defines `TimerStore` and `SqliteTimerStore` satisfies it structurally. Drizzle migrations live in `packages/infrastructure/drizzle`.
3. **`adapter-*` is reserved** for optional external-service adapters with their own dependency, starting with `adapter-codex` and `adapter-jev`. The `adapter` layer keeps the same allowances as `infrastructure`.
4. **Source resolution in development.** Every workspace package lists a `development` export condition first in each `exports` entry, pointing at its TypeScript source, then `types` and `import` pointing at `dist/`. `tsconfig.base.json` sets `customConditions: ["development"]` and the shared Vitest config sets `resolve.conditions: ['development']`. Turborepo's `test` and `test:coverage` tasks no longer depend on `^build`; `build` still does. Node at runtime does not set the condition and loads `dist/`; `tsc -b` follows project references to the referenced projects' declaration output.

## Consequences

- Fewer manifests, tsconfigs, and coverage configs: one infrastructure package instead of five, with one coverage gate over all of it.
- No build before test, lint, or typecheck in the editor. A change in `contracts` is visible to `apps/api` tests immediately.
- Layers inside `infrastructure` are folders. Their boundaries are a convention backed by lint and dependency-cruiser, not by manifests, so a reviewer has to watch for tangles between folders that a package boundary would have prevented.
- Optional or licence-sensitive integrations still get their own `adapter-*` package, so installing GraphGoblin without Codex or Jev stays possible.
- Every new workspace package must follow the same export-map shape, or its dependents will need a build before testing again.
- `pnpm check:layers` rules are per package: `infrastructure` and `adapter-*` may depend on `contracts`, `domain`, and `engine`; apps on anything.

## Alternatives considered

- **Keep one package per adapter.** Clear manifests per concern, but every cost in Context stays, and cross-adapter needs keep leaking into engine ports.
- **Collapse everything into one package.** Fewest files, but loses the boundaries that are real: the browser cannot load Node infrastructure, `contracts` is shared with the web app and the API client, and optional dependencies such as the Codex SDK must stay out of a default install. Layer direction between contracts, domain, and engine would rest on lint alone.
