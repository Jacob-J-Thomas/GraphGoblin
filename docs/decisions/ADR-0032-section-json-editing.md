# ADR-0032: Explicit section JSON editing

Status: Accepted for the #170 part-B implementation (2026-10-10); owner review remains the issue's human gate.

## Context

Structured inference and decision forms need optional JSON entry for substantial collections without sending incomplete input to autosave or rewiring routes while typing. The format-3 schemas and the existing held-input session store remain authoritative.

## Decision

Enable the requested sections through contract field metadata. Reuse `JsonText`, CodeMirror and the parse-error channel with explicit Apply/Cancel. Validate both the complete section and the current whole-config candidate against the root schema before applying its raw input, including parent refinements. Validate while typing and recheck immediately before Apply; no refused candidate reaches the definition or either draft. Map descendant issues to relative paths and root or other-field issues to section-level messages that identify the config path when available. Other invalid config fields must be corrected before a section can apply. Live parent revalidation refreshes held feedback without an extra undo step when the authored text is unchanged, preserving undo and redo across remounts. Edit decision routes and rubric together as Answer, restricted to its current answer variant, so uniqueness and rubric/band constraints can be checked atomically.

Block returning to the structured editor until invalid JSON or a different parsed value is applied or cancelled. Whitespace and object-key-order changes alone are not pending and never block Publish; array order matters. Hold valid unapplied text as well as invalid text through the existing session channel and block Publish until finished. Keep structured controls mounted; following an issue into their hidden section focuses the JSON editor. Refuse entering JSON mode while descendant fields hold input, naming every path and offering to focus the first. If history restores such input while JSON mode was selected, reveal the structured editor with that notice. Apply can never discard hidden held text. Valid unapplied JSON is described as JSON not applied yet, rather than as an invalid value.

In bulk Answer replacement, keep connections only on surviving route IDs, including reorders and ID swaps. Never retarget a connection to another ID. Remove connections for vanished IDs, even for a same-count delete/add or a JSON rename. Before applying, list all removals by route ID and target node and require a separate Confirm Apply JSON action. The labelled confirmation group receives focus and is described by its connection list; Tab reaches Confirm Apply JSON and then Keep editing JSON. Keep editing JSON retains the unapplied text and returns focus to Apply, or to the editor if Apply is disabled. Text changes reset confirmation and confirming rechecks current consequences. Without removals, Apply is immediate. Structured ID renames keep connections. The scoped Answer replacement and removals remain one undoable edit.

## Consequences

No new dependency, persistence path, contract shape or migration. Empty JSON text means an absent value only where the schema permits it. Variable datalists are suggestions, with schema validation unchanged. Capability resolution is unavailable in format 3, so capability slugs stay authored, with one unavailable-suggestions notice per section and no empty datalists. The existing window-session lifetime of held input remains; reloading the page does not add persistence for unfinished JSON.
