# ADR-0046 - Admit a child and its parent link in one transaction

Date: 2026-10-21. Status: Accepted (2026-10-22, reviewed by the orchestrating Claude session; register D-026). Completes the child-creation recovery boundary in [ADR-0044](ADR-0044-awaited-subloops.md), issue #320.

## Context

Child admission and the parent's `child_run.started` were separate commits. A process death after creating the child but before recording the link left an orphan. The unfinished parent visit had no durable identity to recover and admitted a second child. Recording a link before creating the child would instead leave a link to a missing child.

## Decision

`RunAdmission.parentNodeId` names the parent subloop node. The admission port commits the child's run row, initial thread and `run.queued` together with the parent's existing `child_run.started { nodeId, childRunId }` event. The parent event takes the next sequence and updates the parent's `lastEventSeq`. Both logs are published to subscribers only after commit. Repeating the same child admission verifies its existing parent link and never appends another.

This uses one SQLite transaction across the two run logs. A separate creation-intent event or table is unnecessary in this single-store architecture. Recovery has only two admitted states: neither child nor link, or both. The latter remains discoverable after a lost admission acknowledgement or a crash before parking. The unfinished visit reads the link and re-parks on the child or consumes its terminal outcome. An already recorded child finish is reused after an interrupted parent completion or failure. Resuming a failed child can produce a new recorded outcome; retrying an output mapping preserves its unchanged child outcome.

Finish reconciliation identifies an observed outcome by child id plus the child's terminal-event sequence. The existing child wake durably carries `childFinishedSeq` in its ordinary JSON payload before the parent consumes the outcome. A child outcome changed by an independent resume gets a fresh park/wake before consumption; retrying the same outcome reuses the finish associated with its preceding wake identity. The outcome, its sequence and the child's thread are read from one log snapshot. This preserves independent retries with identical statuses without backfilling outcomes the parent never consumed (required by C6). Parent failures/parks or matching statuses alone cannot identify an outcome, as a reproducing regression showed.

## Consequences and verification

- The in-memory admission fake stages the same writes before publishing anything. A shared contract checks rollback, same-ID admission, the parent's event sequence, the missing-parent refusal and the refusal of a parented admission that names no parent node (every child carries its link) against both implementations.
- A real SQLite admission wrapper interrupts before or after the public admission call. Closing and reopening the file proves recovery of the same child, including an unfinished input child. An SQLite trigger refusing the parent link proves that the child insertion rolls back with it.
- A read-only observer queries child rows and parent links in one coherent statement while the built API executes nested queued runs. Real process kills at child creation are followed by restart and cardinality checks. Separate event-port interruptions exercise the finish-record boundary.
- The event types and stored shapes are unchanged. No migration or owner reset is required. The guarantee applies to admissions made through this transaction; this change does not infer missing links for historical orphan children.
- This guarantees one admitted child per parent visit under the existing single-process run manager. It does not guarantee exactly-once external effects performed inside that child. Uncertain script outcomes belong to #321.
