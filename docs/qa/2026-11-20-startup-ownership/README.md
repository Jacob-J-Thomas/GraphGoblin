# #409 startup ownership refusal evidence

Base: `8181f350028e284529c76b51927f32890afcb68a`. Candidate: `8d5709fd867bc3ca3af98fba2eda37b09465c8c5`.

**Independent candidate behavior QA passes twice: 137/137 assertions and 14/14 scenarios per run.** The provider has exited and its last result envelope is verified. [evidence.json](evidence.json) retains separate signed-baseline, author and exact-candidate observations with sanitized per-assertion results and original SHA-256 bindings.

The independent baseline reproduces the defect with real API processes: 87 assertions, 76 pass and 11 fail. All 12 preconditions and 51 controls pass. Six issue assertions fail: the no-stack and one-line checks for a live API directory holder, an actual reset holder, and a shared-database holder. Five informational failures remain separately recorded. Holder survival, byte-preserved records, release and subsequent normal startup pass.

The first author runner was blocked by its Windows sandbox before implementation or tests. A later Sol source-only proposal made no execution claim. Coordinator tests record a genuine baseline red (5 fail, 1 pass, 13 skipped) and candidate suite (78 pass, 5 skipped). A fresh clean exact-source replay retains machine-readable exit 0 and matched log hashes for typecheck and lint.

The candidate checks real directory, shared-database and reset holders; preserved records and holder survival; release and subsequent normal start; malformed and unverifiable owners; stale-lock recovery; unrelated filesystem/bind failures; and escaped path controls. Both candidate native runs have zero failed assertions. Its reconstructed-baseline control has 104/137 passes and 33 refusal-shape failures. That control swaps the two runtime modules back to base source in a candidate build; it is separate from the signed baseline's 87-assertion native run above. Its source and candidate-module byte bindings match.

The [original baseline driver](drivers/qa-409-baseline.mjs) is reusable with Node 22 and a separately built checkout:

```text
node drivers/qa-409-baseline.mjs --checkout <built-checkout> --label <label> --out <private-results.json>
```

Run it from a private scratch copy: it creates disposable data next to itself. The driver only contacts listeners whose health check identifies its own child. Its recorded output remains private; this packet retains sanitized per-assertion observations and original SHA-256 bindings. Windows shell startup is covered; managed-launcher and POSIX behavior are not. Reset overlap is timing controlled and checked as a precondition.

The separately retained [candidate driver](drivers/qa-409-candidate.mjs) and [reconstruction helper](drivers/make-baseline.mjs) preserve the exact post-terminal bytes. The raw candidate JSON names its driver without embedding a hash; this packet records the retained driver's hash without asserting a stronger provenance. Candidate usage:

```text
node drivers/qa-409-candidate.mjs --checkout <built-checkout> --label <label> --out <private-results.json>
```

Candidate limits include no managed-launcher run, key-command holder, reclamation-guard holder, identity-permission failure, WMI timeout or database-hardlink scenario. Holder release uses owned shutdown or reset completion. Its reset overlap uses 3,000 disposable files and a liveness precondition; two earlier smoke calibrations are excluded.

The [manifest](evidence-manifest.json) binds every packet file except itself. This packet establishes no formal review, whole-repository gate result, hosted CI, merge approval or owner acceptance.
