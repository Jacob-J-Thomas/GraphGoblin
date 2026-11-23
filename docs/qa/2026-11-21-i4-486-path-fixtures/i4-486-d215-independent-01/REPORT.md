# D215 independent criterion QA — actual Opus 5.5 / xhigh

**Verdict: CRITERION PASS for the admitted D215 scope at `6de50cb8e22b92bfed5d6fe7bf14a2a10b95cd08`, with stated residual limits.**

The six admitted scenarios passed, and each control behaved as planned: the baseline control failed where expected and the corrected fixture passed. The gates were clean, and the source checkout and index ended byte-identical to the binding. One residual limit matters for the coordinator.

- **Residual risk (R1, below):** the corrected P2 expectation uses JS `fs.realpathSync`, while production resolves with native `realpath`. On this host the two diverge for 8.3 short names. This was traced from the API and the source; it is not an observed test failure.
- **Newer author commit:** during this QA the author committed `e630bb8`, a direct child of `6de50cb`, which switches the test to `realpathSync.native`. This QA does not cover `e630bb8`.

This is criterion QA only. It is not a general scan 4, not a renewed Astra approval, not cap completion and not merge permission. General scan 3 on `b812` stays **CHANGES_REQUIRED**. Hosted CI and native verification, the Fable delta review and the D035/D042 coordinator disposition remain root-owned.

## Source under test

| Item | Value |
| --- | --- |
| Head / tree | `6de50cb8e22b92bfed5d6fe7bf14a2a10b95cd08` / `34b80f155c8434abc69fc72105ae7462fc460377` |
| Direct parent (b812) / tree | `b8126de18080b76b15cbbbbc00fd791030fec3e1` / `86f422bb091515defe3d612df660988e5b47ffeb` |
| QA checkout | `G:\ggq\gg-i4-486-d215-qa\GraphGoblin` (detached, sparse without `docs/qa/`) |
| Baseline fixture | `baseline-fs.test.ts`, 16,988 B, sha256 `82039a8f…bdd21c`, git blob `a966e08` (= b812 blob) |
| Corrected fixture | `candidate-fs.test.ts`, 17,322 B, sha256 `b8012a86…db9e41`, git blob `3e385dc` (= head blob) |
| Index before/after | 5,667,994 B, sha256 `97bbcc40…16dae2` (unchanged); tracked-index sha256 `14b8f818…2d5146` (unchanged) |
| Lock before/after | `pnpm-lock.yaml` sha256 `bcc908d0…bcce2` (unchanged; same blob `6bdbb2d` in b812 and head) |
| Dependency metadata | `node_modules/.modules.yaml` sha256 `7b90437a…c4ae` (matches binding before and after) |

The baseline control runs on production inputs identical to b812, and preflight proved it ([00-preflight.json](qa/raw/00-preflight.json)):

- `git ls-tree -r` lists 38,434 entries at both b812 and head, and exactly one differs: `packages/infrastructure/src/fs/fs.test.ts`.
- HEAD^ is b812.
- The working tree was clean against HEAD.
- The lock blob and the dependency metadata match.

Scenarios 1 and 2 therefore use the b812 fixture on b812 production inside this QA checkout. This is **not** a separate pristine b812 checkout.

Platform: Windows 11 Pro 10.0.26300 x64. Node v22.23.4 is first on PATH, and every observed vitest main and worker process reported it. pnpm.cmd 12.8.1, git 2.49.0.windows.1. Volume serials: C `2894493802`, G `810877956`.

## Method

- **[runner.mjs](qa/tools/runner.mjs)** runs one phase per process, so each tool call stays bounded.
  - Every test invocation is `pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run src/fs/fs.test.ts [-t "<one test name>"] --reporter=verbose --reporter=json`. That is the package's `test` script (`vitest run`) plus filters and reporters.
  - All evidence files are created exclusive (`wx`), so nothing was overwritten or silently re-run.
- **Baseline swap (scenarios 1 and 2 only).** The current corrected bytes were verified and saved first ([saved-corrected-fs.test.ts](qa/raw/saved-corrected-fs.test.ts)). Inside `try/finally`, the runner wrote the exact baseline bytes, ran one invocation, then restored the saved bytes and re-hashed. During each swap git showed ` M` (unstaged); after each restore it showed empty status and the corrected sha ([s1 swap](qa/raw/s1-baseline-ordinary-g-temp-engine-temp.swap.json), [s2 swap](qa/raw/s2-baseline-junction-g-temp-engine-temp.swap.json)). Every later phase refused to start unless the fixture was the corrected sha.
- **[child-observer.cjs](qa/tools/child-observer.cjs)**, loaded through a process-local `NODE_OPTIONS=--require`, records these items in every Node child:
  - pid/ppid, version, argv, cwd and cwd volume;
  - TEMP and `os.tmpdir()`, with its volume and both JS and native realpath;
  - the fixture sha at process start.
  In vitest processes it can also install **passthrough taps** on `fs.mkdtempSync`, `fs.realpathSync`, `path.relative` and `path.resolve`. Each tap calls the original and returns its result unchanged, and logs only calls whose arguments contain `gg-wp-`, with the call site. Scenario 3, the ordinary unit run, used record-only mode with no taps.
- **Watchers.** Recursive `fs.watch` watchers in the runner (outside the test process) recorded real filesystem effects. They watched the TEMP physical root and the checkout package directory, the latter filtered to `gg-wp-relative-*`.
- **Instrumentation revisions** ([runner-revisions.jsonl](qa/raw/runner-revisions.jsonl)). The exact copies used for p0/S1/S2 are preserved as [rev1 observer](qa/raw/instrumentation-rev1-child-observer.cjs) and [rev2 runner](qa/raw/instrumentation-rev2-runner.mjs).
  - git stderr handling was changed after preflight.
  - A worker-only C TEMP was added before S5 (see the next point).
  - A read-only gate-coverage phase was added after the gates.
  No test was re-run because of a revision.
- **Worker-only C TEMP (S5).** S2's watcher showed that vitest 5's **main** process writes about 222 transformed-module files to `os.tmpdir()/<nanoid>/ssr/` (`Vitest._tmpDir`, read in the installed `vitest/dist/chunks/index.DpLw24bj.js`), then deletes them. To keep this cache on G as the brief requires:
  - The main process kept the ordinary G TEMP.
  - The observer set `TEMP`/`TMP` to the C directory only in the fork worker that executes tests, at preload time, before any vitest worker or test code ran. It recorded the inherited value alongside.
  The worker's `os.tmpdir()` therefore read C, which is the only thing the fixture uses. The C watcher saw only the test's `gg-wp-e3-*` data dirs. The 221 transform files went to G and were removed.

## Native fixtures (controlled, not naturally encountered)

These records come from [01-fixtures.json](qa/raw/01-fixtures.json), [20-cross-setup.json](qa/raw/20-cross-setup.json) and [p0 probe](qa/raw/p0-pnpm-exec-argv-probe.stdout.txt).

- **Owned G root:** `G:\ggq\qa-scratch\i4-486-d215-independent-01\opus-qa-mwqzh0i9-937e879a`, with `ordinary-temp` (lexical = physical, verified) and `junction-physical`.
- **Junction:** `junction-alias` was created with `fs.symlinkSync(…,'junction')`.
  - `dir /AL` shows `<JUNCTION> junction-alias [...\junction-physical]`.
  - `fsutil reparsepoint query` reports tag `0xa0000003` (Microsoft, Name Surrogate, Mount Point).
  - Identities: the reparse point's own lstat ino is `844424933534346`, the physical dir's is `844424933534345`, and following the link lands on `…345`. Lexical ≠ realpath.
- **C fixture:** `C:\Users\98jak\graphgoblin-qa\d215-small-native-temp-mwqzh0i9-937e879a`, created by exclusive non-recursive mkdir. Its realpath is unchanged and its volume is C (`2894493802` ≠ G `810877956`). C free space was 527,224,832 bytes before creation.
- **Argument passing:** the p0 probe showed that multi-word `-t` arguments pass intact through pnpm.cmd → `pnpm exec`, and that the child is Node v22.23.4 with cwd `packages\infrastructure`.

The alias was **created by QA as a controlled configuration**. No naturally encountered host incident was involved. The Linux `TMPDIR` symlink example from scan 3 was not exercised, since this is a Windows-only host.

## Scenario results

| # | Fixture / TEMP | Planned | Observed | Counts (pass/fail/skip of 20) | Raw |
| --- | --- | --- | --- | --- | --- |
| 1 | baseline / ordinary G | engine temp case passes (positive control) | **pass**, exit 0 | 1/0/19 | [out](qa/raw/s1-baseline-ordinary-g-temp-engine-temp.stdout.txt) · [summary](qa/raw/s1-baseline-ordinary-g-temp-engine-temp.summary.json) |
| 2 | baseline / junction G | fails at original cwd check | **fail as expected**, exit 1, `fs.test.ts:141:52` | 0/1/19 | [stderr](qa/raw/s2-baseline-junction-g-temp-engine-temp.stderr.txt) · [summary](qa/raw/s2-baseline-junction-g-temp-engine-temp.summary.json) |
| 3 | corrected / ordinary G, full file | all existing tests pass | **pass**, exit 0 (includes Windows-only artifact test) | 20/0/0 | [out](qa/raw/s3-corrected-ordinary-g-temp-full-fs-file.stdout.txt) · [summary](qa/raw/s3-corrected-ordinary-g-temp-full-fs-file.summary.json) |
| 4 | corrected / junction G | engine temp case passes | **pass**, exit 0 | 1/0/19 | [summary](qa/raw/s4-corrected-junction-g-temp-engine-temp.summary.json) |
| 5a | corrected / cwd G, worker TEMP C | adapter mixed case passes with relative input | **pass**, exit 0 | 1/0/19 | [summary](qa/raw/s5a-corrected-c-temp-adapter-mixed.summary.json) |
| 5b | corrected / cwd G, worker TEMP C | engine relative case passes with relative input | **pass**, exit 0 | 1/0/19 | [summary](qa/raw/s5b-corrected-c-temp-engine-relative.summary.json) |
| 6a | corrected / junction G | engine fixed case keeps supplied spelling | **pass**, exit 0 | 1/0/19 | [summary](qa/raw/s6a-corrected-junction-g-temp-engine-fixed.summary.json) |
| 6b | corrected / junction G | engine template case keeps supplied spelling | **pass**, exit 0 | 1/0/19 | [summary](qa/raw/s6b-corrected-junction-g-temp-engine-template.summary.json) |

Each worker's fixture sha at start matched the intended fixture: baseline for 1 and 2, corrected for 3 to 6 ([RESULTS.json](qa/RESULTS.json)). Scenario 2's exit 1 is the planned baseline control. It is not a candidate failure. No corrected invocation failed.

### P2: lexical versus physical temporary root

**Scenario 2: raw baseline failure under the native junction (same production code).**

```
AssertionError: expected 'G:\ggq\qa-scratch\i4-486-d215-indepen…' to be 'G:\ggq\qa-scratch\i4-486-d215-indepen…' // Object.is equality
Expected: "G:\ggq\qa-scratch\i4-486-d215-independent-01\opus-qa-mwqzh0i9-937e879a\junction-alias\gg-wp-e3-jPSIr1\workspaces\00000000000000000000000001"
Received: "G:\ggq\qa-scratch\i4-486-d215-independent-01\opus-qa-mwqzh0i9-937e879a\junction-physical\gg-wp-e3-jPSIr1\workspaces\00000000000000000000000001"
 ❯ src/fs/fs.test.ts:141:52   expect(engine.ports.scripts.calls[0]?.cwd).toBe(path);
```

In the same worker, `os.tmpdir()` was the alias and its realpath was the physical directory. The tap shows the test's `dataDir` created under the alias spelling, with its native realpath under `junction-physical`.

**Scenario 1:** under ordinary G TEMP (lexical = physical) the same baseline case passed. That is the positive control.

**Scenario 4: the corrected case under the same junction passed.** Independent worker observations:

- `realpathSync(dataDir)` at the corrected `fs.test.ts:136` mapped `junction-alias\gg-wp-e3-gZUDNr` to `junction-physical\gg-wp-e3-gZUDNr` (`differs: true`).
- The later `realpathSync(path)` at line 145 received the already-physical `…\junction-physical\gg-wp-e3-gZUDNr\workspaces\00000000000000000000000001`. So the `path` that every assertion compared against (script cwd, result file, claim `path`, reuse) was the physical spelling.
- The physical-root watcher recorded `workspaces\…01\nested\result.txt` at 15 bytes, the length of `real file bytes`.

Covered only by the test's own assertions: exactly one claim with the physical path and a string identity, the canonical `journal.use`, and reuse returning the same path with the claim count still 1.

**Scenario 6:**

- **Supplied spelling retained.** For both fixed and template, the input to `realpathSync(path)` at line 145 was the lexical `junction-alias\gg-wp-e3-…\user-owned`, so the cwd and result assertions held against the supplied alias spelling. Only the canonical journal value used the realpath (`junction-physical\…\user-owned`).
- **Temp rule not applied.** No `realpathSync(dataDir)` call occurred at line 136 for either kind.
- Zero claims is a test assertion.

### P3: genuinely relative inputs on a cross-volume configuration

Scenarios 5a and 5b ran with the worker's cwd at `G:\ggq\gg-i4-486-d215-qa\GraphGoblin\packages\infrastructure` (volume `810877956`). The worker's `os.tmpdir()` was the C fixture (volume `2894493802`), with an unchanged realpath.

- **Old cross-drive control.** These were computed in the same worker with that run's actual C data dir, using the b812 formulas:
  - `relative(process.cwd(), join(dataDir,'relative'))` returned `C:\Users\98jak\graphgoblin-qa\d215-small-native-temp-mwqzh0i9-937e879a\gg-wp-e3-ca4t4d\relative` (`isAbsolute: true`).
  - `relative(process.cwd(), join(dataDir,'user-owned'))` returned `…\gg-wp-e3-ca4t4d\user-owned` (`isAbsolute: true`). Scenario 5b showed the same with `gg-wp-e3-OVACyH`.
- **Corrected inputs.**
  - Adapter, `fs.test.ts:52`: `path.relative(G cwd, G target)` returned `gg-wp-relative-rMiS7X\workspace` (`outIsAbsolute: false`).
  - Engine, `fs.test.ts:95`: it returned `gg-wp-relative-watq6s\workspace` (`outIsAbsolute: false`).
- **Production received the relative input.** `path.resolve` was called with exactly those relative strings from `FsWorkspace.resolve (workspace.ts:22:22)` and resolved to the G checkout path. In 5a it was called a second time from the test's own `resolve(relativePath)` check at line 55.
- **Real effects.**
  - The checkout watcher recorded creation, then removal, of `gg-wp-relative-rMiS7X\workspace` (adapter) and of `gg-wp-relative-watq6s\workspace\nested\result.txt` at 15 bytes (engine).
  - The C watcher recorded only `gg-wp-e3-ca4t4d\{fixed, workspaces\run1}` for the adapter and an empty `gg-wp-e3-OVACyH` for the engine. No `relative` or `user-owned` target was created on C.
  - Both cases passed all their existing assertions.

## Gates (corrected bytes restored)

- **Infrastructure typecheck, exit 0, no diagnostics** ([g1](qa/raw/g1-infrastructure-typecheck-tests-noemit.invocation.json)). Command: `pnpm.cmd --filter @graphgoblin/infrastructure exec tsc -p tsconfig.json --pretty false`. This is the no-emit, test-inclusive half of the package `typecheck` script. Its 1,068-file program includes `src/fs/fs.test.ts` ([coverage confirmation](qa/raw/g-coverage-confirmation.json)).
- **Scoped eslint, exit 0** ([g2](qa/raw/g2-eslint-fs-test.invocation.json)). Command: `eslint src/fs/fs.test.ts`. The JSON format run shows the file linted with 0 errors, 0 warnings and no messages.
- **Supplementary checks, both clean:** `prettier --check` on the file (exit 0) and `git diff --check b812 6de50cb -- fs.test.ts` (exit 0).
- **Ordinary fs unit run:** scenario 3, 20/20.

**Assertion preservation** ([61-assertion-delta.txt](qa/raw/61-assertion-delta.txt)):

- All 77 baseline `expect(` lines are present verbatim in the corrected file.
- The only additions are `expect(isAbsolute(relativePath)).toBe(false)` and `if (kind === 'relative') expect(isAbsolute(fixedPath)).toBe(false)`.
- The multi-line port expectation now uses `fixedPath`. That is the same expression, hoisted.
- The expected-path change is confined to the temp branch.
- No skip, only, todo, timeout, retry or chdir token was added; the single `skip` is the pre-existing Windows-only `it.skipIf`.
- No production file differs from b812.

## Cleanup and resource release

- **C fixture** ([29-cross-cleanup.json](qa/raw/29-cross-cleanup.json)): identity matched, it was empty, and it was removed by non-recursive rmdir. No `d215-small-native-temp-*` remains. C free space afterwards was 534,593,536 bytes.
- **G fixtures** ([40-cleanup.json](qa/raw/40-cleanup.json)):
  - The junction was verified against its recorded reparse-point ino and target, then removed with `fs.unlinkSync` on the link itself.
  - The physical directory was still present with the same identity after the unlink, which shows no traversal.
  - `junction-physical`, `ordinary-temp` and the owned root were each identity-checked, empty, and removed by non-recursive rmdir.
  - The scratch area is back to the setup's `node-compile-cache` and `process-temp`.
- **After each run:**
  - No `gg-wp-relative-*` remained in the checkout.
  - TEMP roots were empty before and after every scenario.
  - Each scenario's `afterEach` / `onTestFinished` cleanup removed its data dirs, and vitest removed its transform dir.
- **Final source state** ([50-after.json](qa/raw/50-after.json)) matches the binding on head, tree, parent, empty status, index bytes and sha, tracked-index sha, fixture and lock. The ignored-path set is the same 14 `node_modules/` entries as before, and no `dist/` was emitted.
- No commit, stage, push, branch, GitHub, provider, owner-store or old-worktree action was taken.

## Distinctions

- **Controlled alias vs incident.** The junction and the C TEMP are QA-created controlled configurations. Nothing here is a naturally encountered host incident. The original P2/P3 findings remain source-traced scan-3 findings. This QA reproduced the P2 baseline failure itself; the author's separately reported junction control was not used or relied on.
- **Baseline fixture vs original full checkout.** Scenarios 1 and 2 swapped only the fs.test.ts bytes, inside the QA checkout, on production proven identical to b812. They are not a run of the original frozen b812 checkout.
- **Test assertions vs independent observations.** Independent observations here come from the worker records, the call-site taps, the external watchers and the S2 `Received` value. Claim count, claim identity, `journal.use` arguments and reuse are established only by the test's own assertions.

## Residual limits

1. **R1: the short-name alias class is not covered by the corrected expectation (source/API-traced, not executed).**
   - At `6de50cb` the corrected temp expectation is `join(realpathSync(dataDir), …)`, and the pre-existing canonical check uses `realpathSync(path)`. Both are JS `fs.realpathSync`.
   - `OwnedRunResources` resolves with `fs/promises.realpath`, which is native.
   - A read-only probe on this host ([60-residual-realpath-probe.json](qa/raw/60-residual-realpath-probe.json)) returned `C:\PROGRA~1` from `fs.realpathSync('C:\PROGRA~1')`, but `C:\Program Files` from both native realpath and `fs/promises.realpath`.
   - In every scenario worker I ran, JS and native realpath agreed, so none of the observed results depend on this.
   - Inference only: with a TEMP spelled through an 8.3 short name (for example `C:\Users\RUNNER~1\…`), the corrected temp-case cwd assertion would still compare a short spelling with production's long spelling. The canonical journal check would diverge for every kind whose path carries that spelling: temp, fixed and template under such a TEMP, but not relative, whose target sits under the checkout cwd. Under that spelling the baseline would also fail, so this is not a D215 regression. It is an alias class that D215's correction does not cover. This QA did not run that configuration, because it was not among the six admitted scenarios.
   - **`e630bb8`** (child of `6de50cb`, "Use native resolution in workspace path expectations", author date 2026-11-21 16:36:58 −0600, committed while this QA was running) changes both calls to `realpathSync.native` (+3/−2 in fs.test.ts only). **This QA does not cover `e630bb8`.** Root should decide which head is under disposition; if it is `e630bb8`, that head needs its own QA.
2. **Worker-only C TEMP.** In S5 only the test-executing worker had the C TEMP; the vitest main process kept G so its transform cache stayed on G. The fixture's semantics depend only on the worker's `os.tmpdir()` and `process.cwd()`, and both were recorded.
3. **Typecheck scope.** The emitting `tsc -b tsconfig.build.json` half of the package script was not run. It excludes `*.test.ts`, emits `dist/`, and the coordinator excluded builds; its inputs are byte-identical to b812.
4. **Host-only evidence.** One Windows host was used. Linux symlink TMPDIR, hosted CI and other volume layouts (subst, network, other mount points) were not exercised.
5. **Harness-side copies on C.** The tool harness persisted two oversized tool outputs on its own under `C:\Users\98jak\.claude\projects\…\tool-results\`: about 1.5 MB of git "Filename too long" warnings from the read-only `--ignored` listing at preflight, and about 110 KB of analysis output. These are harness storage, not QA logs or fixtures. They were left untouched; the authoritative records are on G.
6. **Out of scope.** The author's four reported chat/audio failures were not investigated or run.

## Raw records

- **Consolidated results:** [qa/RESULTS.json](qa/RESULTS.json).
- **Per invocation, in `qa/raw`:** command, environment subset, exit, stdout/stderr, vitest JSON, child records, watcher logs, pre/post listings and summaries.
- **Phase records and event log:** `00-` to `61-`, plus [runner-events.jsonl](qa/raw/runner-events.jsonl).
- **Tools:** `qa/tools`.
- **Hashes:** [qa/SHA256SUMS.json](qa/SHA256SUMS.json) covers this report, RESULTS.json and every file under `qa/tools` and `qa/raw`.
