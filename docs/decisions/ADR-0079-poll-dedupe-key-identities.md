# ADR-0079 - Refuse malformed poll dedupe keys before lookup

Status: Accepted (#361).

## Context

A poll dedupe key passes from JavaScript into a SQLite text bind and is compared against the key extracted from the run's stored JSON. A lone UTF-16 surrogate can be replaced at the text bind while the stored JSON still preserves it. A subsequent lookup can miss the admitted run and start another one. The current-baseline reproduction observed this across real polls and a gateway restart in both poll modes. Single-result polls can also create a lone high surrogate when they slice a complete pair at 512 UTF-16 code units.

## Decision

- Validate item key type, nonblank content and the 512-code-unit maximum before checking UTF-16 well-formedness. Refuse an item with a malformed key as `POLL_ITEM_REJECTED` with reason `MALFORMED_DEDUPE_KEY` and its item index. The candidate has no identity for duplicate comparison, indexed lookup or run admission. Refuse each malformed candidate independently, including repeated malformed values.
- Validate the complete selected set before lookup or admission. Preserve whole-batch failure for the existing invalid types, blank or overlong keys and duplicate well-formed keys. Keep the D-020 structural depth rule for candidates with well-formed keys, including silent skips when a depth-refused key was already seen. Both per-item refusals leave the admission cap available for later eligible items. Dedupe lookup failures prevent admission, and a run admission failure stops the tail.
- In single-result mode, check the actual key after the existing string-or-JSON derivation and 512-code-unit slice. Refuse the observation on malformed UTF-16 and log `POLL_DEDUPE_KEY_INVALID` with reason `MALFORMED_DEDUPE_KEY` before lookup or admission. An omitted expression or an undefined, null or empty result retains unkeyed admission. Exact well-formed strings remain distinct, including literal U+FFFD and complete surrogate pairs.

Warnings carry the trigger identity and fixed diagnostic fields. Item warnings also carry the candidate index. The rule applies to the dedupe identity and leaves unrelated probe values available as payload. The stored format and historical run records retain their existing shape. This refines D-020 in the [delivery register](../delivery/2026-10-18-i01-i07-register.md) for new poll observations.
