# D209 — Reconcile authored-failure recovery instructions with the merged draft-run contract

Integration of #486 source `4d982162ca60e885d5af22f66076383a048215db` with main `a60843a9050b3a203726db84f6abf1f45b8bc694` exposed two documentation instructions that imply publishing is always required before a corrected fresh run. Main already carries D197's reviewed distinction: the UI runs published versions, while the API can start a fresh run from an explicit editable draft using its `versionId` and `allowDraft: true`. Preserve that contract in the combined documentation. Resume and Replay still use the failed run's pinned definition; this is not a runtime or recovery-policy change.

Under the owner's delegated blocker authority, replace only these two #486 sentences during integration:

- CHANGELOG: replace `Correct the reported field and publish a new version before starting a new run.` with: `Correct the reported field and start a fresh run from the corrected definition. The UI's **New run** uses a published version, so publish the correction before starting it there; to test an unpublished saved draft through the API, use POST /loops/{id}/runs with the editable draft's versionId and allowDraft: true.` The endpoint and property names retain normal Markdown code formatting in the file.
- Guide 03's authored-failure paragraph: replace `Correct the field, publish the corrected version and start a new run.` with the same qualification, beginning `Correct the field and start a fresh run from the corrected definition.`

Keep all other #486 sentences and the incoming D197 recovery paragraphs. Protect the original author and QA checkouts and frozen source4d. The actual combined source inventory is **54 unique changed paths**, not the previously summarized 53: source633 changed 52 paths, and D204 adds the newly modified `failure-publication.ts` path and the new `inference-workspace.test.ts` path to that set. Require exact source4d blobs/modes for the 50 noncombined paths and explicit hunk/semantic proofs for the four combined documentation files. Additive evidence policies and every inherited archive blob remain separately protected. Leave the owner's stale local main and dirty primary checkout untouched.

## Verification and review

These two sentences are new integration edits. Retain a bounded independent actual-Claude review of this documentation delta after the announced quota reset, with source-linked small excerpts rather than full wide-guide reads. This is a targeted correction check, not a third general scan or an attempt to reset the cap; the fresh independent Astra MAX general scan 3 remains reserved for the coherent final head after required checks. Also obtain separate static documentation QA against the actual API/UI/pinned-definition contract and preserve source/target proof, ordinary CI, numerical coverage, canonical native evidence and ordinary signed merge. No runtime change, broad retest claim, owner acceptance or deployment is inferred from this decision.

## Alternatives considered

- Preserve the two original sentences verbatim during integration: rejected because they would reintroduce a universal-publication instruction alongside the already corrected API-draft guidance.
- Remove the draft capability or alter runtime recovery behavior to match the wording: rejected; the current behavior is intentional and covered by D197. This is a documentation reconciliation.
- Use a vague instruction such as "try again": rejected because it can confuse a fresh run with Resume or Replay on the unchanged pinned definition.
- Waive opposite-family review because the edit is small or main already describes the behavior: rejected. Keep the bounded Claude correction review, independent static QA and final exact-head audit.
- Begin intent 5 while the Claude review is unavailable: rejected under D207; finish the admitted intent 4 engineering first. Continue all nonblocked publication, integration and verification work in this chat.

The final decision catalogue must record the actual review, QA, CI and merge outcomes. This entry selects the concrete correction and its gates; it does not claim those gates have passed.
