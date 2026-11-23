$ErrorActionPreference = 'Stop'
$evidenceRoot = 'G:/ggq/delivery-evidence/2026-11-17-five-intents/i5-416-api-shape-independent-qa-01'
$fixture = Get-Content -LiteralPath (Join-Path $evidenceRoot 'attempt-02/fixture.json') -Raw | ConvertFrom-Json
$ownedNode = Get-Process -Id $fixture.pid -ErrorAction SilentlyContinue
if ($ownedNode) { throw 'Recorded program PID is running; inspect generation, do not stop it.' }
$parentFull = [IO.Path]::GetFullPath($evidenceRoot)
$observations = @()
foreach ($targetLiteral in @(
  'G:/ggq/delivery-evidence/2026-11-17-five-intents/i5-416-api-shape-independent-qa-01/scratch',
  'G:/ggq/delivery-evidence/2026-11-17-five-intents/i5-416-api-shape-independent-qa-01/attempt-02/scratch'
)) {
  $targetFull = [IO.Path]::GetFullPath($targetLiteral)
  if (-not $targetFull.StartsWith($parentFull + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Cleanup escaped evidence root' }
  $resolved = (Resolve-Path -LiteralPath $targetFull).ProviderPath
  if (-not [string]::Equals($resolved, $targetFull, [StringComparison]::OrdinalIgnoreCase)) { throw 'Resolved path mismatch' }
  $items = @(Get-Item -LiteralPath $targetFull) + @(Get-ChildItem -LiteralPath $targetFull -Recurse -Force)
  if (@($items | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count -ne 0) { throw 'Unexpected reparse point in scratch' }
  $files = @($items | Where-Object { -not $_.PSIsContainer })
  $inventory = @($files | ForEach-Object {
    [ordered]@{ relative = [IO.Path]::GetRelativePath($targetFull, $_.FullName); bytes = $_.Length; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
  })
  foreach ($file in $files) {
    $checked = [IO.Path]::GetFullPath($file.FullName)
    if (-not $checked.StartsWith($targetFull + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'File outside owned scratch' }
    Remove-Item -LiteralPath $checked -Force
  }
  foreach ($directory in @($items | Where-Object PSIsContainer | Sort-Object { $_.FullName.Length } -Descending)) {
    $checked = [IO.Path]::GetFullPath($directory.FullName)
    if ($checked -ne $targetFull -and -not $checked.StartsWith($targetFull + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Directory outside owned scratch' }
    # Nonrecursive: refuse any directory that unexpectedly gained content.
    if (@(Get-ChildItem -LiteralPath $checked -Force).Count -ne 0) { throw 'Directory is no longer empty' }
    Remove-Item -LiteralPath $checked -Force
  }
  $observations += [ordered]@{ target = $targetFull; resolved = $resolved; noReparsePoints = $true; fileCount = $files.Count; files = $inventory; absentAfter = -not (Test-Path -LiteralPath $targetFull) }
}
[ordered]@{
  checkedUtc = [DateTimeOffset]::UtcNow.ToString('o'); recordedNodePid = $fixture.pid
  recordedNodeAbsent = $true; processAction = 'Read-only lookup; no kill'; cleanup = $observations
} | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath (Join-Path $evidenceRoot 'NATIVE-CLEANUP.json') -Encoding utf8NoBOM
[ordered]@{ recordedNodePid = $fixture.pid; recordedNodeAbsent = $true; removedScratchRoots = $observations.Count; allAbsent = @($observations | Where-Object { -not $_.absentAfter }).Count -eq 0 } | ConvertTo-Json
