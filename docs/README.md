# GraphGoblin Documentation

Last full revision: 2026-10-07. These are living documents. Update them as decisions change, and record each material change as an ADR under `decisions/`.

GraphGoblin is a progressive web application plus a gateway backend for designing, running, and observing agent **loops**. A loop is a graph of nodes. Triggers start it. Decision nodes route it. Inferencing nodes hand work to an agent harness. Script and context-mutation nodes shape the shared **context thread**. Wait and heartbeat nodes park it. Subloops nest it. An exit node decides when it is done, what it returns, and where the result goes.

GraphGoblin is built for AI engineers. AI-driven development lifecycle (AIDLC) pipelines are the first use case, not the only one. Nothing in the core should assume GitHub, pull requests, or software engineering.

## Reading order

| #   | Document                                                     | What it covers                                                                               |
| --- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| -   | [User guide](guide/README.md)                                | Install locally, build loops, run and observe, configure triggers and integrations           |
| 01  | [Vision and scope](01-vision-and-scope.md)                   | Purpose, target users, mental model, principles, 1.0 scope, post-1.0 roadmap                 |
| 02  | [Architecture](02-architecture.md)                           | Stack, layering, package layout, ports, process topology, cross-cutting concerns             |
| 03  | [Domain model](03-domain-model.md)                           | Loops, versions, nodes, runs, events, invocations, the context thread                        |
| 04  | [Node catalog](04-node-catalog.md)                           | Every node type: purpose, configuration, ports, engine behaviour                             |
| 05  | [Execution engine](05-execution-engine.md)                   | Executor semantics, event sourcing, run lifecycle, resiliency model                          |
| 06  | [Harness integration](06-harness-integration.md)             | The harness port, Codex and Claude Code adapters, and later integrations                     |
| 07  | [API, streaming, and MCP](07-api-and-streaming.md)           | REST surface, SSE, OpenAPI, auth, MCP server, Codex plugin                                   |
| 08  | [Triggers and integrations](08-triggers-and-integrations.md) | Manual, cron, webhook, inbound event, polling; security of inbound paths                     |
| 09  | [Frontend and PWA](09-frontend-and-pwa.md)                   | Editor, run inspector, settings, service-worker update flow                                  |
| 10  | [Testing and quality](10-testing-and-quality.md)             | Coverage policy, fixtures, adversarial QA agents, CI gates                                   |
| 11  | [Security and distribution](11-security-and-distribution.md) | Licensing, credentials, secrets, inbound exposure, retention                                 |
| 12  | [Implementation plan](12-implementation-plan.md)             | Milestones M0 to M8 with tasks and acceptance criteria                                       |
| 13  | [Open questions](13-open-questions.md)                       | Items that still need a decision, and which milestone they block                             |
| 14  | [Work packages](14-work-packages.md)                         | Delegated work packages, delivery waves, and acceptance criteria from M3 onward              |
| 15  | [Issue workflow](15-issue-workflow.md)                       | Issue gates, QA scope, model routing, milestones, and this repository's development pipeline |
| -   | [reference/nodes.md](reference/nodes.md)                     | Node config reference, generated from the schemas (`pnpm docs:generate`)                     |
| -   | [reference/api.md](reference/api.md)                         | REST API reference, generated from the OpenAPI document                                      |
| -   | [decisions/](decisions/)                                     | Architecture decision records                                                                |
| -   | [research/](research/)                                       | Preserved research on Codex, Claude Code, Jev, licences, and runtimes                        |

## Status legend

Every section, node, or decision carries one of these labels.

- **Decided**: agreed with the product owner. Change it through a new ADR.
- **Draft**: proposed by the architect and not yet confirmed. Build to the proposed shape and expect revision.
- **Open**: needs a decision before the dependent milestone starts. Tracked in `13-open-questions.md`.

## Conventions

- "1.0" is the first usable release for a single-user laptop. "Post-1.0" items are recorded because they shape the design today, not because they are being built now.
- Vocabulary is defined once in `03-domain-model.md`: loop, loop version, node, port, edge, run, invocation, context thread, harness, return channel.
- Code in these docs is a sketch that shows shape, not a final API. Once `packages/contracts` exists, its Zod schemas are the source of truth and the docs follow them.
