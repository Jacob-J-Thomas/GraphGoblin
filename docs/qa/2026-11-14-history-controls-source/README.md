# #208 history controls source evidence

This packet preserves the source-only A1/A2 implementation evidence for stationary history controls and loaded-editor connection-banner ownership. The worker started from #207 phase-2 HEAD 64a955887962f72287e532824be1b8cb32c5f055 (tree a6691516210eb25887cb92abdcbd8c7abe1a4bb3). That is the starting snapshot, not final-main acceptance.

## Baseline cause and implementation scope

The separate baseline handoff, SHA-256 f880198b8f6399bb93c6edc5929d356e1396f845d484b4b8d5aae4e2e66200d9, reproduced four causes: H1 dynamic content and save/publish labels moved the right-aligned history controls; H2 wrapping changed their row at constructed boundaries; H3 a 1 px press translation could lose a top-row click after a 250 ms hold; H4 the shell connection banner shifted the toolbar for offline and failed-transport cases. HTTP 500 produced no connection banner or geometry shift and remained a negative control. The baseline packet is maintained separately and its 25 MB evidence is not duplicated here.

A1 makes Undo/Redo a fixed, leading, top-aligned toolbar slot, with a history-button-only pressed translation override and visible border treatment. Existing names, titles, shortcuts, ARIA state, click semantics and history behavior remain; toolbar Tab order intentionally changes so Undo/Redo come before Loops.

A2 keeps the single connection status in the shell for loading, errors, blocked routes and voice staging, and transfers it below the toolbar inside a loaded editor. Connectivity detection and HTTP 500 classification are unchanged. The source uses a mounted EditorConnectionBanner component to own the claim rather than placing a claim hook in EditorPage before its early returns. Root accepted this as an equivalent, narrower ownership boundary; the root inspection records that decision.

## Frozen source identity

The worker completed as Claude Sonnet 5.5 at xhigh, exit 0. Root verified the actual model. The [safe metadata projection](worker-metadata.json) records model, effort, start and finish times, exit code, and hashes of the source launch/exit metadata; it omits the raw working-directory and PID fields.

Root froze the worker’s 18 exact source hashes as commit fc4c89d9ae2b9c854838787ae7d3375435106130, tree df9304f8705f941b6624ad952d3ab3c2f2d54281, parent 64a955887962f72287e532824be1b8cb32c5f055. The [committed manifest](evidence/root/source-committed-manifest.json) records 18 source files, 18 verified blobs and no evidence files. The [root source inspection](evidence/root/root-source-inspection.md.txt) confirms the composition: 8 production files, 5 new test files and 5 documentation files. The worker handoff labels production as 7 files because one table row combines AppShell and the layout index; this wrapper gives the corrected count without changing the raw handoff.

At packet preparation, root had begun integrating the corrected #207 predecessor. CHANGELOG, docs/09 and the user guide had auto-merged without UI source overlap; integration checks were still pending. This packet records the source freeze before that integration was verified.

## Focused evidence

| Check                                        | Result                                                |
| -------------------------------------------- | ----------------------------------------------------- |
| Existing focused tests before implementation | 6 files, 42 passed                                    |
| Broader focused run                          | 50 files, 591 passed                                  |
| Final focused run after the last edits       | 12 files, 96 passed                                   |
| New tests                                    | 49 across 5 files                                     |
| Web no-emit typecheck                        | Exit 0 before and after                               |
| ESLint                                       | 13 changed code files, final exit 0 and zero warnings |
| Prettier                                     | All 18 changed files clean                            |
| Dependency check                             | 0 errors, 4 pre-existing orphan warnings              |

No build, browser/native run, coverage run, install or exact-target CI was performed. Geometry, real hit testing, paint, screen-reader announcement transfer, narrow/coarse layout and physical touch behavior remain unproved.

## Paired old-source controls and restoration

The paired controls are bounded regression evidence, not a mutation campaign:

- With all four old production files restored, 31 of 37 new tests failed and 6 passed. The passing controls preserve unrelated behavior, button sizing/shared variants, and 404, API-unreachable load and 401 cases.
- With old App.tsx and EditorPage.tsx but the new toolbar, 9 of 13 A2 connection tests failed and 4 passed. The passing controls are HTTP 500, 404, API-unreachable load failure and 401.

The control packet includes the exact old-source/new-tests logs, four backed-up production files, pre-control hashes and both post-restoration hash records. Those hashes match, documenting restoration of the new bytes.

## Preserved failures and qualifications

All recorded failures are in test code or static checks, not production source:

1. The first press evaluator rejected :focus-visible. Its next SVG-selector failure was seen in the tool result but not saved as raw bytes. The included 03b note is explicitly a transcription, not a captured log. The evaluator was corrected to skip combinator rules.
2. The first connection-test run timed out in 8 of 13 tests because earlier tests left TanStack onlineManager offline. After fixing test cleanup, the next run had two test bugs: an over-broad text matcher and an implicit-role section lookup. The third run passed all 13.
3. The first ESLint run reported one no-unsafe-call error in the test spy type; the type was corrected and the next run passed.
4. A meaningless toolbar length assertion was corrected before its first run. A DOM structure comparison that had passed once was replaced with an identity assertion and rerun.

The [complete handoff](evidence/worker/handoff.md.txt) carries the full behavior descriptions, test limits and failure chronology. The shorter [worker report](evidence/worker/report.md.txt), [source hash list](evidence/worker/hashes/source-sha256.txt), and exact [complete patch](evidence/worker/patches/complete.patch), [tracked-file patch](evidence/worker/patches/tracked-changes.patch), and [new-file patch](evidence/worker/patches/new-files.patch) are retained. The complete patch contains 18 paths and reproduces the source hash list on pristine HEAD when applied with autocrlf disabled.

## Open gates

This is source-freeze evidence, not a formal review or sign-off. Corrected-parent integration verification, independent native geometry/action QA, proportional opposite-family review, fresh Astra review, exact-target CI including e2e and coverage, and owner acceptance remain pending. Zero formal scans were consumed for the stationarity PR. The root inspection and final source status are in [root records](evidence/root/root-source-inspection.md.txt).

## Packet contents and integrity

The packet contains 35 exact source copies totaling 736,784 bytes, largest 199,180 bytes. It retains the worker handoff/report, all command logs, source hashes, exact patches, paired controls and restoration evidence, plus the two root source-freeze supplements. The source worker’s launch/exit files are represented by a safe metadata projection; raw event/result streams, latest progress text and runner stderr are not included. The separate stationarity baseline artifacts are not recopied.

See the [copy manifest](copy-manifest.json), [packet manifest](manifest.json), [link checks](link-checks.json), and [SHA-256 sums](SHA256SUMS.txt). .gitattributes disables text conversion under evidence/.
