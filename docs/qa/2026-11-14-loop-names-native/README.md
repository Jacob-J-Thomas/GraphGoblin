# #209 loop names: phase 2 native and browser evidence

**Status: external curation proposal. This folder preserves phase 2 evidence; it is not a merge-readiness or owner-acceptance record.** The source snapshot predates the later #235 correction and main/plugin integration.

## Candidate and launch identity

Phase 2 ran from HEAD 5df84b2d434fa367a241891a57df13f6401cf17b (tree 2428d35ff2db10242bf5bf8d10bc9c249075b976) with one uncommitted eight-line test-fixture correction in apps/web/e2e/responsive.spec.ts. The correction is preserved in [correction-batch-1.diff](correction-batch-1.diff); the corrected file hash is 27e3ad19e376d875be253c5c2983f151e868cc5078cef3629dd62b5b6d159201. Root later committed the same fixture correction as 512200ce1b4c779bc7edcbf6d59e5a890dc0837c, parent 5df84b2d. The product source was unchanged.

The recorded source and build identities are in [candidate-start.txt](candidate-start.txt), [source-sha256.txt](source-sha256.txt), and [build-sha256.txt](build-sha256.txt). Build output files are not included. Phase 2 exited with code 0 at 2026-11-14T11:31:27.476Z; launch metadata records claude-sonnet-5-5 and requested effort xhigh. See [launch.json](launch.json), [exit.json](exit.json), [result.json](result.json), and the [raw handoff](handoff.md.txt) with its [readable publication](handoff.md).

## Results and first failures

- Targeted browser specs: 16 passed (5 loop-name and 11 template-gallery tests).
- Whole browser suite on the candidate: 472 tests in 66 files; **469 passed, 2 failed, 1 skipped**. Both failures were the dark and light variants of the responsive node-dialog test, caused by a stale literal fixture heading. After the eight-line fixture correction, those two tests alone were rerun and both passed. **The whole suite was not rerun after the correction.** Do not describe this as a complete clean full-suite run.
- An earlier mis-selected launch accidentally started all 472 tests and was stopped by its worker at 232 passed, 0 failed. It was not the ordered targeted run and is not pass evidence.
- The first visual attempt failed 7 of 37 steps because of script setup problems. The corrected fresh-store attempt passed 37 of 37 steps and produced 41 final screenshots. The worker reports that all 41 final images were inspected. This bundle retains 35 selected final images plus the four native race images; it does not claim that the curator inspected them.
- Web coverage: 199 files, 2,469 tests passed; 98.50% lines and 93.99% branches. The package thresholds were unchanged.
- Native second-client race: all 53 assertions passed over Create, import, template copy, and editor rename.

Raw starts, exits, logs, result JSON, and the relevant first-failure details remain in [e2e-targeted-1](e2e-targeted-1/), [e2e-full](e2e-full/), [e2e-recheck-1](e2e-recheck-1/), [e2e-aborted-launch-0](e2e-aborted-launch-0/), [coverage-web](coverage-web/), and [logs](logs/). The full-suite trace archives are excluded; their original two-file SHA-256 ledger is [failure-traces-sha256.txt](failure-traces-sha256.txt). The first failed visual run's raw readback and initial driver are retained at [screens-run1-superseded/readback.json](screens-run1-superseded/readback.json) and [native/visual.v1.mjs](native/visual.v1.mjs). Its screenshots are not presented as visual evidence.

## Evidence boundaries

- **Source provenance:** hashes and the small fixture diff identify the tested candidate. Source hashes alone establish no runtime behavior.
- **Controlled browser:** Playwright ran against the test server with an in-memory store and fake harnesses. These checks are not live-provider or native-store evidence.
- **Native local behavior:** the scripts drove the built API and web app with a real SQLite file store, loopback ports, and real headless Edge. No provider was used. The race result is native local runtime evidence, not external-service acceptance.
- **Visual evidence:** [screens](screens/) contains 35 selected final screenshots. For each of Create, import, template, and editor, the selection includes both themes at 360 and 1440 px and one theme at 768 px. It also includes both node-dialog themes at 1440 px, both themes for all four long-name surfaces at 360 px, all three forced-colours captures, and both normal-colour keyboard-focus captures. The other theme at 768 px for each surface and both 360 px node-dialog images were omitted as redundant; the full original hash list remains in [screens-sha256.txt](screens-sha256.txt). The four post-race images are in [native/race](native/race/).
- **Limits:** no screen-reader speech was captured and no physical device was exercised. Startup refusal and repair for a store already holding an equivalent pair were not tested in phase 2. Owner acceptance remains mandatory under issue #209 body; the phase 2 handoff's conditional phrasing does not supersede it. No later main/plugin/#235 integration, opposite-family reviews, current-head CI, fresh whole-PR audit, or merge-readiness conclusion is represented here.

The separate independent backend QA is preserved in its own [canonical bundle](../../../../../names-209-independent-backend/proposed/docs/qa/2026-11-14-loop-names-independent-backend/README.md); it is linked, not copied. This relative link points into the external batch archive and may need updating if this proposal is integrated into the repository.

## Reproduction and integrity

Reproducing the recorded results requires the historical candidate at 5df84b2 plus the exact fixture correction (or its identical commit 512200ce before later integration), Node v22.23.4, pnpm 12.8.1 via pnpm.cmd, and the recorded Edge build. The run-start files, logs, and raw .mjs drivers preserve the commands and harness details. Native reproduction also requires rebuilding the API/web outputs and creating disposable data; neither build outputs nor stores are included here. This curation ran no tests, builds, browser sessions, or provider calls.

The original handoff and report are preserved as .md.txt; the adjacent .md files are readable Prettier-formatted publications. [cleanup-summary.md](cleanup-summary.md) is a derived summary, not raw process evidence. Original process and port log digests and all excluded-material notes are in [excluded-evidence.json](excluded-evidence.json); no redacted process log is presented as unchanged source evidence.

[Source evidence manifest](source-evidence-manifest.json) records each copied source path, byte count, and SHA-256. [Publication manifest](publication-manifest.json) records sizes and hashes for all published files except itself. The folder-scoped [.gitattributes](.gitattributes) disables text normalization so raw evidence remains byte-preserved. Run node verify-bundle.mjs from this folder to check source copies, publication hashes, and local Markdown links.
