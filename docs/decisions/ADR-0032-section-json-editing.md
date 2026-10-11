# ADR-0032: Explicit section JSON editing

Status: Accepted for the #170 part-B implementation (2026-10-10); owner review remains the issue's human gate.

## Context

Structured inference and decision forms need optional JSON entry for substantial collections without sending incomplete input to autosave or rewiring routes while typing. The format-3 schemas and the existing held-input session store remain authoritative.

## Decision

Enable the requested sections through contract field metadata. Reuse `JsonText`, CodeMirror and the parse-error channel with explicit Apply/Cancel. Validate against the complete section's schema before applying its raw input. Edit decision routes and rubric together as Answer, restricted to its current answer variant, so uniqueness and rubric/band constraints can be checked atomically.

Block returning to the structured editor until changed text is applied or cancelled. Hold valid unapplied text as well as invalid text through the existing session channel and block Publish until finished. Keep structured controls mounted; following an issue into their hidden section focuses the JSON editor. Applying a replacement clears descendant held input in the same history step.

Match retained route IDs first in bulk Answer replacement. When the row count is unchanged, pair remaining rows in authored order as renames. Separate remove/apply and add/apply actions express replacement that should drop a connection.

## Consequences

No new dependency, persistence path, contract shape or migration. Empty JSON text means an absent value only where the schema permits it. Variable datalists are suggestions, with schema validation unchanged. Capability resolution is unavailable in format 3, so capability slugs stay authored. The existing window-session lifetime of held input remains; reloading the page does not add persistence for unfinished JSON.
