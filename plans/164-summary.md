# Issue #164: owner approval summary

This summary comes first; the technical plan is the following comment. These are revised proposals, not implementation or data-upgrade approval. The original plan and peer drafts remain unchanged.

## What changes and what stays

The decision editor will first ask how the decision is made.

- Expression will show one JSONata snippet and the routes it can return. It will not show an answer type, criteria, provider settings, or thresholds.
- LLM will show freeform instructions, readable route names, model and effort choices, and selected context. It will return one declared route through a checked structured response. It will not require classifier criteria.
- Classifier will retain Choice, Noul and Score, with their criteria, rubrics and thresholds. Jev and compatible HTTP classifiers remain supported.

Route ids and connections remain stable when labels or display order change. Save, reload, undo and validation focus must preserve meaning. Only the selected evaluator runs; a failure does not silently invoke another one. LLM confidence is shown as information. Current context selection and model-default behavior remain.

The three issues will ship together through one integration branch and one offline upgrade. #165 removes configured template automation but keeps four independent starting points. #168 makes triggers easier to configure and webhooks more general. Retired automation is preserved in an offline archive; it is not silently unbound and allowed to run as ordinary work.

## Decisions the owner must make

### 1. Which exit design should format 4 use?

**#167 now recommends C at medium confidence, and I agree.** Decisions own completion policy, a dedicated Continue node owns the maximum-pass budget through repeat and exhausted connections, and terminal exits own outcome and returns. Under ADR-0020, parity gaps are build cost; keeping loop-back would leave the clutter and risk another cutover. Split the pass budget from a cumulative per-node safety cap, seeding both from old maxIterations during migration.

B moves policy into decisions and uses ordinary backward connections. Exits only say success, failure or exhausted and what to return. It is a simpler graph model, but ordinary edges do not count iterations. Graphs need explicit counting and exhaustion policy.

C is the middle option: decisions choose success, failure or continue; a visible continuation node owns the iteration budget; terminal exits declare outcome and returns. The continuation counts once, routes to an exhausted exit when the budget is spent, and leaves the prior output intact. It separates policy from the budget without treating any backward connection as an iteration.

**If C is the intended destination, choose it now. Moving to C after this format-4 cutover means a second stored-data cutover.** The decision portion can be approved before #167 is settled, but final exit contracts and the data upgrade cannot.

### 2. How should results be stored and shown?

**Recommend the common observation format.** It separates the selected route from the raw classifier answer and preserves old boolean answers honestly. The inspector becomes clearer, but scripts and mappings that read old answer fields need reviewed updates. Keeping current classifier output paths would require an alternative technical design before implementation.

### 3. Should LLM confidence stop an exit from matching?

**Recommend no confidence gate for new LLM exits.** Confidence remains visible but does not control routing or completion. Each existing gate must be deliberately removed or replaced with a supported rule, such as a classifier. Keeping those gates requires a revised proposal. Nothing is dropped automatically during conversion.

### 4. How many routes should be allowed?

**Recommend 2-64 routes for expressions and LLMs**, matching today's Choice limit. Score keeps its existing 1-64 bands. A single-route exception can be approved if useful. Raising the limit needs additional provider, graph and editor checks.

### 5. How much review should old LLM conversion require?

**Recommend reviewing every replacement instruction**, including old Choice decisions. The tool can propose text from the old question and criteria, but it cannot prove that a new prompt means the same thing. Automatic acceptance reduces review effort while accepting that uncertainty.

### 6. What happens to #152 and #118, which are parked?

**Recommend unparking #152 before cutover.** A new database must commit its schema and format marker together; otherwise an interrupted first start can leave it unusable. The alternative is explicit approval to include that bounded repair in #164. Without one of those authorizations, release is blocked.

**Recommend unparking #118 to retain hidden, disarmed versions when loops are deleted and repair existing orphan runs.** The alternative is to keep it parked and resolve every orphan found in the cutover inventory explicitly. Restoration needs real evidence of the old definition. If it cannot be recovered, the owner can approve archive-only retirement of the affected history. An unresolved orphan blocks the upgrade; the tool never invents a replacement version.

#127 can stay parked. Final local checks will bypass caching so stale results cannot stand in for fresh evidence. Its actual cache repair remains separate.

### 7. Which peer decisions must also be settled?

#165 needs approval of archive-only retirement and the exact evidence to preserve. #168 needs its repeated-body policy and review of old filters moved into graph decisions. Recommend allowing repeated new webhook bodies while preserving every existing permanent claim. Those are peer issue decisions, not approvals made by this plan.

SQL numbering is aligned: 0012 retires template storage, 0013 changes trigger storage, and 0014 holds #164 metadata only if needed. These belong to one final migration set. No intermediate integration build upgrades the owner's store.

## Effort and confidence

With the added storage and history work, estimate #164 at 9-14 worker days for A, 11-18 for B, or 12-19 for C. This includes its shared converter, review and QA work. It excludes #165 and #168 implementation, separately authorized #118 and #152 work, and owner or provider delays. Decision behavior has high confidence; exit selection and real-data conversion have medium confidence until the choices and copy inventory are complete.

The 40 passing #167 research scenarios establish today's engine differences. They do not establish that the new continuation node has already been implemented or tested.

## Child PRs in integration order

Every child targets feat/format-4-integration. Only the selected exit branch is included. Each child receives independent review and relevant checks; the complete integration remains unmerged until owner product acceptance.

1. #164 F freezes format-3 sources and proves earlier conversion behavior unchanged.
2. #152, or an explicitly authorized #164 repair, makes fresh initialization atomic.
3. #118 preserves deleted-loop provenance if unparked; otherwise exact orphan resolutions remain a final cutover gate.
4. #164 S adds the format constant, readiness checks, streaming inventory and snapshot baseline.
5. #165 A moves ordinary run paging out of template storage.
6. #165 B disconnects private authority and makes loading draft-only.
7. #165 C1 deletes implementation and review GitHub services.
8. #165 C2 deletes QA GitHub services.
9. #165 D removes settings, instances, APIs, contracts and store access, with reduced manifests.
10. #165 E keeps only independent starting-point assets and removes origin-specific product behavior.
11. #165 F deletes examples/aidlc and active references.
12. #164 D1 introduces the new decision contracts, runtime, adapters and admission.
13. #164 D2 completes decision authoring, inspection, connections and undo.
14. If A is selected, #164 E-A implements fixed boolean predicates and retained loop-back.
15. If B is selected, #164 E-B1 implements terminal exits and ordinary-edge counting policy.
16. If B is selected, #164 E-B2 adds reviewed graph conversion and replay entry mapping.
17. If C is selected, #164 E-C1 adds continuation, terminal exits and atomic counting.
18. If C is selected, #164 E-C2 adds reviewed policy and budget graph conversion.
19. If C is selected, #164 E-C3 completes controller authoring, inspection and replay QA.
20. #164 L isolates upgrade code and loads it lazily while preserving offline draft conversion.
21. #168 T1 puts trigger type first and makes presets optional.
22. #168 T2 adds editable route checks, output restoration and quiet exits.
23. #168 T3 switches current trigger contracts and consumers to type.
24. #168 T4 adds general bodies, metadata and durable acknowledgment.
25. #168 T5 implements the approved repeat and business-key policies.
26. #168 T6 removes trigger filters and finalizes graph conversion and poll evidence.
27. #164 C1 composes all conversion rules, manifest, orphan resolutions and copy dry-run.
28. #164 C-device completes lossless device conversion and token reconciliation.
29. #164 C2 finalizes SQL, snapshots, atomic apply, audit, restore and real-copy rehearsal.

#168's shared cutover child is this last #164 child, not a second cutover. Large children are split into coherent pieces when the actual file count requires it.

## Main risks

A new LLM prompt can change future judgments even after review. Static checks cannot prove every external script or indirect result reader, so unresolved cases must refuse conversion. Old automation can contain uncertain external effects; archiving evidence does not undo them. Missing provenance, unfinished returns or pending work can block the real-store upgrade.

Moving old filters downstream creates visible quiet runs where intake was previously ignored. The reviewed graph must restore the original input before work continues and preserve delivery claims. C adds engine work and does not remove conversion review. Device drafts live outside the server database and must be preserved separately.

## What the owner can review, and when

After common decision authoring is ready, the owner can try all three evaluator forms, edit labels and routes, save and reopen, undo changes, follow errors, and inspect results on an isolated build. After #167 is decided, the owner can review the chosen exit model, final-iteration success, exhausted returns and recovery. Each trigger stage adds its own visible review checkpoint.

Before final merge, the owner receives a readable dry-run showing exact changes, refusals, archives and resolutions. The upgrade is rehearsed on independently supplied, consistent copies, including every retained run and snapshot, device drafts and a full restore. A separate safe runnable copy demonstrates the integrated product. The original instance, port 4747 and ~/.graphgoblin remain untouched during this work. The actual manifest and later installation require separate owner decisions.
