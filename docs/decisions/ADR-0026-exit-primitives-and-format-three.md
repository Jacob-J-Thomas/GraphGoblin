# ADR-0026: Exit predicates use shared answer primitives

Status: Accepted (owner directed the narrowed #99 implementation on 2026-10-08)

## Context

Decisions gained explicit evaluators in ADR-0022 and Noul, Choice and Score in ADR-0025. Exits still used a separate expression/Jev/Codex boolean path. That duplicated provider semantics and prevented a catalog classifier or a scored rubric from deciding completion. The owner deferred #38 context design and #33 session continuity; neither is a prerequisite for this change.

## Decision

A predicate declares `answer`, `evaluation` and `match`. Expression evaluation supports strict boolean Noul; classifiers support Noul, Choice and Score according to catalog capability; Codex LLM supports Noul and Choice. Provider Noul declares explicit true/false labels and criteria. Expression Noul needs only its type. Choice matches a nonempty set of stable option IDs. Score compares its unrounded rubric-index value with an explicit finite `lt`, `lte`, `eq`, `gte` or `gt` threshold. Exit answers have no routing ports or Score bands.

The engine shares the context-free primitive evaluator with decisions. Callers prepare inputs. Exit questions continue rendering against the full thread, and provider state stays `{trigger, vars, lastOutput, lastMessage, iteration}` with the trigger payload, all variables, bare last output or null, and last message content or null. Exits gain no context selector, preview, session policy or renderer changes.

The answer, confidence acceptance and matching rule are separate facts. A valid classifier answer below its configured confidence minimum is retained but cannot match. An optional LLM-only `match.minReportedConfidence` gate preserves the old exit behavior and is explicitly self-reported. Equality passes. Either failed gate prevents matching even when the requested Noul value is false. Without a gate, accepted false may match false. Malformed responses, unavailable configuration, provider errors and cancellation retain failure semantics; they never become ordinary nonmatches or fallback calls.

Criteria remain ordered: the first match determines the outcome and later criteria are skipped. Evaluation precedes the implicit iteration ceiling, so a final-iteration match may complete and a provider failure may still fail there. Explicit duration/iteration criteria keep their authored position. A continuation increments iteration once. Outcomes, return mappings/channels, subloop returns and the single optional loop-back remain unchanged. Exit evaluation writes evidence, not decision outputs.

## Offline cutover

Current definitions/exports and the fresh-store/boot compatibility stamp become format 3 together. Thread schema 1 and session rows do not change. The retained v1-to-v2 converter uses a mechanically captured, self-contained frozen v2 schema/type snapshot; current imports compose that stage with the v2-to-v3 exit converter. Runtime parsing accepts only format 3 and has no legacy exit execution path.

Old provider predicates require a manifest entry supplying explicit true/false criteria. The converter cannot reconstruct them from a historical boolean judgment. A syntactically proven boolean expression converts directly; ambiguous/coercing expressions require a reviewed boolean rewrite. Old Jev truth threshold 0.5, configured confidence minimum and Codex inherited defaults/report-confidence gate are preserved. New criteria and stricter malformed-response handling can change native judgments; conversion does not claim otherwise.

Inventory includes drafts, every version, hidden/deleted history and execution records. All nonterminal runs refuse conversion. Affected failed runs and subloop parents require explicit replay-only dispositions. Unresolved or stale manifests refuse atomically. Original records and approved resolutions remain in the audit; missing historical facts stay null. Complete stopped-data backup, hash verification, rehearsal and restoration precede an installed update. Restoring that backup discards later edits and runs.

## Consequences

Classifier selection, capability admission and safe provenance apply consistently to exits and decisions. The inspector can distinguish raw answer, rejected confidence and a nonmatching rule. Existing exports, device drafts and stored events need the explicit offline conversion. The owner reviews the integrated feature build before the feature PR merges into main.
