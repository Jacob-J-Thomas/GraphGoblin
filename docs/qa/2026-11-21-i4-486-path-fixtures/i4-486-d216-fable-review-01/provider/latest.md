# D216 targeted correction review — GraphGoblin #486 / PR 553

**Verdict: ACCEPT FIX.** The two-site change closes F1 and the adjacent journal-key mismatch, and weakens no assertion. I executed nothing; test results below are the author's or root's, and the rest is source reasoning.

## Source reviewed

- **Candidate:** `e630bb83679bdb055bdd90d2b30e25fbf60571ac`. The worktree `HEAD` points at `refs/heads/codex/gg-i4-486-d215-fix`, and that ref file holds this SHA.
- **Tree and parent:** tree `0713eef9779a14e68b8ca0461f784538ba116c9f` and parent `6de50cb8e22b92bfed5d6fe7bf14a2a10b95cd08` are taken from `dispatch-source-before.json` and author receipts 36 and 38, not recomputed.
- **Patch:** `correction.patch` reads identically to the author's `37-committed.patch`. It has one path, two hunks, 3 insertions and 2 deletions.
- **Checkout:** `fs.test.ts:136-137` and `:146` match the patch. Those are the only `realpathSync` calls in the file, and lines 86–165 of the before-copy differ from the current file only there.

## Why F1 is resolved

- **Temp root (`:136-137`):** the expectation is now `join(realpathSync.native(dataDir), 'workspaces', run.id)`. Production builds the same value from promise `realpath` (`owned-resources.ts:99-100`, `:200-212`), which is the native resolver.
- **Journal key (`:146-152`):** the expectation uses `realpathSync.native(path)` and the unchanged win32 `toLowerCase()` at `:147`. Production does `realpath(path)` then `resolve().toLowerCase()` (`:68-69`, `:120-121`), which is the same value for a native absolute path.
- **Lexical spelling kept:** for fixed, template and relative, `path` is still `target`, so script cwd (`:144`) and the result-file read (`:145`) stay lexical. This matches `workspace.ts:22-24`.
- **Not weakened:** every matcher is unchanged and exact (`:144`, `:148-152`, `:155-158`). Expected values are still derived from the test's own inputs. The new expectation is stricter: a production switch to the non-native resolver now fails under an aliased `TEMP`, where the old test would have passed.
- **Formatting and types:** the wrap is forced by `printWidth` 100 (the one-line form is 105 columns by my count). `realpathSync.native` returns `string` (`fs.d.ts:1544`).

The claim that both calls reach the same native binding is my knowledge of Node. It is supported by root's and the author's probes, where native and promise outputs were identical for uppercase, 8.3 and junction inputs on v22.23.4.

## Executed evidence (author and root, not mine)

| Control | Old source (`6de`) | Corrected source |
| --- | --- | --- |
| Uppercase `TEMP` | Root control 02: fails at `:143`, expected uppercase, received physical | Author 11: 1 passed, 19 skipped |
| Real 8.3 `TEMP` | Author 06: 3 failed (temp at `:143`, fixed and template at `:147`) | Author 13: 3 passed, 17 skipped |
| Ordinary and junction `TEMP` | — | Author 19 and 22: 20/20 each |
| G: checkout, C: temp, relative cases | — | Author 16: 2 passed, 18 skipped |
| Typecheck, file-scoped ESLint and Prettier | — | Author 24–26: exit 0 each |

The uppercase prediction from my earlier review held: old fails, corrected passes.

**Short-name evidence is real.** Probe 03 shows `cmd %~sI` yielding `C:\Users\98jak\GR58B7~1\D216-S~1` for an owned C: directory. The plain resolver kept the short components; native and promise resolvers expanded them. In run 06 the fixed and template cases got past the cwd and file-read assertions with the short spelling and failed only on the journal key. That directly shows cwd stays lexical while the journal follows the long physical name.

## Remaining material findings

None.

## Evidence limits

1. **Author-only passes:** every corrected-source pass is the author's. Root reproduced only the old failure.
2. **Pre-commit runs:** corrected runs used the working file under head `6de`. They bind to the commit by recorded blob `6720acb`. No test ran at `e630bb8` itself.
3. **Filtered subsets:** the 8.3 and uppercase runs covered three cases and one case. The full file ran only under ordinary and junction `TEMP`. The other tests are lexical by my reading.
4. **Short-name scope:** one host, one C: volume, alias on `TEMP` only. No run used an aliased checkout path (8.3, `subst`, mapped drive), so the relative case's journal key under such a checkout rests on source reasoning.
5. **No Linux run:** no POSIX execution exists for this head.
6. **No permanent guard:** by D216, no alias fixture joins the suite, so hosted Ubuntu unit tests will not catch a regression here.

## Non-material observations

- **Cleanup receipts:** receipts 14 and 23 record `[null]`, not `[]`, which is a serialisation artefact. The script's count guard passed, and I found no `gg-wp-*` files in the package or the fixture roots. Glob cannot see empty directories.
- **Leftover fixture root:** `G:/ggq/gg-i4-486-d215-fix/d216-process-temp` still holds a Node compile cache of about 1,361 files. It sits outside the repository.
- **Signature:** receipt 36 reports signature status `N` for the candidate commit.

## Scope examined

- **Read:** the brief, patch and binding; D216; my D215 report; root control 02; author `REPORT.md`, scripts, probe and receipts 03, 05, 06, 08, 10, 11, 13–16, 18, 19, 21–27, 33, 35–38; the root admission record; `fs.test.ts`, `owned-resources.ts`, `workspace.ts`, `physical-path.ts`; `AGENTS.md`, `docs/15`, `.prettierrc`; the `@types/node` 22.20.5 declarations.
- **Not examined:** the P3 helper, hook semantics and earlier accepted assertions (not re-audited, and the delta does not touch them); other packages; archives; held issues; manifest hashes.

## Still pending

The corrected-head independent Opus supplement, exact-head and current-target CI and native verification, coordinator completion and signed merge are not done. The Opus QA on `6de` cannot close F1. Scan 3 and my D215 negative on `6de` stand. This is not general scan 4 or a renewed Astra approval.