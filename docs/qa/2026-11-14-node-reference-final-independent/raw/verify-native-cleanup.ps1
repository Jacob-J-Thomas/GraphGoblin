param(
  [Parameter(Mandatory = $true)][string]$EvidenceRoot,
  [Parameter(Mandatory = $true)][string]$ReportFile,
  [ValidateSet('before', 'corrected')][string]$Phase = 'before'
)
$ErrorActionPreference = 'Stop'
$resolvedRoot = (Resolve-Path -LiteralPath $EvidenceRoot).Path
$runsPath = Join-Path $resolvedRoot 'runs'
$runs = @(Get-ChildItem -LiteralPath $runsPath -Directory | Where-Object Name -Like "$Phase-*")
$records = @(foreach ($fixture in $runs) {
  $run = Get-Content -LiteralPath (Join-Path $fixture.FullName 'run.json') -Raw | ConvertFrom-Json
  $gateway = Get-Content -LiteralPath (Join-Path $fixture.FullName 'gateway.json') -Raw | ConvertFrom-Json
  $closed = Get-Content -LiteralPath (Join-Path $fixture.FullName 'gateway-closed.json') -Raw | ConvertFrom-Json
  $scratch = (Resolve-Path -LiteralPath $closed.scratch).Path
  if (-not $scratch.StartsWith($fixture.FullName + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw "Scratch escaped fixture: $scratch"
  }
  $files = @(Get-ChildItem -LiteralPath $scratch -Name)
  $ids = @($run.orchestratorPid, $run.gatewayPid, $run.browserPid, $run.probePid) |
    Where-Object { $_ } | Sort-Object -Unique
  [pscustomobject]@{
    fixture = $fixture.Name
    pids = @($ids)
    port = ([uri]$gateway.url).Port
    gatewayExit = $run.gatewayExit.code
    browserClose = $run.browserClose
    gatewayListening = $closed.listening
    processIdentityMatches = ($run.gatewayPid -eq $gateway.pid -and $gateway.pid -eq $closed.pid)
    sqliteFile = $files -contains 'graphgoblin.db'
    residualLockWalShm = @($files | Where-Object { $_ -match '(?i)(\.lock(?:\..+)?|-(?:wal|shm))$' })
  }
})
if ($records.Count -eq 0) { throw 'No recorded fixture runs' }
$ownedIds = $records.pids
$ports = $records.port
$live = @(Get-CimInstance Win32_Process | Where-Object { $ownedIds -contains [int]$_.ProcessId } |
  Select-Object ProcessId, ParentProcessId, Name, CreationDate)
$listeners = @(Get-NetTCPConnection -State Listen | Where-Object { $ports -contains [int]$_.LocalPort } |
  Select-Object LocalAddress, LocalPort, OwningProcess)
$invalid = @($records | Where-Object { $_.gatewayExit -ne 0 -or $_.gatewayListening -or
  -not $_.processIdentityMatches -or -not $_.sqliteFile -or $_.residualLockWalShm.Count -ne 0 -or
  ($null -ne $_.browserClose -and $_.browserClose -ne 0) -or $_.port -in 4747,4748 })
$result = [pscustomobject]@{
  checkedAt = [DateTime]::UtcNow.ToString('o')
  fixtures = $records
  liveRecordedIds = $live
  liveFixtureListeners = $listeners
  invalidFixtureRecords = @($invalid | Select-Object -ExpandProperty fixture)
}
$result | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8NoBOM -LiteralPath (Join-Path $resolvedRoot $ReportFile)
$result | Select-Object @{ n = 'Fixtures'; e = { $_.fixtures.Count } }, liveRecordedIds, liveFixtureListeners, invalidFixtureRecords |
  ConvertTo-Json -Depth 5
if ($live.Count -or $listeners.Count -or $invalid.Count) { exit 2 }
