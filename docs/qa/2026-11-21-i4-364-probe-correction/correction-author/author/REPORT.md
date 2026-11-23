# #364 probe correction (D193) — author report

Worker: actual Claude Code, model `claude-opus-5-5`, configured xhigh (spec.json). Role:
implementation author under D193, **not** independent QA or review. Checkout
`G:/ggq/gg-i4-364-claude-start/GraphGoblin`, branch `codex/gg-i4-364-claude-start`. Uncommitted,
unstaged, unpushed; no GitHub, issue, provider, install or subagent action. The scan2
CHANGES_REQUIRED report (SHA-256 `4948e0b8…c637`) stays as it is; this is not a sign-off.

## Status

Both selected findings are corrected in `harness.ts`. The candidate passes every focused and
scoped check run here. Independent QA, current-head/current-target CI with native artifacts, and
fresh Astra scan3 remain.

## Bindings

| | Before | After |
| --- | --- | --- |
| HEAD / tree | `a04f6661a74a727e6c963d8648ea2998bb6dbe7b` / `4442e996f0a5c5d047b3978eedcde2d3fc0e6d69` | unchanged |
| Index | clean, 0 staged | 0 staged |
| Working tree | clean | 5 modified, 0 untracked |
| `harness.ts` | `bc45a184…bf1b` (blob `91b00200`) | `79fd47db…b3b5` (blob `b8cb0237`) |
| `process.ts`, `errors.ts`, `CHANGELOG.md` | `c44ed660…`, `8890262d…`, `295fd174…` | byte-identical |

Full hashes: `before-*.sha256|gitblobs`, `after-*.sha256|gitblobs`, `candidate-frozen.sha256`.
Byte copies of every original are under `original/`, listed in `original.sha256`, and verified
unchanged at the end. The sealed inputs (D193, scan2 report/binding/SHA256SUMS, brief, spec) were
re-verified unchanged.

## Trace and correction

`trace.md` was written before any change. In summary:

- **F1.** `checkOutcome` ran readiness inference (`probe && exitCode !== 0 && failureState`) before
  the lost-output guard. Inference reads recognised stderr (runner `failureState`) or the
  truncated stdout via `cliFailureState`. For an auth check at exit 1 or null it threw
  `HARNESS_NOT_AUTHENTICATED`, and `inspect` then set `authenticated: false`.
  **Fix:** the probe lost-output guard now runs right after the callback check. Termination,
  abort, start refusal, deadline, overflow and callback outcomes stay ahead of it. The
  positive-sign-out branch and every turn path are unchanged.
- **F2.** The help wrapper replaced every `HARNESS_TURN_FAILED` or `HARNESS_CLI_INCOMPATIBLE` with
  "Claude CLI <v> failed the --max-turns/--help check.", including probe start refusals and lost
  output. **Fix:** a module-private `class CheckProcessFailure extends ClaudeHarnessError`, fixed
  to `HARNESS_TURN_FAILED` with the default retriability (false). It is constructed only at the
  two `startFailure` probe returns and at the probe lost-output guard. The help wrapper skips its
  instances. The code, message, retriability, `name` and `instanceof ClaudeHarnessError` are
  unchanged. The class is not exported (it has no `export`, behind `export *`). There is no
  message matching, registry, process.ts or errors.ts change, or new dependency. Ordinary
  exit/stdin failures and inferred `cli-incompatible` keep the versioned guidance.
- **Docs.** `docs/06` gets one clause in the no-turn precedence paragraph. That paragraph already
  listed what stays authoritative over inference but omitted lost check output. It now says lost
  output comes next and infers no state, sign-out included. `CHANGELOG.md` is unchanged: its #364
  entry already describes the outcomes now kept, and no upgrade action applies.

Patch: `source.patch` (SHA-256 `9849523a…a7ea`). It touches 5 files with 481 insertions and 13
deletions (`git diff --numstat`). Production is `harness.ts` +18/−10. Tests are
`harness.test.ts` +301/−1 (the `basename` import), `process-failure.test.ts` +86/−0 and
`start-refusal.test.ts` +74/−2 (imports). Docs are `docs/06` +2/−0.

## Predictions versus results

`predictions.md` and `trace.md` were sealed (`predictions-trace.sealed.sha256`) before any test ran.

| Run | Source | Predicted | Observed |
| --- | --- | --- | --- |
| B0 `10-…` | original, existing tests only | all pass (they miss the mixed cases) | 120/120 passed |
| B1 `11-…` | original, new tests (pre-format bytes) | 19 failures: H1.1-6, H5.1-7, P1.1-4, N1, N2 | **19 failed / 138 passed, exactly that set** |
| B2 `12-…` | original, isolated observation driver | false auth fact; versioned F2 text | `authenticated:false`, `state:auth`, turn `HARNESS_NOT_AUTHENTICATED`; F2 versioned (`observe/observe-original.json`) |
| M1 `31-…` | corrected, guard moved back below inference | H1.1-6, H5.6, P1.1-4 (11) | **11, exactly** |
| M2 `34-…` | corrected, wrapper ignores private type | H5.1-7, N1, N2 (9) | **9, exactly** |
| M3 `37-…` | corrected, private type also at the ordinary exit/stdin site | H6.1-3 + existing max-turns version test (4) | **4, exactly** |
| M4 `40-…` | corrected, inference removed | H2.2, H2.3, H6.4, P2 (4) | **4, exactly** |
| A `52-…` | **frozen candidate, single final run** | all pass | **296 passed, 2 skipped (the owner-CLI checks), 13 files** |
| A-obs `54-…` | corrected, same driver | unknown/absent/fixed detail; F2 cause kept | as predicted (`observe/before-after.txt`) |
| B3 `61-…` | original via temporary rollback, **final** test bytes | the same 19 as B1 | **identical 19-failure set**; restored `79fd47db…` verified |

The counterfactual mutations each made a temporary edit to `harness.ts` (`scripts/mutate.mjs`).
The script requires its search text to occur exactly once. Each restore was SHA-256 verified, and
the frozen candidate was re-verified immediately before run A and after B3.

Observed public values for representative cases:

- **F1 auth-like stdout, exit 1 or null.**
  - Before: `state:auth`, `authenticated:false`, "Claude sign-in is missing or invalid. Run claude auth login…", turn `HARNESS_NOT_AUTHENTICATED`.
  - After: `state:unknown`, `authenticated` absent, "Claude CLI check output could not be read. Check that the Claude CLI starts and responds…", turn `HARNESS_TURN_FAILED` with the same detail, `definitely-not-submitted`, no `--print` process.
- **F2 help-only missing check folder** (version and sign-in passed, `authenticated:true`).
  - Before: "Claude CLI 2.1.285 failed the --max-turns/--help check."
  - After: "Claude CLI could not be started because its temporary check folder does not exist." in preflight and in the turn prerequisite.

## Tests added

All new tests go through `ClaudeHarness.preflight()` and/or `start()` and assert literal expected
text. No production helper is mirrored.

- **`harness.test.ts`** (R = controlled runner seam):
  - H1: F1 matrix — auth-like stdout ×{1,null}, recognised auth stderr ×{1,null}, quota, transport, and the explicit sign-out control.
  - H2: completed sign-in refusals stay `auth`/false.
  - H3: termination-unconfirmed, timeout and overflow stay ahead of lost output, on both the help and auth checks.
  - H4: cancellation through `session.cancel()` stays ahead of lost output, on help and on auth.
  - H5: F2 matrix — folder missing, folder is a file, unexplained ENOENT, unexplained EACCES, lost output at exit 0 / exit 1 with an unknown-option diagnosis / null.
  - H6: versioned controls — exit 1, null, stdin failure, recognised unknown option, missing required option.
  - Canaries for the bodies, binary, prompt and check-folder name/path are checked in both raw and JSON-escaped form.
- **`process-failure.test.ts`** (C = real runner and harness, mocked `spawn`/`killTree`, scripted streams):
  - P1: stderr `API Error: 401` with a stdout or stderr `EPIPE`, close 1 or null.
  - P2: completed-output control.
  - These are needed so that the actual stderr classifier, not a scripted field, produces the recognised-stderr leg.
- **`start-refusal.test.ts`** (N = native):
  - N1 and N2: real Windows spawn refusal and real `stat` observation for the help check only.
  - The test's runner removes the harness's own empty check folder (or replaces it with a file) for that one start and restores it. A guard asserts the folder is directly under TEMP and named `gg-claude-probe-<8 hex>` before any change.

## Checks (Node v22.23.4 first on PATH; `pnpm.cmd` 12.8.1; TEMP/TMP = scratch per process)

| Check | Result |
| --- | --- |
| Prettier `--check` on the 5 changed files | `20-S1` **exit 1** (2 test files): failure preserved. `--write` changed whitespace only (`21-S2-prettier-write-effect.diff`); `22-S3` and `25-S6` exit 0 |
| Infrastructure typecheck (`tsc -b tsconfig.build.json && tsc -p tsconfig.json`) | `23-S4` and `26-S7` exit 0 |
| Infrastructure lint (`eslint .`) | `24-S5` **exit 1**: `no-unnecessary-type-assertion` on my `as unknown as typeof spawn`; failure preserved. Cast removed (type-only); `27-S8` exit 0 |
| Scoped Claude suites and coverage (`vitest run src/claude --coverage --coverage.include=src/claude/**/*.ts`, owner-CLI checks filtered by name) | `52-A` exit 0: 296 passed, 2 skipped. **99.55% statements, 98.72% branches, 100% functions, 100% lines**; `harness.ts` 100% statements, 98.28% branches, 100% lines (`52-A-coverage-summary.json`). The repository 90% thresholds are applied and not lowered; there are no exclusions |
| `git diff --check` | `53` exit 0 |

All 30 commands, with their start times, argv and exit codes, are in `commands.jsonl`, and each
log is under `logs/`. `run.sh` refuses to overwrite a log, so no run was replaced.

## Decisions for root's catalogue (proposed; none blocks)

1. **Unexplained EACCES/UNKNOWN help-only refusal now keeps "Claude CLI could not be started
   (EACCES)."** That text predates #364, and the old wrapper also replaced it. It comes from the
   same start-refusal site, and the docs/06 table promises this preflight detail. Excluding it
   would need a code-specific condition. *Declined alternative:* keep EACCES versioned.
2. **Lost help output now preempts a recognised unknown-option stderr** (H5.6). The result is
   `unknown` with the unreadable detail, where it was `cli-incompatible` with "Update the Claude
   CLI". This is D193's precedence: incomplete output establishes nothing.
3. **Test scope beyond `harness.test.ts`.** P1/P2 run the actual stderr classifier; N1/N2 give a
   native observation of the folder refusal. I judged both needed for the selected controls. No
   other file was edited.

## Limits

- **Lost output is controlled-only.** The output-loss legs use the R and C seams. No native
  started-process pipe fault was produced or observed; the prior native ENOTCONN applied to
  processes that never started.
- **Native help-only selection is induced.** In N1/N2 the Windows refusal and the `stat`
  observation are native, but the test makes only the help check fail. N2 runs on Windows only.
  N1 also runs on POSIX, but only Windows was executed here; Linux and macOS were not run.
- **Owner CLI.** The 2 existing owner-CLI readiness checks in `readiness.test.ts` were filtered
  out by name and reported skipped. No owner account, provider, network or model turn was used.
- **No whole-infrastructure run.** Whole-infrastructure tests and coverage were not rerun
  (known host symlink EPERM). Root's fresh CI provides the full package gate.
- **Typecheck build outputs.** `tsc -b` writes ignored build outputs (dist, tsbuildinfo) in the
  checkout; `git status` shows none.
- **`git write-tree` at before-binding.** It was run once. It derived the untouched index's tree,
  which equals the HEAD tree `4442e996…` and already existed. No index or ref changed.
- **Evidence-only driver.** The observation driver (`observe/`) is not repository code and uses
  the R seam.
- **Scratch folder kept.** `G:/ggq/qa-scratch/i4-364-probe-correction-01` holds the frozen copy,
  the pre-format copies, coverage output and the Node compile cache. It contains no leftover
  check folders.

## Owned files (stable; released)

| File | SHA-256 | Git blob |
| --- | --- | --- |
| `packages/infrastructure/src/claude/harness.ts` | `79fd47db7d2749dd2a966f93771e74f2a929a9a8ea01b5c3fb35a11732d8b3b5` | `b8cb02379064e83602dc1f4fd7b7acfb3eb360c7` |
| `packages/infrastructure/src/claude/harness.test.ts` | `b24ab43f02c2f3da99cd75dc763d06412c81ddebb0a0f19ce2ec2c1ca9f4c960` | `de34ccf2f0788e37fe7d9418ff42217416409a72` |
| `packages/infrastructure/src/claude/process-failure.test.ts` | `ab1ce86fdefd6c5bfa58ffa70005a36a803af283c062b193179e7af60110fe4f` | `676641650617a84f7db892e05e3d7161d6914f35` |
| `packages/infrastructure/src/claude/start-refusal.test.ts` | `f24e8ecd342940030fe453c3201419575c4186d9bd70bcd49e73d567180e1b44` | `86ef9808878554cdb42b743fe739edcf0332b377` |
| `docs/06-harness-integration.md` | `7e68b7bc3abc036ca38d5d3c230b5403dc79a5d16f3a4036b8ecaf8f59ca02d3` | `104c95ea1da5c63041abdb360ebbacc2e0a76d32` |
