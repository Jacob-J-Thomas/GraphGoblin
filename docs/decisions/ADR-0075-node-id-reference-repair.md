# ADR-0075 — Repair references in the current loop's node state

Status: Accepted for #273

## Context

Changing a node ID updates its edge endpoints. Before #273, JSONata and Liquid could still read the old ID, yielding an empty result or rendering, even though the graph passed validation. Thread state also contains inherited and authored output entries, so a graph alone cannot determine where every output key comes from.

## Decision

Use the contracts' existing expression, template and pointer markers to discover fields. Identify the thread view that each field receives. Within that view, repair parsed static keys in the node's output, gate and visit-count maps. The returned definition includes every repaired field, the node ID and its edge endpoints, so the editor can save and undo the entire change as one edit. Preserve the parts of the source outside those key tokens. Executable scripts, generated JSON Patch strings, compared provenance values and arbitrary JSON remain author-controlled.

Validate local keyed references using the same analysis. A missing node or gate in an engine-owned map is an error when the source reads it directly. A deliberate, direct JSONata `$exists` check or a single Liquid `if`/`unless` presence test can probe an absent identity and receives a warning. Reads inside larger expressions or inside a branch are evaluated on their own terms. A missing output key is a warning because an awaited child can inherit it and mutations or scripts can supply it. Whole-map or whole-slot writes that may own the old or proposed output key make the edit ambiguous.

Validation discovers authored fields once. It reuses syntax and reference facts by exact language, scope and source text within a bounded cache. Each validation checks node identities and custom output ownership against its own graph.

## Consequences

Create, import, save, validate and publish continue to return the existing issue shape. A draft with a reference error can be saved and repaired. Publication refuses known broken references. The existing published definition and pinned runs keep their original content. The definition and thread formats, runtime evaluator and store require no changes.
