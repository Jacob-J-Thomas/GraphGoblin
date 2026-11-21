# Independent QA #448 verified cleanup. Removes only:
#  1. the two driver scratch roots, each verified by exact name under TEMP and its .qa448-owned nonce;
#  2. TEMP directories left by the two focused suites I ran, verified by known test prefix AND a
#     creation time inside those suites' recorded windows (09:07:45-09:08:32 and 09:08:40-09:08:59 UTC).
# Prints every decision; never deletes anything that fails verification.
$ErrorActionPreference = 'Stop'
$temp = [System.IO.Path]::GetFullPath($env:TEMP)
$roots = @(
  @{ Name = 'gg-448-qa-indep-20261121T090017'; Nonce = '6ae77d82df58aaa2' },
  @{ Name = 'gg-448-qa-indep-20261121T090427'; Nonce = '53701a428fc1a7f8' }
)
foreach ($r in $roots) {
  $path = Join-Path $temp $r.Name
  if (-not (Test-Path -LiteralPath $path)) { "ROOT absent (nothing to do): $path"; continue }
  $marker = Join-Path $path '.qa448-owned'
  $nonce = if (Test-Path -LiteralPath $marker) { (Get-Content -LiteralPath $marker -Raw).Trim() } else { '' }
  if ($nonce -ne $r.Nonce) { "ROOT SKIPPED (nonce mismatch '$nonce'): $path"; continue }
  $files = @(Get-ChildItem -LiteralPath $path -Recurse -Force -File).Count
  Remove-Item -LiteralPath $path -Recurse -Force
  "ROOT removed: $path (nonce ok, $files files); still exists: $(Test-Path -LiteralPath $path)"
}
$windows = @(
  @([datetime]::Parse('2026-11-21T09:07:45Z').ToUniversalTime(), [datetime]::Parse('2026-11-21T09:08:33Z').ToUniversalTime()),
  @([datetime]::Parse('2026-11-21T09:08:40Z').ToUniversalTime(), [datetime]::Parse('2026-11-21T09:09:00Z').ToUniversalTime())
)
$prefixes = @('gg-wp-a5b-preflight-', 'gg-fable-migration-', 'gg-0002-', 'gg-0003-', 'gg-pre-discovery-catalog-', 'gg-preflight-catalog-', 'gg-ollama-preflight-')
$removed = 0
foreach ($d in Get-ChildItem -LiteralPath $temp -Directory -Force) {
  $created = $d.CreationTimeUtc
  $inWindow = @($windows | Where-Object { $created -ge $_[0] -and $created -le $_[1] }).Count -gt 0
  $known = @($prefixes | Where-Object { $d.Name.StartsWith($_) }).Count -gt 0
  if (-not ($inWindow -and $known)) { continue }
  $contents = (@(Get-ChildItem -LiteralPath $d.FullName -Recurse -Force -File | ForEach-Object { $_.Name }) -join ' ')
  try {
    Remove-Item -LiteralPath $d.FullName -Recurse -Force
    $removed += 1
    "LEFTOVER removed: $($d.Name) created $($created.ToString('o')) [$contents]; still exists: $(Test-Path -LiteralPath $d.FullName)"
  } catch {
    "LEFTOVER NOT removed: $($d.Name) [$contents]: $($_.Exception.Message)"
  }
}
"LEFTOVERS removed: $removed"
