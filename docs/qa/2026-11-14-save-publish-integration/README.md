# Save/publish UI #237 — integration correction evidence

Curated snapshot date: 2026-11-14. This packet records one integrated #209/#237 implementation correction, its retained failures, scoped verification, and known limits. It does not claim the overall #237 work is complete.

## Source and build identity

- The task ran in a merge worktree with HEAD `e12b81ec9767b9bfd3d6e649025023796b2bc638` and MERGE_HEAD `2367b15b310eac52d95af77c570d5ce36f741527`. At run end the index hash matched the start and the conflict stages for `useAutosave.ts` remained untouched. The first-failure, original-runtime swaps, corrected runtime, build and native checks were run before the freeze commit; the runner exit record reports code 0.
- Root then froze the exact tested working contents at commit `9e44bd74bfc40adcc872f8f8a3724c2e2840f378`, tree `2d2b60b9a1ef9f8d015fe3758204715c86ea3288`, with parents e12 and 2367. The preserved root binding covers 25 source files and 1,227 built files, with 11 expected changed paths. This packet extracts source bytes from that immutable commit and verifies every byte against the root binding. The freeze ties the snapshot to the tested contents; it does not claim the tests/build/native run were rerun after the freeze commit.
- The forced build ran 12/12 tasks with no cached tasks. Comparing the preserved pre/post per-file manifests gives 1,227 entries on each side: 1,221 identical paths, four same-path hash changes, and two old JS/map bundle paths replaced by two new paths (six logical outputs changed). The raw handoff says 1,171 files were identical, which conflicts with its own manifests; that raw report remains unchanged. Native gateway records retain served asset/build identity and close checks.
- Root binding and helper are preserved in [binding/](./binding/). The [final file list](./raw/manifests/final-files.txt) distinguishes six correction-touched files from five auto-merged paths that the implementation left untouched.

## What changed and what was verified

The six correction-touched files resolve the #209/#237 `useAutosave.ts` conflict as a union, recheck loop/generation/refusal state immediately before every publish POST (including after check-first readback), and keep the deferred readiness indicator from showing “Ready to publish” beside known name or draft-conflict refusals. Five additional auto-merged paths remain as the parent-provided merge content. The packet includes diffs against both parents and the index stage-0 view, plus original, corrected and final file backups. No API, contract, schema, stored format, dependency, threshold, timeout, or coverage exclusion changed.

Evidence tiers are distinct:

- **Synthetic tests:** the original integrated baseline was 250/250 on a direct Node/Vitest invocation with Node 22.23.4; this was a diagnostic baseline, not the later pnpm gate. Four new negative tests failed on the original phase 1 runtime while the healthy control passed. The proof logs retain the original and corrected runtime swaps. On the corrected candidate, 26 publish/usePublish tests, 255 affected tests across 22 suites, and 38 readiness-related tests passed. Prettier, ESLint (zero warnings), and web typecheck passed on the final bytes.
- **Build:** the forced pnpm build ran all 12 tasks, 0 cached. This packet makes no claim that whole-web coverage or full-repository CI ran; the phase 1 coverage numbers are historical.
- **Native public UI:** real headless Edge 157 drove the built API main entry against disposable file SQLite with no API key or provider. Three retry-readback variants and the U2 name-readiness/retry sequence passed on the first browser invocation: held input produced no extra publish; switching editor load produced no old-load publish/feedback; the healthy control made one intended publish after the real readback; the U2 refusal, invalid retry, repair, and fresh retry behavior matched the records. This is bounded scenario evidence, not independent overall acceptance. The first harness preflight failed with ENOBUFS before the gateway/browser started; that failure and the maxBuffer correction are retained.
- **Cleanup:** the gateway closed, listener and processes were absent, and before/after source/build bindings matched. The six captures explicitly listed as inspected in the handoff are indexed in [SCREENSHOTS.md](./SCREENSHOTS.md).

The earlier phase 1 candidate’s awaited-readback dispatch gap was confirmed by a separate native diagnostic. The corrected integration records its three retry variants; the phase 1 evidence and diagnostic remain in their separate canonical sibling packages: [phase 1 implementation evidence](../2026-11-14-save-publish-implementation/README.md) and [retry-readback diagnostic](../2026-11-14-publish-retry-readback-diagnostic/README.md). Their externally retained identity hashes are listed in [RELATED-EVIDENCE.json](./RELATED-EVIDENCE.json).

## Limits and remaining work

- The raw handoff recorded a source-level local-refusal hypothesis. Subsequent [independent native QA at frozen 9e44](../2026-11-14-publish-local-refusal-native/README.md) confirmed it: after an actual publication whose reply and readbacks failed, an intervening local refusal erased check-first. The next explicit Publish sent POST before GET and received 409 NO_DRAFT. The sole immutable version remained intact; no duplicate publication or data loss occurred in that fixture. This integration snapshot does not contain its later correction.
- A “Publish failed” refusal stays visible until the next Publish attempt, even after the cause is corrected. The handoff says this behavior predates the phase 1 work at 700ce and was left unchanged.
- No current exact-head full CI/coverage, independent full QA, GPT UI review, fresh Astra audit, or owner acceptance is in this packet. These remained separate gates in the handoff. No claim of overall #237 completion is made.

## Preserved evidence and exclusions

- `raw/` preserves the original handoff/report, exit code, launch identity, all listed logs, manifests, diffs, backups, native JSON/driver records and inspected screenshots. Raw Markdown and candidate source Markdown files are stored with `.md.txt` extensions; their bytes are unchanged and matched to the original source paths/hashes in the artifact manifest.
- Native records are copies of public test fixture state. The temporary SQLite store itself, its master key, WAL/SHM, credentials, environment values, authorization headers, and private runner event/result/latest streams are excluded. No data was redacted or arbitrarily transformed in the preserved raw records.
- [artifact-manifest.json](./artifact-manifest.json) covers every packet file other than itself and `artifact-manifest.sha256`; the adjacent checksum covers the manifest.
