[CmdletBinding()]
param([Parameter(Mandatory)][ValidatePattern('^[a-z0-9-]{3,48}$')][string]$Suffix)
$ErrorActionPreference = 'Stop'
$qaBatch = Split-Path -Parent $PSScriptRoot
$qaName = 'evidence-candidate-' + $Suffix
$qaEvidence = Join-Path (Join-Path $qaBatch 'runtime-419-native-preparation') $qaName
$qaReceipts = Join-Path $qaBatch ('runtime-419-launch-execution-candidate-' + $Suffix)
$qaSummary = Get-Content -Raw -LiteralPath (Join-Path $qaEvidence 'summary.json') | ConvertFrom-Json
$qaLaunch = Get-Content -Raw -LiteralPath (Join-Path $qaReceipts 'launch.json') | ConvertFrom-Json
$qaExit = Get-Content -Raw -LiteralPath (Join-Path $qaReceipts 'child-exit.json') | ConvertFrom-Json
$qaClose = Get-Content -Raw -LiteralPath (Join-Path $qaReceipts 'child-close.json') | ConvertFrom-Json
if ($qaSummary.phase -cne 'candidate' -or $qaSummary.evidenceDir -cne $qaEvidence -or
    $qaLaunch.evidence -cne $qaEvidence -or $qaExit.pid -ne $qaLaunch.pid -or
    $qaClose.pid -ne $qaLaunch.pid -or $qaSummary.runner.pid -ne $qaLaunch.pid) {
    throw 'Candidate process receipt identities differ'
}
$qaPort = [int]$qaSummary.transport.bound.port
if ($qaSummary.transport.bound.address -cne '127.0.0.1' -or $qaPort -le 0 -or $qaPort -in @(4747,4748)) {
    throw 'Candidate port is outside the owned fixture scope'
}
$qaPids = [ordered]@{runner=$qaLaunch.pid; supervisor=$qaLaunch.parentPid; exclusiveOpenHelper=$qaSummary.cleanup.probe.pid}
$qaSnap = [ordered]@{observedAtUtc=[DateTime]::UtcNow.ToString('o'); port=$qaPort; queries=@(); matchingTcpRows=@()}
foreach ($qaIdentity in $qaPids.GetEnumerator()) {
    if ($qaIdentity.Value -le 0) { throw "Missing owned PID for $($qaIdentity.Key)" }
    $qaProcess = Get-Process -Id $qaIdentity.Value -ErrorAction SilentlyContinue
    $qaSnap.queries += [ordered]@{
        role=$qaIdentity.Key
        pid=$qaIdentity.Value
        exists=($null -ne $qaProcess)
        startTimeUtc=$(if ($qaProcess) { $qaProcess.StartTime.ToUniversalTime().ToString('o') })
    }
}
$qaNetstat = Join-Path $env:SystemRoot 'System32\netstat.exe'
$qaTcp = & $qaNetstat -ano -p tcp
if ($LASTEXITCODE -ne 0) { throw 'TCP endpoint inventory failed' }
$qaSnap.matchingTcpRows = @($qaTcp | Where-Object { $_ -match ('^\s*TCP\s+\S+:' + $qaPort + '\s+') })
$qaSnap | ConvertTo-Json -Depth 5
