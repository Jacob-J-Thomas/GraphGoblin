# 01 - Vision and scope

## Purpose (Decided)

GraphGoblin lets an AI engineer draw a loop on a canvas, run it, watch it, and hand it to other systems. A loop composes agent-harness sessions, scripts, decisions, and waits into one repeatable process around a shared context thread. The backend is a gateway. It stores loops, runs them, exposes their state as a stream, and lets other applications and agent harnesses start, control, and cancel runs.

## Who it is for (Decided)

AI engineers building repeatable agentic processes. Software-delivery loops such as issue triage, implementation, review, and QA are the first examples. The core stays general. A loop that researches a topic nightly, curates a dataset, or drives a non-code tool is equally valid.

## Mental model: a loop is a function (Decided)

| Function concept      | Loop concept                                                               |
| --------------------- | -------------------------------------------------------------------------- |
| Arguments             | The trigger envelope that starts a run                                     |
| Local variables       | The context thread, owned by the run                                       |
| Body                  | The graph of nodes between trigger and exit                                |
| Nested call           | A subloop node, which executes a child run                                 |
| Return value          | The exit node's return mapping                                             |
| Where the return goes | Return channels: the caller, a webhook, a file, an internal event, the log |
| Side effects          | Changes a harness or script makes to a workspace                           |

Loops must not rely only on side effects. A loop that produces something declares what it returns and where that goes, and the caller can read it.

## Design principles (Decided)

1. **API first.** Every capability exists as an HTTP API before it exists in the UI. The web app and the MCP server are both clients of the same API.
2. **Own the code.** Only permissive licences in the dependency tree. Agent harnesses are external engines the user installs, never bundled.
3. **Resiliency is the platform's job.** Users compose loops. They do not wire error handling. Infrastructure failures are absorbed or resumed by the engine. Inference-level retries are delegated to the harness. The few unavoidable failures, such as an exhausted subscription or an expired login, end a run with a clear reason and can be resumed after the cause is fixed. Anything else is a bug to fix, not a case to design around.
4. **The harness abstracts inference.** GraphGoblin configures and observes harness sessions. It does not reimplement an agent loop, tool use, or context compaction.
5. **Composition over sprawl.** A small set of expressive nodes with rich configuration beats many narrow nodes.
6. **Observable by default.** Every run is an append-only event log that doubles as persistence, live stream, audit trail, and replay.
7. **Single-user first, multi-tenant ready.** Every table has an owner. Every external boundary sits behind an interface. Nothing assumes one process forever.

## 1.0 scope (Decided)

In scope:

- Node types: trigger (manual, cron, webhook, inbound event), decision (Jev, Codex structured decision, expression), inferencing (Codex), script, context mutation, subloop, wait, heartbeat, exit.
- Engine: sequential execution, iteration limits with an explicit loop-back edge, event-sourced runs, pause, resume, cancel, parallel runs of the same loop, runs pinned to a loop version, child runs for subloops.
- Persistence: SQLite.
- Gateway: REST plus SSE, OpenAPI document, local trusted mode plus API keys, MCP server, Codex plugin with skills.
- Web PWA: canvas editor, property panels generated from node schemas, run inspector, service-worker update with user confirmation.
- Deployment: single-user laptop, one process, Codex through the user's existing subscription login.
- Quality: unit tests over 90% of lines and branches per package, enforced in CI with the other standard gates.

Out of scope for 1.0, recorded so the design leaves room:

- Claude Code adapter. Research is preserved in `research/claude-code-agent-sdk.md`.
- LiteLLM adapter for local or alternative inference.
- Multi-tenant hosting: pluggable auth provider, remote runners, Postgres, scheduler lease.
- Per-loop concurrency policy. 1.0 always runs triggered runs in parallel.
- Fan-out and fan-in. Explained below.
- Error or debug nodes.
- LLM-based summarisation or compaction as a mutation operation. Truncation, injection, redaction, and replacement ship in 1.0.
- Configurable retention. 1.0 follows harness defaults and keeps everything.
- Provider-specific trigger presets beyond a generic signed webhook.
- Budget or cost enforcement of any kind.

## Post-1.0 roadmap (Draft, ordered by expected value)

1. Claude Code adapter behind the same harness port.
2. LiteLLM adapter so decision and summarisation steps can use local or alternative models.
3. Per-loop concurrency policy: parallel, queue, skip, replace.
4. Multi-tenant hosting: auth provider, owner scoping enforced at the API, remote runners, Postgres, scheduler lease.
5. Fan-out and fan-in.
6. Error or debug nodes, only if run inspection proves insufficient.
7. Summarise or compact mutation operation.
8. Retention settings and purge jobs.
9. Trigger presets: GitHub, generic CI, error trackers.

## What fan-out and fan-in means, for the record

Today one active token walks the graph. Fan-out would let one node feed two or more downstream nodes that run at the same time, for example a QA subloop and a review subloop both starting after an implementation node. Fan-in is the node where those branches rejoin and their thread changes merge. It is deferred because merging two divergent context threads needs merge rules the thread design does not have yet. The patch-based thread model keeps the door open.

## Non-goals

- Replacing the harness. GraphGoblin never calls a model directly for coding work.
- A general automation product with hundreds of connectors.
- Cost accounting. Usage figures emitted by the harness are recorded for display only.
