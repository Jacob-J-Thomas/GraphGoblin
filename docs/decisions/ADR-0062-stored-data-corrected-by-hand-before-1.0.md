# ADR-0062 - Stored data is corrected by hand before 1.0

Date: 2026-10-28. Status: Accepted. Owner decision of 2026-10-27 on #205. Supersedes, for stored content, the one-off-migration sentence of [ADR-0020](ADR-0020-clean-design-until-release.md). [ADR-0042](ADR-0042-explicit-resets-replace-conversion.md) is unchanged for format changes.

## Context

#205 removes the effort `minimal` from the canonical scale and adds `none`. A value that was valid when it was stored (an effort in a loop definition, an owner default, a catalog row) becomes invalid input. ADR-0020 said to ship a one-off migration that rewrites such data. The owner decided otherwise for the pre-1.0 product:

> you should not design the system to migrate anything automatically, as the product is pre 1.0. Simply manually update my local database yourself after applying the changes if needed.

The product has one instance with real data, the owner's. A migration that rewrites stored content runs once there and then stays in the code, with tests, for every later store, which has nothing to rewrite.

## Decision

- **No automatic data migrations for stored content.** When a contract change makes stored values invalid, the contract changes to its clean shape and nothing rewrites, converts or tolerates the old values. A stored value that no longer parses is invalid input, refused or reported where it is read, as any other invalid input.
- **The CHANGELOG upgrade note names the hand fix.** It says which stored places can hold the old value and gives the SQL (or other step) that corrects each one, so the change is reproducible by anyone who holds such a store.
- **The orchestrator corrects the owner's store by hand.** It checks the owner's store for the old value and applies the fix there after the change merges; the product carries no migration code for it.
- **Drizzle migrations remain for schema changes only.** Tables, columns, indexes, constraints and triggers within the current format still evolve through ordinary Drizzle migrations that keep existing data. The seed refresh of harness-owned catalog rows at startup is existing behaviour, not a data migration: it restores the shipped metadata of seeded rows.
- **Format changes keep ADR-0042.** A change of stored, export or device-draft format moves the current format; older stores are refused and reset explicitly.

## Consequences

- #205 ships no migration. The startup seed refresh gives existing stores the new effort lists of seeded models. A stored `minimal` in a loop version or the owner defaults makes the store guard refuse startup, naming the row and changing nothing; in a hand-added catalog row, a run record, its events or its session rows it fails the read that meets it. The CHANGELOG gives one discovery `SELECT` and one `UPDATE` per stored place, scoped with SQLite's `json_*` functions to the contract's typed effort paths, so authored JSON elsewhere (variable schemas, prompts, run input, thread values) is never matched or changed ([WP-205 record](../qa/2026-10-28-wp-205-none/README.md)).
- A hand recipe is held to the standard of code: it is verified on a disposable store before it is published, and it names every typed place the change affects.
- Stores other than the owner's are not upgraded for stored content. That is acceptable while the product has no other users; this decision is revisited at release with ADR-0020.
- Reviews treat a new data-rewriting migration as a defect unless the owner asks for one.
