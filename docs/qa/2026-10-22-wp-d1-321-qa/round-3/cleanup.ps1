$ErrorActionPreference = 'Stop'
$active = @((& "$PSScriptRoot/process-inventory.ps1") | ConvertFrom-Json)
if ($active.Count -gt 0) { throw 'QA processes remain active; preserve stores and investigate.' }
$tempBoundary=[IO.Path]::GetFullPath($env:TEMP).TrimEnd([IO.Path]::DirectorySeparatorChar)+[IO.Path]::DirectorySeparatorChar
$records=@()
foreach ($target in @(Get-ChildItem -LiteralPath $env:TEMP -Directory -Filter 'gg-qa-321-r3-*')) {
  $resolved=[IO.Path]::GetFullPath($target.FullName)
  if (!$resolved.StartsWith($tempBoundary,[StringComparison]::OrdinalIgnoreCase) -or $target.Name -notlike 'gg-qa-321-r3-*') { throw 'Unsafe cleanup target.' }
  if ($target.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Refuse reparse-point target.' }
  foreach ($pidFile in @(Get-ChildItem -LiteralPath $resolved -File -Recurse | Where-Object { $_.Name -like '*.pid' -or $_.Name -like '*.active-*' })) {
    $pidText=[IO.File]::ReadAllText($pidFile.FullName).Trim()
    if ($pidText -match '^\d+$') { $process=Get-Process -Id ([int]$pidText) -ErrorAction SilentlyContinue; if ($process -and $process.StartTime -le $pidFile.LastWriteTime.AddSeconds(1)) { throw "Recorded process alive for $($target.Name)" } }
  }
  $children=@(Get-ChildItem -LiteralPath $resolved -Directory | Select-Object -ExpandProperty Name)
  Remove-Item -LiteralPath $resolved -Recurse -Force
  $records+=[ordered]@{store=$target.Name;containedDirectories=$children;processesExitedBeforeRemoval=$true;removed=!(Test-Path -LiteralPath $resolved)}
}
[ordered]@{processInventoryClear=$true;stores=$records;remaining=@(Get-ChildItem -LiteralPath $env:TEMP -Directory -Filter 'gg-qa-321-r3-*' | Select-Object -ExpandProperty Name)} | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 (Join-Path $PSScriptRoot 'cleanup.json')
