# ADR-0004 - REST for commands, SSE event stream for run state

Date: 2026-10-02. Status: Accepted.

## Context

Clients need to start, control, and cancel runs and to observe long-running state with no loss across disconnects. Runs are already append-only event logs with sequence numbers.

## Decision

Commands are plain REST endpoints. Run state is exposed three ways over the same log: a snapshot endpoint, a paged read by sequence number, and a Server-Sent Events tail that resumes from `Last-Event-ID`. Outbound webhooks and the `event` return channel serve systems that cannot hold a stream.

## Consequences

- Lossless reconnect for free.
- Works through proxies and in the MCP server without a bidirectional channel.
- If interactive terminals into harness sessions are ever needed, a WebSocket endpoint can be added alongside without changing this design.

## Alternatives considered

- WebSocket: bidirectional, but unnecessary for 1.0 and harder to resume correctly.
- Polling only: simple, but wasteful and laggy for live inspection.
