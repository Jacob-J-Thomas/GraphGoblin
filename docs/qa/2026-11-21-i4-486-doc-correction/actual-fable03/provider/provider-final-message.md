# Verdict: ACCEPT FIX

The two D209 sentences and the single D211 attribute rule are accepted on static inspection at head `29e165e14fdda138300ba2a34585ddd47268b475`. I found no introduced defect in these three deltas. This is not a gate pass: CI attempt 44934348117 remains failed, with the `e2e/pwa.spec.ts:536` cause unresolved, and nothing here changes that.

## D209: recovery sentences

`CHANGELOG.md:7` and `docs/guide/03-run-and-observe.md:273` each contain the selected replacement exactly, and the rest of each paragraph is intact. The old "publish a new version before starting a new run" wording survives only in the sealed transcript (line 8), not in current docs.

| Claim in the sentence | Source read |
| --- | --- |
| UI **New run** uses a published version | `RunLauncher.tsx:90-93` filters to `published`; `:25-29` sends `versionId` with no `allowDraft`; `:94` warns when none is published. `apps/web/src` has no `allowDraft` use, and `RunsPage.tsx:35` calls New run the only place the app starts runs. |
| REST can start an editable draft | `runs.ts:84-85` accepts `versionId` and `allowDraft`; `:108-109` forwards them. `run-manager.ts:3413-3414` refuses a draft without `allowDraft`; `:3406-3411` refuses a snapshot ID. |
| Default API start stays published | `runs.ts:96` falls back to `loop.currentVersionId`, which `sqlite/loops.ts:485-496` sets on publication. `run-manager.ts:3399` otherwise takes the latest published. `allowDraft` alone selects no draft. |
| Existing runs keep their definition | A draft start freezes a new snapshot (`run-manager.ts:692`, `definition-pin.ts:86-95`). Replay forks with `source.versionId` and `source.pinned` (`:1785`, `:1809`, `:1825-1826`). Resume re-admits the same run (`:1416-1475`). |

- **No automatic UI publication implied:** "publish the correction before starting it there" is a user action.
- **No universal publish requirement implied:** the REST draft path is offered in the same sentence.
- **No changed pins implied:** the guide continues "Resume is unavailable for a deterministic fault in the pinned version", and the changelog continues "Previously recorded history retains its original copy and recovery eligibility".
- **No conflict with the MCP limit:** MCP `start_run` cannot select a newer draft of a published loop (`guide/05:66`), but the sentence names `POST /loops/{id}/runs` explicitly.

Two non-blocking observations, neither a defect:
- Neither span repeats the trigger-arming consequence of publishing or the "freezes a new snapshot" detail. Both remain at `guide/03:175`.
- Line 273 does not link `#start-through-the-api`, where lines 275 and 291 do.

## D211: attribute rule

- **Exact rule:** `.gitattributes:223` is the specified rule, under a comment at line 222. It is the only `conflict-marker-size` entry in the root file, and a grep of every `.gitattributes` in the tree found no other.
- **Scope:** the pattern is a literal root-anchored path with no glob characters, so it matches one file. It sets only `conflict-marker-size`; `-text -whitespace` from line 219 still apply, so byte preservation is unaffected.
- **No overrides:** `docs/qa/.gitattributes` has no rule reaching the #486 archive, and the archive has no nested `.gitattributes`.
- **Markers:** the transcript has exactly three seven-character marker lines (7, 9, 28) and no 32-character runs. No other file in the #486 archive has a line-start marker. `CHANGELOG.md`, guide 03, `.gitattributes` and `.prettierignore` have none.
- **Root proofs agree:**
  - `d211-full-check-before.stdout` and `diff-check-attempt2.stdout` list exactly those three lines.
  - The after-check stdout and stderr are empty, and the precommit record shows exit 0 with no unmerged entries.
  - The before/after attribute snapshots differ only by the appended comment and rule.
  - Effective attributes are 32 for the artifact and unspecified for `run-manager.ts`.
- **Ordinary detection preserved:** every other path, including `CHANGELOG.md` where the conflict arose, keeps the default of seven.

One confined residual: a future real conflict in that one file would not be flagged by `--check`. Its seal hash is the control.

## Limits

- **Read-only:** I ran no git commands, tests, builds or formatters. That the higher marker size suppresses the `--check` finding is from my knowledge of Git plus the supplied before/after outputs, not from execution.
- **Head binding:** I read working-tree files. The branch ref resolves to the frozen head, but I could not confirm a clean tree, tree `d50fb576…`, or blob identity.
- **Supplied, not recomputed:** all SHA-256 values, the 187,030-byte length, the 1,534-entry match, the subtraction proofs, the D197 runtime evidence, D212/D213 and the claim that the earlier failure files are unmodified originals.
- **Not traced:** the executor's reads of `run.versionId` (grep only), `.git/info/attributes` and global attributes, and Prettier conformance of the two edited lines.
- **Reads beyond the listed records:** two tiny files in the shared git dir (worktree `HEAD` and the branch ref), `docs/qa/.gitattributes`, and a few small root-publication proofs. Of the transcript I read only lines 5–11 and 26–30, plus count-only pattern scans.
- **Not reviewed:** the PWA failure, #555/#556, the wider D197 paragraphs, ADR-0088 and anything outside the three deltas.

Fresh all-success CI on the final head and current target, canonical native verification and general scan 3 all remain required. A later pass cannot establish or erase the cause of the failed attempt.