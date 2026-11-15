# #381 internal candidate launcher

Preparation only. Root will review this launcher, verify the complete candidate source and build binding, and bind a fresh admission after the exact candidate head is ready. The launcher covers the existing frozen 13-case A3/A4 harness. The baseline wrappers, harness sources, and retained evidence are separate artifacts.

## Admission

Copy the field layout in [admission.example.json](admission.example.json) into a fresh root admission in the batch directory. Replace the placeholders with the admitted candidate head, exact isolated checkout, reviewed launcher SHA-256, project Node executable and SHA-256, and the exact pre-binding receipt and SHA-256. The pre-binding receipt must already exist under the batch directory. Use a fresh receipt basename matching `runtime-381-internal-candidate-execution-<number>`. Root maintains its complete source, index, output and dependency inventory and performs the separate post-binding. The launcher validates the supplied admission digest, path, mode and state, then verifies the referenced bytes and the three frozen harness SHA-256 values. It performs no Git reads or builds.

The child executable is the project Node 22.23.4 PE image at the exact admitted absolute path. The launcher sets `UseShellExecute = false`, `CreateNoWindow = true` and a cleared, explicit five-variable Windows environment. It supplies each argument separately through `ProcessStartInfo.ArgumentList`. The harness argument vector is `--expose-gc`, the exact `run.mjs` path, `candidate`, the exact checkout path, and `evidence-candidate-first`. PowerShell does not interpolate a command line for the child. Paths containing spaces remain one argument. The harness requires both its candidate evidence path and the separate launcher receipt folder to start fresh. The optional store-retention switch is absent.

The later invocation is a direct PowerShell 7 script call with the already admitted digest.

```powershell
$qaLauncher = 'C:\Users\98jak\graphgoblin-qa\2026-11-13-aidlc-batch\runtime-381-internal-candidate-launch-preparation\launch.ps1'
$qaAdmission = '<absolute root-created admission JSON path>'
$qaAdmittedHash = '<root-recorded lowercase SHA-256 of that exact file>'
& $qaLauncher -AdmissionPath $qaAdmission -AdmissionSha256 $qaAdmittedHash
```

## Receipt ordering

- `launch.json` records the executable, arguments, allowlisted environment, working directory and admitted hashes before spawning.
- `child-start.json` records the directly owned process PID. A bounded asynchronous query for CIM creation time starts immediately, in parallel with monitoring the process. The query correlates the exact image path, PID and the start time observed by the owned process handle.
- `child-exit.json` is written and flushed as soon as the process handle signals. It contains the exact observed exit code. It precedes the redirected-stream wait, log flushing, CIM result interpretation and close reporting.
- `child-close.json` records process exit plus both redirected streams closed. `child-identity.json` separately records the CIM result or why it was unavailable. The two log files contain the raw redirected bytes.
- `child-unsettled.json` is the last observed process identity and a missing exit code when the owned process wait reaches the 120-second budget. The supervisor exits 124. A wait timeout can leave an owned child running and only a partial log capture. Root must use the recorded identity and fresh readback for any further decision.
- `launcher-error.json` records the failed stage and available owned-process observations. Setup refusal before a fresh receipt directory exists is reported to the invoking terminal. A missing CIM result, reporting error, or unconfirmed stream close yields an incomplete wrapper with exit 1. Previously written exit and other receipts remain authoritative for their own observations.

Receipts use create-new files and UTF-8 JSON. Exit receipts are flushed to disk before the next stage. With complete observation and a verified identity, the launcher returns the child's exact exit code. It never assigns a case verdict or reads the harness summary. The retained child-exit receipt remains distinct from wrapper status. An unsettled process or capture failure triggers no process kill or rerun. Root separately verifies end-to-end outcome, exact post-binding and absence of owned processes or stores.

The .NET ProcessStartInfo path, CIM provider and inherited-pipe shutdown remain runtime observations for the separately admitted candidate pass. This preparation used PowerShell 7.6.9 static parsing. No launcher or harness was invoked.
