#requires -Version 7.2
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Admission,
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$AdmissionSha256
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if (!$IsWindows -or ![Environment]::Is64BitProcess -or $PSVersionTable.PSVersion.Major -ne 7 -or
    [Threading.Thread]::CurrentThread.GetApartmentState() -ne 'STA' -or
    $env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or $env:RUNNER_OS -cne 'Windows' -or
    !$env:RUNNER_TEMP -or !$env:GITHUB_WORKSPACE -or (Test-Path Env:NODE_OPTIONS) -or (Test-Path Env:NODE_PATH)) {
    throw 'The supervisor requires the admitted standard hosted Windows PowerShell 7 x64 STA job.'
}
$qaUtf8 = [Text.UTF8Encoding]::new($false)
function Save-QaJson([string]$Path, $Data) {
    $file = [IO.File]::Open($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
    try { $file.Write($qaUtf8.GetBytes((ConvertTo-Json -InputObject $Data -Depth 40) + [char]10)); $file.Flush($true) }
    finally { $file.Dispose() }
}
function Read-QaJson([string]$Path) { ConvertFrom-Json -AsHashtable ([IO.File]::ReadAllText($Path)) }
function Get-QaHash([string]$Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
if ((Get-QaHash $Admission) -cne $AdmissionSha256) { throw 'Exact admitted JSON digest differs.' }
$qaInput = Read-QaJson $Admission
if ($qaInput.schema -cne 'gg436-hosted-admission/v1' -or $qaInput.state -cne 'root-admitted' -or
    $qaInput.phase -cnotin @('baseline','candidate') -or $qaInput.evidenceName -cnotmatch '^qa436-[a-z0-9-]{3,38}$' -or
    $qaInput.packetManifestSha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'Invalid hosted admission.' }
if ($qaInput.phase -ceq 'candidate' -and (!$qaInput.validatorArgument -or $qaInput.validatorArgument -cnotmatch '^--[a-z0-9-]+$')) {
    throw 'Bind the candidate staged validator argument from reviewed source.'
}
if ($qaInput.phase -ceq 'baseline' -and $null -ne $qaInput.validatorArgument) {
    throw 'The baseline has no admitted staged validator.'
}
$qaTemp = [IO.Path]::GetFullPath($env:RUNNER_TEMP)
$qaTempDir = Get-Item -LiteralPath $qaTemp -Force
if (!$qaTempDir.PSIsContainer -or ($qaTempDir.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
    [IO.DriveInfo]::new([IO.Path]::GetPathRoot($qaTemp)).DriveFormat -ine 'NTFS') {
    throw 'Require an ordinary runner temporary folder on NTFS.'
}
$qaResults = Join-Path $qaTemp ($qaInput.evidenceName + '-supervisor')
$qaDriverRoot = Join-Path $qaTemp $qaInput.evidenceName
$qaEvidence = Join-Path $qaDriverRoot 'evidence'
if ((Test-Path -LiteralPath $qaResults) -or (Test-Path -LiteralPath $qaDriverRoot)) { throw 'Fresh supervisor and fixture paths are required.' }
New-Item -ItemType Directory -Path $qaResults | Out-Null
$qaTracePath = Join-Path $qaResults 'process-start.etl'
$qaDecodedPath = Join-Path $qaResults 'process-start.xml'
$qaFirst = $null
$qaDispositions = [Collections.Generic.List[object]]::new()
function Note-QaFailure([string]$Stage, $ErrorValue) {
    $cause = $ErrorValue.Exception
    while ($cause.InnerException) { $cause = $cause.InnerException }
    $detail = [ordered]@{ nativeError=if ($cause -is [ComponentModel.Win32Exception]) { $cause.NativeErrorCode }
        atUtc=[DateTime]::UtcNow.ToString('o'); stage=$Stage; message=$ErrorValue.Exception.Message
        type=$ErrorValue.Exception.GetType().FullName; stack=$ErrorValue.ScriptStackTrace }
    $qaDispositions.Add($detail)
    if ($null -eq $script:qaFirst) {
        $script:qaFirst = $detail
        Save-QaJson (Join-Path $qaResults 'first-failure.json') $detail
    }
}
function Invoke-QaCaptured([string]$Label,[string]$Exe,[string[]]$Arguments,[string]$WorkingDirectory,[int]$Timeout) {
    $prefix = Join-Path $qaResults $Label
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $Exe
    $info.WorkingDirectory = $WorkingDirectory
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    foreach ($arg in $Arguments) { $info.ArgumentList.Add($arg) }
    foreach ($key in @($info.Environment.Keys)) {
        if ($key -match '^(GG_|JEV_API_KEY$|OPENAI_API_KEY$|ANTHROPIC_API_KEY$|GH_TOKEN$|GITHUB_TOKEN$)') {
            [void]$info.Environment.Remove($key)
        }
    }
    $info.Environment['GIT_OPTIONAL_LOCKS'] = '0'
    Save-QaJson ($prefix + '.attempt.json') ([ordered]@{
        executable=$Exe; arguments=$Arguments; workingDirectory=$WorkingDirectory; deadlineMilliseconds=$Timeout; requestedUtc=[DateTime]::UtcNow.ToString('o')
    })
    $capturedOut = $null; $capturedErr = $null; $child = $null
    try {
        $capturedOut = [IO.File]::Open($prefix + '.stdout', 'CreateNew', 'Write', 'Read')
        $capturedErr = [IO.File]::Open($prefix + '.stderr', 'CreateNew', 'Write', 'Read')
        $child = [Diagnostics.Process]::Start($info)
        if (!$child) { throw 'Direct child start did not return a process.' }
        $pipes = [Threading.Tasks.Task[]]@(
            $child.StandardOutput.BaseStream.CopyToAsync($capturedOut),
            $child.StandardError.BaseStream.CopyToAsync($capturedErr)
        )
        $birth = $null; $birthError = $null
        try { $birth = $child.StartTime.ToUniversalTime().ToString('o') }
        catch { $birthError = $_.Exception.Message }
        $spawn = [ordered]@{ pid=$child.Id; parentPid=$PID; birthUtc=$birth; birthError=$birthError; executable=$Exe; arguments=$Arguments }
        Save-QaJson ($prefix + '.spawn.json') $spawn
        if (!$child.WaitForExit($Timeout)) {
            Save-QaJson ($prefix + '.deadline.json') ([ordered]@{ atUtc=[DateTime]::UtcNow.ToString('o'); pid=$child.Id; birthUtc=$birth; actualExitObserved=$false })
            throw "Direct child deadline elapsed for $Label."
        }
        $exit = [ordered]@{ pid=$child.Id; birthUtc=$birth; exitCode=$child.ExitCode; exitUtc=$child.ExitTime.ToUniversalTime().ToString('o') }
        Save-QaJson ($prefix + '.exit.json') $exit
        if (![Threading.Tasks.Task]::WaitAll($pipes, 10000)) { throw "Direct child output streams did not close for $Label." }
        $close = [ordered]@{
            pid=$child.Id; exitCode=$exit.exitCode; streamsClosed=$true; closedUtc=[DateTime]::UtcNow.ToString('o')
            stdoutBytes=$capturedOut.Length; stderrBytes=$capturedErr.Length
        }
        Save-QaJson ($prefix + '.close.json') $close
        [ordered]@{ spawn=$spawn; exit=$exit; close=$close }
    } finally {
        if ($child) { $child.Dispose() }
        if ($capturedOut) { $capturedOut.Dispose() }
        if ($capturedErr) { $capturedErr.Dispose() }
    }
}

function Invoke-QaBinding([string]$Label,[string]$Output) {
    $bindArgs = @((Join-Path $PSScriptRoot 'bind.mjs'), $Admission, $AdmissionSha256, $Output)
    $rc = Invoke-QaCaptured $Label $qaInput.tools.node $bindArgs $qaInput.checkout 120000
    if ($rc.exit.exitCode -ne 0 -or $rc.close.stderrBytes -ne 0 -or !(Test-Path -LiteralPath $Output -PathType Leaf)) {
        throw "The complete source/build binding did not finish successfully: $Label."
    }
    Read-QaJson $Output
}

function Invoke-QaCanary([string]$Edge, [string]$Working) {
    $marker = $qaInput.evidenceName + '-process-canary-' + $Edge + '-' + [guid]::NewGuid().ToString('N')
    $script = "process.stdout.write('$marker')"
    $result = Invoke-QaCaptured ('canary-' + $Edge) $qaInput.tools.node @('-e',$script) $Working 10000
    if ($result.exit.exitCode -ne 0 -or $result.close.stderrBytes -ne 0 -or !$result.spawn.birthUtc -or
        [IO.File]::ReadAllText((Join-Path $qaResults "canary-$Edge.stdout")) -cne $marker) {
        throw 'Fast process canary result did not match the expected bytes and birth receipt.'
    }
    $result['marker'] = $marker; $result['script'] = $script
    return $result
}
$qaBound = $null; $qaTrace = $null; $qaBeforeCanary = $null; $qaAfterCanary = $null
$qaTraceStopped = $null; $qaTraceQuery = $null; $qaMatrix = $null; $qaDriver = $null
$qaWitness = 'incomplete'; $qaPostBound = $false
$qaBeforePath = Join-Path $qaResults 'binding-before.json'
$qaAfterPath = Join-Path $qaResults 'binding-after.json'
try {
    $qaBound = Invoke-QaBinding 'bind-before' $qaBeforePath
    if ((Get-QaHash $qaBound.packet.files['supervise.ps1'].path) -cne $qaBound.packet.files['supervise.ps1'].sha256 -or
        $PSCommandPath -cne $qaBound.packet.files['supervise.ps1'].path) { throw 'Verified binding named a different supervisor.' }
    Save-QaJson (Join-Path $qaResults 'admission-reference.json') ([ordered]@{ path=$Admission; sha256=$AdmissionSha256; bindingSha256=(Get-QaHash $qaBeforePath) })
    $driverPath = $qaBound.driver.files['run.ps1'].path
    $qaEtwName = 'GraphGoblin-QA436-' + $qaInput.githubRunId + '-' + $qaInput.githubRunAttempt + '-' + $qaInput.evidenceName
    try {
        Add-Type -Path $qaBound.packet.files['ProcessTrace.cs'].path
        . $qaBound.packet.files['observe.ps1'].path
        $qaTrace = [GraphGoblin.Qa436.ProcessTrace]::Start($qaEtwName, $qaTracePath)
        Save-QaJson (Join-Path $qaResults 'observer-start.json') ([ordered]@{
            name=$qaEtwName; file=$qaTracePath; atUtc=[DateTime]::UtcNow.ToString('o')
            mode='named sequential system logger'; processProvider='3d6fa8d0-fe05-11d0-9dda-00c04fd7ba7c'
        })
        $qaTraceQuery = $qaTrace.Query()
        Save-QaJson (Join-Path $qaResults 'observer-initial-query.json') $qaTraceQuery
        if ($qaTraceQuery.Status -ne 0 -or $qaTraceQuery.Name -cne $qaEtwName -or $qaTraceQuery.File -ine $qaTracePath -or
            ($qaTraceQuery.Mode -band 0x02000001) -ne 0x02000001 -or ($qaTraceQuery.Mode -band 2) -or
            ($qaTraceQuery.EnabledFlags -band 1) -ne 1) { throw 'The owned trace session did not read back as the requested sequential process logger.' }
        $qaBeforeCanary = Invoke-QaCanary 'before' $qaResults
    } catch { Note-QaFailure 'start and validate owned process observer' $_ }

    try {
        $driverArgs = @('-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-File', $driverPath,
            '-Phase', $qaInput.phase, '-Checkout', $qaBound.checkout, '-ExpectedCommit', $qaBound.head,
            '-NodePath', $qaBound.tools.node.path, '-ChromeProxy', $qaBound.tools.chromeProxy.path,
            '-EvidenceName', $qaInput.evidenceName)
        $qaDriver = Invoke-QaCaptured 'driver' $qaBound.tools.powershell.path $driverArgs $qaResults 475000
        $qaMatrix = Read-QaJson (Join-Path $qaEvidence 'summary.json')
        $caseOrder = @($qaMatrix.cases | ForEach-Object { $_.case })
        $expected = @(1..32 | ForEach-Object { $_.ToString('00') })
        if ($qaDriver.exit.exitCode -ne 0 -or !$qaDriver.spawn.birthUtc -or
            $qaMatrix.phase -cne $qaInput.phase -or $qaMatrix.status -cne 'completed' -or
            ($caseOrder -join ',') -cne ($expected -join ',') -or $qaMatrix.boundedChildCalls -ne 49 -or
            !(Test-Path -LiteralPath (Join-Path $qaEvidence 'post-binding.json') -PathType Leaf)) {
            throw 'The driver disposition did not establish all 32 required cases.'
        }
    } catch { Note-QaFailure 'owned direct installer driver' $_ }
    if ($qaTrace -and $qaBeforeCanary -and $qaDriver -and $qaDriver.close.streamsClosed) {
        try { $qaAfterCanary = Invoke-QaCanary 'after' $qaResults }
        catch { Note-QaFailure 'closing fast process canary' $_ }
    }
} catch { Note-QaFailure 'hosted preflight and input binding' $_ }
finally {
    if ($qaTrace) {
        try {
            $qaTraceStopped = $qaTrace.Stop()
            Save-QaJson (Join-Path $qaResults 'observer-stop.json') $qaTraceStopped
            if ($qaTraceStopped.Status -ne 0 -or $qaTraceStopped.EventsLost -ne 0 -or
                $qaTraceStopped.LogBuffersLost -ne 0 -or $qaTraceStopped.RealTimeBuffersLost -ne 0 -or
                $qaTraceStopped.BuffersWritten -eq 0 -or !$qaTraceQuery -or
                $qaTraceStopped.SessionGuid -cne $qaTraceQuery.SessionGuid) {
                throw 'Owned trace stop, session identity, written buffers or native loss counters did not establish complete collection.'
            }
        } catch { Note-QaFailure 'exact owned trace stop and loss counters' $_ }
    }
}
if ($qaBound) {
    try {
        $null = Invoke-QaBinding 'bind-after' $qaAfterPath
        if ((Get-QaHash $qaAfterPath) -cne (Get-QaHash $qaBeforePath)) { throw 'Bound source/build/runtime/fixture input changed.' }
        $qaPostBound = $true
    } catch { Note-QaFailure 'closing source and build binding' $_ }
}
if ($qaTraceStopped -and $qaTraceStopped.Status -eq 0 -and (Test-Path -LiteralPath $qaTracePath -PathType Leaf)) {
    try {
        $traceLength = (Get-Item -LiteralPath $qaTracePath).Length
        if ($traceLength -le 0 -or $traceLength -ge 32MB) { throw 'The sequential trace was empty or reached its 32 MiB cap.' }
        $decodeArgs = @($qaTracePath, '-o', $qaDecodedPath, '-of', 'XML', '-int', (Join-Path $qaResults 'decoder-schema.xml'),
                '-summary', (Join-Path $qaResults 'decoder-summary.txt'))
        $decoder = Invoke-QaCaptured 'tracerpt' $qaBound.tools.tracerpt.path $decodeArgs $qaResults 45000
        if ($decoder.exit.exitCode -ne 0 -or $decoder.close.stderrBytes -ne 0 -or
            !(Test-Path -LiteralPath $qaDecodedPath -PathType Leaf)) { throw 'Native classic ETL decoding did not finish successfully.' }
        if ($qaBeforeCanary -and $qaAfterCanary -and $qaDriver -and $qaTraceQuery -and
            $qaTraceStopped.EventsLost -eq 0 -and $qaTraceStopped.LogBuffersLost -eq 0 -and
            $qaTraceStopped.RealTimeBuffersLost -eq 0 -and $qaTraceStopped.BuffersWritten -gt 0 -and
            $qaTraceStopped.SessionGuid -ceq $qaTraceQuery.SessionGuid) {
            $observerArgs = @($qaDecodedPath, $qaDriver, $qaBeforeCanary, $qaAfterCanary, $driverPath, $qaEvidence,
                $qaInput.validatorArgument, (Join-Path $qaResults 'observer-summary.json'), $qaInput.tools.node, $qaBound.tools.node.path)
            $qaWitness = Read-QaProcessTrace @observerArgs
        }
    } catch { Note-QaFailure 'native classic process decode and canary correlation' $_ }
}
$qaCompleted = $null -eq $qaFirst -and $qaPostBound -and $qaWitness -ceq 'complete-no-gateway-or-chrome-process-starts'
$qaResult = [ordered]@{
    schema='gg436-hosted-supervisor-result/v1'; status=if ($qaCompleted) {'matrix-and-witness-finished-for-review'} else {'incomplete'}
    phase=$qaInput.phase; head=$qaInput.expectedCommit; base=$qaInput.baseCommit; expectedTree=$qaInput.expectedTree
    evidence=$qaEvidence; supervisor=$qaResults; firstFailure=$qaFirst; dispositions=$qaDispositions.ToArray()
    nativeDriver=if ($qaDriver) { $qaDriver.exit }
        elseif (Test-Path -LiteralPath (Join-Path $qaResults 'driver.exit.json') -PathType Leaf) {
            Read-QaJson (Join-Path $qaResults 'driver.exit.json')
        }
    matrixStatus=if ($qaMatrix) { $qaMatrix.status }
    caseCount=if ($qaMatrix) { $qaMatrix.cases.Count }; closingIdentityVerified=$qaPostBound; processWitness=$qaWitness
}
Save-QaJson (Join-Path $qaResults 'launch-result.json') $qaResult
ConvertTo-Json -InputObject $qaResult -Depth 15 -Compress
if ($qaCompleted) { exit 0 }
if ($qaDriver -and $qaDriver.exit.exitCode -ne 0) { exit $qaDriver.exit.exitCode }
exit 1
