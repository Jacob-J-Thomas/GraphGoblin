**Verdict: ACCEPT CORRECTION.** I found no blocking direct regression and no missing material criterion. F1 and F2 are both resolved in the three changed docs. This is formal scan 2 of 3 only: it doesn't approve merging, closing the issue, human acceptance or any other gate.

## What I reviewed
- **Corrected source:** head `38223fd6104a8212ce8bbf6d8d75e8a0d297cbf4`, with stated tree `5afdcbc0…` and parent `b3f22d34…`, against target main `a84f988b…`.
- **The one identity I read directly:** this worktree's `HEAD` points to `refs/heads/codex/gg-i4-362-batch-guidance`, and that ref file reads `38223fd6…`. I didn't check the tree, parent, file hashes or any CI.
- **The change:** I read `source.patch` from the doc-freeze receipt. The working-tree text of `docs/04-node-catalog.md:154-160`, `docs/guide/03-run-and-observe.md:273` and `docs/guide/07-troubleshooting.md:148-220` matches the patch as far as I can read. The receipt and the before/after record agree that only these three docs changed.

## F1 (wrong Resume/Replay guidance): resolved
- **guide 03:273:** an external fix (example: a missing executable) leads to Resume. A change to command, arguments or working-directory configuration leads to a published correction plus a fresh run. The text says neither Resume nor Replay applies that change, because both keep the pinned version, and it links to `07-troubleshooting.md#windows-batch-commands`.
- **guide 07:150:** the same distinction, with a same-page `#windows-batch-commands` link. The old phrases "Fix the start…", "start configuration" and "correct the missing command" no longer appear anywhere in `docs/guide/` or `docs/04`.
- **docs 04:156-160:** Resume and Replay both keep the pinned command, arguments and working-directory configuration. Correcting them needs a published fix and a fresh run. Resume after an external repair is still allowed. The link `guide/07-troubleshooting.md#windows-batch-commands` is a correct relative path.
- **guide 07:207-208 and 216-218 (the batch subsection):** both now name Replay alongside Resume.

**The source and contract agree with the new wording:**
- Replay takes no version input: `ReplayRunInput` (`run-manager.ts:181-191`) and `ReplayIntentSchema` (`contracts/src/run.ts:300-304`).
- `05-execution-engine.md:182` says replay forks keep the source's `versionId` and `pinned`; `:561` says the same of the pinned definition.
- `03-domain-model.md:149` pins the definition through resume and replay forks; `:151` says new runs use the latest published version.
- The guide already agreed: `03:76` and `03:181` ("on the same pinned definition").

**The QA evidence the wording relies on is consistent** (from the independent QA report): A1, A2 and A1-replay fail again on the pinned definition; A3 Resume works after the executable is restored; A5 shows explicit `cmd.exe /d /c` works.

## F2 (heading nesting): resolved
In guide 07, `## Find the symptom` (148) is followed by its two paragraphs, then the general symptom table (154–199), then `### Windows batch commands` (201), then `## HTTP probe exceeds 64 KiB` (220). The table is back under its own section, and the heading text, and therefore the anchor, is unchanged.

## Direct-regression checks (none found)
- **Guide example test:** `apps/api/src/guide-examples.test.ts` lists every triple-backtick block in guide 03. The edited paragraph contains no such blocks, so the test's inputs are unchanged.
- **Tooling:** no tooling or app source refers to guide 07, the `windows-batch-commands` anchor or `act-on-failure-reasons`.
- **Formatting:** Prettier reported all three files "(unchanged)". `.prettierrc` uses the default prose-wrap setting, which keeps long lines as written, so the formatting check is unaffected.
- **Other guidance:** the MCP code and the plugin skill text give no advice that conflicts with the new wording.

## Concrete refutation test
The correction would be wrong if Replay or Resume ever ran a corrected definition. To test it natively:
1. Create a script node whose command is a `.cmd` file directly, start a run, and get `SCRIPT_START_FAILED`.
2. Publish the corrected version (`cmd.exe` with `["/d","/c","x.cmd"]`).
3. Replay the failed run at that node, and separately Resume it.
4. Expect `SCRIPT_START_FAILED` again in both cases, with the fork's `versionId` equal to the source's.
5. Start a fresh run: expect success on the new `versionId`.
6. Separately: start with a missing executable, put the executable back, then Resume: expect success.

The independent QA already observed this (A1/A2/A1-replay, A3, A5). I did not re-run it, and the source reading above agrees.

## Optional and pre-existing notes (none block)
1. **Long lines:** 04:159 and 07:217 run past the hard wrap of the paragraphs around them. This is cosmetic only and doesn't affect the formatting check.
2. **"New run" ambiguity (pre-existing):** generic text at guide 03:289 ("start a new run") and 07:520 ("Replay is a deliberate new run") could still be read as including Replay. The corrected script paragraphs and 03:181 resolve this for scripts.
3. **Subloop edge case (pre-existing):** if a child loop's script fails, a fresh parent run picks up the corrected child only through a `latest` subloop reference (`03-domain-model.md:152`). A reference pinned to an explicit version also needs the parent definition updated.
4. **In-repo archive:** `docs/qa/2026-11-21-i4-362-batch-commands/README.md` is a sealed record of the original `5db3dfd4` candidate. It lists only docs 04 and 07 and still says formal review is pending. That is as intended under D187, but the root's publication will need to record this correction and the review outcomes outside the sealed subtrees.
5. **Carried over unchanged, as D187 intends:** the inspector message "Resume tries to start it again", identical public failures for a batch file and a missing executable (formal 1's P2, overlapping #364), the gap where no CI job runs the Windows-only `scripts.test.ts` cases (formal 1's P1), and formal 1's optional suggestions on quoting, `.\build.cmd` and the TEMP marker.

## Limits
I used only Read, Glob and Grep. I ran no commands, tests, Git, CI, formatter or provider calls, and made no edits. I verified no SHA-256 values, tree or blob identities, archive seals or CI results; the formatter log and receipts are root-collected records that I only read. A fresh normal CI run on the new head and the final Astra scan 3 are still required.