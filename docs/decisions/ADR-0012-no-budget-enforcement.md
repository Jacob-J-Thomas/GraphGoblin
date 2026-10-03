# ADR-0012 - No budget or cost enforcement

Date: 2026-10-02. Status: Accepted.

## Context

The architect proposed cost ceilings as exit criteria and global quotas. The owner declined: 1.0 runs on subscriptions, cost is not a concern, and users who want limits can build them with decision or script nodes.

## Decision

GraphGoblin records usage figures reported by the harness as informational events and counters. It implements no budgets, warnings, or cost-based exit criteria. Iteration and duration limits remain.

## Consequences

- Less surface area in the exit node and settings.
- Usage still appears in the run inspector because the harness emits it anyway.
