# Canvas double-click native evidence

This packet preserves the native verification sequence for candidate `dbc55454b224e350f7005cdaf58b8655c4b9e71e` (tree `a52fb7570c279ceb74f0ffa9c1a0453313c39e21`). The final correction1 report was read and accepted by root. This packet is evidence curation; it does not record owner acceptance or overall release readiness.

## Native result

The final handoff records 15 distinct product cases passing across 17 activations, with no unrun product cases in the final product matrix. Correction1 ran four cases: pan-reset 17 PUTs and 31 checkpoints; blank-device 6 PUTs and 14 checkpoints; coarse 1 PUT and 2 checkpoints; protected-chat 2 PUTs and 8 checkpoints. Together those runs produced 26 PUTs, 55 checkpoints, and zero page errors. The native handoff reports 100 preservation requests without HTTP status. Across the earlier first and focused phases, 33 PUT requests recorded HTTP statuses: 32 HTTP 200 and one intentional HTTP 409.

The initial native-verification handoff is retained as historical evidence: at that point it recorded 11 PASS, one inconclusive, one OS-limited, and three unrun. The later correction1 report closes product coverage, while retaining the original pan inconclusive and optional OS limitation. The original pan-reset preservation attempt failed its compound pan-ownclick predicate without serializing the trace; it remains inconclusive and does not prove a product regression. Shared, script, and decisions preservation cases passed in that earlier run, and its final three cases were unrun then. Correction1 later captured four PASS cases. One of two corrected fixture batches has been used.

The first native phase also records three product PASS cases, an OS-mouse case limited before native OS input, 19 PUTs, and zero page errors. The five focused cases passed. Their 14 attempts comprise 13 HTTP 200 responses and one intentional HTTP 409. The first focused terminal-error record is retained.

## Separate repository E2E evidence

The two affected-web repository E2E cases passed on their first attempt with zero retries. They used source API, in-memory fakes, and a built-web copy; they are not native built-API/file-SQLite evidence. The report records 1,680 source hashes and 1,227 outputs across 13 trees as exact. The initial checker failed on a Git-blob identity assumption before E2E execution; that assumption was corrected and the first record preserved. The service-worker copy modification time changed, but all 28 file hashes match and the original timestamps are unchanged.

## Correction1 preparation and limits

The approved correction1 preparation packet and its admission and receipt are included. Correction1 made no product-code changes. The native runs are separate from the repository E2E evidence. All five native source/build bindings match exactly. No private model streams, browser profiles, build output copies, caches, SQLite databases, or master keys are included. The largest retained raw file is 8,616,888 bytes. Exact duplicate files are represented once; the raw manifest maps every original source path to the retained byte-identical copy.

Curation did not run QA or modify the repository or Git index. This packet does not substitute for owner acceptance or a broader release decision.

## Evidence

See the [complete source-to-copy index](evidence-index.md), [raw copy manifest](copy-manifest.json), and [SHA-256 sums](SHA256SUMS.txt). Key reports and run records:

- [Final correction1 handoff](provenance/pan-correction1-final-handoff.md.txt), [handoff manifest](provenance/pan-correction1-handoff-manifest.json), and [consolidated cleanup](cleanup/pan-correction1-consolidated-cleanup.json).
- [Earlier native verification handoff](provenance/native-verification-handoff.md.txt), [native manifest](provenance/native-verification-manifest.json), and [terminal cleanup](cleanup/native-final-terminal-cleanup.json).
- [Correction1 preparation manifest](preparation/pan-correction1/literal-manifest.json), [plan](preparation/pan-correction1/files/plan.md.txt), [diff](preparation/pan-correction1/files/pan-correction1.diff), [approval](provenance/pan-correction1/root-approval.json), [admission](provenance/pan-correction1/admission.json), and [admission receipt](provenance/pan-correction1/admission-receipt.json).
- [Pan-reset correction1 run](runs/correction1/pan-reset/run.json) with its [observed capture](runs/correction1/pan-reset/observed.json) and [browser log](runs/correction1/pan-reset/browser-run.log); [blank-device](runs/correction1/blank-device/run.json), [coarse](runs/correction1/coarse/run.json), and [protected-chat](runs/correction1/protected-chat/run.json) runs.
- [Earlier inconclusive pan-reset run](runs/initial-preservation/pan-reset/run.json), its [browser log](runs/initial-preservation/pan-reset/browser-run.log), and retained [screen capture](runs/initial-preservation/pan-reset/first-canvas-after-decisions.png).
- [Affected-web E2E report](preflight/affected-e2e-source-api-inmemory/report.md.txt), [results](preflight/affected-e2e-source-api-inmemory/results.json), [cleanup](preflight/affected-e2e-source-api-inmemory/cleanup.json), [first checker record](preflight/affected-e2e-source-api-inmemory/binding-preflight-first.json), and [dist-copy readback before](preflight/affected-e2e-source-api-inmemory/dist-copy-before.json) and [after](preflight/affected-e2e-source-api-inmemory/dist-copy-after.json).
