# Quiescence audit for the resume runs (v2). Read-only: it never terminates anything. Run from the resume dir:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/audit-resume-quiescence.ps1 <output.json>
# v2 separates: (a) resource problems of a run, (b) a retained fixture failure whose resources closed cleanly,
# (c) numeric PIDs that were reused after the recording run ended, (d) processes that already existed in the pre-start baseline.
param([Parameter(Mandatory = $true)][string]$OutFile)
$ErrorActionPreference = 'Stop'
# Get-FileHash is not available in this PowerShell host; use .NET SHA256 instead.
function Get-Sha([string]$p) { $h = [Security.Cryptography.SHA256]::Create(); $st = [IO.File]::OpenRead($p); try { ($h.ComputeHash($st) | ForEach-Object { $_.ToString('x2') }) -join '' } finally { $st.Dispose() } }
$proofRoot = (Get-Location).Path
$launch = Get-Content -LiteralPath 'launch.json' -Raw | ConvertFrom-Json
$runnerPid = [int]$launch.pid
$bindingSha = Get-Sha (Join-Path $proofRoot 'binding/binding-before.json')
$baselineRaw = (Get-Content -LiteralPath 'cleanup/processes-before-start.json' -Raw).TrimStart([char]0xFEFF)
$baselinePids = @(($baselineRaw | ConvertFrom-Json) | ForEach-Object { [int]$_.ProcessId })
$records = @(Get-ChildItem -LiteralPath (Join-Path $proofRoot 'runs') -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'run.json') } | ForEach-Object {
  $folder = $_.FullName
  $run = Get-Content -Raw -LiteralPath (Join-Path $folder 'run.json') | ConvertFrom-Json
  $closed = Get-Content -Raw -LiteralPath (Join-Path $folder 'gateway-closed.json') | ConvertFrom-Json
  $openLog = Get-Content -Raw -LiteralPath (Join-Path $folder 'browser-open.log')
  $closeLog = Get-Content -Raw -LiteralPath (Join-Path $folder 'browser-close.log')
  $scratch = [IO.Path]::GetFullPath($closed.scratch)
  $o = [ordered]@{
    label = $run.label; scenario = $run.scenario; config = $run.config; session = $run.session; startedAt = $run.startedAt; finishedAt = $run.finishedAt
    orchestratorPid = $run.orchestratorPid; gatewayPid = $run.gatewayPid; browserPid = $run.browserPid
    apiPort = ([uri]$run.origin).Port; sinkPort = ([uri]$run.sinkOrigin).Port
    driverExit = $run.driverExit; browserClose = $run.browserClose; gatewayExit = $run.gatewayExit.code
    browserConfirmed = ($openLog.Contains("opened with pid $($run.browserPid).") -and $closeLog.Contains("Browser '$($run.session)' closed"))
    gatewayNotListening = (-not $closed.listening)
    sameBinding = ($bindingSha -eq (Get-Sha (Join-Path $folder 'binding-before.json')))
    disposableStoreRemoved = ($run.store.removed -and -not (Test-Path -LiteralPath $scratch))
    noResidualLockWalShm = (@($run.store.residualLockWalShm).Count -eq 0)
    pageErrors = @($run.pageErrors).Count; fixtureFailure = $(if ($run.failure) { [string]$run.failure.message } else { $null })
  }
  $o.resourcesClosedCleanly = ($o.driverExit -eq 0 -and $o.browserClose -eq 0 -and $o.gatewayExit -eq 0 -and $o.browserConfirmed -and $o.gatewayNotListening -and $o.sameBinding -and $o.disposableStoreRemoved -and $o.noResidualLockWalShm)
  [pscustomobject]$o
})
$ports = @($records.apiPort; $records.sinkPort)
if ($ports -contains 4747 -or $ports -contains 4748) { throw 'Owner port found in run metadata' }
$ids = @($records.orchestratorPid; $records.gatewayPid; $records.browserPid)
$all = Get-CimInstance Win32_Process
$recordedAlive = @($all | Where-Object { $_.ProcessId -in $ids } | ForEach-Object {
  $pidNow = $_.ProcessId; $created = $_.CreationDate.ToUniversalTime()
  $holders = @($records | Where-Object { $_.orchestratorPid -eq $pidNow -or $_.gatewayPid -eq $pidNow -or $_.browserPid -eq $pidNow })
  [pscustomobject]@{ ProcessId = $pidNow; Name = $_.Name; CreatedUtc = $created.ToString('o'); RecordedBy = ($holders.label -join ','); IsThisAuditHost = ($pidNow -eq $PID)
    CreatedAfterEveryRecordingRunEnded = (@($holders | Where-Object { $created -le [DateTimeOffset]::Parse($_.finishedAt).UtcDateTime }).Count -eq 0)
    Cmd = $(if ($_.CommandLine) { $_.CommandLine.Substring(0, [Math]::Min(120, $_.CommandLine.Length)) }) }
})
$ours = @($all | Where-Object { $_.ProcessId -ne $PID -and $_.ProcessId -ne $runnerPid -and $_.ProcessId -notin $baselinePids -and $_.Name -match '^(node|msedge|chrome)\.exe$' -and ($_.CommandLine -like '*gg208-*' -or $_.CommandLine -like '*ui-208-stationarity-baseline-resume*') } |
  Select-Object ProcessId, ParentProcessId, Name, @{n = 'Cmd'; e = { $_.CommandLine.Substring(0, [Math]::Min(200, $_.CommandLine.Length)) } })
$preExistingMatches = @($all | Where-Object { $_.ProcessId -in $baselinePids -and $_.Name -match '^(node|msedge|chrome)\.exe$' -and ($_.CommandLine -like '*gg208-*' -or $_.CommandLine -like '*ui-208-stationarity-baseline-resume*') } |
  Select-Object ProcessId, ParentProcessId, Name, @{n = 'Cmd'; e = { $_.CommandLine.Substring(0, [Math]::Min(160, $_.CommandLine.Length)) } })
$listeners = @(Get-NetTCPConnection -State Listen | Where-Object LocalPort -in $ports | Select-Object LocalAddress, LocalPort, OwningProcess)
$leftStores = @(Get-ChildItem -LiteralPath (Join-Path $proofRoot 'runs') -Recurse -Force -Directory -Filter 'gateway-store-*' | Select-Object -ExpandProperty FullName)
$leftDb = @(Get-ChildItem -LiteralPath $proofRoot -Recurse -Force -File | Where-Object { $_.Name -match '(\.db|\.sqlite|\.sqlite3|-wal|-shm|\.lock|master\.key)$' } | Select-Object -ExpandProperty FullName)
$resourceInvalid = @($records | Where-Object { -not $_.resourcesClosedCleanly } | ForEach-Object label)
$retainedFixtureFailures = @($records | Where-Object { $_.fixtureFailure -or $_.pageErrors -ne 0 } | ForEach-Object { [pscustomobject]@{ label = $_.label; resourcesClosedCleanly = $_.resourcesClosedCleanly; pageErrors = $_.pageErrors; failure = $(if ($_.fixtureFailure) { $_.fixtureFailure.Substring(0, [Math]::Min(100, $_.fixtureFailure.Length)) }) } })
$reusedPids = @($recordedAlive | Where-Object { -not $_.CreatedAfterEveryRecordingRunEnded })
$owner = @(Get-NetTCPConnection -State Listen | Where-Object LocalPort -in 4747, 4748 | Select-Object LocalAddress, LocalPort, OwningProcess)
$report = [ordered]@{
  checkedAt = [DateTime]::UtcNow.ToString('o'); scope = 'Every runs/<label> record of the resume session plus live resource readback; read-only (version 2)'
  runnerPidExcluded = $runnerPid; bindingSha256 = $bindingSha; runCount = $records.Count; portsChecked = ($ports | Sort-Object -Unique)
  liveOwnedProcessMatches = $ours; preExistingBaselineProcessesMentioningThisPath = $preExistingMatches
  recordedPidsAliveNow = $recordedAlive; recordedPidsAliveAndNotProvablyReused = $reusedPids; liveFixtureListeners = $listeners
  leftoverGatewayStores = $leftStores; leftoverSqliteLockWalShmKeyFiles = $leftDb
  ownerPortsPreExistingNotOurs = $owner; resourceInvalidRuns = $resourceInvalid; retainedFixtureFailuresWithCleanResources = $retainedFixtureFailures; runs = $records
  terminationIssuedByThisAudit = $false
}
[IO.File]::WriteAllText((Join-Path $proofRoot $OutFile), ($report | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding $false))
"runs=$($records.Count) resourceInvalid=$($resourceInvalid.Count) ownedProcesses=$($ours.Count) recordedPidsNotProvablyReused=$($reusedPids.Count) listeners=$($listeners.Count) leftoverStores=$($leftStores.Count) leftoverDbFiles=$($leftDb.Count) retainedFixtureFailures=$($retainedFixtureFailures.Count)"
if ($ours.Count -or $listeners.Count -or $leftStores.Count -or $leftDb.Count -or $resourceInvalid.Count -or $reusedPids.Count) { exit 2 }
