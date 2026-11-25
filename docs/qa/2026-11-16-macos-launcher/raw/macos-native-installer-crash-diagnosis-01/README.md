# Read-only native installer crash report collection

This packet binds the completed native installer reproduction's PID 48099, start 2026-11-16T21:59:58.800Z and signal readback 2026-11-16T21:59:59.081Z. It rechecks the exact build04 installer path, inode, byte count, SHA-256 and Mach-O LC_UUID. It also samples the known partial stage, including the staged launcher's executable and plist digests and exact final-target, configuration, data and receipt paths.

The helper reads only bounded recent GraphGoblin-named IPS candidates in the user's physical DiagnosticReports directory. Full bytes are returned only for a unique report matching the installer PID, process name, owner, start and capture window, path and Mach-O UUID. The allowed redacted path is the literal Apple-style /Users/USER/*/GraphGoblinLauncherInstaller; its asterisk is never a pattern. Unmatched candidates expose only match booleans, with selected scalars additionally limited to exact PID and process name. Matched reports with environment or secret markers return stack projection without raw bytes. The execution has no remote writes, signals, installs, launches, or retries.

Read crash-probe.mjs and run-crash-probe.mjs, compare SHA256SUMS.txt, and check the preview's exact strict SSH arguments. With project Node 22 selected, save the preview and display only digest metadata.

```powershell
node .\run-crash-probe.mjs --preview | Set-Content -Encoding utf8NoBOM .\root-preview.json
$crashPreview = Get-Content -Raw .\root-preview.json | ConvertFrom-Json
$crashPreview | Select-Object commandSha256,probeSha256,probeBytes,timeoutMs,maxBuffer
```

After operator admission, invoke once with the inspected digest.

```powershell
node .\run-crash-probe.mjs --run $crashPreview.commandSha256
```

Use receipt/summary.json for the readback, including the faulting thread and loaded images. A matched full report is retained as receipt/GraphGoblinLauncherInstaller-48099.ips after size, SHA and binding verification. The original reproduction receipt and the stage remain in place.
