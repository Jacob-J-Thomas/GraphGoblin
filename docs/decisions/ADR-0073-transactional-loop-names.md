# ADR-0073 - Transactional loop-name uniqueness

Date: 2026-11-14. Status: Accepted for #209.

## Context

Equivalent names make loop selection ambiguous. A stale list check cannot prevent two
requests from both seeing an available name. SQLite's built-in lowercase only handles
ASCII. The current store should keep its graph IDs, authored names and histories.

## Decision

Compare loop display names per owner using ECMAScript `trim()`, replacement of each
ECMAScript whitespace run with one space, and locale-independent `toLowerCase()`. The
comparison does not apply Unicode normalization or full Unicode case folding. Preserve
the display spelling submitted by each entry point. Only current loop rows reserve a
name. A case or whitespace edit of the same loop can keep its equivalent name.
Refuse NUL and malformed UTF-16 at authored name admission because the SQLite text
driver cannot read those names back intact. Valid U+FFFD and supplementary characters
are ordinary names.

Check the owner-indexed loop names inside the same libsql write transaction as the
insert or draft save. Drizzle's transaction gets libsql's immediate write mode, so
independent connections cannot both compare against an earlier writable snapshot.
The API's existing token check keeps its precedence for stale draft copies.

Create, draft save, import and template copies return `409 LOOP_NAME_CONFLICT` with
an advisory `suggestedName` when another loop has the equivalent name. Accept explicit
replacement names through the normal save, import and copy entry points. The caller
chooses whether to retry. Generated gateway and device Chat loop names select an
available name in the same creation transaction and retain the separate device label.
If a device label contains characters the loop name cannot store, substitute U+FFFD
in the generated loop name.

The read-only current-format preflight reports the IDs of an existing duplicate pair
or a loop whose stored name contains NUL before startup writes. Operators can rename
the identified loop in the previous build or explicitly reset. The comparison needs
neither a stored name key nor a schema change. Historical published and pinned
definitions keep their original names.

## Consequences

Name admission reads the indexed owner's current name list and compares it in memory.
Existing names, store format and portable export format stay intact. Manual writers
must honor the same rule and stop the gateway before operating on its store.
