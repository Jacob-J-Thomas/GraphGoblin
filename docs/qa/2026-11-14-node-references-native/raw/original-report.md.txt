I didn't find any product defect where #209's loop-name handling and #273's node rename meet. One new browser test still fails on its last line and needs your decision. Everything else passed: the build, the affected browser tests, the native pass, performance and whole-web coverage. Nothing is committed or pushed.

**The failing test.** `apps/web/e2e/rename-references.spec.ts` has 5 tests: 4 pass, and the focus/held-text test fails only its final check that the saved variables are unchanged. The browser trace shows the saved variables were already empty in the first save, before any rename. My test emptied the Variables field before typing the unfinished JSON, and that empty value removed the variable. Every behaviour check before that line passed: focus after the form reloads, the kept Variables text, the kept unfinished schedule, and the corrected settings template. I'd used both allowed correction rounds, so I didn't change it again. The two-line fix is in `proposed/variables-assertion-unapplied.patch`; it is not applied and not run.

**Combined code and fixes.** The automatic merge kept both features and nothing overlapped. I added one unit test for the case where a node is renamed while the loop's name is refused. The rename stays on the device, and taking the suggested name saves the whole renamed draft in one save. It passed on its first run. Whole-web lint failed at the starting commit because of my own phase-1 change: `renameNode` now returns its refusal message, which turned one existing call in `EarlierNodeOutputs.test.tsx` into an unawaited promise. I fixed that test line and kept the first failure log. I also added a docs09 sentence and named the new spec in its regression list.

**Native checks** (real Edge, built server and web, SQLite file, fake provider; 93/93 checks):
- **Starter `assistant` → `writer`:** the sibling template and the Exit are repaired, connections follow, and plain text, the JSON value and the script are byte-identical. Undo, redo and reload each saved once with the correct draft token, and the device copy matched the server. Version 1 is unchanged. Runs pinned to version 1 (before and after the rename) and to version 2 all succeeded with their own results, and reading the SQLite file directly agrees.
- **Publish:** a known missing gate saves but Publish is refused with 422 `NODE_REFERENCE_MISSING`, and the current version stays put. A direct existence check is only a warning and publishes.
- **Two tabs:** a rename in the stale tab gets 409, waits, and Overwrite sends the complete renamed draft.
- **Voice steps:** the three protected ids are read-only and can't be deleted. Renaming `respond` repairs the chat envelope.
- **Screens:** I looked at screenshots in both themes, at 360 px, desktop, 200% zoom and forced colours. Long ids wrap and nothing scrolls sideways. I didn't test screen-reader speech.
- The 8 existing affected browser specs passed 64/64 on the first run.

**Performance (300 nodes, Edge)**

| Keystroke to paint | Candidate median / p95 | Baseline median / p95 |
| --- | --- | --- |
| First 20 keys after load | 26.6 / 40.6 ms | 30.4 / 40.8 ms |
| Next 20 keys | 23.6 / 30.0 ms | 25.3 / 30.3 ms |

The baseline already misses the 16.7 ms frame budget on every keystroke at this size, and the candidate is no slower. The drag-routing gate passed on both builds with similar numbers (worst drag p95 3.5 ms).

**Coverage and checks.** Whole-web coverage at final source passed: 201 files, 2,500 tests, lines 98.51%, branches 93.99%. Typecheck, lint and formatting pass.

**Baseline checkout.** Its HEAD moved from 812f6f74 to 34cdf722 and then to 02567f87 while I worked; that was your work, and the new commits touch only test files and QA docs. The built files I compared stayed byte-identical before and after measuring.

**Observations, all pre-existing and left unchanged:**
- Choosing a review row for an Exit puts focus on the Returns "JSONata expression" option, not the editor; badge rows do the same.
- The message for an over-long node id doesn't mention the 64-character limit.
- The warning icon stays yellow under forced colours.
- At 360 px or 200% zoom, the rename notice fills most of the screen above the canvas.

Everything is stopped. Still open: your call on the patch, root `pnpm.cmd check`, current-head CI, the reviews, QA and audit, and #273 owner acceptance.

Everything is in `C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch/ui-273-claude-phase2/`; open `handoff.md` first (per-criterion results and hashes); logs are under `logs/`.