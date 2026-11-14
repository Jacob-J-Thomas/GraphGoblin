# PR469 U22 research evidence review (scan 2 of 3): READY

**Reviewer:** Claude Opus 5.5 (`claude-opus-5-5`). I can't observe my own reasoning-effort setting, so I can't confirm the xhigh launch myself.
**Scope:** only the GPT-authored U22 research records: `docs/qa/2026-11-14-i08-u22-baseline/`, their provenance in `docs/qa/2026-11-14-input-presence/`, and the register line that summarises them. I did not review the #235 input-form implementation (scan 1 covers it).
**Candidate:** head `e0ff50c5e8fadd4fa53ed30d4e659e670fdf3139`, target main `cee2fd721b19f93a3c68f7b7ecf01fed7850c90f`. The research itself was run against historical baseline `b3b5e1874a8252cc01c065d18fef42cbfbe075b4`.

## 1. Verdict

**READY** to publish these evidence claims at this head and target. The raw recordings support all three narrow statements:

- **Three union paths** (Wait, Mutate, Decision) display and save the selected values.
- **Eighteen valid decision connections** (15 static + 3 dynamic) agree before and after reload.
- **Manual geometry** is preserved in both the server and device-first fixtures.

The non-reproduction is framed honestly and the baseline is explicit. No fix is claimed and owner acceptance stays pending. The BadID case is described as a validation refusal, not as the owner's failure. The owner's reload-only screenshot is acknowledged. Nothing here closes #64, #125, #221, #323 or #235.

## 2. Blocking issues

None.

## 3. Non-blocking follow-ups

All are P3 and none is introduced by product code. Dispositions: F1, F2 and F3 are FIX-IN-PR only if the root cuts another head anyway, otherwise DEFER-ISSUE. F4–F7 are NO-CHANGE (recorded limitations).

**F1. Wording overclaim in the README's #64 row (README.md:7).**

- **Claim:** "Duration 13 and signal name i08-signal agreed across browser state, captured draft PUT, independent REST GET and full reload."
- **What the data shows:** Duration 13 was checked on screen, in the PUT and via GET, but it was replaced by signal before any reload. Only the final signal state was reloaded.
- **Also:** the probe's on-screen check (`union-wait.playwright.js:13-22`) never reads the Name field. The displayed `i08-signal` is shown only in `screenshots/union-wait-after.png`, after reload (I viewed it).
- **Correction:** say duration agreed across the visible field, PUT and GET; the final signal state agreed across PUT, GET and reload, with the reloaded Name shown in the screenshot.

**F2. Imprecise method description for the #125 device-first case (README.md:9 and :12).**

- **Claim:** geometry survived "while only that loop's API requests failed" / "blocking the loop's API requests".
- **What the data shows:**
  - `geometry.result.json` records exactly one PUT for the device-first fixture.
  - The server was unchanged at both the edited and the reloaded reads, and was updated only after access was restored.
  - The before-reload screenshot shows "Unsaved changes" (no save attempted yet).
  - The after-reload screenshot shows "Checking the server and this device before saving changes".
  - Source context: autosave schedules no save until the editor is reconciled with the server (`useAutosave.ts:244`, `EditorPage.tsx:479-483`).
- **Conclusion:** the draft save was never attempted, or refused, while requests were denied. The single PUT is the sync after restore.
- **Likely cause (not executed):** in Playwright globs a single `*` does not match `/`, so the deny pattern `**/loops/<id>*` (`geometry.playwright.js:61`) probably covered only the loop read, not `/loops/<id>/draft`.
- **Impact:** the case shows a device-only draft surviving a reload while the loop read was denied. It does not show a refused save. The preserved-geometry claim stands.
- **Correction:** state that only the loop read was denied, no draft save was attempted during the denial, and the one PUT is the post-restore sync.

**F3. Stale provenance statement in the sibling folder (`2026-11-14-input-presence/README.md:30,32`).**

- **Claim:** "All 31 entries matched" and "The source README and active worktree were not edited."
- **At e0ff:** the in-place U22 `README.md` is the formatted replacement. Its git blob is `c7896367`, identical to the canonical-replacement copy (exact.diff lines 5903 and 62893), which the readback records as sha256 `047aa07…`, 7133 B. It no longer matches the 31-file manifest's entry (`23dba59e…`, 5094 B).
- **Also:** `integration-readback.json` binds only the canonical-replacement path. None of the other 30 byte-preserved U22 files are among its 209 checks. At the final head they are bound only by the pre-integration hash lists (phase 1/2/3 lists `ed06d639…` and `u22-baseline-verification.json`).
- **Content is fine:** the README text matches the raw copy word for word; only table padding differs.
- **Correction:** add one sentence recording the in-place README replacement and its expected manifest mismatch. Optionally add the 30 raw U22 files to the root's readback.

**F4. Hard-coded counts in the verifier.**

- `verify-evidence.mjs:57` prints `unionPaths:3`, `validDecisionDrags:18` and `geometryPaths:2` as literals.
- It asserts the 15 static drags (line 26) but never checks that the dynamic probe made exactly 3, nor that the dynamic edges rendered after reload.
- I checked the raw data by hand and 18 is correct. The file is byte-preserved JS, so don't edit it; use derived counts in future bundles.

**F5. Rounded coordinate.** README.md:12 gives y = `400.085324232082`; the raw value is `400.0853242320819` (15-significant-digit rounding). Cosmetic.

**F6. Environment claims not backed by files in the bundle.**

- "Frozen install and all 11 cached build tasks" has no build log in the bundle.
- "all four relevant store lock paths" isn't verifiable: `cleanup.json` shows `existingLocks: []` without naming the paths checked.
- `gateway.mjs` checks the baseline HEAD but not that the worktree was clean.
- `gateway.json` does record the content-hashed built asset filenames, which partly compensates.

**F7. Register line doesn't name the baseline inline (register diff line 1208).** It links to the README, which does. Note that `b3b5e187` predates the merges of PRs #461, #462 and #463, so the current editor was not re-exercised. Adding "at baseline b3b5e187" inline would be clearer.

## 4. Per-report disposition

| Report              | Supported claim                                                                                                                                                                                                                                                                                                                                                                                                    | Key evidence                                                         | Disposition                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| #64 union state     | Wait input→duration→signal cleared timeout 173 and then 59; values agreed on screen, in PUT and in GET; the final signal state survived reload. Mutate set→delete: Path cleared, then `/vars/new-probe` reached PUT, GET and reopen. Decision expression→LLM: JSONata control removed, routes, labels and `maxPasses` kept through reload.                                                                         | `union-wait.result.json`, `union-additional.result.json`, screenshot | Not reproduced; supported (wording per F1)                                                       |
| #221 decision ports | 15 drags = LLM 3 + Score 2 + Expression 3 + Noul 3 + Choice 4, including 4 limit-reached (Score has no repeat route). Modal options equal canvas IDs; every edge rendered right after saving; edges unchanged after reload; device draft synced. Dynamic probe: replaced/new/repaired IDs connected and persisted, `yes-edge` kept. "Bad ID" refused via the modal only (no canvas drag tried) with nothing saved. | `outputs.result.json`, `outputs-dynamic.result.json`                 | Not reproduced; the owner's modal mismatch and reload-only rendering are correctly distinguished |
| #125 geometry       | Exhausted node moved (1260,320)→(1167.59…,400.085…); both manual routes `[215,366,412.5]` and `[1176,-18,608]`; DOM transforms and SVG paths identical before and after reload in both modes.                                                                                                                                                                                                                      | `geometry.result.json`, 4 screenshots                                | Not reproduced; supported (method note per F2)                                                   |
| #323 investigation  | One explicit result per report; no speculative fix.                                                                                                                                                                                                                                                                                                                                                                | All of the above                                                     | Valid unconfirmed outcome                                                                        |

## 5. What was read, and what was verified

**Read:**

- REVIEW-COMMON, `AGENTS.md`, `docs/README.md`, `docs/15-issue-workflow.md`; `identity.txt`, `gate-status.md`, `ci-jobs.json` (only checked that it mentions the head SHA and run ID), `u22-contracts.json`, the research brief and spec.
- All 31 files of the U22 bundle. The 7 PNGs are covered by manifest hashes; I viewed 6 of them.
- In the sibling folder: README, raw README, 31-file manifest, verification JSON, phase-1 hash list, Markdown publication hashes, publication manifest.
- `integration-readback.json`, the U22 and register hunks of `exact.diff`.
- Source for context only (this is the e0ff source, not b3b5e187): `useAutosave.ts`, `EditorPage.tsx:440-510`, `model.ts:226-235`, and where `JsonSchemaForm` is used.

**Identity confirmed with Read tools:**

- The worktree `.git` file points to `…/.git/worktrees/GraphGoblin24`; `commondir` is `../..`.
- `HEAD` → `refs/heads/codex/gg-20261114-i08-input` = `e0ff50c5`; `origin/codex/gg-20261114-i08-input` = `e0ff50c5`; `origin/main` = `cee2fd72`.
- The local `refs/heads/main` is stale at `b3b5e187`; it is not the target.

**Done myself:** I re-derived every assertion in `verify-evidence.mjs` by reading the raw data, and confirmed the counts and cross-surface equalities above.

**Taken on trust, not checked:** CI (`gate-status.md`), the exact-diff SHA-256, the 209-blob readback, and all SHA-256 manifest values.

**Limitations:**

- Read/Grep/Glob only: no shell, git, hashing, browser, or running the verifier.
- Byte identity rests on retained manifests and abbreviated git blob IDs in the diff.
- The Playwright glob behaviour behind F2 is inferred, not run.
- I didn't read the external evidence directories or `ci-jobs.json` in full.
- Screenshots that were not retained in the bundle were not reviewed.

## 6. Scope and gates

- The #235 input-form change is a separate surface: `JsonSchemaForm` is used only by `RunLauncher` and `WaitPanel`, not by editor node forms.
- Raw JSON, JS and PNG files are byte-preserved under `.prettierignore` and `* -text`; the QA Markdown is formatted, as `docs/15` requires.
- No source change, execution, publication or owner operation was made.
- This is one cross-family gate. Independent QA, CI and the scan-3 Astra audit remain separate.
