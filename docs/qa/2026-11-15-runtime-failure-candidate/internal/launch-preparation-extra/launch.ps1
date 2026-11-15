#requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$AdmissionPath,
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{64}$')][string]$AdmissionSha256
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $IsWindows -or $PSVersionTable.PSEdition -ne 'Core') {
    throw 'Use PowerShell 7 on Windows.'
}

function Resolve-PlainPath([string]$Value, [bool]$Directory) {
    if (-not [IO.Path]::IsPathFullyQualified($Value) -or $Value -notmatch '^[A-Za-z]:\\') {
        throw "Expected an absolute local Windows path: $Value"
    }
    $resolved = [IO.Path]::GetFullPath($Value)
    if ($resolved -ne $Value) { throw "Expected normalized path: $Value" }
    $item = Get-Item -LiteralPath $resolved -Force
    if ($item.PSIsContainer -ne $Directory) { throw "Unexpected path type: $resolved" }
    for ($current = $resolved; $current; $current = [IO.Path]::GetDirectoryName($current)) {
        if ([IO.File]::GetAttributes($current) -band [IO.FileAttributes]::ReparsePoint) {
            throw "Reparse points are outside this launch: $current"
        }
    }
    $item.FullName
}

function Assert-Hash([string]$Path, [string]$Expected) {
    if ($Expected -cnotmatch '^[0-9a-f]{64}$') { throw "Missing lowercase SHA-256 for $Path" }
    $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -cne $Expected) { throw "SHA-256 mismatch for $Path" }
}

function Write-Receipt([string]$Path, [System.Collections.IDictionary]$Data) {
    $json = (ConvertTo-Json -InputObject $Data -Depth 12) + [Environment]::NewLine
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes($json)
    $stream = [IO.FileStream]::new($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
    try {
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush($true)
    } finally { $stream.Dispose() }
}

function Start-ChildIdentity([Diagnostics.Process]$Child) {
    $probe = [ordered]@{ query = $null; pending = $null; pid = $Child.Id
        requestedUtc = [DateTime]::UtcNow; nativeStartUtc = $null; error = $null }
    try { $probe.nativeStartUtc = $Child.StartTime.ToUniversalTime() } catch {
        $probe.error = "Process start time unavailable: $($_.Exception.Message)"
    }
    try {
        $probe.query = [PowerShell]::Create()
        $null = $probe.query.AddCommand('Get-CimInstance').AddParameter('ClassName', 'Win32_Process').
            AddParameter('Filter', "ProcessId = $($Child.Id)").AddParameter('OperationTimeoutSec', 3).
            AddParameter('ErrorAction', 'Stop')
        $probe.pending = $probe.query.BeginInvoke()
    } catch {
        $probe.error = $_.Exception.Message
    }
    $probe
}

function Complete-ChildIdentity([System.Collections.IDictionary]$Probe, [string]$ExpectedExe, [int]$WaitMs) {
    $answer = [ordered]@{ pid = $Probe.pid; status = 'unavailable'; queriedUtc = $Probe.requestedUtc
        nativeStartUtc = $Probe.nativeStartUtc; cimCreationUtc = $null; executablePath = $null
        error = $Probe.error }
    try {
        if (-not $Probe.pending) { return $answer }
        if (-not $Probe.pending.AsyncWaitHandle.WaitOne($WaitMs)) {
            $null = $Probe.query.BeginStop($null, $null)
            throw 'Timed out waiting for the in-process CIM query.'
        }
        $observed = @($Probe.query.EndInvoke($Probe.pending))
        if ($observed.Count -ne 1 -or -not $observed[0].CreationDate -or -not $observed[0].ExecutablePath) {
            throw 'CIM did not yield one row with creation time and executable.'
        }
        $row = $observed[0]
        $answer.cimCreationUtc = ([DateTime]$row.CreationDate).ToUniversalTime()
        $answer.executablePath = [string]$row.ExecutablePath
        if ($row.ProcessId -ne $Probe.pid -or $answer.executablePath -ne $ExpectedExe) {
            throw 'CIM process identity differs from the owned child handle or exact image path.'
        }
        if (-not $answer.nativeStartUtc -or
            [Math]::Abs(($answer.cimCreationUtc - $answer.nativeStartUtc).TotalMilliseconds) -gt 20) {
            throw 'CIM creation time could not be correlated with the owned child handle.'
        }
        $answer.status = 'verified'
        $answer.error = $null
    } catch {
        $answer.error = $_.Exception.Message
    } finally {
        if ($Probe.query -and ($null -eq $Probe.pending -or $Probe.pending.IsCompleted)) {
            $Probe.query.Dispose()
        }
    }
    $answer
}

function Remaining-Milliseconds([Diagnostics.Stopwatch]$Elapsed) {
    [int][Math]::Max(0, 120000 - $Elapsed.ElapsedMilliseconds)
}

$batch = Resolve-PlainPath (Split-Path -Parent $PSScriptRoot) $true
$profileRoot = Split-Path -Parent (Split-Path -Parent $batch)
$worktrees = Resolve-PlainPath (Join-Path $profileRoot '.codex\worktrees') $true
$admissionFile = Resolve-PlainPath $AdmissionPath $false
if ((Split-Path -Parent $admissionFile) -ne $batch) { throw 'Use a root admission file in the batch directory.' }
Assert-Hash $admissionFile $AdmissionSha256
$admitted = Get-Content -Raw -LiteralPath $admissionFile | ConvertFrom-Json -AsHashtable
if ($admitted.schema -cne 'gg381-internal-candidate-launch/v1' -or
    $admitted.state -cne 'root-admitted' -or $admitted.phase -cne 'candidate' -or
    $admitted.candidateHead -cnotmatch '^[0-9a-f]{40}$' -or
    $admitted.receiptFolder -cnotmatch '^runtime-381-internal-candidate-execution-[1-9][0-9]{0,3}$') {
    throw 'The root candidate admission or receipt basename is incomplete.'
}
$launcherPath = Resolve-PlainPath $PSCommandPath $false
Assert-Hash $launcherPath $admitted.launcherSha256
$bindingPath = Resolve-PlainPath $admitted.preBindingPath $false
if (-not $bindingPath.StartsWith($batch + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The root pre-binding receipt must be within the batch directory.'
}
Assert-Hash $bindingPath $admitted.preBindingSha256

$node = Resolve-PlainPath $admitted.nodeExe $false
$expectedNode = Join-Path $profileRoot '.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64\node.exe'
if ($node -ne $expectedNode -or (Get-Item -LiteralPath $node).VersionInfo.ProductVersion -ne '22.23.4') {
    throw 'Use the project Node 22.23.4 executable.'
}
Assert-Hash $node $admitted.nodeSha256
$checkout = Resolve-PlainPath $admitted.checkout $true
if ([IO.Path]::GetRelativePath($worktrees, $checkout) -notmatch '^gg-[^\\/]+\\GraphGoblin$') {
    throw 'Use the admitted isolated GraphGoblin worktree.'
}

$harness = Resolve-PlainPath (Join-Path $batch 'runtime-381-native-internal-preparation') $true
$harnessHashes = [ordered]@{
    'run.mjs' = 'f9c2a36e098a1fc9d4c72a5b4b9cf88396a4991293916eecbbadf4418c2e1dae'
    'cases.mjs' = 'ca28bf290133dec3a3e8572815c6d5c010f85fa8a87cf134f11bfafffa5640ce'
    'README.md' = '97b2c6751abe3deadb5523141cd72eae08dded69b819fd9903a61c15913ce58e'
}
foreach ($entry in $harnessHashes.GetEnumerator()) {
    Assert-Hash (Resolve-PlainPath (Join-Path $harness $entry.Key) $false) $entry.Value
}
$evidenceName = 'evidence-candidate-first'
if (Test-Path -LiteralPath (Join-Path $harness $evidenceName)) { throw 'Candidate evidence path already exists.' }
$receipt = (New-Item -ItemType Directory -Path (Join-Path $batch $admitted.receiptFolder)).FullName

$child = $null
$started = $false
$stdout = $null
$stderr = $null
$identity = $null
$probe = $null
$outcome = 1
$stage = 'configure'
try {
    $scratch = (New-Item -ItemType Directory -Path (Join-Path $receipt 'temp')).FullName
    $systemRoot = [Environment]::GetFolderPath([Environment+SpecialFolder]::Windows)
    if (-not $systemRoot) { throw 'Windows system root unavailable.' }
    $childEnv = [ordered]@{ SystemRoot = $systemRoot; WINDIR = $systemRoot
        PATH = "$(Split-Path -Parent $node);$systemRoot\System32;$systemRoot"
        TEMP = $scratch; TMP = $scratch }
    $launchArgs = @('--expose-gc', (Join-Path $harness 'run.mjs'), 'candidate', $checkout, $evidenceName)
    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $node
    $startInfo.WorkingDirectory = $harness
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    foreach ($part in $launchArgs) { $startInfo.ArgumentList.Add($part) }
    $startInfo.Environment.Clear()
    foreach ($entry in $childEnv.GetEnumerator()) { $startInfo.Environment.Add($entry.Key, $entry.Value) }

    $stdout = [IO.FileStream]::new((Join-Path $receipt 'stdout.log'), [IO.FileMode]::CreateNew)
    $stderr = [IO.FileStream]::new((Join-Path $receipt 'stderr.log'), [IO.FileMode]::CreateNew)
    Write-Receipt (Join-Path $receipt 'launch.json') ([ordered]@{
        phase = 'candidate'; candidateHead = $admitted.candidateHead
        launcherPid = $PID; admittedPath = $admissionFile; admissionSha256 = $AdmissionSha256
        preBindingPath = $bindingPath; preBindingSha256 = $admitted.preBindingSha256
        launcherSha256 = $admitted.launcherSha256; nodeSha256 = $admitted.nodeSha256
        executable = $node; argv = $launchArgs; cwd = $harness; childEnvironment = $childEnv
        harnessHashes = $harnessHashes; requestedUtc = [DateTime]::UtcNow
    })
    $stage = 'start'
    $child = [Diagnostics.Process]::new()
    $child.StartInfo = $startInfo
    $elapsed = [Diagnostics.Stopwatch]::StartNew()
    if (-not $child.Start()) { throw 'Process.Start returned false.' }
    $started = $true
    $copies = [Threading.Tasks.Task]::WhenAll([Threading.Tasks.Task[]]@(
        $child.StandardOutput.BaseStream.CopyToAsync($stdout),
        $child.StandardError.BaseStream.CopyToAsync($stderr)
    ))
    Write-Receipt (Join-Path $receipt 'child-start.json') ([ordered]@{
        pid = $child.Id; executable = $node; observedUtc = [DateTime]::UtcNow
    })

    $probe = Start-ChildIdentity $child
    $stage = 'wait'
    if (-not $child.WaitForExit((Remaining-Milliseconds $elapsed))) {
        $identity = Complete-ChildIdentity $probe $node 0
        Write-Receipt (Join-Path $receipt 'child-unsettled.json') ([ordered]@{
            observedUtc = [DateTime]::UtcNow; identity = $identity; timeoutMs = 120000
            processHandleSignalled = $false; exitCode = $null; rawLogsMayBePartial = $true
        })
        $outcome = 124
    } else {
        $stage = 'child-exit'
        $childCode = $child.ExitCode
        # Persist the exact wait result first. Stream handling and interpretation can fail later.
        Write-Receipt (Join-Path $receipt 'child-exit.json') ([ordered]@{
            observedUtc = [DateTime]::UtcNow; pid = $child.Id; exitCode = $childCode
            processHandleSignalled = $true
        })
        $stage = 'child-stream-close'
        if (-not $copies.Wait((Remaining-Milliseconds $elapsed))) {
            throw 'The child exited, but redirected stream closure was not observed within the launch bound.'
        }
        $stdout.Flush($true)
        $stderr.Flush($true)
        $stdout.Dispose()
        $stderr.Dispose()
        $stdout = $null
        $stderr = $null
        $stage = 'child-close-receipt'
        Write-Receipt (Join-Path $receipt 'child-close.json') ([ordered]@{
            observedUtc = [DateTime]::UtcNow; pid = $child.Id; exitCode = $childCode
            stdoutClosed = $true; stderrClosed = $true
        })
        $stage = 'child-identity-receipt'
        $identity = Complete-ChildIdentity $probe $node ([Math]::Min(3500, (Remaining-Milliseconds $elapsed)))
        Write-Receipt (Join-Path $receipt 'child-identity.json') $identity
        $outcome = if ($identity.status -eq 'verified') { $childCode } else { 1 }
    }
} catch {
    $problem = [ordered]@{
        stage = $stage; observedUtc = [DateTime]::UtcNow; message = $_.Exception.Message
        scriptStack = $_.ScriptStackTrace; childStarted = $started; childPid = $null
        childExited = $null; childExitCode = $null; childObservationError = $null; identity = $identity
    }
    if ($started) {
        try {
            $problem.childPid = $child.Id
            $problem.childExited = $child.HasExited
            if ($problem.childExited) { $problem.childExitCode = $child.ExitCode }
        } catch { $problem.childObservationError = $_.Exception.Message }
    }
    if ($null -eq $identity -and $probe) {
        try { $problem.identity = Complete-ChildIdentity $probe $node 0 }
        catch { $problem.identity = @{ status = 'unavailable'; error = $_.Exception.Message } }
    }
    try { Write-Receipt (Join-Path $receipt 'launcher-error.json') $problem }
    catch { [Console]::Error.WriteLine("Could not save launcher error: $($_.Exception.Message)") }
    [Console]::Error.WriteLine($problem.message)
} finally {
    if ($stdout) { $stdout.Dispose() }
    if ($stderr) { $stderr.Dispose() }
    if ($child) { $child.Dispose() }
}
exit $outcome
