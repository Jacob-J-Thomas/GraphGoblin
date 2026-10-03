# Research - Licence ledger

Every dependency added to the repo gets a line here. CI enforces the allowlist in 11; this file is the human-readable record and the place to note anything unusual.

## Allowlist

MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, Unlicense, CC0-1.0.

## Planned dependencies

| Dependency                                           | Licence    | Notes                                                                            |
| ---------------------------------------------------- | ---------- | -------------------------------------------------------------------------------- |
| Node.js                                              | MIT        | Runtime                                                                          |
| TypeScript                                           | Apache-2.0 |                                                                                  |
| pnpm, Turborepo                                      | MIT        |                                                                                  |
| Fastify, @fastify/swagger, fastify-type-provider-zod | MIT        |                                                                                  |
| Zod                                                  | MIT        |                                                                                  |
| Drizzle ORM, drizzle-kit                             | Apache-2.0 |                                                                                  |
| @libsql/client, libsql                               | MIT        | N-API binary, prebuilt for all Node versions; see `sqlite-libsql.md`             |
| drizzle-kit                                          | Apache-2.0 | Dev only: migration generation                                                   |
| ajv, ajv-formats                                     | MIT        | JSON Schema validation in `domain`                                               |
| @fastify/swagger-ui                                  | MIT        | Dev-facing API docs at `/docs`                                                   |
| pino-pretty, tsx, @types/node                        | MIT        | Dev only                                                                         |
| croner                                               | MIT        | Adopted in M6 (10.x): cron slots in `infrastructure/src/scheduler`               |
| pino                                                 | MIT        |                                                                                  |
| OpenTelemetry JS                                     | Apache-2.0 |                                                                                  |
| LiquidJS                                             | MIT        |                                                                                  |
| JSONata                                              | MIT        |                                                                                  |
| @modelcontextprotocol/sdk                            | MIT        | Runtime dependency of `@graphgoblin/mcp` (1.31); transitive deps all MIT/ISC/BSD |
| @openai/codex-sdk                                    | Apache-2.0 | Pinned 0.160.0 in `adapter-codex`; spawns the Codex CLI                          |
| @openai/codex (+ platform package)                   | Apache-2.0 | 0.160.0, a dependency of the SDK; bundles the native CLI (~430 MB)               |
| @typesafe-ai/sdk                                     | MIT        | Pinned 0.6.0 in `adapter-jev`; no runtime dependencies                           |
| @napi-rs/keyring                                     | MIT        | Verify on adoption                                                               |
| React, React DOM                                     | MIT        |                                                                                  |
| Vite, vite-plugin-pwa, Workbox                       | MIT        |                                                                                  |
| @xyflow/react                                        | MIT        | The paid Pro tier is examples and support only                                   |
| Zustand, TanStack Query                              | MIT        |                                                                                  |
| Tailwind CSS, shadcn/ui, Radix UI                    | MIT        |                                                                                  |
| CodeMirror 6                                         | MIT        |                                                                                  |
| react-hook-form                                      | MIT        |                                                                                  |
| Vitest, Testing Library, MSW                         | MIT        |                                                                                  |
| Playwright                                           | Apache-2.0 |                                                                                  |
| dependency-cruiser                                   | MIT        |                                                                                  |
| openapi-fetch                                        | MIT        | Runtime dependency of `@graphgoblin/api-client`; one MIT helper dep              |
| openapi-typescript                                   | MIT        | Dev only: generates `api-client` types; pulls `@redocly/openapi-core` (MIT)      |

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
