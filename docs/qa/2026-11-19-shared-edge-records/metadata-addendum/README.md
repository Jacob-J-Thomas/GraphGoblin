# Device row-metadata observation qualification

This addendum qualifies the earlier frozen form-metadata claim. It does not change any sealed original file or replace the baseline/candidate results.

Inspection of the intact original browser readbacks confirms that **all nine synced per-form device records lack the own `decisionRoutes` field**: before, label edit, ID rename, rename Undo/Redo, Cancel, removal, and removal Undo/Redo. The earlier equality accepted two absent values. Per-form durable row metadata is therefore **unobserved**, including the metadata portion of the earlier “removal Undo/Redo … ownership” check. Do not count that equality as row-map preservation evidence.

Complete server/device definitions and edge objects are present and equal in those samples, so the separate definition/history results remain supported. The offline edit/reload records for both baseline and candidate contain actual nonempty `pick` row maps; those comparisons are substantive. Controlled store snapshots also contain real row maps and remain a separate evidence tier.

`presence-audit.json` binds each observation to the SHA-256 of its original raw artifact and records explicit own-property presence, shape, definition presence/equality and the actual offline maps. `verify-addendum.mjs` verifies the public observations; supply the authorized original evidence root as its optional argument to read and hash-check the intact originals directly. It never prints private original content.

The corrected final-source narrow recheck must use real unsynced form states if it claims durable per-form row metadata: require own-property presence, nonempty valid table/row shape, expected row IDs and owned edge references, then exact Undo/Redo/reload equality. Synced records without the field can qualify definitions, not row-map persistence. This augments the separate pending cold-pointer/safe-guidance/protected-voice recheck.
