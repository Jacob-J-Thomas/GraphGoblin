Both findings are fixed in `harness.ts`. The new tests fail on the original source exactly as I predicted and pass on the corrected source. Nothing is committed, staged or pushed, and this is not a sign-off: the scan2 CHANGES_REQUIRED stands, and independent QA, current CI and the fresh Astra scan3 still have to happen.

**The fix**
- **F1 (P2):** a check whose output was lost now reports that before any state is guessed from the partial stdout or stderr. A cut-off sign-in check therefore comes back `unknown`, with no `authenticated` field and the fixed text "Claude CLI check output could not be read." Stronger outcomes are unchanged and still come first: unconfirmed termination, cancellation, refused start, deadline, overflow and callback. Genuine sign-outs and turn handling are unchanged.
- **F2 (P3):** I added a private subclass of `ClaudeHarnessError` inside `harness.ts`, using the existing `HARNESS_TURN_FAILED` code, not retriable and not exported. It is created only where a check's start is refused and where a check's output is lost. The help wrapper leaves those errors alone, so their specific cause reaches both preflight and the turn's prerequisite refusal. Ordinary option failures still get "Claude CLI X failed the --max-turns/--help check." There is no text matching and no change to `process.ts`, `errors.ts` or `CHANGELOG.md`.
- **Docs:** one clause in `docs/06`. Its list of outcomes that override guessing from output was missing lost check output.

**Results**
- I wrote the code trace and a fixed list of predictions, and sealed their hashes, before running any test.
- **Existing tests on the original source:** all 120 passed, which confirms they missed these mixed cases.
- **New tests on the original source:** exactly the 19 predicted failures. Rerunning with the final, formatted test bytes against a temporarily restored original gave the identical 19.
- **Direct observation of the original source:** a cut-off sign-in check reported `authenticated: false` and the turn was refused as not signed in.
- **Four deliberate breakages of the fix:** each failed exactly the predicted tests (11, 9, 4 and 4). Each was reverted and the file hash checked.
- **Final run, once, on the frozen files:** 296 passed and 2 skipped, those being the two existing checks that run the owner's installed Claude CLI. Claude coverage was 99.55% statements, 98.72% branches, 100% functions and 100% lines, with thresholds not lowered.
- **Static checks:** infrastructure typecheck, lint, Prettier and `git diff --check` all pass. Two first attempts failed and are kept in the logs: Prettier flagged whitespace, and lint flagged a type cast I didn't need.

**Decisions for your catalogue (none blocks)**
1. A help-only refusal with `EACCES` or `UNKNOWN` now keeps "could not be started (EACCES)". That text existed before #364 and the old wrapper also replaced it, but it comes from the same start-refusal code, and the docs/06 table promises that wording.
2. Lost help output now outranks a recognised "unknown option" message. The result is `unknown` instead of `cli-incompatible`.
3. I edited `process-failure.test.ts` so the recognised-stderr cases go through the real stderr classifier rather than a scripted value. I edited `start-refusal.test.ts` to get a native Windows observation of the help-only check-folder refusal.

**Limits**
- Output-loss cases run on controlled seams only. No real pipe failure in a running process was produced or observed.
- In the native help-only cases the Windows refusal and the folder check are real, but the test removes the check folder for that one check to make only help fail.
- I ran on Windows only. I did not rerun the whole infrastructure package; your fresh CI covers that.
- I used `git write-tree` once at the start. It recomputed the existing HEAD tree from the untouched index.
- I wrote one temporary file list to Git Bash's `/tmp` and deleted it straight away.

The provider folder, brief and spec are untouched.

**Files I changed (stable, released)**

| File | SHA-256 |
| --- | --- |
| `packages/infrastructure/src/claude/harness.ts` | `79fd47db7d2749dd2a966f93771e74f2a929a9a8ea01b5c3fb35a11732d8b3b5` |
| `packages/infrastructure/src/claude/harness.test.ts` | `b24ab43f02c2f3da99cd75dc763d06412c81ddebb0a0f19ce2ec2c1ca9f4c960` |
| `packages/infrastructure/src/claude/process-failure.test.ts` | `ab1ce86fdefd6c5bfa58ffa70005a36a803af283c062b193179e7af60110fe4f` |
| `packages/infrastructure/src/claude/start-refusal.test.ts` | `f24e8ecd342940030fe453c3201419575c4186d9bd70bcd49e73d567180e1b44` |
| `docs/06-harness-integration.md` | `7e68b7bc3abc036ca38d5d3c230b5403dc79a5d16f3a4036b8ecaf8f59ca02d3` |

The source patch hash is `9849523aad98e461f95b11ee12757e691f1daa35f129402cf23ef8bafb26a7ea`. HEAD and tree are still `a04f6661`/`4442e996`.

Everything is in `C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i4-364-probe-author-01/author`. `SHA256SUMS` covers 110 files and has SHA-256 `25adae224f2c88047be664c2726b01aa18f0240f08c9f56bdb610ce8c5d90d9a`.
- REPORT.md
- source.patch
- commands.jsonl
- evidence-manifest.json
- SHA256SUMS