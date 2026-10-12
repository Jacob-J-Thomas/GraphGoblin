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

**#167 recommends option 3 (variant C) at medium confidence, and I agree.** Decisions choose completion policy, a dedicated Continue node owns maxPasses through repeat and exhausted connections, and terminal exits own outcome and returns. The cumulative per-node safety cap remains separate. Both limits are seeded from old maxIterations during migration.

Option 1 (variant A) keeps loop-back and simplifies its predicates. Option 2 (variant B) uses decisions and ordinary backward connections, with explicit counting and exhaustion policy. Option 3 makes the budget visible while leaving policy in decisions and the prior output intact.

Under ADR-0020, parity gaps are build cost. Keeping loop-back leaves the clutter concern unresolved. **Choosing option 3 after this format-4 cutover would require a second stored-data cutover.** The proposed limit of one Continue node per loop is for owner review, not a settled rule. Decisions can be approved first, but final exit contracts and cutover wait for the exit choice.

### 2. Should LLM confidence stop an exit from matching?

**Recommend no confidence gate for new LLM exits.** Confidence stays visible but does not control completion. Review each existing gate for deliberate removal or a supported replacement, such as a classifier. Keeping gates requires a revised proposal; conversion never drops them automatically.

### 3. How much review should old LLM prompts receive?

**Recommend reviewing every replacement instruction**, including old Choice decisions. Proposed text from old questions and criteria cannot prove equivalent meaning. Automatic acceptance reduces review effort while accepting that uncertainty.

### 4. What happens to parked #152 and #118?

**Recommend unparking #152 before cutover**, or explicitly approving its bounded repair in #164. Schema and marker must commit together so an interrupted first start cannot leave an unusable database. Without one of those authorizations, release is blocked.

**Recommend unparking #118 for hidden, disarmed deleted-loop provenance and orphan repair.** Alternatively, keep it parked and resolve every inventoried orphan explicitly. Restoration requires evidence of the actual old definition; otherwise approve exact archive-only retirement. Unresolved orphans block apply, and no replacement version is invented.

#127 can stay parked while final local checks bypass caching. Its cache repair remains separate.

## Coordination prerequisites

#165 needs approval of archive-only retirement and preserved evidence. #168 needs its repeated-body policy and reviewed filter conversions. Recommend allowing new repeated bodies while preserving existing permanent claims; these remain peer approvals.

All three plans use the joint pending-state rule in technical section 4. Retired template deliveries cannot bypass it. SQL remains one set: 0012 for template retirement, 0013 for triggers, and 0014 for #164 metadata only if needed.

## Effort and confidence

With the added storage and history work, estimate #164 at 9-14 worker days for A, 11-18 for B, or 12-19 for C. This includes its shared converter, review and QA work. It excludes #165 and #168 implementation, separately authorized #118 and #152 work, and owner or provider delays. Decision behavior has high confidence; exit selection and real-data conversion have medium confidence until the choices and copy inventory are complete.

For option 3, the three-issue programme totals about 34-51 worker days: #164 takes 12-19, #165 takes 6-9, and #168 takes 16-23. This excludes separately authorized #118/#152 work and owner or provider delays. The original 3-5-day estimate covered #164 semantics; the programme now includes three issues, one safe data cutover, restoration evidence, independent review and browser QA.

The 40 #167 scenarios establish current engine differences, not a tested Continue implementation.

## Child PRs in integration order

Every child targets feat/format-4-integration. Only the selected exit branch is included. Each child receives independent review and relevant checks; the complete integration remains unmerged until owner product acceptance.

- Step 01: #164 F freezes format-3 sources and proves earlier conversion behavior unchanged.
- Step 02: #152, or an explicitly authorized #164 repair, makes fresh initialization atomic.
- Step 03: #118 preserves deleted-loop provenance if unparked; otherwise exact orphan resolutions remain a final cutover gate.
- Step 04: #164 S adds the format constant, readiness checks, owner-sized bounded-memory inventory and apply, and the snapshot baseline.
- Step 05: #165 A moves ordinary run paging out of template storage.
- Step 06: #165 B disconnects private authority and makes loading draft-only.
- Step 07: #165 C1 deletes implementation and review GitHub services.
- Step 08: #165 C2 deletes QA GitHub services.
- Step 09: #165 D removes settings, instances, APIs, contracts and store access, with reduced manifests.
- Step 10: #165 E keeps only independent starting-point assets and removes origin-specific product behavior.
- Step 11: #165 F deletes examples/aidlc and active references.
- Step 12: #164 D1 introduces the new decision contracts, runtime, adapters and admission.
- Step 13: #164 D2 completes decision authoring, inspection, connections and undo.
- Step 14: If A is selected, #164 E-A implements fixed boolean predicates and retained loop-back.
- Step 15: If B is selected, #164 E-B1 implements terminal exits and ordinary-edge counting policy.
- Step 16: If B is selected, #164 E-B2 adds reviewed graph conversion and replay entry mapping.
- Step 17: If C is selected, #164 E-C1 adds continuation, terminal exits and atomic counting.
- Step 18: If C is selected, #164 E-C2 adds reviewed policy and budget graph conversion.
- Step 19: If C is selected, #164 E-C3 completes controller authoring, inspection and replay QA.
- Step 20: #168 T1 puts trigger type first and makes presets optional.
- Step 21: #168 T2 adds editable route checks, output restoration and quiet exits.
- Step 22: #168 T3 switches current trigger contracts and consumers to type.
- Step 23: #168 T4 adds general bodies, metadata and durable acknowledgment.
- Step 24: #168 T5 implements the approved repeat and business-key policies.
- Step 25: #168 T6 removes trigger filters and finalizes graph conversion and poll evidence.
- Step 26: #164 C1 composes all conversion rules, manifest, orphan resolutions and copy dry-run.
- Step 27: #164 C-device completes lossless device conversion and token reconciliation.
- Step 28: #164 C2 finalizes SQL, snapshots, atomic apply, audit, restore and real-copy rehearsal.

#165 and #168 cite these same step ids. #168 steps 20-25 follow the selected exit work without exception. Its shared cutover is step 28, not another cutover. Any split updates both sequences.

## Main risks

A new LLM prompt can change future judgments even after review. Static checks cannot prove every external script or indirect result reader, so unresolved cases must refuse conversion. Old automation can contain uncertain external effects; archiving evidence does not undo them. Missing provenance, unfinished returns or pending work can block the real-store upgrade.

Moving old filters downstream creates visible quiet runs where intake was previously ignored. The reviewed graph must restore the original input before work continues and preserve delivery claims. C adds engine work and does not remove conversion review. Device drafts live outside the server database and must be preserved separately.

## What the owner can review, and when

After common decision authoring is ready, the owner can try all three evaluator forms, edit labels and routes, save and reopen, undo changes, follow errors, and inspect results on an isolated build. After #167 is decided, the owner can review the chosen exit model, final-iteration success, exhausted returns and recovery. Each trigger stage adds its own visible review checkpoint.

Before final merge, the owner receives a readable dry-run showing exact changes, refusals, archives and resolutions. The upgrade is rehearsed on independently supplied, consistent copies, including every retained run and snapshot, device drafts and a full restore. A separate safe runnable copy demonstrates the integrated product. The original instance, port 4747 and ~/.graphgoblin remain untouched during this work. The actual manifest and later installation require separate owner decisions.
