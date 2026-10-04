# ADR-0019 - Harness selection belongs to inference nodes

Date: 2026-10-04. Status: Accepted.

## Context

A loop-level harness duplicates inference-node configuration and implies that other node kinds
choose a harness too. Existing stored definitions, portable files, and device drafts contain
`settings.defaults.harness`. Zod encodes API responses, so response schemas must remain encodable.

## Decision

Canonical loop defaults contain only model and effort. Each inference node selects its harness;
omission defaults to Codex. The loop panel renders canonical settings; the inference dialog keeps
its Harness field. Decision strategies and structured repair retain their existing ports.

`LoopDefinitionCompatibilitySchema` is the shared input parser. It validates the optional,
deprecated legacy harness enum without injecting a loop harness default, preserves omitted node
harnesses until inheritance, fills only omitted inference values from the legacy value, removes
the legacy field, and validates the canonical result. Explicit node values win. Parsing is
non-mutating and idempotent. Invalid legacy values remain errors even with explicit node values.
Production supports only Codex; a test-only second identifier proves the shared inheritance rule.

Create, draft save, validate, portable import, and SQLite version reads use this parser. The domain
importer chooses an export envelope before validation so envelope errors retain their prefixed
paths and `LOOP_IMPORT_ERROR`. Every new export is canonical, including exports of old versions.
API response schemas have no one-way transforms. OpenAPI requests advertise compatibility input
while responses describe canonical output. Schema and format versions stay 1.

SQLite normalises only at read time. There is no migration or rewrite of stored JSON, version
ids, version numbers, or publication timestamps. Pinning, replay, and recovery keep their existing
version identity. Valid legacy device drafts are normalised when loaded; invalid unfinished
drafts remain editable with compatibility validation errors and a canonical settings projection.

Catalog warnings for a loop-default model use the inference default (`codex`).

## Consequences

New writes and exports use node-only harness configuration. Old files and stored versions remain
usable. A future harness must extend the production enum and adapter wiring; compatibility input
cannot enable unsupported harnesses. Read-time validation rejects corrupt stored definitions.
Rollback needs no database migration, since the previous contracts already default omitted loop
harnesses to Codex. Re-upgrading resolves retained legacy JSON again without rewriting history.
