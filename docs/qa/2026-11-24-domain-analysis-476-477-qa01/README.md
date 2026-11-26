# Rename counts and syntax diagnostics: #476 / #477

Actual independent Claude Opus5.5/xhigh QA returned **PASS** for both issues: 116 domain tests, 34 store/component tests and 2 public API-injection scenarios passed. Formal review1 was **READY**. Raw reports retain their original qualifications and visibility limits.

## Candidate and actors

Base/HEAD: `d2df8600c2c8574bec420947de686b936910b245`. Complete ten-path patch: `dd0f9f6b5df075bbcbc914a1982968e6aeb9677b8c456d21bb7f804841766345`. Index: `68a4937db310819d83d24e28b9c3c63d76b2d3b8b289b71705d71ba15f2c277b`.

The [actual QA report](raw/qa01/QA-REPORT.claude.md.txt), [exit](raw/qa01/CLAUDE-EXIT.json) and [launch](raw/qa01/CLAUDE-LAUNCH.json) establish a fresh ordinaryMax session, required model/xhigh setting, three exact commands, no permission denials or overage, and unchanged source. [PROVENANCE.json](PROVENANCE.json) records recomputation of the model-result/report binding, 3 receipts and 6 streams, current ten-file/patch/index binding, driver and wrapper hashes. Curation ran no tests or QA.

## Evidence and limits

| Tier             | Established                                                                                                                                                                                                                   | Boundary                                                                                                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domain           | 116/116 across 5 files, including 17 syntax entries in the full raw log. Rename source/connection/endpoint counts, self-edges, no-op/refusal, discriminants, nested locations, invalid siblings and cache reuse.              | Actor output omitted the syntax names; curation read the full log and lists them in PROVENANCE.                                                                        |
| Store/components | 34/34 across 4 files: notices, held text/selection, undo/redo, save history and pointer activation.                                                                                                                           | Vitest/component simulation, no real browser.                                                                                                                          |
| Public API       | 2 in-memory `app.inject` scenarios. Invalid template/expression diagnostics match domain validation at save/validate/publish; validate 200 reports not publishable; publish 422 `LOOP_INVALID`; corrected drafts publish 200. | No listening server or inference. Old published version checked by ID/status only, not full definition/row bytes. API bodies were asserted by the driver, not printed. |

The [API driver](raw/qa01/publish-diagnostics.mts.txt) explicitly supplies `GG_OLLAMA_ENABLED=false` and an empty Jev seed to `createTestApp`, with fake providers/timers off. Its config assertion is conditional: raw output does not independently show whether that branch ran. The actor says the driver was not hashed; the preserved [wrapper](raw/qa01/run-check.py.txt) actually includes its hash in before/after snapshots. Curation recomputed `87991349afd8dd5363f9fb00a8b21503cc4c04f8c2bf9cc0d4eeaea557abe88b`. This reconciliation leaves the actor report unchanged.

The actor could not read changed-file/index hashes or nonempty stderr. Those artifacts remain. Curation confirmed domain/store stderr contains only package command labels; API stderr is empty. Full stdout accompanies the [receipts](raw/qa01/DOMAIN-RESULT.json).

## Earlier evidence and remaining gates

[Formal review1](raw/review01/REVIEW.md.txt) found no fix-in-PR or follow-up findings and retains its source manifests and bounded 203-control results. It is separate from actual QA and the reserved final audit.

The [correction author report](raw/author-correction/IMPLEMENTATION-REPORT.claude.md.txt) records 31 domain files/499 tests with 97.82% statements, 95.6% branches, 98.33% functions and 98.77% lines, plus 24 web tests. Formal review read that carried coverage for matching source; these are earlier author results, distinct from QA's116/34/2. The author receipt hashes original model-result text; PROVENANCE separately reconciles its added terminal newline/Windows CRLF serialization and preserved raw report hash.

Current-target CI, required broad gates in an admitted venue, publication-head verification and reserved final Astra review remain pending. No owner/general browser acceptance is claimed. Whole private provider streams/prompts and credentials are excluded. Raw bytes use `-text`; [MANIFEST.json](MANIFEST.json) lists every member except itself. Prepared externally: repository copy, staging, Windows checkout/blob roundtrip, local commit and publication require separate root action.
