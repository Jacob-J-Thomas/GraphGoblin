# #209 and #235 integration: phase 3 evidence

**Status: external evidence proposal, bound to historical admission c427287b. This is not a clean full-suite run, final-head evidence, or merge-readiness record.**

## Historical identity and launch

Phase 3 ran on HEAD c427287b41a4e1b67a397ab4e03e228c6ea62450, tree 3d32c7eaad229efad6a896721cbe60cc289726d5. Its parents were 512200ce (the #209 UI plus responsive-fixture correction) and 1ae90e2b (the #235 correction, main cee2, and plugin work). The candidate start record binds this capture to its tracked-file hash. No source file changed during phase 3.

The phase 3 launcher exited 0 at 2026-11-14T12:09:38.666Z. Launch metadata requested claude-sonnet-5-5 at xhigh effort; the canonical model recorded in session-result-summary.json is claude-sonnet-5-5. The worker said xhigh is requested effort and cannot be independently verified. Raw launch and exit metadata are preserved; the raw result containing token, thinking, and cost metadata is excluded and represented only by its digest.

Start with the [phase 3 handoff](handoff.md) and its byte-preserved [raw Markdown](handoff.md.txt). The short [runner report](report.md) and [raw report](report.md.txt) are also retained; it is a duplicate of launcher latest.md, whose source digest is recorded as an alias.

## Merge and source/build binding

The handoff records a source-only seam inspection against both parents. Of the files changed on both sides, the six merged files are documented; all 63 files only #209 changed match parent 512200ce byte-for-byte, and all 356 files only #235/main changed match parent 1ae90e2b. The two auto-merged specs match both parents’ line-change sets in all four comparisons, and the hand-resolved docs differ from a fresh auto-merge only by conflict-marker removal. The complete semantic proof and shared-file patches are in [deltas](deltas/).

[candidate-start.txt](candidate-start.txt) and [source-sha256.txt](source-sha256.txt) bind the source to c427287b and the 54 tracked changed files. [build-sha256.txt](build-sha256.txt), [build-sha256-final.txt](build-sha256-final.txt), and [build-listings](build-listings/) bind the build outputs. Initial and final output listings were checked identical. Build output trees themselves are not included.

## Build recovery and test results

The first build stopped because the new plugin builder refused a stale, ignored plugin-codex marketplace directory left by the worker’s phase 2 build. The worker moved it aside and rebuilt; the corrected build completed 12/12 tasks. Both the refusal and recovery logs are retained in [logs](logs/); the moved-aside directory contents are excluded.

Selected phase 3 browser runs passed: 25/25 cases across form-controls, loop-names, and template-gallery, followed by 4/4 responsive cases (two node-dialog themes and two coarse-pointer themes). The responsive measurements record the Omit target at 44×44 px on New run and Wait in both themes. These results are in [e2e-selection-1](e2e-selection-1/) and [e2e-responsive-1](e2e-responsive-1/).

The related unit selection passed 1,256 tests across 95 files. Its source seeds, exact test-file list, run log, and result JSON are in [unit-related](unit-related/). Web typecheck and lint passed; Prettier checked 227 parent-changed files; token, layer, and dependency checks passed with four existing no-orphans warnings. Exact logs and the Prettier file list are retained.

**Four backend-side test failures remain.** MCP had one failing test, and api-client had three. An unchanged confirming run (log batch 17) reproduced the same four failures. The MCP ambiguity fixture uses case-equivalent names that the #209 admission rule now rejects; the api-client tests mechanically reuse names in a shared app. The handoff and [backend identity proof](deltas/backend-test-failures-identity.txt) show these files are byte-identical to the #209 parent, so phase 3 did not attribute the failures to the merge. They were left for GPT/root to correct; this bundle does not include a correction or post-correction result.

The 472-case browser suite and native matrix were not rerun in phase 3. The 1,256 related tests are not a coverage run. The reported selected checks do not make phase 3 an all-pass result while the four backend failures remain.

## Evidence boundaries and limits

- Source hashes and merge diffs establish historical source identity and merge semantics, not runtime behavior.
- The browser E2E runs used the built web dist with the e2e test server; the API under test ran from TypeScript source with a controlled in-memory app. These are selected controlled browser results, not provider or native-store evidence.
- No native matrix or new screenshots were produced in phase 3 because no source/class changed. The prior visual evidence remains separately curated in [phase 2](../../../../../names-209-phase2-curation/proposed/docs/qa/2026-11-14-loop-names-native/README.md), not copied here.
- Real assistive-technology speech and Safari/Firefox were not exercised. Owner #209 acceptance remains mandatory under the issue body.

**Post-capture context from root, not phase 3 evidence:** root later merged metadata as 35436edd and reports no runtime delta. Phase 3 evidence remains bound to c427287b. Do not use the mutable current worktree to reconstruct or validate this historical candidate. The later backend test corrections are outside this bundle.

## Curation and integrity

The handoff and report are preserved as raw .md.txt plus Prettier-formatted .md. The raw JSON, JS, logs, build listings, E2E results, unit results, and semantic merge patches selected for publication were copied byte-for-byte. Excluded event/result metadata, process and port listings, the process-check script, and moved-aside files are described with source digests in [excluded-evidence.json](excluded-evidence.json). [cleanup-summary.md](cleanup-summary.md) is a derived note, not a raw or redacted process log.

The source and publication manifests are wholly inside this folder. The folder-scoped [.gitattributes](.gitattributes) disables text normalization. Run node verify-bundle.mjs here to verify copied bytes, publication hashes, and local Markdown links. This curation ran no tests, builds, browser sessions, or provider calls.
