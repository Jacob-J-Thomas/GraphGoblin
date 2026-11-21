# Independent D167/F5 behavior QA — PASS (exact source only)

> Publication projection: results and evidence limits below are the original independent QA observations. Private path prefixes are replaced, Markdown is formatted, and the local-account-containing common source is omitted from this publication subset. Original public/ byte-identity statements below describe the original sealed subset, not this derivative. Six new native groups plus a separately executed maintained group exceed the original six-total cap; coordinator disposition is separate. The six failed compiler invocations across two prefreeze shell batches remain administrative setup failures.

| Item                           | Value                                                                                                                                   |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Source (candidate)             | `184c95ac2d08590e258c084723eb9ab379f0bbe5`                                                                                              |
| Tree                           | `404700711621832629aef6d505b69076972474da`                                                                                              |
| Sole parent (held publication) | `c6f08d4a62c1488690096f69f577a68c6d382cbc`                                                                                              |
| Target main                    | `47ca4640793a81efa5bec661dba25627de314774` (ancestor of the source; merge base)                                                         |
| Actor                          | Claude Code, Opus 5.5 (`claude-opus-5-5`), xhigh; independent of the Sol author, the Astra scan, the Fable reviewer and the coordinator |
| Checkout                       | `<checkout>` (clean before, during and after)                                                                                           |
| Output root                    | `<out>`                                                                                                                                 |
| Executed                       | 2026-11-21, 06:50–07:07 UTC                                                                                                             |

This is bounded behavior QA of the exact source above. It is not a fourth general review, Fable
acceptance, CI, owner QA or merge authority. The original scan-3 report (SHA-256
`129ffea08f253e819b0da154ed2f6de833456015e25a1ab4c875e292441eaf14`, CHANGES REQUIRED for F5) and every
earlier result keep their own scopes.

## Verdict

**PASS** for source `184c95ac2d08590e258c084723eb9ab379f0bbe5` against target
`47ca4640793a81efa5bec661dba25627de314774`. No product defect was found.

| Group                                               | Cases                                                                    | Assertions or controls                                               | Result |
| --------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------- | ------ |
| Independent deadline seam D01–D11 (frozen)          | 11/11 PASS                                                               | 79/79 assertions                                                     | PASS   |
| Independent native public controls N1–N6 (frozen)   | 6/6 PASS                                                                 | 97/97 assertions                                                     | PASS   |
| Frozen F3 driver v2 replay (unchanged)              | 16/16 CONFORMS                                                           | 176/176 per-case controls (16 × 11); 88/88 corrected-contract checks | PASS   |
| Maintained bounded-log acceptance group (one group) | Node test: 9 tests (1 top-level + 8 subtests), 9 pass, 0 fail, 0 skipped | —                                                                    | PASS   |

The F3 replay also retains its raw baseline-prediction comparison: 9 cases matched the prediction
for the held head and 7 differed (Q08, Q09, Q10, Q11, Q12, Q13, Q15), with 65/88 baseline-prediction
checks matching. That is the expected result of the D166 correction and is recorded as raw evidence, not
a failure. F3 replay setup faults: 0. Fixture corrections used: 0 of the 1 allowed. The six failed compiler invocations across two prefreeze shell batches are retained separately as administrative setup failures. No case failed, so no failure was
repeated.

## 1. Setup and identity (before any compilation for QA)

`tools/setup-verify.mjs` passed 34/34 checks (`setup/setup-verify.json`):

- HEAD, tree and sole parent as above; the target is an ancestor (merge base equals target).
- `git status --porcelain=v1 --untracked-files=all` was empty: no tracked changes and no untracked
  non-ignored files.
- The worktree bytes equal the committed blobs for all nine candidate-changed paths plus
  `Launcher.cs`, `NativeChecks.cs`, the acceptance and evidence scripts, the installer and the API
  ownership/identity sources. All nine admission-recorded hashes matched.
  `apps/windows-launcher/Launcher.cs`: SHA-256 `34eb6b2298446495ab6c353a92aca9d2f834d39f1a003f5a69b2e37f932022ce`,
  git object `4293a97d549cc8920485f86d13e1ab7dce12e77a`, 103,920 bytes.
- Runtime: Node `v22.23.4` (project runtime on PATH), `pnpm.cmd` 12.8.1.
- Compiler: `<framework-compiler>\csc.exe`, "Visual C# Compiler version
  14.8.10001.0 for C# 5", SHA-256 `eca02e6b15cde93009a59a3d129d5a77fb5008f2e1cf62cf573b6737c747ecc3`.
- The built files the launcher needs were present. A read-only `pnpm.cmd run build --dry=json` reported
  every cacheable build task as a cache HIT for the current inputs (the two plugin builds are `cache:false`).
  The root's preparation records matched the admission: brief, spec and build-log hashes all agreed.

No author assembly, author result or earlier QA assembly was used. Every assembly executed here was
compiled during this session from the verified source.

## 2. Commands and exits

| #   | Command (summarized)                                                                                                                                                                                                                                                                            | Exit                      | Record                                                                                                                                                                                                                                                                              |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `node tools/setup-verify.mjs <checkout> setup/setup-verify.json`                                                                                                                                                                                                                                | 0                         | 34/34 checks                                                                                                                                                                                                                                                                        |
| 2   | `pnpm.cmd run build --dry=json` (read-only)                                                                                                                                                                                                                                                     | 0                         | `setup/turbo-build-dry.json`                                                                                                                                                                                                                                                        |
| 3a  | Two pre-freeze direct-shell batches, three compiler invocations each                                                                                                                                                                                                                            | 1 (six invocations total) | Corrected administrative readback: first batch had Git Bash switch/path rewriting; the MSYS_NO_PATHCONV retry still had CS1504/CS0006 path/reference errors. These are setup invocation failures. The original report counted only three; both original event batches are retained. |
| 3b  | Pre-freeze compile-only check through `qa167i-build.mjs` into a throwaway scratch directory                                                                                                                                                                                                     | 0 (3/3)                   | `freeze-v1.json`; the outputs were never executed                                                                                                                                                                                                                                   |
| 4   | Freeze: `qa167i-manifest.mjs harness/v1 MANIFEST.sha256`                                                                                                                                                                                                                                        | 0                         | Manifest SHA-256 `cdb68877b572cdfb47cdabe9fc3b4d87b88a06d4ea00baa04ad372246d14087c`, 14 entries, 07:01:54Z                                                                                                                                                                          |
| 5   | `qa167i-build.mjs` (official)                                                                                                                                                                                                                                                                   | 0 (3/3 compiles)          | `harness/build-record-v1.json`                                                                                                                                                                                                                                                      |
| 6   | `qa167i-deadline.mjs` (manifest verified first)                                                                                                                                                                                                                                                 | 0                         | run `deadline-20261121T070206Z-8bb4d7`                                                                                                                                                                                                                                              |
| 7   | `qa167i-native.mjs` (manifest verified first)                                                                                                                                                                                                                                                   | 0                         | run `native-20261121T070224Z-cf8476`                                                                                                                                                                                                                                                |
| 8   | F3 `qa459i-build.mjs` (driver manifest verified first)                                                                                                                                                                                                                                          | 0 (2/2 compiles)          | `f3/build-record.json`                                                                                                                                                                                                                                                              |
| 9   | F3 `qa459i-driver.mjs --label candidate --expect-head 184c95ac… --expect-tree 40470071…`                                                                                                                                                                                                        | 0                         | run `candidate-20261121T070327Z-e99f01`                                                                                                                                                                                                                                             |
| 10  | `node tools/run-maintained.mjs` → `pnpm.cmd exec node --test --test-reporter=tap "--test-name-pattern=bounded Windows logs: stale entry, closed outcomes, one writer per root, legacy writer and unsafe names" tooling/scripts/windows-launcher.acceptance.mjs` with `GG_TEST_PORT_START=25860` | 0                         | `maintained/run-record.json`, 99.3 s                                                                                                                                                                                                                                                |
| 11  | Copied the maintained artifacts privately (228 files, hash-verified), then removed the checkout `.tmp/`. That directory did not exist before step 10.                                                                                                                                           | 0                         | `private/maintained/artifacts.sha256`                                                                                                                                                                                                                                               |
| 12  | `node tools/assemble.mjs`                                                                                                                                                                                                                                                                       | 0                         | `case-results.json`, `acceptance-map.json`, `public/`                                                                                                                                                                                                                               |

## 3. Hashes

| Artifact                                                      | SHA-256                                                                                                                                 |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| QA167I harness v1 manifest (frozen before execution)          | `cdb68877b572cdfb47cdabe9fc3b4d87b88a06d4ea00baa04ad372246d14087c`                                                                      |
| `Qa167iDeadline.cs`                                           | `b7ab3b901c60e1ef622bbdf7290a3edd8034d16598a7dccf6be70a1640a8ab83`                                                                      |
| `Qa167iPublicEntry.cs`                                        | `99e0e8d906735007bc2099902e21b5487f8669284a91654a9264c872f1a1b8bf`                                                                      |
| `qa167i-cases.json` (frozen expectations)                     | `f24a0b7a073710e4d8daf3adb67a98c846c50d084a95521d6bfa00d8bb83fdc9`                                                                      |
| My `GraphGoblin.exe` (installer flags)                        | `a4db890920f57967644b9ed1d533a4ae89e357a8c40ce9b16114bbe9e283bab2`                                                                      |
| My `Qa167iDeadline.exe` (same assembly as Launcher.cs)        | `c3ae3529fab6c602e7e22f6eed390e0fa24d49ee85be99b2dbaeca661d639f8e`                                                                      |
| My `Qa167iPublicEntry.exe`                                    | `25317c704e22a2f35209378a776f235f3b0dfee008a36a2c1bc9d6f58e8c3ff2`                                                                      |
| F3 driver v2 manifest (unchanged)                             | `766811a8076395f172127dea170220b8827b009ef828de26678d8768a178076e`                                                                      |
| F3 build: `GraphGoblin.exe` / `Qa459iHarness.exe`             | `ab15ec805920817ec7b1297c3388317257d65267ae2c0df60526de8d728183d0` / `e597bca8ffb175d48fcd32fa09e17509d7f4aec0423d489c5adbf14870a4c625` |
| Maintained group's own `GraphGoblin.exe` / `NativeChecks.exe` | `ceee91569f849b96b9a5c414f5baa19f043e3e69d17fc4fda9a40f38abc5713d` / `3e4e993101b59554fd1373cc1860800cebd04b397acea99442c3b47f874bae27` |
| `windows-launcher.acceptance.mjs` / `NativeChecks.cs` at run  | `04341ec716bc456ab62a52ab76da6590e35183db5b12a2be7f1bbb0d3c20b4eb` / `9757bde7458dcd4f10bf6427992c456688ce910c5563a9d60df4a974c9767577` |
| Maintained TAP output (private)                               | `27a49e538c267a6be59210804e0dce4d74f2757b82f1c4169564bea6bb8e8786`                                                                      |

The .NET Framework compiler does not produce deterministic bytes, so the pre-freeze check outputs have
different hashes. They were never executed.

## 4. Independent deadline cases (D01–D11)

These run in `Qa167iDeadline.exe`, which compiles the unchanged `Launcher.cs` and the harness into one
assembly. That gives the harness the intended internal seam (`WorkDeadline` constructor, `Recheck`,
`Within`, `Check`, `Remaining`, `Expired`) with no reflection and no substitute timing code. The harness
runs once.

The evidence classes are:

- **component-deterministic:** production members driven by a controlled clock.
- **native-deterministic:** public `HelperProcess.Read` with real Node children in the production private
  job; the shared clock moves only from caller or validator callbacks.
- **native-real-time:** a real `Stopwatch` and real waits.

None of these cases injects an OS scheduling fault.

| Case | Evidence                            | Result | What was established                                                                                                                                                                                                                                                                                                                                                                |
| ---- | ----------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D01  | component                           | 10/10  | `Recheck(7750, release 10000)` gives a cutoff of 8000 with 250 remaining. At 7999 the check passes; at 8000 (equality) and 8001 it refuses with `helper-timeout` and the exact closed ownership text.                                                                                                                                                                               |
| D02  | component + native                  | 11/11  | `Within` at or after the cutoff runs no operation. Public `Read` entered at equality refuses in 6 ms: no marker child, no validator call. A ReadHelper-shaped call after the cutoff runs no preparation and starts no child.                                                                                                                                                        |
| D03  | native-deterministic                | 8/8    | **Audit example.** 250 ms remain at retry admission, which fits the 200 ms minimum. 50 ms of preparation is charged inside `Within`. The real helper returns a valid free response while 225 ms is charged during validation, which ends at 8025, 25 ms into the reserve. Result: `helper-timeout`, nothing returned to the caller. Control: 50 + 199 ms returns the free response. |
| D04  | native-deterministic                | 6/6    | Preparation that reaches the cutoff makes `Read` refuse before native creation (no marker, no validation). Control: preparation ending at the cutoff minus 1 runs the helper, which writes its marker and returns ok.                                                                                                                                                               |
| D05  | native-deterministic                | 9/9    | Validation crossing the cutoff. Valid at equality gives `helper-timeout`. Valid one millisecond before returns ok. Invalid at equality gives `helper-timeout`, because expiry precedes the invalid outcome. Invalid before gives `helper-invalid`.                                                                                                                                  |
| D06  | native-deterministic                | 4/4    | `Read` returns at 7999 and caller time reaches 8000 before `Within` returns: `helper-timeout`, nothing delivered. Control delivers ok.                                                                                                                                                                                                                                              |
| D07  | component + real-clock construction | 8/8    | Constants are 15000 and 2000. A retry in a long window is capped at admission + 15000 (admission + 14999 passes, + 15000 refuses), including a late admission. Public `Start(15000)` grants at most 15000 ms and is not expired at creation.                                                                                                                                        |
| D08  | component                           | 8/8    | Release 8000 gives a cutoff of 6000 (5999 passes, 6000 refuses). Admission at 5800 leaves exactly 200 ms; at 5801 it leaves 199. Admission at 6000 or 7000 is already expired and runs no work.                                                                                                                                                                                     |
| D09  | native-real-time                    | 5/5    | A real-clock retry deadline returns the free response. Remaining fell from 8000 to 7911 because the same deadline kept running; there was no restart. Public `Start(5000)` admits an on-time helper.                                                                                                                                                                                |
| D10  | native-real-time                    | 5/5    | The cutoff is 600 ms on a real clock. 400 ms of real preparation ended at 414 ms. The helper started (its marker exists), was refused with `helper-timeout` at 619 ms, and its 1,500 ms timer never fired. Cleanup was confirmed, not reported as unconfirmed.                                                                                                                      |
| D11  | component                           | 5/5    | One cutoff is shared by sequential guarded operations: the first ends at 400 with 200 ms remaining, and the second 250 ms operation refuses. A restarted clock would have admitted it.                                                                                                                                                                                              |

The D03 contrast is arithmetic only: a clock restarted after preparation would have compared 225 < 250
and accepted. The held source was not executed. Its behavior on that example comes from the audit's source
analysis, not from a dynamic reproduction here.

## 5. Independent native public controls (N1–N6)

N1–N4 and N6 run the compiled production launcher through its ordinary quiet entry,
`GraphGoblin.exe --config <file> --ensure-gateway` (no dialog, no PWA). N5 runs a harness that uses
public APIs only. Ports came from the range 25880–25884 after bind checks; none was occupied. Configuration
and log folders had private ACLs, and every store was disposable.

| Case                                           | Result | Observation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N1 timely held-to-free                         | 17/17  | The first sample is held (after 300 ms) and the second is free. The launcher admitted its ordinary start path: exactly one fixture gateway marker, with the launcher as parent PID. The fixture exited 54, which the launcher recorded as `unknown-exit` with `childExit` 54. 1,455 ms. This is a fixture marker, not a ready gateway.                                                                                                                                                              |
| N2 insufficient time, no new helper            | 19/19  | `StartupTimeoutSeconds` 3 and a 700 ms held sample. The launcher refused `store-held` after exactly one ownership sample, with the full held reason, rendered lock path and guidance, and no start marker. 1,157 ms. Which private comparison refused is not attributed.                                                                                                                                                                                                                            |
| N3 stalled held retry                          | 24/24  | `StartupTimeoutSeconds` 6: held, then a retry that stalls. Result: `store-held` with the held reason and guidance, and no timeout text in the output. The stalled helper had no natural exit and its heartbeat stopped before the launcher exited (lifetime 3,233 ms, under the bound of release window minus 2,000 ms = 4,000 ms). The launcher took 4,264 ms. Helper PIDs match the launcher's parent PID.                                                                                        |
| N4 ordinary detached gateway                   | 9/9    | Real built gateway on a disposable store and port 25883. The cold click exited 0 with empty output (8,066 ms). The gateway answered `/healthz` with 200 and phase `running` after the launcher had exited, under a distinct PID with a 64-hex identity. The warm click exited 0 (1,499 ms) and reused the same PID and identity. No `launcher.log` records. The sentinel was alive before, during and after. Driver teardown used the ordinary drain (`/system/shutdown`, 202); the port was freed. |
| N5 expired deadline at the public helper entry | 8/8    | `HelperProcess.Read` with `WorkDeadline.Start(0)` refused `helper-timeout` in 6 ms. The owned marker was absent after 1.5 s and the validator was never called. Control `Start(15000)` returned ok in 140 ms and its marker was written.                                                                                                                                                                                                                                                            |
| N6 initial identity 15-second cap              | 20/20  | A stalled identity helper produced `helper-timeout` with the identity-stage text after 15,331 ms. No ownership helper and no start marker. The identity helper had no natural exit and its heartbeat stopped (14,900 ms lifetime).                                                                                                                                                                                                                                                                  |

On process ownership: the fixture helpers record their own PID and parent PID, and every helper and
marker had the spawned launcher as parent. The driver signalled only processes it owned: the launcher
processes (watchdog only, which never fired), the sentinel (exact handle, `driver-teardown`), and the N4
drain request. Stalled helpers ended through the launcher's own private-job cleanup; the driver never
signalled a helper. Afterwards no process from these runs remained, ports 25840–25899 were all bindable,
and the checkout was clean.

## 6. F3 replay (frozen driver v2, unchanged)

The driver bytes were verified against `MANIFEST.sha256` (manifest SHA-256 `766811a8…076e`), and the
driver ran from its original location. Its harness compiled unchanged against the candidate's public
`Gateway` API: `Gateway.Ensure`, `Program.Present` and `LauncherLog.Build`, with no direct
`HelperProcess.Read`. No fixture adaptation was needed, and the original payloads, limits and the Q06
sample correction are unchanged. The driver bind-checked port 25840 and used it for every case; it was
never bound and was free after each case. The preflight exited 0 with no setup faults.

- **Corrected contract:** 16/16 CONFORMS, 0 VIOLATES. Per-case controls: 176/176 (all 11 controls in
  every case). Corrected-contract checks: 88/88.
- **Baseline prediction (raw evidence):** 9 MATCHED and 7 DIFFERED (Q08–Q13 and Q15; 23 of 88 prediction
  checks). This matches the expected seven differences.
- **Q04 (actual producer, free):** the built `instance-identity.js --store-state` on a fresh disposable
  store produced 17 bytes, relayed byte for byte by the fixture helper. The launcher admitted the start
  path (fixture marker, `unknown-exit` 54).
- **Q06 (actual producer, held):** the producer read the driver-owned malformed owner record and reported
  held (237 bytes, identical over 3 samples). The result was `store-unverified` with the malformed-record
  reason, lock and guidance. The owner record was preserved.
- These Q04/Q06 producer outputs are attributed to the relay fixture. The launcher reads the relay's
  output and never calls the producer directly.
- Q05 took 18 held samples within the 8 s window (6,242 ms).

## 7. Maintained bounded-log group

This one maintained acceptance group was run independently. Its modes were written by the author, so it
is not an independently designed case set. Node test reported 9 tests, 9 pass, 0 fail, 0 skipped, in
99.0 s. The 8 subtests are:

- native closed outcomes, launcher pair bounds and NUL stdio checks (the `--bounded-log-checks`,
  `--helper-checks`, `--cleanup-deadline-checks` and `--work-deadline-checks` modes)
- stale built entry
- startup failure 74
- held ownership guidance and last-recheck budget
- strict raw JSON ownership admission
- one writer per physical root
- deliberate stop, legacy append writer and oversized history
- unsafe managed names

This retains the maintained F4 cleanup-decision controls and the strict-protocol controls. The group used
its own 20-port pool starting at 25860, and `GITHUB_PAT` was removed from its environment.

## 8. Acceptance map summary (`acceptance-map.json`)

**Established by compiled seam and native evidence:**

- One immutable absolute deadline across preparation, creation, validation and return: D02–D06, D10,
  D11, N5.
- Equality is expired: D01, D02, D05, D06, D08.
- Expired admission starts no callback or child: D02, D04, N5.
- The audit example refuses: D03.
- The 15-second cap: D07; the identity cap natively in N6.
- Retry cutoff at min(admission + 15000, release − 2000): D01, D07, D08, natively bounded in N3.
- On-time success: the D-case controls, D09, N1, N4, N5.
- The F3 parser: the F3 replay and the maintained strict subtest.
- Held guidance: N2, N3, F3 Q05/Q07/Q10.
- Detached gateway and unrelated survival: N4 and the sentinels.

**Source integration (committed source read, not separately executed):**

- `Gateway.ReadHelper` wraps argument and environment preparation plus `Read` in `work.Within`
  (Launcher.cs 1085–1090).
- `StoreHasLiveOwner` re-checks the deadline before consuming the owner (1385).
- `Ensure` builds the retry with `Recheck(releaseClock, StartupTimeoutSeconds × 1000)` after the capped
  sleep and probe, and maps a failed retry to `HeldFailure` (1221–1230).
- The initial `Start(WorkMilliseconds)` calls for identity (1205) and the first ownership sample (1216).
- The admission comparison `Remaining < max(200, sample)` (1227).

The held-retry F5 late-free mapping is therefore source integration plus the shared seam. N3 reaches an
ordinary stalled-retry timeout through public `Ensure` in real time; that is not a controlled reproduction
of the 50 + 225 ms scheduling gap.

## 9. Evidence boundaries and limits

- No controlled OS scheduling, kernel race, permission or Win32 fault experiment was performed. The seam
  establishes timing decisions only.
- Synchronous OS calls being charged when they return: checks sit immediately before and after
  `CreateProcess` (source). No delayed or faulted creation was injected, so this is a **LIMIT**.
- The initial ownership-check 15-second cap is shown at component level (`Start`) and in source; it was
  not observed natively. Only the identity cap was (N6).
- F4: the maintained cleanup-decision checks passed, and D10, N3 and N6 observed confirmed cleanup after
  real work expiry. Unconfirmed-cleanup runtime mapping, pending-I/O transfer, Win32 faults and visible
  dialog proof were not observed; their earlier LIMIT scopes are unchanged. The visual dialog remains NOT
  PERFORMED, because only the quiet entry was used.
- The original 23 PASS / 0 FAIL / 8 LIMIT, later correction results and unresolved local aggregate
  failures keep their scopes and were not re-run. The full acceptance suite was not run.
- N1 and the F3 start-path cases show a fixture gateway marker plus the launcher's recorded exit. They are
  not ready gateways. Only N4 started a real gateway.
- Timing figures are fresh-runner observations on this host; prior use of the host is unknown.

## 10. Hygiene notes

- My shell environment contains `GITHUB_PAT`. N4's real gateway and the F3 and native fixture processes
  inherited the ordinary non-`GG_` user environment, as the maintained group's gateways ordinarily do. A
  scan of every evidence file and the scratch directory found no occurrence of that value (counted only,
  never printed). The maintained group ran with the variable removed.
- `public/sources/harness-v1/qa167i-common.mjs` contains the local account name as the literal pattern
  that the scrubber replaces, as in earlier QA public sources. The source is kept byte-identical to the
  frozen harness so the manifest stays valid.
- `f3/public/` is the frozen driver's own path-scrubbed projection. It contains exact payload texts,
  including escape sequences, and is retained with the evidence, not as the concise public subset. The
  concise public subset is `public/`. It has no raw payloads, all paths are scrubbed, and it contains no
  backslash-u sequences.
- No product, index, commit, push, publication, provider call, owner store, port 4747/4748/7443,
  author range 25810–25829, GUI entry, kernel or race experiment was used.

## 11. Layout

- `REPORT.md`, `case-results.json`, `acceptance-map.json`, `evidence-manifest.sha256`: results and
  manifest.
- `setup/`: identity verification and the Turbo dry run.
- `harness/v1/` and `harness/freeze-v1.json`: frozen sources and the freeze record.
- `harness/build-record-v1.json`: the official build record.
- `deadline/`, `native/`, `f3/`, `maintained/`: run records. Each has a `private/` (raw) and a `public/`
  (scrubbed) projection.
- `private/maintained/`: raw TAP output, stderr and the copied maintained artifacts.
- `public/`: the concise public subset (`public/MANIFEST.sha256`).
- `tools/`: setup, maintained-runner and assembly scripts.
- `admission.json`, `brief.md`, `spec.json` and `provider/` belong to the coordinator and were not
  modified.
