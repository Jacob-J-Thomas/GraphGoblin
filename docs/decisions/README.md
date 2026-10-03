# Architecture decision records

One file per decision. Status is Accepted unless stated. Supersede by adding a new ADR and linking both ways.

| ADR                                                      | Title                                                                                          |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [0001](ADR-0001-typescript-monorepo.md)                  | TypeScript monorepo for backend, frontend, and MCP server                                      |
| [0002](ADR-0002-own-the-executor.md)                     | Own the loop executor; LangGraph.js is the recorded alternative                                |
| [0003](ADR-0003-sqlite-drizzle.md)                       | SQLite with Drizzle for 1.0, Postgres for hosting                                              |
| [0004](ADR-0004-rest-commands-sse-state.md)              | REST for commands, SSE event stream for run state                                              |
| [0005](ADR-0005-codex-only-for-1-0.md)                   | Codex is the only harness in 1.0; Claude Code and LiteLLM after                                |
| [0006](ADR-0006-no-error-ports.md)                       | No error ports; resiliency lives in the engine                                                 |
| [0007](ADR-0007-parallel-runs.md)                        | Triggered runs execute in parallel                                                             |
| [0008](ADR-0008-runs-pin-versions.md)                    | Runs pin a loop version; new runs follow the latest published version                          |
| [0009](ADR-0009-subloops-by-reference.md)                | Subloops reference loops by id                                                                 |
| [0010](ADR-0010-exit-return-channels.md)                 | Exit nodes declare a return mapping and return channels                                        |
| [0011](ADR-0011-harnesses-external-subscription-auth.md) | Harnesses are external engines; Codex uses the machine's subscription login                    |
| [0012](ADR-0012-no-budget-enforcement.md)                | No budget or cost enforcement                                                                  |
| [0013](ADR-0013-context-thread-shape.md)                 | Context thread shape (Draft, implemented to unblock M1, to be confirmed)                       |
| [0014](ADR-0014-packages-at-real-boundaries.md)          | Packages only at real boundaries; one infrastructure package; source resolution in development |
| [0015](ADR-0015-wp-d2-open-questions.md)                 | Visit cap under `maxIterations`, draft conflicts with `If-Match`, and the first API key        |
| [0016](ADR-0016-api-key-scope-delegation.md)             | API keys may delegate only their own scopes                                                    |
