# #209 loop names: phase 1 implementation evidence

**Status: phase 1 evidence only. Phase 2 browser and visual checks, full web coverage, independent UI review, CI, the fresh audit, and owner acceptance remain pending.** This curation did not run tests, builds, or browser checks. Phase 2 artifacts were still being produced and are not included here.

## Candidate identity and applicability

The Claude phase 1 handoff records an uncommitted UI candidate based on backend commit fddadabf8d838098da003cf7fa072050f179445d, with baseline b3b5e1874a8252cc01c065d18fef42cbfbe075b4. The raw handoff and recorded source-sha256.txt are preserved. All 35 recorded UI source files are archived byte-for-byte under [candidate-source](candidate-source/) and checked against the recorded SHA-256 values. Markdown source files use .md.txt names so the raw bytes remain intact; [candidate-source-manifest.json](candidate-source-manifest.json) maps repository paths to archived paths.

At curation time the read-only gg-20261114-loop-names checkout was clean at 5df84b2d434fa367a241891a57df13f6401cf17b. Thirty-four of the 35 recorded phase 1 source hashes matched that tree. The phase 1 CHANGELOG.md hash was recovered exactly from Git commit 2c7513986d0d3a70abb938fde2dfcf5f3ebf8d88; the current 5df copy has later content. This reconstructs the phase 1 source snapshot and does not verify the in-progress phase 2 UI.

The separate independent backend QA remains in its existing [canonical bundle](../2026-11-14-loop-names-independent-backend/README.md), with the exact-head retain manifest in the external staging artifact `names-209-independent-backend/retain-manifest.json`. It ran against 5df84b2d434fa367a241891a57df13f6401cf17b, which contains the frozen fddad implementation and later f9e175283bd47654ee8becb6180786aed31e170a SQLite type-cycle fix. The 5df merge has parents 2c7513986d0d3a70abb938fde2dfcf5f3ebf8d88 and 9748714cfdf923424ba33d86e08de05f01d6185d; 974 is the PR #461 merge of b3b5 and 308c6285. That separate backend QA used b3b5 as its previous-build control. Neither 5df nor its 974 parent is the final combined #209 UI integration head; phase 2 and integration remain pending. The independent backend files and observations are linked, not copied. The bundle link targets the canonical sibling docs/qa path; the retain manifest remains external and is not part of the repository QA bundle.

## Phase 1 record

The raw [Claude handoff](raw/phase1-handoff.md.txt) gives the UX contract, acceptance matrix, tests and fixture audit. Its readable [Prettier-formatted publication copy](handoff.md) is kept beside it. Exact session launch, completion and exit metadata are in [session](session/); the result JSON is Claude session metadata, not a GraphGoblin run. The metadata identifies claude-opus-5-5, records xhigh as requested effort (not verified), reports 230 turns, success and exit code 0. The multi-megabyte event stream is omitted.

Retained phase 1 logs include first failures and corrected runs: typecheck, editor unit tests, ESLint and Prettier, plus focused and affected-suite results. The handoff reports the final focused rerun at 11 files/155 tests and the affected suites at 99 files/1,082 tests. check-deps.log is an important failure: on the phase 1 fddad snapshot it reports a cycle from db.ts through store-format.ts and loop-names.ts back to db.ts. Do not describe that phase 1 snapshot as passing all repository gates.

Later i08 implementation records are retained separately under [backend-history](backend-history/). The post-f9 cycle logs show the dependency-cruiser run with four warnings and zero errors, plus 19 infrastructure and 7 API regression tests passing. These records are not the phase 1 fddad check. Their individual log text does not carry a full source HEAD, so the nearby backend handoff and commit history provide chronology; the separate independent QA retain manifest is the exact artifact record for 5df.

## Evidence and limits

- [Raw source hash list](candidate-source/source-sha256.txt), [candidate mapping](candidate-source-manifest.json), [source evidence manifest](source-evidence-manifest.json), [Markdown source/publication hashes](markdown-publication-hashes.json), and [publication manifest](publication-manifest.json) record provenance.
- [Backend API handoff](backend-history/loop-names-209-frontend-handoff.md) and [design proposal](backend-history/loop-name-209-proposal.md) have raw .md.txt copies next to their formatted publications.
- Selected first-failure and final phase 1 logs are preserved, along with the relevant later API/cycle implementation records. No independent backend runner, disposable database, or backend observations are duplicated here.
- Phase 1 did not run the browser suite or full web coverage. Phase 2 remains the gate for native Edge interactions, visuals, broad E2E fixture behavior and full coverage. Independent UI review, touched-systems QA, CI, the fresh Astra audit and owner closure also remain outstanding.
