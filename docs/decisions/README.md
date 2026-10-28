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
| [0028](ADR-0028-editable-template-starting-points.md)    | Editable starting-point drafts with optional configured repository automation                  |
| [0029](ADR-0029-no-billing-in-the-product.md)            | No billing policy; Claude uses technical readiness and owner switches                          |
| [0030](ADR-0030-templates-are-starting-points.md)        | Templates are starting points; one-action gallery; instance retirement in #165                 |
| [0031](ADR-0031-mounted-context-tabs.md)                 | Mounted Context tabs in node forms                                                             |
| [0032](ADR-0032-section-json-editing.md)                 | Explicit schema-validated section JSON with session-held text                                  |
| [0033](ADR-0033-loop-deletion-removes-runs.md)           | Loop deletion atomically removes its runs and dependent history                                |
| [0035](ADR-0035-evaluator-specific-decisions.md)         | Evaluator-specific decisions, factual observations and format 4                                |

[ADR-0036: Decision gates and terminal exits](ADR-0036-decision-gates-terminal-exits.md) supersedes earlier exit loop-back rules.

[ADR-0037: Webhook acknowledgement](ADR-0037-webhook-acknowledgement.md) supersedes ADR-0024's public response and preset-filter rules; T4 has a bounded admission checkpoint and continuation.

[ADR-0038: Downstream payload checks](ADR-0038-downstream-payload-checks.md) removes trigger filters and requires version-bound review of stored filter graphs.

[ADR-0041: Runs pin an immutable definition, drafts included](ADR-0041-runs-pin-immutable-definitions.md) supersedes ADR-0008's draft-run gap: draft runs pin a frozen snapshot, and inherited model defaults are pinned at start.

[ADR-0042: Explicit resets replace pre-1.0 conversion](ADR-0042-explicit-resets-replace-conversion.md) retires historical conversion; unsupported stores, imports and device drafts refuse, and `--reset` is the explicit fresh start. It supersedes the conversion mechanics of ADR-0039 and, for format changes, ADR-0020's one-off migrations.

[ADR-0043: Bounded durable webhook return delivery](ADR-0043-bounded-webhook-return-delivery.md) records identity, ambiguity, finite recovery and independent delivery outcomes.

[ADR-0044: Loops compose only as awaited subloops](ADR-0044-awaited-subloops.md) supersedes ADR-0010's `event` channel: child wakes are bound to the observed park, a child returns its configured output or none, child execution failures and cancellations follow the inline rules, and exit-to-Event chaining is retired while external Event intake stays.

[ADR-0046: Atomic child admission](ADR-0046-atomic-child-admission.md) proposes committing the child's run, thread and first event with its parent's child link, so recovery never creates a second child for an interrupted visit (#320).
[ADR-0045: Inherited session IDs do not establish authored-task acceptance](ADR-0045-inference-inherited-session-recovery.md) records D-022: uncertain authored work cannot continue an inherited conversation without acceptance evidence.

[ADR-0047: Visible execution limits and explicit unlimited mode](ADR-0047-visible-execution-limits.md) records pinned node-visit and run-deadline limits and their visible controls.

[ADR-0048: Targeted durable Event admission](ADR-0048-targeted-event-admission.md) records a single explicit recipient, receipt-before-acknowledgement, recipient-scoped keys and bounded payload nesting.

[ADR-0050: Bound SSE replay and slow-consumer buffering](ADR-0050-bounded-sse-replay.md) records paged durable catch-up, bounded live queues, backpressure and typed stream recovery, the bounded browser history window, and bounded, coalesced reads while the inspector follows a run live.

[ADR-0058: Node 22.22.2 floor for development and gates](ADR-0058-node-22-patch-floor-for-development.md) amends ADR-0040's `^22` range: pnpm refuses an older Node 22, while the built app still needs only major 22.

[ADR-0057: Observe execution outcome and durable finalization separately](ADR-0057-execution-and-delivery-finalization.md) exposes the existing finalization marker as `finalizedAt` and extends the stream completion rule to wait for it, so readers tell execution end apart from delivery pending, delivered and failed.

[ADR-0059: Uncertain script recovery](ADR-0059-uncertain-script-recovery.md) records dispatch provenance, explicit retry consent and authoritative resumed observation (#321).

[ADR-0062: Stored data is corrected by hand before 1.0](ADR-0062-stored-data-corrected-by-hand-before-1.0.md) supersedes ADR-0020's one-off-migration sentence for stored content: no automatic data migrations; the CHANGELOG upgrade note names the hand fix, and Drizzle migrations remain for schema changes only (#205).
