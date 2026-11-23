# Independent #459 D166 correction baseline QA

**Verdict: BASELINE CHARACTERIZED.** F3 was observed through the compiled public
`Gateway.Ensure` / `HelperProcess` ownership path at held head `2164cd11`. **F4 is SOURCE-ONLY.**
**Candidate QA is PENDING.** This is baseline evidence only. It is not a corrected-source PASS,
general-review sign-off, owner acceptance or merge permission.

Six malformed ownership responses reached the ordinary fresh gateway-start path on the held
baseline. They are JavaScript-only syntax, non-JSON whitespace between tokens, a duplicate decoded
name, a duplicate name on the held retry, a leading U+00A0 and a trailing U+000C. A seventh case,
an invalid `\'` escape, was refused before start. It was reported as `store-held` instead of the
corrected contract's `helper-invalid`. All valid free and held controls, producer controls,
privacy checks and record-preservation controls behaved as the corrected contract requires.

## Placeholders

| Placeholder  | Meaning                                                                      |
| ------------ | ---------------------------------------------------------------------------- |
| `<checkout>` | The assigned clean, detached, held checkout                                  |
| `<scratch>`  | The disposable QA scratch root                                               |
| `<out>`      | This independent output root. Paths below are relative to it unless prefixed |

## Binding

| Item                                                                     | Value                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Held head / tree                                                         | `2164cd11624c88d66ae64d1ac86ae26505a6c1ea` / `0b1a84d1c881518b4744e2565a2874ec481921fc`. Verified before QA at 04:17:55Z and after QA at 04:33:33Z. Tracked changes and untracked non-ignored entries: 0 at both times. Sparse settings unchanged. |
| Parent / signed target                                                   | `11214dadbde049af01dd0280b9b701ad10a0f50a` / `47ca4640793a81efa5bec661dba25627de314774`; the target is an ancestor of head.                                                                                                                        |
| `apps/windows-launcher/Launcher.cs`                                      | blob `76d695fd…`, sha256 `bf66facf…c24078`, as in the admission receipt                                                                                                                                                                            |
| `apps/api/src/instance-identity.ts`                                      | blob `3dfecc49…`, sha256 `7afbe98d…088d9e`                                                                                                                                                                                                         |
| `apps/api/src/data-dir-lock.ts`                                          | sha256 `5f3ab443…cc5d3f`                                                                                                                                                                                                                           |
| Built producer `apps/api/dist/instance-identity.js` / `data-dir-lock.js` | sha256 `e8a04bf5…abcddb29` / `dfc4e59a…5b0d9c71`                                                                                                                                                                                                   |
| Compiled launcher `GraphGoblin.exe`                                      | sha256 `febd02c1ad43814b2bed19d74ac6eb1ae8d409b607449117731f3501428c8a20` (63,488 bytes). Built with the installer's exact csc flags; compiler sha256 `eca02e6b…`.                                                                                 |
| Independent harness `Qa459iHarness.exe`                                  | sha256 `346a225c0cebc996abe1edf4439c91a17c7aabf0be724d4d4944cfd3456a8fc1` (7,168 bytes)                                                                                                                                                            |
| Driver v1 / v2 manifests                                                 | `driver/v1/MANIFEST.sha256` `a9e9ec11…b73d62d3` / `driver/v2/MANIFEST.sha256` `766811a8…a178076e` (11 entries each)                                                                                                                                |
| Admission packet                                                         | All 40 `evidence-manifest.json` entries were unchanged after QA. D166 `affbdc73…`, final audit `eb200bc8…`.                                                                                                                                        |

The runtime was Node v22.23.4 from the pinned project runtime. `pnpm install --frozen-lockfile`
exited 0 (04:18:06–04:18:32Z). `pnpm build` exited 0 (04:18:43–04:20:01Z; 12/12 tasks, 0 cached).
Both compilations exited 0 (04:29:22–04:29:24Z; three CS0649 warnings for deserialized fields).
No manifest, lockfile, source, maintained test, build policy, threshold or deadline was changed.
Exact hashes are in `setup/build-record.json`, `setup/pre-qa-git-state.txt` and
`setup/post-qa-git-state.txt`.

## Method

- **Compiled public path only.** `driver/v*/harness/Qa459iHarness.cs` references the unmodified
  compiled `GraphGoblin.exe`. It calls only public members: the `Configuration` setters,
  `Validate(true)`, `LogRoot.Admit`, `new Gateway(config, logDir).Ensure()`, the
  `LauncherFailure` fields, `Program.Present` and `LauncherLog.Build`. It uses no `Program.Main`,
  private member, reflection, GUI, MessageBox, launcher mutex or `launcher.log` write. The
  production parser, `HelperProcess` private job, retry loop and gateway start are unchanged.
- **Fixtures.** A disposable fixture repository replaces only `apps/api/dist/instance-identity.js`
  and `apps/api/dist/main.js`.
  - The helper writes scenario bytes exactly. For Q04/Q06 it relays the actual built producer from
    `<checkout>` byte for byte. The producer ran as a descendant inside the launcher's private
    helper job.
  - The gateway main script appends a **driver-owned marker** and exits 54 without listening. A
    marker means the actual `Gateway.Ensure` reached `NativeProcess.Start`. The launcher's own
    retained handle then reports `unknown-exit` with `ChildExit 54`. Both witnesses agreed in all
    17 executions. This is start-path admission evidence, not a ready gateway.
- **Disposable resources.** Each case had a fresh store `store-α`. Free cases had an unrelated
  sentinel with invalid UTF-8 bytes. Held-path cases also had a driver-owned malformed
  `graphgoblin.lock`. Each case also had a private log folder, `StartupTimeoutSeconds` 8 and owned
  port 25840. The port came from the 25840–25859 reservation after a loopback bind check; no
  conflict occurred. Every helper wrote a stderr privacy canary.
- **Order.** Predictions (from source reading) and D166 corrected expectations were frozen in v1
  (`driver/freeze-v1.json`) at 04:29:34Z. Run 1 started at 04:29:51Z.

## F3 results (authoritative baseline characterization)

`START` means the actual compiled `Gateway.Ensure` reached the ordinary gateway-start path, shown
by the main-script marker and launcher-observed exit 54. Every case's 11 controls passed.

| Case | Response (ownership bytes)                                 | Baseline observed                                                 | Prediction | D166 contract                              |
| ---- | ---------------------------------------------------------- | ----------------------------------------------------------------- | ---------- | ------------------------------------------ |
| Q01  | `{"state":"free"}\n`                                       | START, `unknown-exit` 54                                          | matched    | CONFORMS                                   |
| Q02  | Only SP/HT/CR/LF around and inside; `\u` in name and value | START                                                             | matched    | CONFORMS                                   |
| Q03  | Identity padded ` <hex> \r\n`; producer-shaped free        | START                                                             | matched    | CONFORMS                                   |
| Q04  | Actual producer, fresh store: `{"state":"free"}\n`         | START (producer sample 2,089 ms)                                  | matched    | CONFORMS                                   |
| Q05  | Held, reordered fields, `\\` plus `α` in path              | refused, `store-held`, lock and guidance, 16 samples              | matched    | CONFORMS                                   |
| Q06  | Actual producer, driver-owned malformed record (held)      | refused, `store-unverified`, record bytes preserved               | matched†   | CONFORMS                                   |
| Q07  | Held, then retry `{"state":"free"} <canary>`               | refused, `store-held`, held lock and guidance retained, 2 samples | matched    | CONFORMS                                   |
| Q08  | `{\n  state: 'free'\n}\n`                                  | **START**                                                         | matched    | **VIOLATES** (needs `helper-invalid`)      |
| Q09  | `{"state":"held","state":"free"}`                          | **START**                                                         | matched    | **VIOLATES** (needs `helper-invalid`)      |
| Q10  | Held, then retry `{"state":"held","state":"free"}`         | **START** on retry (2 samples)                                    | matched    | **VIOLATES** (needs retained `store-held`) |
| Q11  | Leading U+00A0, then `{"state":"free"}`                    | **START**                                                         | matched    | **VIOLATES**                               |
| Q12  | `{"state":"free"}` followed by U+000C LF                   | **START**                                                         | matched    | **VIOLATES**                               |
| Q13  | `{"state":` U+2028 `"free"}`                               | **START**                                                         | matched    | **VIOLATES**                               |
| Q14  | `{"state":"free","detail":"<canary>"}`                     | refused, `helper-invalid`                                         | matched    | CONFORMS                                   |
| Q15  | Held with JavaScript-only `\'` escape in detail            | refused, but `store-held` (12 samples), not `helper-invalid`      | matched    | **VIOLATES** (diagnostic only; no start)   |
| Q16  | `{"state":"free"}\n{"state":"free"}\n`                     | refused, `helper-invalid`                                         | matched    | CONFORMS                                   |

† Q06 is reported from the single v2 corrective re-execution; see Setup faults.

**Counts.** There were 16 cases, within the cap of 16, and 17 executions: 16 in run
`baseline-20261121T042951Z-e1e0e8` (v1) plus one corrective Q06 re-execution in
`baseline-20261121T043159Z-5ff66d` (v2).

- 16/16 matched prediction under v2. Run 1's raw summary records 15/16 because of the Q06 driver
  assumption.
- 10 reached the start path: valid Q01–Q04 and malformed Q08–Q13. Six refused before start.
- 9 conform to the D166 contract and 7 violate it: Q08–Q13 by authorizing a start, and Q15 by its
  diagnostic.
- There were 0 run-level setup faults, 0 watchdog actions and 0 port conflicts.

**Mechanism, source-consistent.** `ValidOwnership` (`Launcher.cs:1231-1241`) and
`StoreHasLiveOwner` (`:1243-1252`) use `JavaScriptSerializer`. That parser accepted unquoted names,
single-quoted strings, `\'`, non-JSON white space between tokens and last-wins duplicate names. It
validates the already `.Trim()`-ed text (`:953`), which removes U+00A0 and U+000C. The field-count
check rejected unknown fields (Q14). The serializer rejected trailing non-whitespace material (Q16,
and the Q07 retry). The free result reaches `AdmitLogRoot` and `NativeProcess.Start`
(`:1168-1170`). A malformed retry after held (`:1164`) reaches the same start when it decodes as
free (Q10). It retains held guidance only when it throws (Q07).

## Cross-cutting controls (all 17 executions)

- **Privacy.** None of the per-case stderr canaries or response canaries (`QA459I_*`) appeared in
  `LauncherFailure.Message`, `Program.Present` text or `LauncherLog.Build` records. Only four
  distinct closed messages occurred: unknown-exit 54, store-held, store-unverified and
  helper-invalid. Lock locations are rendered by design. No dialog was shown; visual dialog QA was
  not performed and is not claimed.
- **Records and resources.** The driver-owned owner record and unrelated store sentinel stayed
  byte-identical, including the actual producer reads in Q06. Nothing was written to any private
  log folder. The port was free after every case. The unrelated same-executable `node.exe`
  sentinel stayed alive in both runs.
- **Processes.** There were 19 harness processes (2 preflight, 17 case), all exit 0. Every fixture
  helper root logged a natural exit 0. Every actual producer process exited 0. Ten fixture
  gateways were parented by the harness and wrote markers. The launcher's retained handle
  observed their exit 54. **Product cleanup:** the launcher's private-job cleanup branch ran only
  after helpers had already exited naturally. No `helper-cleanup-unconfirmed` occurred, and this
  is not F4 evidence. **Driver teardown:** each run's sentinel was stopped by its exact retained
  handle (SIGTERM) after the cases. No other process was stopped and no process-name matching was
  used.

## Setup faults, corrections and limits (preserved separately)

1. **Admission preparation fault** (`preparation-fault.json` in the admission packet): an absent
   sparse archive path. It is mechanical and not a product result. It is retained untouched, and
   shared sparse settings were not changed. Prior frozen drivers were read as context only and
   were not executed.
2. **The single permitted correction was a driver expectation (timing) assumption, not a product
   fault.** v1 Q06 expected at least two actual-producer samples.
   - Run 1 observed one 3,375 ms sample. ADR-0086 and `Launcher.cs:1157-1158` then correctly
     refuse a retry that cannot fit the measured previous sample within the window less the 2 s
     reserve. Every contract fact held.
   - The v1 record keeps its original `DIFFERED-FROM-PREDICTION` / `VIOLATES` labels (`private/runs/…e1e0e8/Q06`).
   - v2 changes only that range to `[1, 60]` (`driver/v1-to-v2.cases.diff`, `driver/freeze-v2.json`).
     It was frozen at 04:31:44Z, before the Q06-only re-execution at 04:31:59Z. That run matched
     and conformed with two samples (1,689 and 1,869 ms), confirming the timing dependence. No
     unchanged failure was retried.
3. **Bookkeeping errors I made, corrected openly.**
   - Both freeze records were first written with hand-typed, incorrect `frozenUtc` values. They
     were corrected from the manifest file times, and the original values are kept in
     `frozenUtcBasis`.
   - Before the freeze, two attempts at my ad hoc preview of case bytes failed with shell-quoting
     syntax errors, which ran no product code. The third version is `<scratch>/tools/preview-cases.mjs`.
4. **Limits.**
   - Only public `Gateway`/`HelperProcess` behavior is exercised; `Program.Main` mutexes and
     `LauncherLog.Record` file writes are not.
   - A marker is start-path admission, not readiness or store mutation. The independent API lock
     was not exercised, and no store mutation is claimed.
   - WMI was not exercised, because the malformed record needs no process query.
   - Fixture sample spans are helper-internal event times. Held-loop sample counts (16, 12, 2, 1)
     depend on timing.
   - Predictions came from reading source and recalling `JavaScriptSerializer` reference behavior;
     observation confirmed them.
   - Observations come from one Windows 11 host (10.0.26300) on fresh runners.
   - The old 31-criterion matrix was not dispatched. No provider or model turn was made.

## F4 — SOURCE-ONLY

The held head has no shared deterministic timing seam. No baseline API was added and no kernel
race was simulated. No OS reproduction is claimed. Normal fixture timeouts bounded this work and
are not F4 evidence. The source decision order in `HelperProcess.Read`'s `finally` block
(`Launcher.cs:975-999`) is:

1. `cleanup` starts. Then `TerminateJobObject`, writer close and `Cancel` run (`:979-982`).
2. Each pass observes root exit, job accounting and both pipe completions. It sets
   `confirmed = child == null && Empty(job) && outputDone && errorDone` (`:985-988`).
3. `if (confirmed || cleanup.ElapsedMilliseconds >= CleanupMilliseconds) break;` (`:989`).
   `confirmed` short-circuits the deadline, and no elapsed sample is taken after the observation
   pass.

Therefore a pass completing at or after 2,000 ms with all four conditions observed is credited as
timely. This includes a pass that starts after a `Thread.Sleep(1)` overshoot and the equality case.
D166 requires these to remain `helper-cleanup-unconfirmed`. Later code does not upgrade a recorded
outcome. `job.Dispose()` (`:993`), pipe `Complete`/`TransferCompletion` (`:995-997`) and
`if (!confirmed)` (`:998`) all follow. On a held retry, `HeldFailure` (`:1223-1229`) lets
`helper-cleanup-unconfirmed` lead. Any other inconclusive code falls back to the prior ownership
reason. A late credit therefore surfaces as the held reason. Candidate verification must use the
product's new shared observation/clock seam at 1,999/2,000/2,001 ms and a deadline-crossing poll.

## Candidate phase (PENDING, not run)

Use frozen **driver v2** unchanged for F3 against an immutable corrected commit, with
`--expect-head/--expect-tree`. Then compare per case with this baseline. Q08–Q13 and Q15 must move
to their corrected expectations; all other cases and controls must stay unchanged. F4 needs the
product seam described above plus ordinary native regression controls.

## Evidence index

- `REPORT.md`, `case-results.json` and `acceptance-map.json` hold scrubbed, machine-readable results.
- `driver/v1`, `driver/v2` and `driver/freeze-v*.json` are the frozen sources, harness and
  fixtures. `driver/v1-to-v2.cases.diff` holds the single correction. `tools/qa459i-aggregate.mjs`
  derives projections only.
- `setup/` holds the install/build/compile records, git state before and after, and run launch
  logs.
- `private/runs/<runId>/` holds the raw originals: response `.bin` bytes, harness results and
  stdout/stderr, helper events, markers, actual producer stdout/stderr bytes and full case
  records. These are bound by `private/MANIFEST.sha256`.
- `public/` is a path-scrubbed public-safe subset with reusable driver sources, bound by
  `public/MANIFEST.sha256`, which excludes itself. `evidence-manifest.sha256` binds the root files
  and both subtree manifests. The runner-owned `provider-baseline/` is excluded.
- `<scratch>` holds the disposable fixture trees and assemblies. They were retained, with no live
  process, listener or job.

**BASELINE CHARACTERIZED.** F3: 16 cases in 17 executions. Ten reached the start path, six of
them malformed. Seven cases violate the D166 contract and nine conform. F4 is SOURCE-ONLY. One
driver timing assumption was corrected once, and there were zero run-level setup faults.
Candidate QA is pending.
