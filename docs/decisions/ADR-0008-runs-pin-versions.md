# ADR-0008 - Runs pin a loop version; new runs follow the latest published version

Date: 2026-10-02. Status: Accepted.

## Decision

Loops have a draft and a history of immutable published versions. A run pins the version it started with and finishes on it. New runs always use the latest published version. Subloop references resolve to the latest published version of the referenced loop at parent start, or to an explicitly pinned version.

## Consequences

- Editing a loop never changes a run in flight.
- Cron and webhook schedules are regenerated per published version.
- The run inspector shows which version a run used, and a version can be exported for reproduction.
