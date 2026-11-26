# Validation pointer segments: #523 independent QA

Actual fresh Claude Opus5.5/xhigh QA passed all executed boundaries: **38 focused tests and 24 real HTTP cases**. Root accepted that scoped result with explicit qualifications under [FUP-048](raw/qa01/ROOT-QA-ADJUDICATION.json). The [original actor report](raw/qa01/QA-REPORT.claude.md.txt) is preserved, including its ambiguity and evidence-gap observations.

## Candidate and evidence

Worktree: `G:/ggq/gg-fu-validation-pointers-20261124/GraphGoblin`. Base/HEAD: `d2df8600c2c8574bec420947de686b936910b245`. Recorded formal candidate patch: `5e99ea4ff8b8651f09bdcb8c7996b54d475f656088f1e2537d03563d6beea2ef`; current working-tree diff: `73510b82fbfb85bbcd779f874965d9d7fb88e8b6bc6e3b60dbd97d22e6b5a842`. These are different recorded serializations, not interchangeable hashes. Index: `dad35a38e59bc5f44afcc143faedc81f9df1eec96d6d6247b218d2887a55a0b9`.

[PROVENANCE.json](PROVENANCE.json) records recomputed source/index/driver bindings, two receipts/four streams, the complete HTTP result and actual model-result/report/session metadata. Original provider journals/prompts and credentials are excluded. Curation ran no tests, HTTP requests, provider or model and edited no product source/index.

- Focused: 38/38 across five files: Ollama14, request-validation5, loop-definition6, validation-paths3 and thread-disconnect10.
- Real product HTTP: 21 invalid-path cases return400 `VALIDATION_FAILED`, malformed JSON returns400 `MALFORMED_BODY`, and valid input returns201 with defaults. Record/unknown keys cover slash, tilde, already escaped-looking text, empty, numeric-looking and Unicode segments.
- A separate controlled Fastify serializer app returns generic500 `RESPONSE_INVALID` without stack/cause/private test value/schema internals. This is not a product-route serialization witness.
- The ephemeral product fixture has Ollama disabled, fake harness and zero harness starts. No owner listener or provider turn is claimed. Both wrapper stderr streams are empty.

## Qualifications retained

The API already uses `/` for a document-root failure. It also uses `/` for an empty-named root member; this ambiguity predates the patch and is deliberately preserved. Therefore the actor's general RFC6901 statement must be read with this root-convention qualification.

The actor hypothesized a strict object nested under an empty root-record key could lose a pointer segment. No exposed production route was established. Root's bounded inspection found the two directly declared root-record bodies accept generic/unknown values rather than strict object values; this is not an exhaustive schema proof. The hypothetical route is neither reproduced nor fixed, and no further product correction was admitted.

The actor was not shown the malformed-body detail or complete driver. Root separately read the recorded exact body and confirmed `review-private-malformed` was not echoed; curation rechecked that same retained observation without replay. The driver hash matches before/after freezes. Full type/title/detail/content-type equality rests on executed driver assertions; ordered multi-error arrays were checked in-process only. Formal review1 remains [READY](raw/review01/REVIEW.md.txt), distinct from QA and the reserved final review.

Current-target CI, coverage/broad required gates in an admitted venue, publication-head verification and reserved final audit remain pending. Raw byte attributes and [MANIFEST.json](MANIFEST.json) preserve the original evidence. Prepared externally: root still owns repository copy, explicit staging, staged/committed blob and Windows checkout roundtrip, local commit and publication.
