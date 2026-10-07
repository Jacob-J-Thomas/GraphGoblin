# ADR-0022 - Explicit decision evaluation and an offline format cutover

Date: 2026-10-07. Status: **Accepted architecture; implementation and product review pending**. Owner approval: [#98 plan](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/98#issuecomment-6029669439).

## Context

Decision strategy chains conflate an authored evaluation method with recovery from another method. The owner requested expression, classifier and LLM choices that never implicitly substitute for each other. The product is unreleased, so ADR-0020 favors a clean schema and one-off conversion over a legacy executor.

This partially supersedes ADR-0018's advisory-only model validation, ADR-0019's flat model/effort defaults and inference-only harness-selection statement, and ADR-0021's retained decision fallback semantics. Their catalog ownership and provider-boundary decisions remain in force. Exit predicate configuration remains unchanged pending #99.

## Decision

A decision has an `answer` and an `evaluation`. Initially only `answer.type: choice` is supported. Every option has a stable port/provider ID, a unique readable label and authored criteria. The evaluation is a strict union of expression, classifier or LLM. It accepts only the fields applicable to that kind.

Expressions return a declared string option ID with no implicit stringification. Classifiers name an explicit Choice-capable catalog entry. LLM evaluation names an implemented harness (Codex initially) and explicit model/effort inheritance or selection. Only classifiers have `minConfidence`; rejection fails with a typed error. LLM confidence must be finite and in range, is informational, and is not treated as a calibrated probability. There is no evaluator fallback or decision schema-repair loop.

Loop, owner and process defaults share `{byHarness:{codex:{model?,effort?}}}`. Resolution stays in the chosen harness, in node/loop/owner/process order. Catalog membership and effective effort are enforced uniformly. Invalid explicit values are errors, not an invitation to use a lower-precedence default. Disabled or unconfigured selections remain diagnosable in drafts and block publication. Runtime rechecks configuration; in-flight provider requests retain their starting snapshot. Process configuration uses `GG_DEFAULTS`; old default environment variables produce a typed upgrade error.

Canonical output is `{answer:{type:'choice',optionId,confidence,probabilities},portId,provenance:{kind,provider,classifierId,model,effort}}`. All keys are present. Inapplicable and unknown historical facts are null. Fresh events undergo strict per-kind emission validation before append. An event-only diagnostics list of at most three entries preserves pre-cutover skip facts introduced by #103. Raw converted records are retained in the offline upgrade audit so unrepresentable historical alternatives or missing values are not fabricated or lost.

## Offline upgrade

Definitions and export envelopes move to format 2. Before schema migrations, recovery or triggers, startup distinguishes a genuinely fresh database from an existing unconverted store. Existing old data and incomplete upgrade journals are refused. A separate offline tool inventories the entire stopped store, accepts an explicit resolution manifest, performs ordered structural and semantic changes transactionally, validates the result and records its audit. Complete backup and tested rollback precede conversion. Architecture approval does not authorize upgrading a live instance or approve its actual resolution manifest.

Refuse every nonterminal run. Preserve failed-run history; any conversion that makes a failed run nonresumable requires an individual accepted disposition and replay guidance. Inventory definitions, all versions, patches, initial threads, snapshots, drafts and exports. Mixed chains, uncertain expression coercion and changed authored references require explicit resolution; never select the first old strategy implicitly. Detect references conservatively, including whole-value, dynamic, wildcard and opaque uses. Saved exports use the same conversion rules. Committed examples are adapted deliberately and tested; old examples remain converter test inputs.

A shared pure synchronous converter handles device drafts. Convertible drafts survive; ambiguous raw drafts use the existing set-aside/export flow. Normal runtime imports and execution accept only the new schema. Retain the converter through this cutover release and retire it no earlier than the next incompatible release, with upgrade notice.

## Boundaries and verification

Today's question template and separately selected provider context are preserved. #38 remains the human context-design session; #33 remains an unapproved possible continuity implementation after that session. This ADR authorizes no session policy, visit cap, prompt-delivery recovery protocol, Noul/Score primitive, exit-kind change or new harness.

Verify exactly-one-evaluator execution, typed failure/cancellation behavior, inherited model admission, many-option connections, historical replay and conversion refusal, and save/reload/undo/keyboard behavior. Preserve the repository coverage, layering, licensing and generated-reference gates. Child PRs receive Codex and independent Opus review on the implemented head, followed by the required owner product review. No live-data conversion follows automatically from merge.
