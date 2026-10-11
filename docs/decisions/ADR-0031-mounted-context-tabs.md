# ADR-0031: Mounted Context tabs in node forms

Status: Accepted for the #170 part-A implementation (2026-10-10); running-product review remains the issue's human gate.

## Context

Inference and provider decision forms mix turn context with the main task settings. Moving context must preserve field paths, validation, unfinished JSON text and undo focus. The current format-3 contracts are authoritative; terminology work in #38 and session continuity in #33 remain separate.

## Decision

Add a shared horizontal Tabs primitive in `apps/web/src/components/ui/`. Automatically activate tabs with Left/Right (wrapping), Home and End, expose one tab stop and linked tab/panel ARIA attributes, and keep every panel mounted. A synchronous reveal helper selects a hidden panel before issue or history focus opens its disclosures and focuses the field.

Contract field metadata marks context with `context: true`; the form collects these fields through present objects and the selected evaluator variant and renders them once under Context with their original bindings. Settings and Context share one schema form. Nested object and evaluator bodies use the same basic/Advanced layout. Required authored fields remain basic. Each panel and Advanced disclosure reports its problem paths.

Store tab selection in the dialog's disclosure session, alongside independent Advanced states and collection identities. Undo/redo remounts keep selection; closing/reopening resets it to Settings. Node identity fields and Connections stay outside the configuration tabs. Expression decisions and other node kinds retain one panel without tabs.

## Consequences

No dependency, contract shape, stored-data migration or runtime behavior changes. Held JSON text survives tab switches, and future field placement can change through metadata. Typed controls and optional JSON collection editing in part B can reuse the same mounted panels and parse-error channel. The owner reviews placement in the running product before merge.
