$evidence = Join-Path (Get-Location) 'docs/qa/2026-10-22-wp-f3-round-4'
$names = @()
Get-ChildItem -LiteralPath $evidence -Filter 'migration-proof*.log.txt' -File | ForEach-Object {
  $text = Get-Content -LiteralPath $_.FullName -Raw
  $names += [regex]::Matches($text, 'gg-wp-f3-round4-[a-f0-9-]+\.db') | ForEach-Object { $_.Value }
}
$inventory = @()
$tempRoot = [System.IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')
foreach ($name in ($names | Sort-Object -Unique)) {
  foreach ($suffix in @('', '-wal', '-shm')) {
    $file = $name + $suffix
    $target = [System.IO.Path]::GetFullPath((Join-Path $tempRoot $file))
    if ((Split-Path -Parent $target) -ne $tempRoot -or $file -notmatch '^gg-wp-f3-round4-[a-f0-9-]+\.db(?:-wal|-shm)?$') { throw 'Unexpected cleanup target' }
    $before = Test-Path -LiteralPath $target
    $bytes = 0
    if ($before) {
      $item = Get-Item -LiteralPath $target
      if ($item.PSIsContainer) { throw 'Cleanup never removes directories' }
      $bytes = $item.Length
      Remove-Item -LiteralPath $target -ErrorAction Stop
    }
    $after = Test-Path -LiteralPath $target
    if ($after) { throw 'Owned database file remains' }
    $inventory += [ordered]@{ file = $file; existedBefore = $before; bytesBefore = $bytes; existsAfter = $after }
  }
}
$directories = @(Get-ChildItem -LiteralPath $tempRoot -Directory -Filter 'gg-wp-f3-round4-sql-*' | ForEach-Object {
  $remaining = @(Get-ChildItem -LiteralPath $_.FullName -Recurse -File)
  if ($remaining.Count) { throw 'SQL fixture files remain' }
  [ordered]@{ name = $_.Name; remainingFiles = $remaining.Count; directoryPreserved = $true }
})
$result = [ordered]@{ processBoundary = 'All migration-proof child commands exited before this cleanup'; files = $inventory; emptyFixtureDirectories = $directories; databaseFilesRemaining = 0; directoriesDeleted = 0 }
[System.IO.File]::WriteAllText((Join-Path $evidence 'migration-cleanup.json'), (($result | ConvertTo-Json -Depth 8) + "`n"), [System.Text.UTF8Encoding]::new($false))
Write-Output ($result | ConvertTo-Json -Depth 8)
