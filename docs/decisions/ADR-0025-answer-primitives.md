# ADR-0025 - Noul, Choice and Score decision answers

Date: 2026-10-08. Status: **Accepted architecture; implementation verification pending**. Owner authorization and narrowed scope: [#97 plan](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/97#issuecomment-6049169776).

## Context

The classifier catalog advertises Noul, Choice and Score, but a decision could execute only Choice. The owner wants those three answer types available explicitly, with criteria and understandable routing. The owner also deferred the context design in #38 and session continuity in #33; neither is a prerequisite for primitive evaluation.

This extends ADR-0022's Choice-only answer set and ADR-0021's Choice-only HTTP execution. Their explicit evaluator, catalog ownership, error handling and current context boundaries remain in force.

## Decision

Keep answer type separate from evaluation kind. Choice supports expressions, classifiers and Codex; Noul supports strict boolean expressions, classifiers and Codex; Score supports classifiers only. Reject unsupported combinations before dispatch. The selected evaluator is invoked once, without fallback or a decision repair loop. Existing Choice transport retry behavior is retained; the new Noul/Score classifier operations disable automatic retries.

Choice keeps its existing configuration and canonical result shape. Stable option IDs identify provider keys and routes; labels and order are display choices. Existing two-option Choices remain Choice.

Noul declares true and false sides with stable ports, labels and criteria. A classifier returns the raw true probability; the authored truth threshold defaults to 0.5 and equality selects true. The confidence of the selected side is p(true) or 1-p(true), independently of the truth threshold. A separate minimum confidence rejects a value below the minimum; equality passes. Expressions require an actual boolean and have no confidence or probability. Codex requires an actual boolean and finite confidence in [0,1]; that confidence is informational. Any recorded reasoning is a bounded excerpt of up to 2,048 characters.

Score declares ordered nonblank anchors on the zero-based [0,N-1] rubric, with at least two anchors and the selected provider's actual limits. Preserve fractional values, rubric metadata, confidence and probabilities. Named route bands have stable IDs and cover the full range exactly, without gaps or overlap. Each includes its lower bound and excludes its upper bound, except that the last band includes the final endpoint. Do not round or rescale a score to select a route.

The classifier registry resolves the requested primitive from an enabled, configured catalog entry. Jev and compatible HTTP transports implement all three primitives. Typed validation rejects malformed answers and incompatible capabilities; errors and cancellation retain their existing safe boundaries.

A small engine evaluator accepts already prepared question/state or the full expression view. It does not render or select context. It returns validated raw evidence with an accepted or classifier-confidence-rejected status. A decision turns rejection into EVALUATION_RESULT_REJECTED without routing. The later exit consumer can record the rejected evidence as a nonmatch. Configuration, provider, malformed-response and cancellation failures never become false answers.

## Preserved context and conversion boundary

Decision questions still render against the full thread. The existing selector supplies trigger payload, selected role/content messages, selected variables and optional bare last-output value separately. Its defaults and serialization remain unchanged. No projected view, new selector, input preview, strict renderer, request artifact or session policy is added.

This change is additive within format 2: old Choice definitions, outputs and historical evidence retain their shape. The v1 converter continues to convert old decisions to Choice and refuses a replacement that attempts to reinterpret them as Noul or Score. #99 owns the later format-3 exit cutover; the owner instance is not updated between the two changes. New provider Noul requires explicit side criteria; old Jev/Codex exits lacking them will require resolved manifests during that cutover, rather than a nullable compatibility form.

## Verification and delivery

Verify criteria mapping, requested capabilities, Noul truth/confidence boundaries, strict booleans, stable Choice IDs, fractional Score routing and invalid bands/responses. Preserve current Choice request/output/error/cancellation behavior and context fixtures. Cover typed failures, exactly one selected evaluator, save/reload, undo, stable connections, keyboard use and inspector evidence. Record live provider checks separately from controlled fixtures.

Each child targets the feature branch and receives normal Codex Review and installed Opus adversarial and product QA. The owner reviews the completed local feature build after the full backup and conversion workflow. The final feature-to-main PR remains unmerged until that acceptance.
