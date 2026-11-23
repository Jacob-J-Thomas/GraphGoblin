# D209 independent static documentation QA

**PASS for the bounded D209 documentation correction and narrow D211 policy check at `29e165e14fdda138300ba2a34585ddd47268b475`.** The committed wording agrees with the inspected API/UI/pinned-definition contract. No discrepancy was found within this static scope. No new runtime test, build, browser, provider or general review was performed.

Exact integrated tree: `d50fb576f1ef4498cb30e52521198575d6d0ebd4`. Parents: first merge `5d740d50b82c5a6f1a8fbb7854fd34c8dca6803d` and main `a60843a9050b3a203726db84f6abf1f45b8bc694`. Frozen source4d and publication `edf7f70560be12153b3ef581f582eb95143e4516` are ancestors. The worktree is clean; its index hash matches the final root integration receipt. All checks read immutable Git objects or existing evidence; no source/index write occurred.

## Committed wording and contract

Both approved replacement spans occur exactly once in their intended #486 paragraphs: CHANGELOG and guide03. Both old universal-publication instructions are absent from those documents. The rest of each authored-failure paragraph is preserved.

| Statement | Independently verified source at a608 and retained at the final head |
| --- | --- |
| Ordinary API start uses a published version | REST defaults omitted `versionId` to `loop.currentVersionId`; that pointer is set on publication. Engine fallback selects latest published. `allowDraft: true` alone does not select the editable draft. |
| Explicit saved-draft API start remains available | REST forwards explicit `versionId` and `allowDraft: true`; engine permits the editable draft, validates it and freezes a separate immutable snapshot. A direct start using an old snapshot ID is refused. |
| UI **New run** uses a published version | UI filters versions to `published`, selects the current/chosen published version and sends its ID without `allowDraft`. It does not automatically publish or silently start an editable draft. The wording does not promise that selecting an older published version runs the newest one. |
| Editing does not change Resume/Replay pins | Resume changes lifecycle fields and requeues the existing run; execution reads `run.versionId`. Replay reads the source version and forks with `source.versionId` and `source.pinned`. Neither applies an edited definition. |

Sixteen bounded source excerpts were independently extracted from actual a608 Git objects, then checked against the final commit. The locator packet was not substituted for source evidence. See [static-source-excerpts.json](./static-source-excerpts.json), [assertions.json](./assertions.json) and [final-static-verification.json](./final-static-verification.json).

## Exact integration scope

- All **50 noncombined** paths in source4d's54-path change set retain its exact Git blob and mode. [Independent proof](./frozen-source-50-proof.json).
- For the **four combined documents**—CHANGELOG, docs04, docs06 and guide03—an independent line-diff calculation isolated the source insertion hunks. After applying only the two approved D209 replacements, each expected insertion appears once in the committed document. **Subtracting those insertions reconstructs incoming a608 byte-for-byte in all four documents.** This proves preservation of other incoming text and source insertions rather than relying only on a root receipt's boolean. [Independent subtraction proof](./independent-combined-doc-proof.json).
- All **six incoming D197 recovery paragraphs** across docs04, guide03 and guide07 remain present once, with unchanged normalized text. Publication qualification, explicit editable-draft ability, trigger-publication consequences, external-prerequisite repair and the original recovery pins remain intact. [Paragraph mapping](./incoming-D197-paragraphs.json).
- The six root combined-file expected hashes—four documents plus the additive `.gitattributes`/`.prettierignore` policies—also match the committed files. D209 adds no runtime source edit; inherited feature/main changes retain their separate provenance.

## D211 narrow static check

The final committed `.gitattributes` contains exactly the selected rule:

```gitattributes
docs/qa/2026-11-21-i4-486-authored-failures/historical-target-02a/integration/conflict/0/worktree-original conflict-marker-size=32
```

Read-only `git check-attr --source=<final-head>` reports32 for that exact artifact and `unspecified` for the inspected ordinary API/engine source paths. The historical artifact remains **187,030 bytes**, SHA-256 `98047f736843b54ebcf2918f8369be0b7383a7959c8f3a5394000bc577db3d8b`. All **1,534 #486 archive blob/mode entries** match publicationedf exactly.

The retained main integration receipt records the full command `git diff --cached --check`, **no path exclusions**, exit0 and empty stdout/stderr. Those stream hashes were verified. Its following `git write-tree` output matches the final committed treed50. This is verification of the prior staged-tree check; an empty clean-index check was not run and misrepresented as rechecking the archive. [D211 check](./D211-static-check.json).

## Evidence classes and limits

**New here:** static source/text/blob/mode/attribute and evidence-binding checks only. **Prior runtime evidence:** D197 at `08633913a58cb42c32b4a18c72cd4aed67cfefa6`, with88/88 manifest members verified and19 actual passing named cases (15 engine,4 API). The relevant maintained test files, REST route, freeze helper and UI launcher blobs match a608. That historical public-method/Fastify-injection evidence is not relabelled as new D209 execution, native process restart or browser interaction. [Prior evidence](./prior-D197-evidence.json).

No runtime/build/provider command was issued by this QA. Root's scoped formatting/install/check activity remains separate. No new actual UI/API behavior, full numerical coverage, current-target CI, native acceptance, owner QA, merge or deployment result is claimed. The pending actual-Claude bounded documentation/policy review and reserved Astra general scan3 remain distinct gates; this static pass consumes neither.

Decision209 SHA: `a85217e83b50daa3e7c3c0ceb97e51cebfd5703dfeaed0aa8bd9b5d5e5d82d7e`. Complete input hashes and immutable commit bindings accompany this report. Original author/QA/publication/selection packets were not edited.
