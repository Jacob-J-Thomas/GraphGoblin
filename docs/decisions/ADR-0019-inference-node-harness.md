# ADR-0019 - Harness is chosen on inference nodes only

Date: 2026-10-04. Status: Accepted.

## Context

Loop-level harness settings duplicate inference-node configuration and imply that other node
kinds select a harness. After approving the initial plan, the owner clarified at 18:09Z:
"I'm not really worried about maintaining v1 compatibility. I'd rather ensure the code is as
well written, and maintainable as possible" and "There is no reason to support legacy."
The repository-wide direction is recorded in [ADR-0020](ADR-0020-clean-design-until-release.md).

## Decision

Loop defaults contain model and effort only. Each inference node chooses `config.harness`,
defaulting to Codex. The loop settings form has no Harness control; the inference dialog keeps
it. Decision strategies and structured repair retain their existing ports.

Use only canonical schemas for API bodies and portable import/export. Reject
`settings.defaults.harness` as an unknown field with its path. Recognize export envelopes by
their keys before validation, preserving envelope error paths under `LOOP_IMPORT_ERROR`.
Schema and export format versions remain 1.

Migration `0005_inference_node_harness` removes the obsolete field from stored version JSON
once at startup. Old stored inference nodes already carry explicit harnesses from the previous
parser, so no node changes are necessary. Version identity, numbering, timestamps, run pins,
replay, and recovery remain intact. There is no read-time normalization or compatibility layer.

Device drafts that no longer parse against the canonical schema are discarded on load,
including set-aside copies. Older exported files and API clients must remove the field, as
described in the CHANGELOG upgrade notes.

## Consequences

The contract and its consumers have one maintainable shape. The one-off migration changes
stored version definitions without changing their execution semantics. Imported files require
an explicit edit, and obsolete unsynced device edits are lost. Loop-default model catalog
warnings check Codex until a second harness requires a broader check.
