# D216 independent native-path QA supplement: attempt02 (Opus 5.5, xhigh)

**Verdict: CRITERION PASS on all six admitted D216 criteria at `e630bb83679bdb055bdd90d2b30e25fbf60571ac`, with the residual limits below.**

Genuine 8.3 aliases were available and were exercised.

| # | Criterion | Result |
| --- | --- | --- |
| 1 | Uppercase G TEMP: resolver probe, 6de negative control, e630 positive, record-only | **PASS** |
| 2 | Genuine 8.3 short-name C TEMP: 6de negative, then e630 positive, for the temp, fixed and template cases | **PASS** (alias **OBSERVED**, not manufactured) |
| 3 | e630 full `fs.test.ts`, ordinary G TEMP | **PASS** (20 of 20 executed and passed, 0 skipped) |
| 4 | e630 native junction G TEMP: temp, fixed and template | **PASS** (3 of 3) |
| 5 | e630, cwd on G, worker-only C TEMP: adapter mixed-relative and engine relative | **PASS** (1 of 1 and 1 of 1) |
| 6 | Exact delta, fixture restore, binding, cleanup and no repo actions | **PASS** |

Scope of this verdict:
- It is a criterion result for the targeted D216 supplement only.
- It is not a general review, scan 4, renewed Astra approval, cap reset, final CI/native verification, root final admission or merge acceptance.
- It does not relabel the older 6de QA. That session's report, `b19194db…`, remains its own record.

## Source and binding

- **Source.**
  - HEAD `e630bb83679bdb055bdd90d2b30e25fbf60571ac`, tree `0713eef9779a14e68b8ca0461f784538ba116c9f`.
  - Direct parent `6de50cb8e22b92bfed5d6fe7bf14a2a10b95cd08`, whose tree `34b80f15…` was verified.
  - Detached QA checkout `G:\ggq\gg-i4-486-d216-qa\GraphGoblin`.
- **Bindings read.**
  - `source-binding.json`.
  - Root admission `i4-486-d216-root-admission-01/candidate-review-qa-admission.json`. Its sha256 `2513fd28…` matches the binding.
  - `decision-216.md`, `decision-217.md` and the brief.
- **Preflight** ([00-preflight.json](qa/raw/00-preflight.json)) checked all of these against the binding, and all matched:
  - head, tree and parent;
  - empty status;
  - index bytes and sha `22054cb1…`;
  - tracked-index sha;
  - fixture `723d7333…` (17346 bytes);
  - lock `bcc908d0…`;
  - `node_modules/.modules.yaml` `0db496e4…`.
- **Only `packages/infrastructure/src/fs/fs.test.ts` differs from the parent.** This comes from a full-tree `ls-tree` set comparison with equal entry counts, plus `git diff --raw`.
- **Two-site delta proof** (`deltaProof` in preflight; diffs in [00a](qa/raw/00a-two-site-delta.diff), [00b](qa/raw/00b-fixture-blob-diff.txt) and [00c](qa/raw/00c-two-site-delta-U0.diff)):
  - Rewriting exactly `realpathSync(dataDir)`→`realpathSync.native(dataDir)` and `realpathSync(path)`→`realpathSync.native(path)` in the 6de blob gives the e630 blob, ignoring whitespace. Without the rewrite the two differ.
  - Each site occurs exactly once.
  - Token counts are identical between the blobs: `expect(` 79/79, `toBe(` 39/39, `toHaveBeenCalledExactlyOnceWith(` 1/1, `toLowerCase(` 1/1, `toMatchObject(` 8/8, `toEqual(` 9/9, `realpathSync` 3/3, `.skip` 1/1 (the pre-existing Windows `skipIf`).
  - `.only`, `.todo`, `retry`, `timeout`, `chdir` and `vi.mock` occur 0/0.
- **Fixture blobs.**
  - `baseline-fs.test.ts` (sha `b8012a86…`, 17322 bytes) is the git blob `6de:fs.test.ts`.
  - `candidate-fs.test.ts` (sha `723d7333…`, 17346 bytes) is `e630:fs.test.ts`.
  - Both were checked by `git hash-object` against `rev-parse`.
- **Platform and toolchain.**
  - Windows 11 Pro 10.0.26300 x64, host `DESKTOP-RQPA3QI`.
  - Node v22.23.4 first on PATH (the project-scoped runtime).
  - `pnpm.cmd` 12.8.1 (`C:\nvm4w\nodejs\pnpm.cmd`) and vitest 5.0.3.
  - No install, build or emitting typecheck was run.
- **Volumes.** C dev `2894493802` and G dev `810877956` are distinct.

## Harness, instrumentation and fixture control

- **Observer.** [qa/tools/child-observer.cjs](qa/tools/child-observer.cjs) is a byte-exact copy of the verified reference, sha `62a5a655…`. It was not revised.
  - It still keeps `fs.realpathSync.native` as the original builtin property at line 159 while wrapping the JS function.
  - Every invocation re-checked its hash.
- **Runner.** [qa/tools/runner.mjs](qa/tools/runner.mjs), sha `c160f6dc…` (rev1, copy [instrumentation-rev1-runner.mjs](qa/raw/instrumentation-rev1-runner.mjs)), is newly derived from the reference runner. Changes:
  - new packet, checkout and head constants;
  - the `git status --ignored` listing is removed;
  - the D216 matrix;
  - an uninstrumented resolver probe;
  - an instrumentation label on every invocation.

  Every phase used rev1. There was no runner revision ([runner-revisions.jsonl](qa/raw/runner-revisions.jsonl); `runnerSha256` appears in every `phase-start` event).
- **Post-run read-only tools** were written after all test invocations and never used by one:
  - [analyze.mjs](qa/tools/analyze.mjs), derived from the reference;
  - [consolidate.mjs](qa/tools/consolidate.mjs), derived from the reference;
  - [extract-failures.mjs](qa/tools/extract-failures.mjs), new.
- **Three distinct instrumentation modes:**
  - **Uninstrumented** ([realpath-probe.mjs](qa/tools/realpath-probe.mjs)). `node.exe` runs directly with no `NODE_OPTIONS` and no `--require`. It calls `fs.realpathSync`, `fs.realpathSync.native` and `fs/promises.realpath` directly. Used for probes p1, p2 and p5.
  - **Record-only** (`QA_D215_TAP=0`). The observer writes one process record per Node child: TEMP, `os.tmpdir()`, JS and native realpath of tmpdir, cwd, and the fixture sha at start. It wraps no builtin. Used for S1a, S1b, S2a, S2b and S3.
  - **Passthrough-tapped** (`QA_D215_TAP=1`, vitest processes only). `path.relative`, `path.resolve`, `fs.mkdtempSync` and JS `fs.realpathSync` are wrapped. Each wrapper calls the original and returns its result unchanged. `.native` remains the original. Used for S2c, S4, S5a and S5b.
  - The old `QA_D215_OLD_CONTROL` path was never enabled. The `QA_D215_*` env names come from the unrevised observer.
- **Worker-only TEMP.** For the uppercase, C-short and C-long scenarios, the observer applied TEMP/TMP only inside the vitest fork worker, at preload. The vitest main process and pnpm kept the ordinary G TEMP, so the ~225-file transform directory stayed on G. Each worker record shows the inherited G value next to the applied value.
  - S3 used ordinary G TEMP for the whole invocation.
  - S4 used the junction alias for the whole invocation, matching the verified reference mechanics.
- **Watchers.** Recursive `fs.watch` watchers ran in the runner, outside the test process:
  - on the TEMP physical directory;
  - on the main G TEMP, when it was separate;
  - on the checkout package directory, filtered to `gg-wp-relative-*`.
- **Fixture control, not a pristine old checkout.** The 6de controls (S1a, S2a) swapped only `fs.test.ts` bytes inside this new QA checkout, where all production and dependency inputs are identical to 6de. For each swap:
  - The candidate sha was checked and saved ([saved-corrected-fs.test.ts](qa/raw/saved-corrected-fs.test.ts)).
  - The exact baseline bytes were written, and git showed ` M` during the swap.
  - The run happened inside `try`, and `finally` restored the saved bytes and re-hashed them.
  - [s1a swap](qa/raw/s1a-baseline6de-upper-g-temp-engine-temp-recordonly.swap.json) restored at 14:44:16Z and [s2a swap](qa/raw/s2a-baseline6de-c-short-temp-engine-fixed-temp-template-recordonly.swap.json) at 14:44:57Z. Both restored `723d7333…` with empty status.

  Every scenario refused to start unless the fixture was the candidate and status was empty, and re-checked both afterwards. Each worker's own record of `fixtureSha256AtStart` matches the intended fixture in all 9 runs: baseline `b8012a86…` for S1a and S2a, candidate `723d7333…` for the rest.
- **Argument passing.** [p0 probe](qa/raw/p0-pnpm-exec-argv-probe.stdout.txt) ran through the same `pnpm.cmd … exec` path. It shows the arguments `uses real temp paths`, `uses real [ft][ie][xm]` (a regex for fixed, temp and template that excludes relative and uses no pipe) and the adapter name arriving intact. Each vitest JSON report lists exactly the executed tests.

## Invocation matrix

Counts are per invocation and must not be summed across heads or environments. The file holds 20 tests at both heads, and "filtered" means not selected by `-t`.

| Invocation | Fixture | Worker TEMP spelling | Mode | Expected | Observed | Exit | Executed / passed / failed / filtered |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S1a | 6de | `G:\GGQ\QA-SCRATCH\…\UPPER-TEMP` | record-only | temp fails at :143 | failed at `fs.test.ts:143:52` | 1 | 1 / 0 / 1 / 19 |
| S1b | e630 | same uppercase | record-only | pass | passed | 0 | 1 / 1 / 0 / 19 |
| S2a | 6de | `C:\Users\98jak\GR58B7~1\D216-S~1\SHORT-~1` | record-only | temp :143, fixed and template :147 | exactly so | 1 | 3 / 0 / 3 / 17 |
| S2b | e630 | same short | record-only | pass | passed | 0 | 3 / 3 / 0 / 17 |
| S2c | e630 | same short | passthrough-tapped | pass | passed | 0 | 3 / 3 / 0 / 17 |
| S3 | e630 | ordinary G (whole invocation) | record-only | full file passes | passed | 0 | 20 / 20 / 0 / 0 |
| S4 | e630 | G junction alias (whole invocation) | passthrough-tapped | pass | passed | 0 | 3 / 3 / 0 / 17 |
| S5a | e630 | C long `…\d216-small-native-temp-…\long-spelling-worker-temp` | passthrough-tapped | adapter mixed passes | passed | 0 | 1 / 1 / 0 / 19 |
| S5b | e630 | same C long | passthrough-tapped | engine relative passes | passed | 0 | 1 / 1 / 0 / 19 |

There were no timeouts and no watcher errors. Each test invocation ran exactly once; nothing was re-run or retried. Consolidated in [qa/RESULTS.json](qa/RESULTS.json): `allScenariosMatchExpectation`, `allWorkersRanIntendedFixture`, `allSwapsRestored`, `allPostStatesClean` and `noWatcherErrors` are all true.

## Criterion 1: uppercase spelling of an owned G TEMP (PASS)

**Fixture** ([01-fixtures.json](qa/raw/01-fixtures.json)):
- Physical directory: `G:\ggq\qa-scratch\i4-486-d216-independent-02\opus-qa-mwry6cl9-8930f76e\upper-temp`.
- Spelling under test: the same path fully upper-cased.
- `lstat` of both spellings gives the same dev/ino, and it is not a link.
- Native realpath of the spelling equals the physical path.

**Independently observed** (uninstrumented [p1](qa/raw/p1-upper-g-temp-resolver-probe.stdout.json); TEMP=uppercase, so `os.tmpdir()` returns uppercase):
- For a fresh `mkdtemp` child `…\UPPER-TEMP\qa-probe-ELSuxv`:
  - JS `realpathSync` returns the uppercase input unchanged.
  - `realpathSync.native` and `fs/promises.realpath` return the identical physical lower-case spelling `G:\ggq\…\upper-temp\qa-probe-ELSuxv` (`nativeEqualsPromises: true`).
  - Dev/ino are the same.
  - A marker written through the uppercase spelling reads back through the native spelling.
  - The child was removed.
- In both S1 workers the record-only observer recorded:
  - `TEMP` uppercase (inherited: ordinary G);
  - `tmpdirRealpathJs` uppercase;
  - `tmpdirRealpathNative` physical;
  - `tapsInstalled: false`.

**6de negative control (S1a)** failed at `fs.test.ts:143:52`, `expect(engine.ports.scripts.calls[0]?.cwd).toBe(path)`. Full text from [stderr](qa/raw/s1a-baseline6de-upper-g-temp-engine-temp-recordonly.stderr.txt), also in [60-baseline-failure-blocks.json](qa/raw/60-baseline-failure-blocks.json):

```
Expected: "G:\GGQ\QA-SCRATCH\I4-486-D216-INDEPENDENT-02\OPUS-QA-MWRY6CL9-8930F76E\UPPER-TEMP\gg-wp-e3-7Gzz36\workspaces\00000000000000000000000001"
Received: "G:\ggq\qa-scratch\i4-486-d216-independent-02\opus-qa-mwry6cl9-8930f76e\upper-temp\gg-wp-e3-7Gzz36\workspaces\00000000000000000000000001"
```

**e630 positive (S1b)** passed in the same environment: same worker TEMP spelling, same mode, candidate bytes. The test asserts:
- cwd equals `join(realpathSync.native(dataDir),'workspaces',id)`;
- the result file reads back;
- `journal.use` carries the lower-cased native canonical;
- one claim, with `path` and a string identity;
- the cached re-resolve returns the same path and keeps the claim count at 1.

The watcher independently saw `gg-wp-e3-KkYSRF\workspaces\…01\nested\result.txt [file:15]` in the physical directory.

## Criterion 2: genuine 8.3 short-name alias on an owned tiny C fixture (PASS; alias OBSERVED)

**Probe** ([20-c-setup.json](qa/raw/20-c-setup.json)) used only ordinary existing behavior: `cmd for %~sI` (GetShortPathName), and `dir /x` on the owned root only.
- The owned root was `C:\Users\98jak\graphgoblin-qa\d216-small-native-temp-mwry6cl9-8930f76e`, created empty, with subdirectories `short-alias-worker-temp` and `long-spelling-worker-temp`.
- A read-only `fsutil 8dot3name query C:` returned `Error 5: Access is denied` without elevation. It is recorded and was not needed.
- No volume setting, privilege, mapping or owner data was changed.

**Observed alias.** `C:\Users\98jak\GR58B7~1\D216-S~1\SHORT-~1` for `…\graphgoblin-qa\d216-small-native-temp-mwry6cl9-8930f76e\short-alias-worker-temp`.
- The short components appear at indexes 3, 4 and 5.
- The two QA-created components (`D216-S~1`, `SHORT-~1`) got short names at creation by the volume's existing policy.
- `GR58B7~1` is the existing short name of the QA parent directory. It was not modified.

**Same physical fixture** (runner and uninstrumented [p2](qa/raw/p2-c-short-temp-resolver-probe.stdout.json)):
- The followed stat via the short spelling equals the long one on all of dev `2894493802`, ino `5066549589138176` and birthtimeNs.
- `lstat` of the short spelling is not a reparse point.
- `realpathSync.native(short)` equals the long path.
- A random marker written via the long path was read back via the short path, then removed.
- In p2, TEMP was the short spelling and `os.tmpdir()` returned it. For a mkdtemp child:
  - JS `realpathSync` returned the short spelling;
  - `realpathSync.native` and `fs/promises.realpath` both returned the long path (`nativeEqualsPromises: true`);
  - dev/ino were the same, and the child was removed.

**6de negative control (S2a; record-only; worker TEMP is the short spelling):**
- **temp** failed at `:143`, the cwd assertion:
  ```
  Expected: "C:\Users\98jak\GR58B7~1\D216-S~1\SHORT-~1\gg-wp-e3-IXHTYt\workspaces\00000000000000000000000001"
  Received: "C:\Users\98jak\graphgoblin-qa\d216-small-native-temp-mwry6cl9-8930f76e\short-alias-worker-temp\gg-wp-e3-IXHTYt\workspaces\00000000000000000000000001"
  ```
- **fixed** and **template** both failed at `:147` (`journal.use`), after passing `:143` (cwd equals the supplied lexical target) and `:144` (`result.txt` reads back via that path). The diff for fixed:
  ```
  -   "c:\\users\\98jak\\gr58b7~1\\d216-s~1\\short-~1\\gg-wp-e3-ng68q4\\user-owned",
  +   "c:\\users\\98jak\\graphgoblin-qa\\d216-small-native-temp-mwry6cl9-8930f76e\\short-alias-worker-temp\\gg-wp-e3-ng68q4\\user-owned",
  ```
  Template shows the same pattern with `gg-wp-e3-fjrwca`. The key line has the same two spellings, prefixed `workspace:`.
- So the negative cwd observation (temp) and the negative journal observation (fixed and template) are preserved. Full blocks are in [S2a stderr](qa/raw/s2a-baseline6de-c-short-temp-engine-fixed-temp-template-recordonly.stderr.txt) and [60-baseline-failure-blocks.json](qa/raw/60-baseline-failure-blocks.json).

**e630 positive (S2b record-only, then S2c tapped)** passed 3 of 3 each, in the same environment.
- S2c's taps independently show each `beforeEach` dataDir created as `C:\Users\98jak\GR58B7~1\D216-S~1\SHORT-~1\gg-wp-e3-…`, called from `fs.test.ts:33:13`. Its `outRealpathNative` is the long path.
- So the fixed and template target supplied to the engine is short-spelled. The passing tests assert:
  - script cwd equals that lexical short target;
  - `result.txt` is read through it;
  - `journal.use` equals the lower-cased native long path.
- For temp, cwd and the claim path equal `join(realpathSync.native(dataDir),…)`, which is long. Reuse returns the same path with one claim.
- The watchers on the long physical directory saw all three `nested\result.txt [file:15]` writes in both runs.
- No JS `fs.realpathSync` call on a `gg-wp-` path occurred in e630. Its two sites now call the untouched `.native` property.

## Criterion 3: e630 ordinary G TEMP, full file (PASS)

S3 ran `vitest run src/fs/fs.test.ts` once, record-only, with TEMP set to the ordinary owned G directory (lexical equals physical). The actual counts were 20 total, 20 passed, 0 failed and 0 skipped. The Windows-only `skipIf` artifact test executed. The prior source also had 20 tests; the count here is the observed one, not assumed. The post listing of TEMP and the checkout leftovers were empty.

## Criterion 4: e630 native junction G TEMP (PASS)

**Fixture.** `junction-alias` is a junction to `junction-physical`:
- `lstat` shows a link, and the alias and target have different inodes;
- `readlink`, native realpath and JS realpath all give the physical path;
- the followed identity matches the target;
- `dir /AL` and `fsutil reparsepoint query` both exit 0.

**S4 (tapped; TEMP is the alias for the whole invocation)** passed temp, fixed and template.
- Taps show the dataDirs created as `…\junction-alias\gg-wp-e3-…` with `outRealpathNative` `…\junction-physical\gg-wp-e3-…`.
- The tests assert:
  - lexical alias spelling for fixed and template (cwd equals target);
  - temp cwd and claim on the native physical path;
  - `journal.use` with the lower-cased native canonical;
  - one temp claim, and zero claims for fixed and template;
  - one port call (cached resolution);
  - re-resolve returning the same path.
- The physical-root watcher independently saw `result.txt` (15 bytes) under `user-owned` for fixed and template, and under `workspaces\…01` for temp.

**Junction cleanup** used the reference mechanics. The runner verified the recorded reparse-point inode and target, then removed only the link with `fs.unlinkSync`, with no traversal. The physical directory remained, was empty, and was then removed with a non-recursive `rmdir`.

## Criterion 5: cwd on G, worker-only tiny C TEMP, true-relative cases (PASS)

The worker records in S5a and S5b show:
- `TEMP=C:\…\long-spelling-worker-temp` applied in the fork worker only (inherited TEMP is G);
- `tmpdirDev 2894493802` (C);
- cwd `G:\ggq\gg-i4-486-d216-qa\GraphGoblin\packages\infrastructure`, `cwdDev 810877956` (G);
- native tmpdir equal to the lexical one.

**S5a: adapter, "resolves fixed, relative, and temporary directories…" (passed).**
- dataDir `C:\…\gg-wp-e3-O2z0Zb` (`fs.test.ts:33`).
- Relative target from `mkdtempSync(G:\…\packages\infrastructure\gg-wp-relative-)` at `fs.test.ts:41`.
- `path.relative(cwd G, target G)` gave `gg-wp-relative-yM5KVj\workspace`, not absolute, with both roots `G:\`.
- `FsWorkspace.resolve` (`workspace.ts:22`) resolved the relative input to the G target.
- The C watcher saw `fixed`, `workspaces\run1` created and then removed.

**S5b: engine, "uses real relative paths…" (passed).**
- `path.relative` gave `gg-wp-relative-qfiI7S\workspace` (not absolute), called from `fs.test.ts:95`, and was resolved at `workspace.ts:22`.
- The checkout watcher saw `gg-wp-relative-qfiI7S\workspace\nested\result.txt [file:15]`, the real effect on G. The tree was then removed by the test's `onTestFinished`.
- The C watcher saw only the dataDir created and removed.

**After both runs:** zero `gg-wp-relative-*` leftovers in the checkout, and the C TEMP listing is empty. This is evidence from actual worker execution, not a standalone `path.relative` probe.

## Criterion 6: assertions, source binding and cleanup (PASS)

- **Delta.** Only the two native-resolver expectation sites changed from 6de (delta proof above). Every exact journal, result, claim, cache and ownership assertion is unchanged by token count. Fixed and template cwd and result spelling stay lexical (`… : target`).
- **Fixture restore.** The candidate fixture was restored after each 6de control, before any corrected run. The worker fixture shas prove which bytes each run saw.
- **After** ([50-after.json](qa/raw/50-after.json); re-checked at seal time in [70-final-source-check.txt](qa/raw/70-final-source-check.txt)):
  - HEAD, tree and parent are bound;
  - status is empty and nothing is staged;
  - index sha `22054cb1…`, fixture `723d7333…`, lock `bcc908d0…` and `.modules.yaml` `0db496e4…` all equal the binding.
- **C cleanup** ([29-c-cleanup.json](qa/raw/29-c-cleanup.json)):
  - Each of the two subdirectories and the root was identity-checked (dev/ino, not a link) and was empty.
  - Each was removed with a non-recursive `rmdir`.
  - The short spelling no longer exists.
  - There are zero `d216-small-native-temp-*` entries under the C parent.
- **G cleanup** ([40-cleanup.json](qa/raw/40-cleanup.json)):
  - junction unlinked;
  - `junction-physical`, `upper-temp`, `ordinary-temp` and the root were removed, each with a non-recursive empty `rmdir`;
  - the scratch directory holds only its original `node-compile-cache`, `npm-cache` and `process-temp`.
- **No repository or external actions.** There was no commit, stage, push, GitHub, issue or owner-store action. No install or build was run. No account or credential was inspected. No gates were run: no lint and no typecheck. The author's D216 gates and final CI are separate.

## Independently observed vs test-asserted

- **Independently observed** (probes, observer records, taps, watchers, reporter text):
  - resolver outputs (JS, native and promises) for the uppercase and short spellings;
  - the physical identity of each alias;
  - the worker TEMP, tmpdir, cwd and volumes;
  - the fixture bytes each worker loaded;
  - the dataDir spellings and their native targets;
  - relative strings and roots;
  - real `result.txt` writes on the physical directories and the checkout;
  - creation and removal of the test directories;
  - the 6de Expected and Received values.
- **Test-asserted only:**
  - the `journal.use` arguments in passing runs;
  - claim count and claim fields;
  - port-call count;
  - cached re-resolve equality;
  - cwd equality in passing runs.

## Attempt ledger

- **Two tool-file write attempts failed in the shell before running anything.** Neither ran any command or test, and neither left a file:
  - a single heredoc for `runner.mjs` hit `ENAMETOOLONG: uv_spawn`, the Windows command-line limit;
  - a chunked heredoc hit a bash parse error.

  The runner was then written with a placeholder and the Edit tool.
- **Phases ran in order, each once:** preflight → fixtures (p1, p0) → S1a → S1b → c-setup (p2, p5) → S2a → S2b → S2c → S3 → S4 → S5a → S5b → c-cleanup → cleanup → after → analyze → consolidate → extract. Console output of every phase is in `qa/raw/phase-*.console*.txt`. The runner event log is [runner-events.jsonl](qa/raw/runner-events.jsonl) and has zero `phase-error` events.
- **RESULTS.json.** The `expectedValue`/`receivedValue` fields are `null` because vitest's JSON `failureMessages` truncate long paths with `…` and carry no Expected/Received lines. The full values come from the verbose reporter's stderr, preserved raw and extracted into `60-baseline-failure-blocks.json`.

## Residual limits

1. **Controlled configurations.**
   - The uppercase spelling, the junction and the C TEMP are QA-created test environments, and the 8.3 alias is the volume's existing behavior on QA-created directories. None of them is a naturally encountered owner incident.
   - The 6de controls are a byte swap of a single fixture in this checkout. They are not an independent pristine 6de checkout.
2. **Worker-only TEMP.**
   - For S1, S2 and S5, only the test-executing fork worker received the uppercase, short or C TEMP. The vitest main process and pnpm used ordinary G TEMP.
   - The fixture depends only on the worker's `os.tmpdir()` and `process.cwd()`, and both were recorded.
   - S3 and S4 applied TEMP to the whole invocation. In those runs the vitest main process's transient transform directory (~225 files) appeared under that TEMP and was removed by vitest.
3. **8.3 scope.**
   - Short names were observed and exercised on C only. G short-name availability was not probed.
   - The alias spelling includes the pre-existing short name of the QA parent `graphgoblin-qa` (`GR58B7~1`) in addition to the two QA-owned components.
   - The volume's 8.3 policy could not be read without elevation (`fsutil` Error 5). Availability is shown by direct observation instead.
4. **Native cleanup limits.**
   - Every QA directory was verified empty and removed non-recursively. Removal is checked by `lstat` absence and by the prefix listing.
   - NTFS metadata and short-name table reuse are not observable here.
   - C free space was 2,691,440,640 bytes before and 2,690,723,840 after cleanup, about 2.5 GiB free on C. The 716,800-byte difference cannot be attributed to this QA, whose C directories were empty at removal; other host or harness activity runs at the same time.
5. **Host-only.** This is one Windows 11 host. Linux/macOS TMPDIR symlinks, hosted CI, subst, network and other mount layouts were not exercised.
6. **Out of scope.**
   - No lint, typecheck or other gate was run.
   - The author's four chat/audio failures were not investigated.
   - No whole-app or regression run was made.
   - Final CI, canonical native verification, coverage, capped completion and signed merge remain separate and required.
7. **Tool-output spill.** All large outputs were redirected to G files, and only bounded summaries were printed. I did not verify whether the CLI harness persisted any tool output on C on its own. No prior C overflow copies or caches were touched.

## Records

- Report: this file. Consolidated results: [qa/RESULTS.json](qa/RESULTS.json).
- Raw per-invocation records in `qa/raw`:
  - `*.invocation.json` (command, env subset, exit);
  - `*.stdout.txt` and `*.stderr.txt`;
  - `*.vitest.json`;
  - `*.child.jsonl` (observer);
  - `*.watch-*.jsonl`;
  - `*.prepost.json`;
  - `*.swap.json`;
  - `*.summary.json`.
- Phase records `00`–`70`, `state.json` and the runner and revision logs.
- Tools are in `qa/tools`.
- The manifest [qa/SHA256SUMS.json](qa/SHA256SUMS.json) covers this report and every file under `qa/` except itself. It excludes the controller inputs at the packet root (their hashes are bound in preflight), `provider/`, and the `dispatch.*` controller stream.
