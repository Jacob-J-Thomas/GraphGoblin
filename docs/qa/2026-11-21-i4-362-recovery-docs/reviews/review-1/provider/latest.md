**Verdict: CHANGES_REQUIRED.** The runtime and the test change are fine. The fix for the documentation finding (O2) is incomplete: the user-guide line O2 specifically named still tells users to Resume, and the new text doesn't say that Replay also keeps the old command. The required changes are documentation only.

## What I reviewed
- **Original change:** source `5db3dfd4e2c96e53aa52b5a33403819da8c49196` (tree `c6fc1acd…`) against base `02351e2fb932b3be44e7cc3fb3943a61d568226c`. I read the whole four-file diff from the author's retained `candidate.patch`.
- **Current integrated head:** the worktree's branch ref `codex/gg-i4-362-batch-guidance` reads `b3f22d345aee3cbfbcd818ebb7980d962cafd2b1`. Its merge parents, per the root records, are `d284b9a4…` and current main `a84f988b…`. In the working tree the four changed regions match the patch byte for byte as far as I can read.
- **Integration:** the three merge conflicts (`.gitattributes`, `.prettierignore`, `CHANGELOG.md`) are plain additions of both sides. The #362 and #427 path blocks don't overlap, and the CHANGELOG keeps #362, then #427/#365, then #459. No problems found.

## Blocking findings

**F1 (medium): the O2 guidance fix is incomplete and now contradicts itself.**
- QA's O2 cited guide 03:273 as the misleading text and showed that Replay also fails again (QA `REPORT.md:147-151`, case A1-replay at `:119`).
- `docs/guide/03-run-and-observe.md:273` is unchanged and still says "Fix the start configuration, then Resume." Guide 07:98 sends readers there "for every contract code."
- `docs/guide/07-troubleshooting.md:150` still says "correct the missing command or start configuration and explicitly Resume."
- The new instruction "publish a corrected definition and start a new run" (`docs/04-node-catalog.md:157`, `07:168`) sits next to text that calls Replay a new run (`04:152`, `07:150`, `07:519`). But Replay keeps the pinned definition (`05-execution-engine.md:561`); only a fresh run uses the latest published version (`03-domain-model.md:151`). A user who publishes a fix and then uses Replay gets the same failure again.
- **Required:** qualify 03:273 and 07:150 so Resume applies to external fixes (such as a missing executable). Say that a change to command, arguments or working directory needs a published fix and a fresh run, not Resume or Replay, and link to `#windows-batch-commands`. Mention Replay in 04:157 and 07:168. The failed retries cause no side effects, so this is a correctness problem in the guidance, not a safety one.

**F2 (low, introduced): heading nesting in guide 07.** The new `### Windows batch commands` (07:154) was inserted between the "Find the symptom" paragraphs and the general symptom table. That whole table (07:172–218) now sits under the batch heading in the page outline. Move the subsection after the table, before 07:219; the link from docs/04 stays valid if the heading text is unchanged. On its own this wouldn't block.

## Confirmed correct
- **Runtime:** the PR #375 catch is present (`scripts.ts:128-134`) and `shell: false` is hard-coded (`:126`). The engine maps the refusal to `SCRIPT_START_FAILED`, a resumable failure code (`engine/src/handlers/script.ts:105-114`). No runtime fix is needed, and none was invented.
- **Test (`scripts.test.ts:358-385`):** it catches the real regressions:
  - an implicit shell or shell fallback fails the refusal check and creates the marker;
  - a removed catch makes `run()` reject;
  - a runner that refuses everything, or a broken fixture, fails the explicit `cmd.exe /d /c` check (expects exit 0 and the exact `effect\r\n` marker content).
- **Author check:** the filter in `checks.ps1:8` selects exactly the four claimed tests. Typecheck allows `process.env.SystemRoot` (`tsconfig.base.json:14`).
- **Other guidance text** is accurate: `shell: false`, `/d` disabling AutoRun, an absolute `cmd.exe` path, ordinary Resume being allowed versus uncertain-outcome consent, Resume keeping the pinned command, and Resume being fine after an external repair (QA case A3).
- **Dispositions:** I agree with O1 (NO-CHANGE; the probe text is a fixed internal label, not the public `SCRIPT_START_FAILED` code) and with O3 (no new API fixture).

## Non-blocking suggestions
1. **Quoting (from knowledge, not natively verified):** Node wraps and backslash-escapes each argument element for Windows, and `cmd.exe` doesn't parse those escapes. Embedding your own quotes inside an element after `/c` can break. Better advice: one path or argument per element, keep complex logic inside the batch file, and say explicitly that Liquid-templated arguments (`04:142`) after `/c` are interpreted by the shell.
2. Consider `.\build.cmd` in the example, so `cmd.exe` can't fall back to searching PATH when the current-directory search is disabled.
3. **Test robustness:** the batch body now actually runs with an absolute marker path. A non-ASCII or `%` character in the TEMP path could fail the explicit-shell check. A relative `>marker` (the working directory is already `dir`) plus `rm(..., { maxRetries })` would avoid that and keep the test's value.

## Pre-existing follow-ups (check for duplicates first)
- **P1: CI never runs this test.** The Coverage job runs on Ubuntu (`ci.yml:148-176`; its `coverage.log:962` shows `scripts.test.ts 47 tests | 4 skipped`). The Windows job runs only `test:windows-launcher` (`ci.yml:44-51`). So the 27 native-Windows passes don't include this test. The only execution evidence is the author's local run at `5db3dfd4` (4 passed, 43 skipped). Search the #488/#496 CI work for a declined Windows unit-test lane before filing.
- **P2:** EINVAL (batch file) and ENOENT (missing executable) produce identical public failures, the runtime message says "Resume tries to start it again", and the command field help just says "Program to run." QA noted overlap with #364, so check that issue first.

## Limits
I used only Read, Glob and Grep. I didn't run tests, Git or CI, and I didn't verify any Git or CI hashes, blob equality or archive seals. The CI results (run 44893807635 succeeded on all six jobs; run 44890908736 is historical) and the production-equality and integration proofs are root-collected records that I only read. The only identity I observed directly is the branch-ref file. This is formal review 1 only; independent QA, current-target CI, the Astra final audit and merge are still separate, and nothing here implies issue closure or owner acceptance.