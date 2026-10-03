# Research - Licence ledger

Every dependency added to the repo gets a line here. CI enforces the allowlist in 11; this file is the human-readable record and the place to note anything unusual.

## Allowlist

MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, Unlicense, CC0-1.0.

## Planned dependencies

| Dependency                                                           | Licence    | Notes                                                                                                                  |
| -------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------- |
| Node.js                                                              | MIT        | Runtime                                                                                                                |
| TypeScript                                                           | Apache-2.0 |                                                                                                                        |
| pnpm, Turborepo                                                      | MIT        |                                                                                                                        |
| Fastify, @fastify/swagger, fastify-type-provider-zod                 | MIT        |                                                                                                                        |
| Zod                                                                  | MIT        |                                                                                                                        |
| Drizzle ORM, drizzle-kit                                             | Apache-2.0 |                                                                                                                        |
| @libsql/client, libsql                                               | MIT        | N-API binary, prebuilt for all Node versions; see `sqlite-libsql.md`                                                   |
| drizzle-kit                                                          | Apache-2.0 | Dev only: migration generation                                                                                         |
| ajv, ajv-formats                                                     | MIT        | JSON Schema validation in `domain`                                                                                     |
| @fastify/swagger-ui                                                  | MIT        | Dev-facing API docs at `/docs`                                                                                         |
| pino-pretty, tsx, @types/node                                        | MIT        | Dev only                                                                                                               |
| croner                                                               | MIT        | Adopted in M6 (10.x): cron slots in `infrastructure/src/scheduler`                                                     |
| pino                                                                 | MIT        |                                                                                                                        |
| OpenTelemetry JS                                                     | Apache-2.0 |                                                                                                                        |
| LiquidJS                                                             | MIT        |                                                                                                                        |
| JSONata                                                              | MIT        |                                                                                                                        |
| @modelcontextprotocol/sdk                                            | MIT        | Runtime dependency of `@graphgoblin/mcp` (1.31); transitive deps all MIT/ISC/BSD                                       |
| @openai/codex-sdk                                                    | Apache-2.0 | Pinned 0.160.0 in `adapter-codex`; spawns the Codex CLI                                                                |
| @openai/codex (+ platform package)                                   | Apache-2.0 | 0.160.0, a dependency of the SDK; bundles the native CLI (~430 MB)                                                     |
| @typesafe-ai/sdk                                                     | MIT        | Pinned 0.6.0 in `adapter-jev`; no runtime dependencies                                                                 |
| @napi-rs/keyring                                                     | MIT        | Verify on adoption                                                                                                     |
| React, React DOM                                                     | MIT        |                                                                                                                        |
| Vite, vite-plugin-pwa, Workbox                                       | MIT        |                                                                                                                        |
| @xyflow/react                                                        | MIT        | The paid Pro tier is examples and support only                                                                         |
| Zustand, TanStack Query                                              | MIT        |                                                                                                                        |
| Tailwind CSS, shadcn/ui, Radix UI                                    | MIT        |                                                                                                                        |
| CodeMirror 6                                                         | MIT        |                                                                                                                        |
| react-hook-form                                                      | MIT        |                                                                                                                        |
| Vitest, Testing Library, MSW                                         | MIT        |                                                                                                                        |
| Playwright                                                           | Apache-2.0 |                                                                                                                        |
| dependency-cruiser                                                   | MIT        |                                                                                                                        |
| openapi-fetch                                                        | MIT        | Runtime dependency of `@graphgoblin/api-client`; one MIT helper dep                                                    |
| openapi-typescript                                                   | MIT        | Dev only: generates `api-client` types; pulls `@redocly/openapi-core` (MIT)                                            |
| @fastify/static                                                      | MIT        | `apps/api`: serves the built web app under `/app/` when `GG_WEB_DIST` is set                                           |
| react, react-dom                                                     | MIT        | `apps/web` runtime                                                                                                     |
| react-router                                                         | MIT        | `apps/web` client-side routing (basename `/app`)                                                                       |
| @xyflow/react                                                        | MIT        | `apps/web` canvas                                                                                                      |
| zustand                                                              | MIT        | `apps/web` editor, run-event, and PWA stores                                                                           |
| @tanstack/react-query                                                | MIT        | `apps/web` server state                                                                                                |
| react-hook-form, @hookform/resolvers                                 | MIT        | `apps/web` schema-driven forms with the Zod resolver                                                                   |
| codemirror, @codemirror/{view,state,language,lang-json,legacy-modes} | MIT        | `apps/web` template, expression, and JSON editors                                                                      |
| workbox-window                                                       | MIT        | `apps/web` service worker registration and prompt update flow                                                          |
| idb-keyval                                                           | Apache-2.0 | `apps/web` IndexedDB mirror of unsaved drafts                                                                          |
| clsx                                                                 | MIT        | `apps/web` class names                                                                                                 |
| vite, @vitejs/plugin-react                                           | MIT        | Dev only: `apps/web` build                                                                                             |
| vite-plugin-pwa, workbox-build                                       | MIT        | Dev only: manifest and generated service worker                                                                        |
| tailwindcss, @tailwindcss/vite                                       | MIT        | Dev only. Build-time transitive `lightningcss` is MPL-2.0 (already present through Vite); it never ships in the bundle |
| jsdom                                                                | MIT        | Dev only: `apps/web` unit tests                                                                                        |
| @testing-library/react, dom, user-event, jest-dom                    | MIT        | Dev only: `apps/web` component tests                                                                                   |
| fake-indexeddb                                                       | Apache-2.0 | Dev only: IndexedDB in jsdom                                                                                           |
| @playwright/test                                                     | Apache-2.0 | Dev only: `apps/web` E2E (`test:e2e`)                                                                                  |
| @types/react, @types/react-dom                                       | MIT        | Dev only                                                                                                               |
| eslint-plugin-react-hooks                                            | MIT        | Dev only: hooks lint rules (root)                                                                                      |
| @eslint-react/eslint-plugin                                          | MIT        | Dev only: JSX and DOM lint rules (root); supports ESLint 10 where `eslint-plugin-react` does not                       |

## Recorded alternatives and their licences

| Option                                               | Licence                    | Why noted                                                                               |
| ---------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------- |
| LangGraph.js, @langchain/langgraph-checkpoint-sqlite | MIT                        | Executor alternative; LangGraph Platform, Studio, and the CLI dev server are commercial |
| PGlite                                               | Apache-2.0                 | Database alternative                                                                    |
| DBOS Transact                                        | MIT                        | Durable execution alternative                                                           |
| Temporal TypeScript SDK                              | MIT                        | Durable execution alternative; server is also MIT                                       |
| Hatchet                                              | MIT                        | Task queue alternative                                                                  |
| @anthropic-ai/claude-agent-sdk, Claude Code          | Anthropic Commercial Terms | Post-1.0 harness; optional, user-installed, never vendored                              |
| @anthropic-ai/sdk                                    | MIT                        | Would be used by a direct Claude API decider post-1.0                                   |
| NestJS, Hono                                         | MIT                        | HTTP framework alternatives                                                             |
| SvelteKit, Svelte Flow                               | MIT                        | Frontend alternative                                                                    |
| Monaco editor                                        | MIT                        | Rejected for bundle size, not licence                                                   |

## Rejected for licence reasons

| Project        | Licence                 | Note                                                  |
| -------------- | ----------------------- | ----------------------------------------------------- |
| n8n            | Sustainable Use License | Do not copy code or patterns verbatim                 |
| Restate server | BSL                     | Verify if ever reconsidered                           |
| Inngest server | Historically non-OSI    | SDKs are Apache-2.0; verify the server before any use |
| vm2            | MIT but unmaintained    | Rejected for security, not licence                    |
