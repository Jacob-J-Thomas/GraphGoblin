# ADR-0009 - Subloops reference loops by id

Date: 2026-10-02. Status: Accepted.

## Decision

A subloop node references another loop by id, with `latest` or a pinned version. It does not copy the definition. Child runs are first-class runs with their own event logs and a parent link. Input and output mappings on the subloop node are rich and configurable: inherit, project, or fresh for input; result-only, merge, or custom patch for output.

## Consequences

- A library of reusable loops emerges naturally.
- Changing a shared loop affects new parent runs only, by ADR-0008.
- Depth limits and self-reference checks are needed and specified in 03 and 04.
