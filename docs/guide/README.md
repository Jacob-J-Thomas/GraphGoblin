# User guide

GraphGoblin is a local web app and API for composing agent work, scripts, decisions, and waits.
A loop is a graph of nodes connected through named ports.
A run executes a particular loop version and records an event log that you can inspect and stream.
Codex is the harness that performs agent work using your machine's existing login.
A decider uses Jev or Codex to choose a route, or a decision node evaluates a JSONata expression.

## Use the mental model

| Concept | Use it for                                                                            |
| ------- | ------------------------------------------------------------------------------------- |
| Loop    | Define a graph, its entry triggers, workspace, limits, and return value.              |
| Run     | Execute one version; inspect its status, event log, and shared context thread.        |
| Harness | Let Codex perform work in the run's working directory.                                |
| Decider | Ask Jev or Codex to pick a labelled route; use expressions for deterministic choices. |

The context thread holds messages, variables, artifacts, per-node outputs, and usage counters. Templates use Liquid; mappings and predicates use JSONata. Only an exit node's explicit loop-back increments the run's iteration.

## Follow the guide

1. [Install and make a first run](01-install-and-first-run.md)
2. [Build a loop](02-build-a-loop.md)
3. [Run and observe](03-run-and-observe.md)
4. [Configure triggers](04-triggers.md)
5. [Use MCP and the Codex plugin](05-mcp-and-codex-plugin.md)
6. [Manage settings and secrets](06-settings-and-secrets.md)
7. [Troubleshoot](07-troubleshooting.md)

This guide describes the current implementation. Callouts mark planned 1.0 features that are unavailable. For design context, read [Vision and scope](../01-vision-and-scope.md), [Architecture](../02-architecture.md), and the [Implementation plan](../12-implementation-plan.md).
