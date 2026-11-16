# #438 disposable standard-handle controls

**Preparation only.** The [fixture host](StdioFixtureHost.cs) compiled as AMD64 PE32+ with warnings as errors. Project Node passed the [driver](run.mjs) syntax check. Neither executable, the driver, nor a runtime fixture ran. The [observer and its proof limits](../full-report.md) still govern the interpretation. [Compile receipt](compile-check.json) · [Syntax receipt](syntax-check.json)

The driver runs one positive mapping, one NUL with the wrong output access, one anonymous pipe in place of stdout, and two identity refusals on the still-live positive fixture. Each fixture is exactly project Node with argv `-e` and `setTimeout(() => {}, 30000)`. The fixture host opens NUL and, in the wrong-destination case, an anonymous pipe. It supplies only the listed inheritable handles, records the creation FILETIME directly and holds the exact process handle through natural exit. The driver gives the observer three independent redirected pipes. It checks the raw granted-access bits and the expected mapped object type/name as well as the observer disposition.

## One root-admitted run

After root has reviewed the exact bytes and scheduled the disposable controls, fill the following PowerShell variables and create a fresh admission. Keep the driver, fixture host, observer, receipts and runtime in their prepared paths. The required path names are fixed in the driver. The Windows release and selected System32 DLL hashes bind the build under test. These hashes describe the named host files.

```powershell
$qaControls = 'C:\Users\98jak\graphgoblin-qa\2026-11-13-aidlc-batch\launcher-438-stdio-preparation\controls'
$qaPreparation = Split-Path -Parent $qaControls
$qaNode = 'C:\Users\98jak\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64\node.exe'
$qaAttempt = 'attempt-1' # use a fresh name
$qaAdmission = Join-Path $qaControls "admission-$qaAttempt.json"
$qaSystem32 = Join-Path $env:SystemRoot 'System32'
Remove-Item Env:NODE_OPTIONS -ErrorAction SilentlyContinue
$qaHostRelease = & $qaNode -p 'require("node:os").release()'
if ($LASTEXITCODE -ne 0) { throw 'Windows release readback failed' }

$qaFiles = [ordered]@{
    driver = Join-Path $qaControls 'run.mjs'
    fixtureSource = Join-Path $qaControls 'StdioFixtureHost.cs'
    fixtureExe = Join-Path $qaControls 'StdioFixtureHost.exe'
    fixtureCompileReceipt = Join-Path $qaControls 'compile-check.json'
    observerSource = Join-Path $qaPreparation 'ObserveStdio.cs'
    observerExe = Join-Path $qaPreparation 'ObserveStdio.compile-check.exe'
    observerCompileReceipt = Join-Path $qaPreparation 'compile-check.json'
    node = $qaNode
    ntdll = Join-Path $qaSystem32 'ntdll.dll'
    kernel32 = Join-Path $qaSystem32 'kernel32.dll'
    kernelbase = Join-Path $qaSystem32 'KernelBase.dll'
}
$qaHashes = [ordered]@{}
foreach ($qaName in $qaFiles.Keys) {
    $qaHashes[$qaName] = (Get-FileHash -LiteralPath $qaFiles[$qaName] -Algorithm SHA256).Hash.ToLowerInvariant()
}
$qaPayload = [ordered]@{
    schema = 'gg438-stdio-controls-admission/v1'
    state = 'root-admitted'
    attempt = $qaAttempt
    hostRelease = $qaHostRelease
    sha256 = $qaHashes
}
$qaStream = [IO.File]::Open($qaAdmission, [IO.FileMode]::CreateNew)
try {
    $qaBytes = [Text.UTF8Encoding]::new($false).GetBytes(($qaPayload | ConvertTo-Json -Depth 4) + [char]10)
    $qaStream.Write($qaBytes)
} finally { $qaStream.Dispose() }
$qaAdmissionSha = (Get-FileHash -LiteralPath $qaAdmission -Algorithm SHA256).Hash.ToLowerInvariant()
& $qaNode (Join-Path $qaControls 'run.mjs') $qaAdmission $qaAdmissionSha
```

The driver verifies binding before any spawn and after all cases and cleanup. Each observer has a nine-second deadline. The supervisor can request termination only through the exact observer child it spawned. A timed-out fixture host or target is left to its natural lifecycle and recorded as incomplete if close remains ambiguous. The driver stops at its first failed case and has no retry path. It records the expected spawn evidence before proceeding and waits on exact host close in the case's cleanup path.

## Verify the result

Read the fresh `attempts/<attempt>/evidence` directory and require all of the following.

- Driver exit 0, `result.status=observed`, and equal opening and closing binding receipts.
- Three host launch receipts with raw PID and birth, exact Node command and case mapping, the `STARTF_USESTDHANDLES` flag, the explicit handle list and its per-slot access. Each host emits `natural-exit` with the matching PID and child exit 0 through its retained process handle. Each host also has a distinct exit, close and stream EOF receipt.
- Positive observer exit 0 and all NUL slots matched. Wrong-direction observer exit 1 with only stdout lacking write access. Wrong-destination observer exit 1 with only stdout classified as PIPE. The mismatched birth and image each return exit 2 with the expected refusal and emit no slot observations. The raw stdout and stderr and separate exit, close and EOF evidence are available for every observer.
- `cleanup.scratchRemoved=true` and exactly three natural fixture exits. Only the empty canonical scratch leaf is removed after successful receipts. Evidence stays. Incomplete cases retain their scratch and receipts, including the first failure. No process enumeration or deletion of stores is needed.

Passing controls qualify the observer on this Windows build. The actual launcher still requires a separate admitted observation of its owned gateway and caller EOF.

