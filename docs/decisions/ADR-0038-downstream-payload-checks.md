# ADR-0038: Payload checks belong downstream

Status: Decided, owner-approved #168 plan; 2026-10-16.

Supersedes trigger-filter behaviour in ADR-0024 and ADR-0037. Their historical receipt facts remain intact.

Webhook and Event configs have no `filter`. Eligible input is admitted before ordinary decision, classifier or script nodes apply payload policy. A quiet exit is a new terminal Success exit with no returns or destinations. No new node kind or compatibility reader is introduced. Poll `fireWhen` is unchanged.

The frozen V3-to-V4 converter proposes a decision/restore/quiet-exit fragment for payload-only predicates. Its guarded `$eval` wrapper preserves `evaluatePredicate` collection and scalar coercion, including false-valued nonempty collections. Restore copies the full trigger output. Trigger and successor-edge identities survive; invalidated manual routes are cleared and reported. Ambiguous successors, missing destinations, exhausted Slug IDs and graph bounds refuse conversion. Effectful exits are never reused.

Each stored filtered version requires a version-bound hash review: approve the exact generated fragment, supply a valid replacement, or explicitly remove the filter with a reason accepting broader behaviour. Headers, clock, randomness, dynamic sources and unavailable context have no generated proposal. Review acknowledges quiet runs, post-acknowledgement errors, key consumption before checks and extra visits. Approval cannot transfer between versions.

Historical `filtered` receipts remain visible and continue consuming their explicit keys. New intake never creates that disposition. The shared format-4 cutover owns storage/device composition, manifest identities, replay and backup/restore evidence; this decision does not authorize an installed upgrade.
