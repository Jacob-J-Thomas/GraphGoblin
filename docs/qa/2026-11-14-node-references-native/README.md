# Node references (#273) phase 2 evidence

This packet publishes the historical Claude phase 2 implementation/native/performance record. It is not a formal review, independent QA report, current-head CI result, or owner acceptance. Review count is 0. The original handoff and report are preserved byte-for-byte under raw/; this README is a curated interpretation with evidence tiers and limits made explicit.

## Provenance and source identity

- Runner record: Claude Opus 5.5, xhigh requested, exit code 0. See derived/provenance/runner-execution.json and its source hashes in artifact-manifest.json. Token usage, cost, runner event stream, and model transcripts are excluded.
- Admitted candidate/build identity: commit 9da3db6f248182740dcc27523a2964d7188124ad, tree 3683dc5044279c08e3c7d973cb4f42d7c8e88139. The admission record is raw/provenance/phase2-admission.json.
- Historical source checkpoint: bd88ff09069338c0db2d0d64a1e8b291c9eb6602, tree a0a30a056e2f692d9bf6674cbea28972fcec0d27. The coordinator confirmed all four phase2 source hashes against the saved source manifest and committed the test/docs-only checkpoint. No product runtime source changed from 9da3db6. The build and gateway bindings remain tied to 9da3db6; the later checkpoint does not change runtime code.
- The phase2 source delta consists of EditorPage.rename.test.tsx, EarlierNodeOutputs.test.tsx, docs/09-frontend-and-pwa.md, and the new Edge spec apps/web/e2e/rename-references.spec.ts (untracked at capture time). The root later committed all four as the historical source checkpoint. The tracked diff, final spec snapshot, source status, and hashes are preserved under raw/source/.

## Evidence tiers and outcomes

### Playwright browser runs

The affected browser suite passed 64/64 across eight named existing specs on its first run. The new rename-references Edge spec had these results: attempt 1, 1 passed and 4 failed; attempt 2, 2 passed and 3 failed; attempt 3, 4 passed and 1 failed. The final remaining failure is the last variables equality in the held-input scenario. It is not a product failure established by this run.

Tier boundary: Playwright e2e/server.ts serves the built web distribution, but the API and its dependencies load through TypeScript development/tsx resolution with the in-memory/fake test harness. Therefore the 5-test new spec and 64-test affected run are browser/product-flow evidence over the test API composition; they are not built-API/file-SQLite native evidence.

The final failure expected stored.variables to equal { key: { type: string } } and received {}. The fixture cleared the Variables editor before entering unfinished JSON, so its first accepted save had already removed the key. The sanitized request sequence is in derived/failure/attempt3-first-save-sequence.sanitized.json; the original trace archive remains in the source evidence folder and is referenced by hash, not copied. The root retained the original assertion and rejected weakening it to expect an empty object. The follow-up is to correct the input sequence atomically and keep the original assertion. A later fixture correction has separate evidence and is intentionally not merged into this historical phase2 packet.

raw/failure/variables-assertion-unapplied.patch is preserved for history only. It is unapplied and unverified; do not treat it as the accepted correction.

The affected 64/64 and new 4/5 counts are not interchangeable with native checks. Logs for attempts 1-3 are kept under raw/checks/; attempt 3's exact failure context and run log are under raw/failure/.

### Separate native API/browser pass

A separate manual Edge driver used the built API testing entry and built web distribution, file SQLite, FakeHarness/FakeClock, and real Edge 157.0.4341.46. This is the 93-check native tier; it is not the Playwright e2e/server.ts tier and it is not the shipped main.js provider composition. No live provider was contacted.

The native driver’s first pass refused its 65-character replacement id (the product correctly enforces the 64-character limit). The corrected N3 driver pass is retained. The first verifier was 87/93 because six expected notice strings said “Updated 2 references”; the observed fixture has one static read and three connections. After correcting that expectation, the verifier passed 93/93. Preserve the first failures and corrections; do not report an unqualified 93/93 without this sequence.

N1-N2: assistant to writer repairs sibling Liquid and Exit references and both edge endpoints; prose, JSON literal, and script remain unchanged. Undo, redo, reload, device copy, draft tokens, immutable v1, and pinned v1/v2 runs were checked. N4: missing-gate publish returns 422 while preserving v1; optional existence check warns and publishes. N5: stale tab receives 409 and explicit Overwrite writes the complete draft. N6: protected voice ids remain read-only and renaming respond repairs the chat envelope. These results are from the native driver and direct store record, not the affected Playwright suite.

The direct SQLite readback is a separate corroborating tier. It reports unchanged DB-file hash across read, v1/v2 rows agreeing with API observations, and three succeeded version-pinned runs. The database/store files themselves are not copied. derived/native/store-readback.sanitized.json removes the absolute DB path; raw/native/native-verified.json preserves the final 93 check results.

### Build and source checks

The admitted candidate build exited 0 with 12 tasks. All 13 files in raw/build-listings/ are preserved. aggregates.txt records seven candidate dist trees: web (28 files), web-goblin (28), API (306), contracts (117), domain (121), engine (161), and infrastructure (293); each has a corresponding per-file list. Baseline/support records include a 28-file web dist copy, a 97-file baseline domain list, pre/post baseline web readbacks, and an after-browser candidate readback. The handoff records the baseline API dist as 306 files, but this bundle has no separate full baseline API listing. Sanitized gateway bindings preserve candidate/baseline commit/tree identity and served-file hashes without PID, URL, scratch, or DB paths.

At final phase2 source, whole-web coverage passed 201 files and 2,500 tests: lines 98.51%, branches 93.99%, statements 97.57%, functions 97.04%; thresholds remained 90%. Whole-web typecheck, corrected lint, and formatting passed. The first whole-web lint failure is preserved; its test-only correction is in the source diff. check:deps and check:layers were not run. Root-level pnpm check, current-head CI, formal reviews, independent QA, and owner acceptance are not claimed.

### Bounded performance comparison

Keystroke-to-paint at 300 realistic nodes, headless Edge on one Windows host: candidate cold runs 1-3 median/p95 26.6/40.6 ms vs baseline 30.4/40.8 ms; warm 23.6/30.0 ms vs 25.3/30.3 ms. All 60/60 measurements in each group exceeded the 16.7 ms frame budget on both builds. This supports “no regression observed”; it does not meet the frame budget and does not establish performance on other hosts.

Routing at 300 nodes was similar: candidate run medians 2.6 and 2.8 ms, baseline 2.6 and 2.9 ms; the largest per-drag routing p95 was 3.5 ms. At 100 nodes the candidate medians were 1.5 and 1.8 ms, baseline 1.7 and 1.5 ms. Raw per-run reports, raw keystroke JSONL, aggregates, and logs are preserved under raw/performance/ and raw/checks/.

Baseline caveat: the baseline checkout changed HEAD during measurement (start 34cdf722, close 02567f87; close record says sameIdentity=false). The saved listings/readbacks report byte-identical web/API/domain dist before and after; this is a build-artifact comparison with a source-identity limitation, not a stable-checkout comparison.

## Screenshots and limits

All 42 screenshots from screens-1 and screens-2 are preserved under raw/screenshots/. The original handoff names 10 screenshots as opened; the other 32 were captured and measured but not individually opened. Both themes, 360 px, desktop, 200% zoom, and forced colours were covered. No screen-reader speech was tested. NODE_REFERENCE_OUTPUT_UNVERIFIED was not browser-exercised. Existing observations include focus on the Returns mode radio rather than the expression editor, a warning icon retaining yellow under forced colours, and a tall notice at 360 px/200% zoom.

## What is intentionally omitted

- events.jsonl and result.json: runner event/model-use payloads and internal usage metadata.
- stores/: SQLite databases, WAL/SHM, artifacts, and workspaces.
- Expanded Playwright trace directories and raw request/header captures. The attempt-3 failure context plus sanitized request sequence are preserved; original trace path, byte count, and hash are in artifact-manifest.json.
- latest.md: redundant runner summary; report.md is preserved separately.
- Built dist binaries: the complete before/after hash listings and sanitized served-file bindings are retained instead.

This evidence does not apply the rejected assertion patch or claim product acceptance. The sanitized artifacts are published here; original unredacted records remain in the external QA archive. The [prepared README](raw/publication-before-integration/README.md.txt) and its original manifests are retained alongside the publication copy.
