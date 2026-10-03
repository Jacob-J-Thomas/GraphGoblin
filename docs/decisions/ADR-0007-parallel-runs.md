# ADR-0007 - Triggered runs execute in parallel

Date: 2026-10-02. Status: Accepted.

## Context

A trigger can fire while a run of the same loop is active.

## Decision

Every firing starts a new run that executes concurrently with existing runs. A global worker pool caps overall concurrency. A per-loop policy with `parallel`, `queue`, `skip`, and `replace` is recorded as a post-1.0 loop setting.

## Consequences

- Simple and predictable for 1.0.
- Loops that must not overlap need the post-1.0 setting or a wait on a signal; the docs say so.
