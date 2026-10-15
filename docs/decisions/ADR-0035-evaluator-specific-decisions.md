# ADR-0035: Evaluator-specific decisions and definition format 4

Status: Accepted. Implements #164 step 12 (D1), with the owner's informational-only LLM confidence amendment.

## Context

The independent answer/evaluation matrix in ADR-0022 and ADR-0025 made expressions and LLMs carry classifier criteria and inactive settings. Decision authoring and runtime requests should describe the selected evaluator directly.

This supersedes ADR-0022's decision shape and result, ADR-0025's cross-evaluator answer matrix, and ADR-0026's shared decision/exit configuration. Their historical text remains intact. Classifier mathematics, provider transport, typed failures, context exposure and cancellation boundaries remain in force.

## Decision

`DecisionConfig` is a strict union on `kind`:

- `expression` has `jsonata` and `routes`. The one JSONata snippet must return a scalar string equal to a declared route ID. Undefined, non-string and undeclared results are typed failures. Existing expression size and execution limits apply.
- `llm` has Liquid `instructions`, `routes`, `harness: "codex"`, required inherit-or-explicit `model` and `effort`, and provider `context`. Rendered instructions, route declarations, prepared context and resolved selections go to one checked structured completion. Exactly `route`, `confidence` and `reasoning` are required, with no additional properties. Route is constrained to submitted IDs; confidence must be finite in [0,1]. Confidence is informational and has no decision gate. Retain at most 2,048 reasoning characters. There is no repair or fallback.
- `classifier` has explicit catalog `model`, Liquid `question`, `answer`, `context`, optional `minConfidence`, Noul-only optional `truthThreshold`, and `recordAlternatives`. Choice keeps options with IDs, labels and criteria; Noul keeps two authored sides; Score keeps ordered anchors and contiguous named bands. Provider requests, fractions and transport retry policies are unchanged.

Expression and LLM routes contain only `{id, label}`. Declare 2–64 routes. IDs are slugs of at most 64 characters (a letter followed by letters, digits, underscores or hyphens), unique, and cannot be `in`. Trimmed labels are nonblank, unique and at most 120 characters. Classifier ports derive from options, sides or bands. Noul equality at the truth threshold selects true, with confidence from the chosen side. Score routing never rounds and preserves the final inclusive endpoint.

Outputs contain `{portId, provenance, observation}`. Observations are `route` (`routeId`, nullable confidence and reasoning), `boolean` (`holds`, nullable confidence and reasoning), or `classifier` (typed `answer`). Fresh decisions emit route or classifier observations; boolean observations belong to predicate evaluation. Fresh provenance records resolved facts; unknown or inapplicable historical facts remain null. `decision.made` adds at most three factual diagnostics; fresh decisions have none. Output-reference authors must move from `.answer` to `.observation.answer` for classifiers and `.observation.routeId` for routes.

Exit predicates temporarily use a separate minimal `{predicate, match}` contract. Expressions and Codex return booleans; classifiers retain comparisons over their primitives. This preserves existing exit criteria, ordering, returns and loop-back behaviour until step 14 removes exit criteria. It does not introduce decision-gate exits, pass limits or a Continue node. The optional reported-confidence match remains exit-only.

All authoring admission paths use the same strict contracts and source paths. The editor exposes applicable branch fields and can save every kind. Existing same-branch stable route edits, held text and issue focus remain. Kind-change loss previews, edge ownership and undo polish belong to D2.

## Stored data and delivery

Current definitions and exports are format 4; thread format stays 1. The format-4 baseline is `0012_retire_template_instances`, set by #165 step 09. Format-3 markers and old exports are refused with the existing upgrade-required errors. Frozen V3 parsers and v1/v2-to-v3 stage tests remain format 3. No temporary 3-to-4 stage is added: the integrated steps 26–28 provide conversion and the final baseline. Applying the unfinished historical conversion cannot stamp V3 definitions as current.

Consumers must update removed matrix exports and nested evaluator fields, regenerate clients, and rebuild backend and web together. There is no tolerant old-format runtime path.
