# Independent #459 D166 corrected-source QA

**Verdict: PASS (bounded)** for exact source `37803eeef9f55c2a316289aa502798025a7873be`
(tree `647d297990837f7f21e0054c5be15a0109fab2f1`).

| Phase                                         | Cases run                        | Result                                                                       |
| --------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------- |
| Frozen F3 replay (`driver/v2`, unchanged)     | 16 cases, 16 executions in 1 run | 16/16 `correctedContract: CONFORMS`; 176/176 controls passed; no setup fault |
| F4 timing extension (frozen before execution) | 8                                | 8/8 PASS through the product's `HelperProcess.AwaitCleanup`                  |
| Relevant ordinary native regressions          | 3                                | 3/3 PASS (maintained `NativeChecks` modes)                                   |

This is independent behavioral QA of the committed candidate source. It is not hosted CI, a
general or corrective review, a formal scan, owner acceptance or merge permission. No source,
index, publication or GitHub state was changed.

## Placeholders

| Placeholder  | Meaning                                                                    |
| ------------ | -------------------------------------------------------------------------- |
| `<checkout>` | The assigned clean, detached candidate checkout                            |
| `<scratch>`  | The disposable QA scratch root                                             |
| `<out>`      | This candidate output root; paths below are relative to it unless prefixed |
| `<baseline>` | The frozen independent baseline root (read-only here)                      |

## Binding

| Item                                    | Value                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Head / tree                             | `37803eeef9f55c2a316289aa502798025a7873be` / `647d297990837f7f21e0054c5be15a0109fab2f1`. Detached; tracked changes 0, untracked non-ignored 0, index sha256 `f5c4be3a…` at 04:55:05Z (before) and 05:07:35Z (after). The before and after records are identical apart from time. No `.tmp` was created in the checkout.    |
| Sole parent / target                    | `2164cd11624c88d66ae64d1ac86ae26505a6c1ea` / `47ca4640793a81efa5bec661dba25627de314774`; the target is an ancestor of head.                                                                                                                                                                                                |
| `apps/windows-launcher/Launcher.cs`     | blob `f3a4f314…`, sha256 `2ef219c2…2b520`, 102,124 bytes. Matches the admission receipt and HEAD before and after QA.                                                                                                                                                                                                      |
| `apps/windows-launcher/NativeChecks.cs` | blob `eb431a9e…`, sha256 `416ab74f…77d0`                                                                                                                                                                                                                                                                                   |
| Producer sources / built outputs        | `instance-identity.ts` `7afbe98d…`, `data-dir-lock.ts` `5f3ab443…`; built `instance-identity.js` `e8a04bf5…`, `data-dir-lock.js` `dfc4e59a…`                                                                                                                                                                               |
| Compiler                                | .NET Framework `csc.exe` v4.0.30319, sha256 `eca02e6b…` (same as baseline)                                                                                                                                                                                                                                                 |
| F3 assemblies (frozen build step)       | `GraphGoblin.exe` `aa3f63bd42726133b62be5af61cc5baf551309bab6b81abf8de6f6f56e40f4ed` (65,536 bytes); `Qa459iHarness.exe` `8df22105dd8ca78e892c238e40fee343772142b9e51b90af70575ae53546bc3b` (7,168 bytes). Both compiles exited 0 with no warnings. The baseline's three CS0649 warnings for deserialized fields are gone. |
| F4 assembly                             | `Qa459tCleanupDecision.exe` `e7003f753c0264a9ef26f9c3dc68ea4a327db8f8e0008452fe24bd24d7746287` (74,240 bytes)                                                                                                                                                                                                              |
| Native assembly                         | `NativeChecks.exe` `e07a36ae525e6990ad5b62353143f49ed52215b63f01d098b5316eaf127dd048` (95,232 bytes)                                                                                                                                                                                                                       |
| Frozen F3 driver                        | `<baseline>/driver/v2/MANIFEST.sha256` `766811a8…a178076e`, 11 entries, verified before the run and after QA. The driver recorded its own file hashes at run time, and they equal the manifest.                                                                                                                            |
| Frozen extensions                       | `f4/v1/MANIFEST.sha256` `344e7924…bb51` (3 entries) and `native/v1/MANIFEST.sha256` `e38df2c3…d75a` (2 entries). Both were verified unchanged after their runs.                                                                                                                                                            |
| Admission packet                        | `candidate-admission.json` `12ca2aed…`; all 17 `evidence-manifest.final.json` entries are unchanged. All five baseline manifests verified unchanged after QA: root (28), private (155), public (61), driver v1 (11), driver v2 (11).                                                                                       |

Runtime: project-scoped Node v22.23.4, first on PATH for every command. I did not repeat the
mechanical install/build. I verified its outputs instead. The three built API outputs match its
record, and the producer outputs also match the baseline's fresh (0-cached) build of the same
unchanged TypeScript sources.

## Sequence (actual times, UTC, 2026-11-21)

| Time           | Event                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------ |
| 04:55:05       | Pre-QA git state recorded                                                                                    |
| 04:55:17-19    | F3 build: the frozen `qa459i-build.mjs` compiled the committed `Launcher.cs` and the frozen harness (exit 0) |
| 04:55:33       | Frozen driver v2 manifest verified                                                                           |
| 04:55:33-59    | F3 replay run `candidate-20261121T045534Z-624fab` (exit 0)                                                   |
| 05:04:41-59    | F4 compile-only pre-check (three attempts; see Faults). The assembly was never executed.                     |
| 05:05:06.279   | F4 v1 freeze record written (manifest `344e7924…`)                                                           |
| 05:05:06.559   | Native v1 freeze record written (manifest `e38df2c3…`)                                                       |
| 05:05:13-17    | F4 run `f4-20261121T050513Z-e48422` (exit 0)                                                                 |
| 05:05:30-06:07 | Native run `native-20261121T050530Z-3875a5` (exit 0)                                                         |
| 05:07:25-35    | Post-QA manifest verifications, port probe and git state                                                     |

The freeze-record times are process clock values written by `tools/qa459c-freeze.mjs`, not hand
entries. Each record was written before its run started.

## F3 replay (frozen v2, unchanged)

Invocation: `node <baseline>/driver/v2/qa459i-driver.mjs --checkout <checkout> --scratch
<scratch>/f3 --out <out> --build-record <out>/setup/f3-build-record.json --label candidate
--expect-head 37803eee… --expect-tree 647d2979…`. Exit 0, empty stderr.

`status` still compares each observation with the **baseline prediction**. `correctedContract`
and the 11 controls decide candidate acceptance. `START` means the compiled public `Gateway.Ensure`
reached `NativeProcess.Start`. The fixture main's marker and the launcher-observed exit 54 both
show this. It is controlled start-path admission, **not** a ready gateway.

| Case | Response (ownership bytes)                           | Baseline observed                    | Candidate observed                                                          | Raw status | Contract | Controls |
| ---- | ---------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------- | ---------- | -------- | -------- |
| Q01  | `{"state":"free"}\n`                                 | START                                | START, `unknown-exit` 54                                                    | MATCHED    | CONFORMS | 11/11    |
| Q02  | legal SP/HT/CR/LF, `\u` in name and value            | START                                | START                                                                       | MATCHED    | CONFORMS | 11/11    |
| Q03  | identity padded; free                                | START                                | START                                                                       | MATCHED    | CONFORMS | 11/11    |
| Q04  | actual producer, fresh store                         | START                                | START (producer sample 2,350 ms)                                            | MATCHED    | CONFORMS | 11/11    |
| Q05  | held, reordered, `\\` and `α` path                   | `store-held`, 16 samples             | `store-held`, lock and guidance, 17 samples                                 | MATCHED    | CONFORMS | 11/11    |
| Q06  | actual producer, driver-owned malformed record       | `store-unverified` (v2 re-execution) | `store-unverified`, record preserved, 2 producer samples (2,061 / 1,690 ms) | MATCHED    | CONFORMS | 11/11    |
| Q07  | held, then trailing-material retry                   | `store-held`, 2                      | `store-held`, 2                                                             | MATCHED    | CONFORMS | 11/11    |
| Q08  | `{\n  state: 'free'\n}\n`                            | START                                | **`helper-invalid`**, 1 sample                                              | DIFFERED   | CONFORMS | 11/11    |
| Q09  | `{"state":"held","state":"free"}\n` (exact 37 bytes) | START                                | **`helper-invalid`**, 1                                                     | DIFFERED   | CONFORMS | 11/11    |
| Q10  | held, then duplicate-name retry                      | START on retry                       | **`store-held`**, lock and guidance retained, 2                             | DIFFERED   | CONFORMS | 11/11    |
| Q11  | leading U+00A0                                       | START                                | **`helper-invalid`**, 1                                                     | DIFFERED   | CONFORMS | 11/11    |
| Q12  | trailing U+000C                                      | START                                | **`helper-invalid`**, 1                                                     | DIFFERED   | CONFORMS | 11/11    |
| Q13  | U+2028 between tokens                                | START                                | **`helper-invalid`**, 1                                                     | DIFFERED   | CONFORMS | 11/11    |
| Q14  | unknown field                                        | `helper-invalid`                     | `helper-invalid`                                                            | MATCHED    | CONFORMS | 11/11    |
| Q15  | held, invalid `\'` escape                            | `store-held`, 12                     | **`helper-invalid`**, 1                                                     | DIFFERED   | CONFORMS | 11/11    |
| Q16  | trailing second record                               | `helper-invalid`                     | `helper-invalid`                                                            | MATCHED    | CONFORMS | 11/11    |

**Counts.** 16 cases (cap 16), 16 executions, one run, 0 setup faults and no watchdog actions.

- 16/16 conform to the corrected contract and 176/176 controls passed.
- Raw labels are preserved: 9 `MATCHED-PREDICTION` and 7 `DIFFERED-FROM-PREDICTION`. The seven
  are exactly Q08–Q13 and Q15, the intended corrections. In each, only baseline-prediction checks
  failed: the start, code and exit-54 checks, plus the call-count, lock and held-message checks for
  Q15. No control failed.
- Only Q01–Q04 (valid) reached the start path. None of the six previously admitted malformed
  responses did.

**Payload identity.** Q09's response is exactly the baseline original: 37 bytes, sha256
`9fb5d4511478937a531fcb52fe399c2d424b54b50dae94afac971a4ea3da6889`, with the escaped name
`state`. Every other non-path response is byte-identical to the baseline. The path-dependent
payloads (Q05, Q07, Q10, Q15) and the actual producer's Q06 output are identical to the baseline
once the run-specific lock location is normalized. The baseline report table's decoded duplicate
names are shorthand only; the original report is unchanged.

**Q06 timing.** The actual producer took 2,061 ms, so a second sample fit the window. v1's
one-sample record and v2's corrected `[1, 60]` expectation stay as recorded. No retry was required
or attempted. Q05's 17 held samples (16 in the baseline) are likewise timing-dependent.

**Cross-cutting controls (all 16 executions).**

- **Privacy.** No stderr or response canary appeared in `LauncherFailure.Message`,
  `Program.Present` or `LauncherLog.Build`. After normalizing lock locations, four closed messages
  occurred: unknown-exit 54, store-held, store-unverified and helper-invalid.
- **Records.** The driver-owned owner record and the unrelated invalid-UTF-8 store sentinel stayed
  byte-identical. Nothing was written to any private log folder.
- **Ports and sentinel.** The only port used was 25840, free after every case with no conflict.
  The unrelated same-executable sentinel stayed alive until driver teardown, which signalled its
  exact retained handle (SIGTERM).
- **Processes.** There were 17 harness processes (1 preflight and 16 cases), all exit 0. Every
  fixture helper root exited naturally with 0, as did all 3 actual producer processes. The 4
  fixture gateways were parented by the harness, and the launcher observed their exit 54.
- **Final process check.** None of the 79 exact PIDs recorded by F3, F4 and the native run was
  alive afterward. This was a PID query only.

## F4 timing extension (independent, candidate-specific)

`f4/v1/harness/Qa459tCleanupDecision.cs` is compiled in **one** `csc` invocation with the
committed, unmodified `Launcher.cs` (`/target:exe /optimize+ /platform:x64
/main:Qa459tCleanupDecision`). It reaches `internal static bool HelperProcess.AwaitCleanup`
(`Launcher.cs:1011`, called by the production cleanup path at `:986`) through ordinary
same-assembly internal access. There is no reflection, private member, product edit or substitute
implementation, and every verdict is the product method's return value.
`HelperProcess.CleanupMilliseconds` read 2000.

| Case | Observation / clock                                                    | Expected | Returned | Order                  | Samples    |
| ---- | ---------------------------------------------------------------------- | -------- | -------- | ---------------------- | ---------- |
| T1   | complete at 1,999                                                      | `true`   | `true`   | `OE`                   | 1999       |
| T2   | complete at 2,000 (equality)                                           | `false`  | `false`  | `OE`                   | 2000       |
| T3   | complete at 2,001                                                      | `false`  | `false`  | `OE`                   | 2001       |
| T4   | clock 1,999 at pass start; the pass advances it to 2,001 and completes | `false`  | `false`  | `OE`                   | 2001       |
| T5   | incomplete at 1,999, then complete at 2,001                            | `false`  | `false`  | `OEOE`                 | 1999, 2001 |
| T6   | incomplete at 1,998, then complete at 1,999                            | `true`   | `true`   | `OEOE`                 | 1998, 1999 |
| T7   | incomplete at 2,000                                                    | `false`  | `false`  | `OE` (no further pass) | 2000       |
| T8   | real `Stopwatch`; the pass sleeps 2,050 ms then completes              | `false`  | `false`  | `OE`                   | 2065       |

The call order (`O` = observe, `E` = elapsed sample) shows that the elapsed time is sampled after
the complete observation pass. Only a sample strictly below 2,000 ms credits completion.
Equality, a later completion and a pass that crosses the deadline are all refused. Harness exit 0,
8/8 PASS, no watchdog action.

**What F4 does not prove.** A `bool` alone does not show any of these runtime outcomes:

- the production mapping of `false` to `helper-cleanup-unconfirmed` (`:1000`);
- held guidance retained after an unconfirmed retry (`:1244-1245`);
- pending-I/O completion transfer (`:997-999`);
- job closure and later-disposal ordering (`:995-996`).

These remain **source integration evidence**. No public native control in this QA reached the
unconfirmed branch, and no OS cleanup, race, late-kernel completion or fault seam was attempted.
F4's baseline remains SOURCE-ONLY.

## Relevant ordinary native regressions (3 of at most 6)

These are the three maintained `NativeChecks` modes that the existing acceptance subtest **'native
closed outcomes, launcher pair bounds and NUL stdio checks'** runs. That subtest sits under the
test **'bounded Windows logs: stale entry, closed outcomes, one writer per root, legacy writer and
unsafe names'** in `tooling/scripts/windows-launcher.acceptance.mjs`.

I reproduced the subtest's exact `csc` command, argument order, timeouts, environment (inherited
minus `GG_*`/`JEV_API_KEY`, isolated `TEMP`/`TMP`), private `install α` ACL and expected stdout.
The fixture folder was an owned scratch path instead of `<checkout>/.tmp`. The node:test wrapper
and its sibling subtests were not run.

| Entry | Mode                        | Outcome                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N1    | `--bounded-log-checks`      | exit 0, 976 ms. Closed child-exit outcomes, presentation/record privacy, closed ownership detail, log root checks, and a detached `NativeProcess.Start` NUL-stdio child whose retained handle reported exit 73.                                                                                                                                                                                                                                                                                                                                                                    |
| N2    | `--helper-checks`           | exit 0, 33,385 ms. `CheckCapability`; clean, slow and padded success; the raw untrimmed validator input; six closed refusals without canaries. Four inheritance fixtures (`both`, `stdout`, `stderr`, `neither`) each printed `cleanup-confirmed`, finishing at 2,616–2,690 ms in total (the 2,500 ms work budget plus cleanup). In those fixtures, live descendants were collected by the private job with `0xE0470459`, the refusal stayed `helper-timeout` (never `helper-cleanup-unconfirmed`) and the unrelated same-executable sentinel survived. The 15 s initial cap held. |
| N3    | `--cleanup-deadline-checks` | exit 0, 106 ms. The author's six maintained deterministic `AwaitCleanup` checks.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

The isolated TEMP contained no managed log names afterward. Each mode is a **grouped** control: it
exits non-zero at the first failing internal `Check`, so individual assertions are not separately
counted. N3 is the author's own maintained check, run here against the exact immutable candidate.
It is not independent of the author. F4 is the independent timing evidence.

N2 and F3 add narrow integration evidence: the production `AwaitCleanup` call path returned
confirmation within 2,000 ms on this host. This covered helpers terminated by the job while alive
(N2) and helpers that had already exited with invalid output (the F3 refusals). Neither produced
`helper-cleanup-unconfirmed`.

## Bounded source integration readback

- **Single strict parse.** `StoreHasLiveOwner` makes exactly one `ReadHelper` call, whose validator
  is `TryReadOwnership` (`:1337`). That validator is the strict `OwnershipReader` (`:1254-1332`):
  JSON whitespace only, decoded names checked against the allowlist and for duplicates, the closed
  escape set, no raw control characters and no trailing material. The same parsed object supplies
  `state`, `path` and `detail`, and there is no second deserialization. `JavaScriptSerializer` now
  remains only for shortcut inspection output, configuration reading and bounded log string
  encoding (`:169`, `:177`, `:266`, `:569`), not for ownership.
- **Raw validation order.** `HelperProcess.Read` strictly decodes the retained UTF-8 bytes (`:954`).
  It validates the **untrimmed** text inside the work window (`:957-959`) and trims only the
  returned result afterward (`:960-961`). The identity validator trims itself (`:1161-1162`), which
  preserves padding.
- **Shared cleanup call path.** `finally` starts the cleanup Stopwatch, terminates the job and
  cancels I/O. It then calls `AwaitCleanup(observe, () => cleanup.ElapsedMilliseconds)`
  (`:982-993`), where the observation pass checks the root, both pipes and job accounting. Disposal
  and transfer follow (`:995-999`), and the unconfirmed mapping comes last (`:1000`).
  `HeldFailure` lets `helper-cleanup-unconfirmed` lead and appends the held guidance
  (`:1241-1247`).
- **Producer compatibility.** The producer emits `JSON.stringify(...)`
  (`instance-identity.ts:67-69`). Its actual free and held/unverified outputs parsed correctly in
  Q04 and Q06.

This readback is bounded integration reading, not a general review or a new formal scan.

## Faults, corrections and limits (preserved)

1. **Setup/fixture corrections used: 0 of 1.** No frozen driver, harness or case was changed after
   its freeze, and no run was repeated.
2. **Pre-freeze compile-only check.** Attempt 1 failed because Git Bash rewrote `/nologo`-style
   flags into paths. Attempt 2 failed because `csc` mis-parsed forward-slash source paths.
   Attempt 3, through Node with backslash paths, compiled cleanly. None executed anything, and the
   pre-check assembly was never run. All three records are kept as
   `setup/f4-prefreeze-compile-check{,-2,-3}.stdout.txt`.
3. **Pre-freeze draft fix.** Before the freeze, I found that my own F4 draft never started T8's
   Stopwatch, and fixed it. Only the fixed version was frozen and executed.
4. **Ad hoc tooling.** One read-only `node -e` comparison failed on a shell-quoting error and ran no
   product code. It was redone as a scratch script. A dummy node:test probe in scratch established
   that name patterns run whole parents in Node 22.23.4. That informed the native selection.
5. **Native selection constraints.** Real-gateway subtests of test 690 were not run: their
   configuration leaves `GG_OLLAMA_ENABLED` at its default (true), and API preflight could contact
   a local Ollama/owner service. Filtering test 1828's siblings would trip its `gateway.log` tail
   assertion, so the maintained modes were run directly instead.
6. **Limits.**
   - The marker is fixture start-path admission. There was no real ready gateway, store mutation or
     API-lock exercise, and no live-gateway preservation control.
   - `Program.Main`, launcher mutexes, `launcher.log` writes, GUI/MessageBox and visual dialog QA,
     WMI, shortcuts, the installer and enclosing-job containment refusal (D163) were not exercised.
     The D164 visual dialog remains NOT PERFORMED.
   - The F4 runtime mappings listed above remain source-only.
   - Native modes are grouped controls.
   - Evidence comes from one Windows 11 host (10.0.26300) on fresh-runner timings.
   - The old 31-criterion matrix, the full tooling regression and the full local checks
     (`pnpm check` / `test:coverage`) were not run. Prior full-local-check nonpasses and the C14 and
     C25–C31 LIMIT entries are unchanged. There is no blanket upgrade of any criterion.
   - The baseline's freeze-timestamp corrections, Q06 correction and original records stand as
     recorded.
   - Ports 25860–25879 were not needed and were not used.
   - No provider or model turn, external service, real store, auth or configuration was touched.

## Evidence index

- `REPORT.md`, `case-results.json` (per-case raw labels, contract outcomes, controls, baseline
  comparison, F4 and native detail) and `acceptance-map.json` (claim-to-evidence map with tiers)
  are path-scrubbed.
- `f4/v1/`, `native/v1/` and `f4/freeze-v1.json` / `native/freeze-v1.json` hold the frozen
  extensions. `tools/` holds the freeze, aggregate and verify helpers.
- `setup/` holds pre/post git state, build and run meta/stdout/stderr, the F3 build record, the
  pre-freeze compile checks and post-QA verification.
- `private/runs/<runId>/`, `private/f4/<runId>/` and `private/native/<runId>/` hold the raw originals
  unchanged. These include the response `.bin` bytes (invalid UTF-8 and escaped payloads), harness
  results, helper events, markers, actual producer stdout/stderr and native stdout/stderr. They are
  bound by `private/MANIFEST.sha256`.
- `public/` is the compact scrubbed subset: byte-unchanged copies of the reusable F4/native sources
  and tools, scrubbed setup records, the driver-written public projections and
  `public/MANIFEST.sha256`, which excludes itself. The frozen F3 driver v2 is reused from the
  baseline's public subset (manifest `766811a8…`) and is not duplicated.
- `evidence-manifest.sha256` binds the root files, setup and tools, and the subtree manifests. The
  runner-owned `provider-candidate/` is excluded.
- `<scratch>` keeps the disposable fixture trees and assemblies, with no live process, listener or
  job.

**PASS (bounded)** for `37803eeef9f55c2a316289aa502798025a7873be`: F3 16/16 conform with 176/176
controls, F4 8/8 and native 3/3, using 0 setup corrections. The parent still owns the corrective
opposite-family review, hosted CI, the final independent audit, owner decision review/QA and merge.
