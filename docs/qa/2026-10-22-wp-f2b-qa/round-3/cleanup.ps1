param([switch]$Remove)
# <repo>: inventory only by default; -Remove deletes only the recorded owned TEMP roots.
$qaEvidence=$PSScriptRoot
$qaTempRoot=[IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')+'\'
$qaDirectories=@()
$qaPids=@()
$qaServed=Get-Content -LiteralPath (Join-Path $qaEvidence 'served-lifecycle.json') -Raw | ConvertFrom-Json
if (-not $qaServed.processExited) { throw 'Served process exit not confirmed' }
$qaPids+=@($qaServed.exits | ForEach-Object {$_.pid})
$qaDirectories+=@{directory=$qaServed.directory;kind='disposable store';processExited=$true}
$qaCollector=Get-Content -LiteralPath (Join-Path $qaEvidence 'collector-lifecycle.json') -Raw | ConvertFrom-Json
if (-not $qaCollector.processExited) { throw 'Collector process exit not confirmed' }
$qaPids+=$qaCollector.pid
$qaDirectories+=@{directory=$qaCollector.directory;kind='disposable store';processExited=$true}
$qaEdge=Get-Content -LiteralPath (Join-Path $qaEvidence 'edge-lifecycle.json') -Raw | ConvertFrom-Json
$qaEdgeProcess=Get-Content -LiteralPath (Join-Path $qaEvidence 'edge-process.json') -Raw | ConvertFrom-Json
if (-not $qaEdgeProcess.exitObserved) { throw 'Edge process exit not confirmed' }
$qaPids+=$qaEdge.pid
foreach($qaStore in $qaEdge.stores) {
  if (-not $qaStore.appClosed) { throw 'Edge app closure not confirmed' }
  $qaDirectories+=@{directory=$qaStore.directory;kind='disposable store';processExited=$true}
}
$qaCoverage=Get-Content -LiteralPath (Join-Path $qaEvidence 'coverage-location.json') -Raw | ConvertFrom-Json
$qaCoverageStage=Get-Content -LiteralPath (Join-Path $qaEvidence 'coverage-command.json') -Raw | ConvertFrom-Json
$qaDirectories+=@{directory=$qaCoverage.directory;kind='coverage artifacts';processExited=($qaCoverageStage.processExited -eq $true)}
$qaDirectories+=@{directory='gg-qa-204-r3-edge-results';kind='Edge artifacts';processExited=$true}
$qaProcessAudit=@($qaPids | Select-Object -Unique | ForEach-Object { @{pid=$_;absent=($null -eq (Get-Process -Id $_ -ErrorAction SilentlyContinue))} })
foreach($qaItem in $qaDirectories) {
  $qaResolved=[IO.Path]::GetFullPath((Join-Path $env:TEMP $qaItem.directory))
  if (-not $qaResolved.StartsWith($qaTempRoot,[StringComparison]::OrdinalIgnoreCase)) { throw 'Target escaped TEMP' }
  if (-not (Split-Path -Leaf $qaResolved).StartsWith('gg-qa-204-r3-')) { throw 'Wrong cleanup prefix' }
  $qaItem.exists=Test-Path -LiteralPath $qaResolved
  $qaItem.withinTemp=$true
}
$qaAudit=@{processes=$qaProcessAudit;directories=$qaDirectories;scope='This round only; prior rounds excluded'}
[IO.File]::WriteAllText((Join-Path $qaEvidence 'cleanup-preflight.json'),($qaAudit | ConvertTo-Json -Depth 6))
if (-not $Remove) { Write-Output 'Cleanup inventory written; no deletion requested'; exit 0 }
if (@($qaProcessAudit | Where-Object {-not $_.absent}).Count -ne 0) { throw 'Owned process still present' }
$qaResults=@(foreach($qaItem in $qaDirectories) {
  $qaTarget=[IO.Path]::GetFullPath((Join-Path $env:TEMP $qaItem.directory))
  if (-not $qaTarget.StartsWith($qaTempRoot,[StringComparison]::OrdinalIgnoreCase) -or -not $qaItem.directory.StartsWith('gg-qa-204-r3-')) { throw 'Unsafe target' }
  try {
    if(Test-Path -LiteralPath $qaTarget) { Remove-Item -LiteralPath $qaTarget -Recurse -Force -ErrorAction Stop }
    @{directory=$qaItem.directory;kind=$qaItem.kind;removed=(-not(Test-Path -LiteralPath $qaTarget))}
  } catch {
    @{directory=$qaItem.directory;kind=$qaItem.kind;removed=$false;reason='Filesystem removal failed'}
  }
})
$qaStatus=if (@($qaResults | Where-Object {-not $_.removed}).Count -eq 0) {'COMPLETE'} else {'INCOMPLETE'}
$qaCleanup=@{status=$qaStatus;directories=$qaResults;processes=$qaProcessAudit}
[IO.File]::WriteAllText((Join-Path $qaEvidence 'cleanup.json'),($qaCleanup | ConvertTo-Json -Depth 6))
$qaResults | ConvertTo-Json -Depth 4