param([Parameter(Mandatory=$true)][ValidatePattern('^old-attempt-[1-9][0-9]*$')][string]$Attempt)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$fixture = (Resolve-Path -LiteralPath (Join-Path $root $Attempt)).Path
if ($fixture -cne (Join-Path $root $Attempt)) { throw 'Unexpected resolved attempt directory' }
$admission = Get-Content -LiteralPath (Join-Path $fixture 'admission.json') -Raw | ConvertFrom-Json
$result = Get-Content -LiteralPath (Join-Path $fixture 'result.json') -Raw | ConvertFrom-Json
$receipt = Join-Path $fixture 'cleanup.json'
if (Test-Path -LiteralPath $receipt) { throw 'The first cleanup record already exists' }
$store = (Resolve-Path -LiteralPath $admission.cwd).Path
if ($store -cne (Join-Path $fixture 'disposable-store')) { throw 'Unexpected resolved store directory' }
if ((Split-Path -Path $store -Parent) -cne $fixture) { throw 'Store is outside the fixture' }
$db = [IO.Path]::GetFullPath($admission.sqlitePath)
if ($db -cne (Join-Path $store 'poll.sqlite')) { throw 'Unexpected SQLite path' }

$ports = @($result.sourcePort) + @($result.gatewayProcesses | ForEach-Object { $_.port })
$ports = @($ports | Where-Object { $_ -gt 0 } | Sort-Object -Unique)
if ($ports -contains 4747 -or $ports -contains 4748) { throw 'Protected listener observed in fixture record' }
$listeners = @(Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in $ports } |
  Select-Object LocalAddress, LocalPort, OwningProcess)
$processes = @($result.gatewayProcesses | ForEach-Object {
  [pscustomobject]@{ pid = [int]$_.pid; ownedStoppedAt = $_.exit.at.wall }
})
$processes += [pscustomobject]@{ pid = [int]$result.processPid; ownedStoppedAt = $null }
$processReadback = @($processes | Where-Object { $_.pid -gt 0 } | ForEach-Object {
  $owned = $_
  $live = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $($owned.pid)"
  $recycled = $null
  if ($null -ne $live) {
    $knownFixtureCommand = $live.CommandLine -like ('*' + $root + '\gateway.mjs*') -or
      $live.CommandLine -like ('*' + $root + '\run-old.mjs*')
    $recycled = !$knownFixtureCommand -and $owned.ownedStoppedAt -and
      ($live.CreationDate.ToUniversalTime() -gt [DateTimeOffset]::Parse($owned.ownedStoppedAt).UtcDateTime)
  }
  [pscustomobject]@{ pid = $owned.pid; currentProcessPresent = $null -ne $live; reusedAfterExit = [bool]$recycled }
})
$unqualified = @($processReadback | Where-Object { $_.currentProcessPresent -and !$_.reusedAfterExit })
$rootItem = Get-Item -LiteralPath $store -Force
if ($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Disposable store is a reparse point' }
$contents = @(Get-ChildItem -LiteralPath $store -Force -Recurse)
$reparsePoints = @($contents | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint })
$remainingRuntimeFiles = @($contents | Where-Object { $_.Name -match '(?:-wal|-shm|\.lock(?:\..*)?|\.reclaim)$' } |
  ForEach-Object { $_.FullName.Substring($store.Length + 1) })
$cleanDrain = !$result.sourceListening -and !$result.cleanupFailed -and
  @($result.gatewayProcesses).Count -eq 2 -and
  @($result.gatewayProcesses | Where-Object { $_.exit.code -ne 0 -or $_.drain.status -ne 202 -or $_.fallbackOwnedChildStop }).Count -eq 0
$clean = $cleanDrain -and $listeners.Count -eq 0 -and $unqualified.Count -eq 0 -and
  $remainingRuntimeFiles.Count -eq 0 -and $reparsePoints.Count -eq 0 -and
  (Test-Path -LiteralPath (Join-Path $fixture 'post-drain-readback.json'))
$dbBefore = Test-Path -LiteralPath $db
if ($clean -and $dbBefore) {
  Remove-Item -LiteralPath $store -Recurse -Force
}
$storeRemoved = !(Test-Path -LiteralPath $store)
[ordered]@{
  checkedAt = [DateTime]::UtcNow.ToString('o')
  attempt = $Attempt
  ports = $ports
  listeners = $listeners
  processReadback = $processReadback
  cleanDrain = [bool]$cleanDrain
  sqliteFileExisted = $dbBefore
  remainingRuntimeFilesBeforeRemoval = $remainingRuntimeFiles
  reparsePoints = $reparsePoints.Count
  disposableStoreRemoved = $storeRemoved
} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $receipt -Encoding utf8NoBOM
"ports=$($ports.Count) listeners=$($listeners.Count) unqualifiedPids=$($unqualified.Count) runtimeSidecars=$($remainingRuntimeFiles.Count) storeRemoved=$storeRemoved"
if (!$clean -or !$storeRemoved) { exit 2 }
