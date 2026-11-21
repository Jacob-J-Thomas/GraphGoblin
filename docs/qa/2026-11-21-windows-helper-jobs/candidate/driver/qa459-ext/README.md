# GraphGoblin #459 independent native QA driver

Independent behaviour QA for the reviewed #459 plan (Windows launcher helper lifetime). It is not
product code and not a source review. It compiles the checkout's
`apps/windows-launcher/Launcher.cs` with the shipped installer's csc flags and drives the normal
`--config <file> --ensure-gateway` CLI (quiet: no dialog, no PWA) against disposable stores,
ports and private log folders.

## Run

Node 22 first on PATH (Git Bash shown; on PowerShell prepend the same directory to `$env:PATH`):

```
export PATH="$HOME/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64:$PATH"
node qa459-driver.mjs --checkout <checkout> --scratch <scratch dir> --out <output dir> \
  --label baseline|candidate [--cases id,id] [--job-exit-code <n>] [--port-start 4871] \
  [--launcher-host detached|job]
```

- The checkout must already be built (`apps/api/dist`, `apps/web/dist`). The driver only reads it.
- `--scratch` receives the compiled launcher and witness, the fixture repository copy and all
  disposable case directories (`runs/<runId>/`).
- `--out` receives `<runId>/run.json`, `summary.json`, `cases/<id>.json` (scrubbed public
  evidence) and `raw-private/<id>/` (unscrubbed original launcher stdout/stderr bytes, events,
  launcher.log, configs; private, contains local scratch paths). Existing run folders are never
  overwritten.
- `--label candidate` judges every `requirement` and `control` assertion as must-pass.
  `--label baseline` judges whether each observation matched its stated baseline expectation.
- `--job-exit-code` (candidate only, optional): require that exact exit code for every
  descendant that launcher collection terminates.
- `--launcher-host detached` (default) starts the launcher outside the driver's libuv job, like
  a shortcut click; `job` starts it inside that job (kill-on-close, silent breakaway).

## Lanes

- `fixture`: a disposable copy of the minimal built tree the launcher validates, with
  `apps/api/dist/instance-identity.js` replaced by `fixtures/helper.mjs` (a scenario-driven
  helper) and `apps/api/dist/main.js` by `fixtures/gateway.mjs` (a minimal fake gateway).
- `real`: the unmodified built API/helper of the checkout, real WMI and a real gateway that is
  drained normally (`POST /system/shutdown {"action":"drain"}`).

## Process witnesses

`witness/QaWitness.cs` opens `SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_TERMINATE`
handles. Every fixture process (helper roots, detached members, the PowerShell query, its nested
child, fake gateways, the sentinel) connects to the driver's private pipe, sends its PID and blocks
until the witness holds its handle, so the PID cannot be reused before the handle exists. Launchers,
real helpers and the contender are opened right after spawn while Node still holds their process
handle, and checked by image name and creation time. Real gateways are opened from the health PID
and confirmed by a later health answer while the handle is still live. The witness reports
OS-recorded creation/exit FILETIMEs, exit codes, parent PID and job membership. It never enumerates
processes and terminates only an exact retained handle on the driver's watchdog request.

## Exit codes

| Code           | Meaning                                                                     |
| -------------- | --------------------------------------------------------------------------- |
| 41             | member natural lifetime end                                                 |
| 43             | PowerShell query natural lifetime end                                       |
| 44 / 45        | fake gateway drained / natural max lifetime                                 |
| 46             | sentinel natural lifetime end                                               |
| 47             | driver release request (teardown, not launcher collection)                  |
| 48             | PowerShell fixture lost its driver pipe                                     |
| 49             | hanging helper root natural max lifetime                                    |
| 97             | fixture setup fault                                                         |
| 42073 (0xA459) | driver watchdog TerminateProcess on an exact handle                         |
| 4294967295     | .NET Framework `Process.Kill` (baseline launcher kill of the direct helper) |

A helper root counts as natural only when its own `helper-exit` event recorded the same code. On
the baseline host, processes killed through a libuv kill-on-close job showed exit code 0, so
fixtures use distinctive nonzero natural codes.

## Sequence per case

1. Prepare the scenario, config, private case folder and (identity cases) a plain-health marker
   listener on the case port. A `foreign-listener` refusal then proves that the identity result
   was accepted.
2. Launch, sample all owned handles at launcher exit, wait 3 s, sample again (`afterGrace`).
   Assertions use only these samples (launcher collection).
3. Teardown, recorded separately: HTTP drain for gateways, a release request to fixtures, then
   watchdog termination of anything still alive. Final states and caller-pipe EOF after teardown
   are recorded but never used to pass a requirement.

## Extending for candidate QA

Add cases to `qa459-cases.mjs`. Use `requirement` for reviewed #459 acceptance semantics and
`control` for behaviour that must hold on both baseline and candidate; state the expected
baseline result. Keep new fixtures bounded (natural lifetimes) and announced through the
handshake.

## Extension qa459-ext/1 (`--suite ext`)

A separately hashed copy of the baseline driver. `qa459-cases.mjs` is byte-identical to the
baseline; the base suite (default `--suite base`) behaves as before. `--suite ext` runs
`qa459-ext-cases.mjs` for the remaining ADR-0086 native acceptance:

- **Harness jobs.** The witness creates a disposable job (`job`, `joblimit`), places processes
  in it (`jobspawn`: created suspended with NUL stdin and two private capture pipes as the only
  inherited handles, assigned, then resumed), reports basic accounting and the job's own
  process-ID list (`jobquery`), job membership of an exact handle (`injob`) and closes the job
  only at teardown (`jobclose`). It never enumerates processes outside its own disposable jobs.
- **In-job probe.** `QaWitness.exe --nest-probe <file> [innerUi]` runs inside the harness job and
  reports the job's effective UI restrictions read from inside, and whether a nested
  `CreateProcess` with `PROC_THREAD_ATTRIBUTE_JOB_LIST` and an `AssignProcessToJobObject` into a
  fresh job actually succeed. Probe children are created suspended and terminated with 42078
  before they ever run.
- **Creator death.** At an acknowledged boundary (helper-ready, or root-exited with descendants
  ready) the exact launcher handle is terminated with 17820 (0x459C) while the harness job stays
  open; descendant completion is sampled 2 s after the launcher's exit, before harness teardown.
  Kill-on-close completion carries an OS-assigned code (0 on this host), so no 0xE0470459
  assertion is made there.
- **Incompatible host.** On the QA host no UI restriction prevents nesting (see the setup
  exploration). The incompatible job is limited to the processes the harness placed in it plus
  one free slot; console hosts appear in accounting but are not counted by the active-process
  limit on this host. The in-job probe verifies the refusal before the launcher uses the slot.
- **Observer handles.** After the grace sample the witness closes its handles to exited
  processes and the open harness job's accounting is read again.
- **Filesystem state.** Every case writes a private case-folder inventory (`filesystem.json`).

| Code           | Meaning (ext)                                               |
| -------------- | ----------------------------------------------------------- |
| 17820 (0x459C) | creator-death TerminateProcess of the exact launcher handle |
| 42078 (0xA45E) | never-resumed probe child or refused assignment             |
