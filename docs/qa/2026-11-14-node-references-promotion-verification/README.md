# #273 promotion verification evidence

This packet preserves a bounded local verification run at PR #474 head `ae8add8a791699e905540465b5ddf929d00c50eb`, tree `ea2dfcfd46f7d5ab79fd98414db214513d830b52`, based on `a817e5ccb4fd598ca56089b97b4ce55e9cb6f58c`. The worker used Claude Sonnet 5.5 (`claude-sonnet-5-5`), requested effort `xhigh`, and exited 0 at 2026-11-14T18:24:28Z. The exact handoff is [preserved](raw/handoff.md.txt), SHA-256 `4f5fc26e662f437d1334644a03bd6ac5dc3e10a6c97829341742efef94375b2c`.

## Admission and source identity

- The checkout started and ended clean. `git diff HEAD` was 0 bytes and both source and index identity stayed unchanged. Root's [one-slot grant](raw/ui-273-promotion-verification-slot-grant.json) names this head, tree, and base.
- The read-only admission recheck passed **27/27**. All paths added after product freeze `16aa9a2aed50710e68875b991a8eedb668fdecf8` are under `docs/qa` or `docs/delivery`; they add no product, test, or config delta after that freeze. The product delta from `a817` to this head remains the 24 mapped paths checked in the handoff.
- All 48 promotion source hashes match the checkout and Git HEAD blobs. The copied [source hash list](raw/manifests/source-sha256.txt) is byte-identical to the independent promotion QA's [frozen source list](../2026-11-14-node-reference-promotion-independent/frozen-source-sha256.txt). The [dry-run binding report](raw/manifests/dryrun-binding-report.json) verifies 48 source hashes and 1,227 artifact files. The proposed spec and UI mapping remain `frozen:false`; this worker froze nothing.
- The empty [source-change patch](raw/patch/source-change.patch), [index-change patch](raw/patch/index-change.patch), and [source stat](raw/patch/source-change.stat.txt) record no source or index change.

## Gates

All listed gates ran once under project Node v22.23.4 and `pnpm.cmd`; none was rerun, and no coverage task was run.

| Gate                                                                    | Result                                           |
| ----------------------------------------------------------------------- | ------------------------------------------------ |
| Domain node-reference suite                                             | 1 file, 44/44                                    |
| Prepared web rename suites                                              | 4 files, 44/44                                   |
| Extended web editor/store/import neighbourhood                          | 26 files, 402/402; 0 failures, skips, or todos   |
| Web typecheck and lint                                                  | Exit 0                                           |
| Prettier on 32 changed non-QA files and whole-repository `format:check` | Pass                                             |
| Full domain unit suite                                                  | 29 files, 428/428                                |
| API node-reference test                                                 | 1 file, 2/2, in-memory `createTestApp`, no ports |
| Domain/API typecheck and domain lint                                    | Exit 0                                           |

The exact commands, versions, times, and exit codes are in adjacent `.meta` files under [raw/logs](raw/logs/). The numbered logs retain the initial helper mistakes and their corrected outcomes, including the pre-build stale-bundle mismatch and the verifier's declaration-noise/first-rerun errors. These were tool or harness mistakes, not product or test failures.

## Build identity and limits

`pnpm.cmd build --force --cache-dir=.turbo/local-cache` passed **12/12 tasks with 0 cached**. The complete 13-tree, 1,227-file listings are preserved for start, prebuild, postbuild, Edge runs, scratch comparison, and final state under [raw/manifests](raw/manifests/). Start and prebuild were byte-identical. The forced build changed the web output; all backend TypeScript projects were already up to date. This is an incremental backend build, not a fresh TypeScript re-emit.

The postbuild and final per-file manifests match for all 1,227 files. Edge's server restored `apps/web/dist/sw.js` with identical bytes but a newer mtime. For native verification, use the postbuild listings and treat that later `sw.js` mtime accordingly.

A separate scratch emit matched the existing `.js` and `.d.ts` files for the compared projects except five `contracts` declaration files, which differ in member order. The check found the same line count and line multiset; that does **not** prove semantic equality, and the cause was not isolated. Contracts is outside this product delta. Scratch output files are omitted; the comparison manifests and logs are retained.

The built browser bundle's seven mapped editor paths, additional mapped notice sources, embedded packages, and source hashes are bound in the manifests. The Edge tests passed both specified specs (5 + 5) with retries disabled, then passed 10/10 in a supplementary traced run. This tier is built web output with the in-process TypeScript-source API, an in-memory database, and `FakeHarness`; it is not compiled-gateway/file-SQLite native verification. No full-web coverage, CI result, formal review, or owner-acceptance claim is made by this worker packet.

Six selected JPEGs are linked below from the supplementary trace run; the [inspection notes](raw/edge-trace/inspected/INSPECTION-NOTES.md.txt) preserve all nine viewed-frame captions and caveats. They are visual sanity checks, not accessibility or layout conformance evidence. The notes explain, for example, that the Publish alert is not visible in one selected frame and the narrow frame does not show name guidance.

## Related evidence and packet map

The current-head [CI packet](../2026-11-14-node-references-promoted-ci/README.md) and the separate [independent native promotion report](../2026-11-14-node-reference-promotion-independent/README.md) are linked siblings; their evidence is not duplicated here. The independent native report has its own source binding and tier. Follow that report for its exact tested source and limits.

Selected inspected frames: [known-missing publish state](raw/edge-trace/inspected/case2-078-publish-refused-known-missing.jpeg), [renamed response node](raw/edge-trace/inspected/case5-072-respond-renamed-to-reply.jpeg), [held Variables before rename](raw/edge-trace/inspected/case8-020-held-variables-before-rename.jpeg), [held Variables after rename](raw/edge-trace/inspected/case8-194-after-rename-template-repaired-variables-held.jpeg), [held schedule after rename](raw/edge-trace/inspected/case8-261-trigger-schedule-still-held-at-end.jpeg), and [narrow 360 px view](raw/edge-trace/inspected/loopnames5-056-narrow-360-final.jpeg).

The raw [worker report](raw/report.md.txt) is byte-preserved; it matches the worker's `latest.md`. The raw launcher result and event stream are omitted to avoid session/usage and private-event data. No trace archives, scratch-output tree, database/store, or generated key is included. See [manifest.json](manifest.json) for source-to-copy hashes and sizes, [link-checks.json](link-checks.json) for local and sibling links, and [SHA256SUMS.txt](SHA256SUMS.txt) for packet integrity.
