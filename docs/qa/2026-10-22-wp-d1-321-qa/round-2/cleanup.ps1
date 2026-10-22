$ErrorActionPreference = 'Stop'
$processExit = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'process-exit.json') | ConvertFrom-Json
foreach ($store in $processExit.stores) {
  if ($store.error -or !$store.markerProcessesExited -or !$store.nativeProbeProcessesExited) { throw 'Owned process exit has not been established.' }
  foreach ($process in $store.apiProcesses) { if (!$process.exited) { throw 'QA API has not exited.' } }
}
$tempBoundary = [IO.Path]::GetFullPath($env:TEMP).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
$records = @()
foreach ($target in @(Get-ChildItem -LiteralPath $env:TEMP -Directory -Filter 'gg-qa-321-r2-*')) {
  $resolved = [IO.Path]::GetFullPath($target.FullName)
  if (!$resolved.StartsWith($tempBoundary,[StringComparison]::OrdinalIgnoreCase) -or $target.Name -notlike 'gg-qa-321-r2-*') { throw 'Unsafe cleanup target.' }
  if ($target.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Refuse reparse point.' }
  foreach ($pidFile in @(Get-ChildItem -LiteralPath $resolved -File -Recurse | Where-Object { $_.Name -like '*.pid' -or $_.Name -like '*.active-*' })) {
    $text = [IO.File]::ReadAllText($pidFile.FullName).Trim()
    if ($text -match '^\d+$') {
      $process = Get-Process -Id ([int]$text) -ErrorAction SilentlyContinue
      if ($process -and $process.StartTime -le $pidFile.LastWriteTime.AddSeconds(1)) { throw "Recorded process still alive for $($target.Name)" }
    }
  }
  Remove-Item -LiteralPath $resolved -Recurse -Force
  $records += [ordered]@{store=$target.Name;processesExitedBeforeRemoval=$true;removed=!(Test-Path -LiteralPath $resolved)}
}
[ordered]@{head=$processExit.head;stores=$records;remaining=@(Get-ChildItem -LiteralPath $env:TEMP -Directory -Filter 'gg-qa-321-r2-*' | Select-Object -ExpandProperty Name)} | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 (Join-Path $PSScriptRoot 'cleanup.json')
