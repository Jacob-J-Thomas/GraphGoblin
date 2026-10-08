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
| [0017](ADR-0017-design-tokens-and-web-components.md)     | Two-tier design tokens and the web component structure                                         |
| [0018](ADR-0018-model-catalog-source.md)                 | Harness model metadata is managed; enabled is an owner preference                              |
| [0019](ADR-0019-inference-node-harness.md)               | Harness is chosen on inference nodes only                                                      |
| [0020](ADR-0020-clean-design-until-release.md)           | Clean design over backward compatibility until release                                         |
| [0021](ADR-0021-classifier-model-catalog.md)             | Separate owner classifier catalog, HTTP Choice protocol, and runtime registry                  |
| [0022](ADR-0022-explicit-decision-evaluation.md)         | Explicit decision kinds, harness-scoped defaults and offline format conversion                 |
| [0023](ADR-0023-installed-claude-code.md)                | Owner-installed Claude Code CLI as a native-Windows inference harness                          |
| [0024](ADR-0024-github-trigger-admission.md)             | Body-signed webhooks, durable admission and bounded poll items                                 |
| [0025](ADR-0025-answer-primitives.md)                    | Noul, Choice and Score answers with existing context preserved                                 |
| [0026](ADR-0026-exit-primitives-and-format-three.md)     | Shared exit answer primitives and one offline format-3 cutover                                 |
| [0027](ADR-0027-bundled-template-instances.md)           | Bundled templates, atomic draft instances and API-owned integration authority                  |
