$ErrorActionPreference = 'Stop'
$packet = Split-Path -Parent $PSCommandPath
$scratch = 'G:\ggq\qa-scratch\i4-364-probe-independent-01'
$inputs = @(
 'C:\Users\98jak\graphgoblin-qa\2026-11-17-five-intents\i4-364-probe-independent-BRIEF-01.md',
 'C:\Users\98jak\graphgoblin-qa\2026-11-17-five-intents\decision-193.md',
 'C:\Users\98jak\graphgoblin-qa\2026-11-17-five-intents\decision-198.md',
 'C:\Users\98jak\graphgoblin-qa\2026-11-17-five-intents\i4-549-final-astra-01\REPORT.md',
 'C:\Users\98jak\graphgoblin-qa\2026-11-17-five-intents\i4-364-probe-author-01\author\REPORT.md',
 'C:\Users\98jak\graphgoblin-qa\2026-11-17-five-intents\i4-364-probe-root-freeze-01\receipt.json'
)
$inputHashes = @()
foreach ($file in $inputs) { $inputHashes += [ordered]@{ path=$file; bytes=(Get-Item -LiteralPath $file).Length; sha256=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLower() } }
$inputHashes | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath "$packet\input-manifest.json" -Encoding utf8
$external = @()
$externalFiles = @(Get-ChildItem -LiteralPath $scratch -Recurse -File | Where-Object { -not $_.FullName.Contains('\node-compile-cache\') })
foreach ($file in $externalFiles) { $external += [ordered]@{ path=$file.FullName; bytes=$file.Length; sha256=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLower(); disposition='retained inactive local-only fixture, disposable SQLite or build TEMP evidence' } }
$cacheFiles = @(Get-ChildItem -LiteralPath "$scratch\node-compile-cache" -Recurse -File)
[ordered]@{ files=$external; compileCache=[ordered]@{ path="$scratch\node-compile-cache"; files=$cacheFiles.Count; bytes=($cacheFiles | Measure-Object Length -Sum).Sum; disposition='retained local build cache, not behavior evidence' } } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath "$packet\external-manifest.json" -Encoding utf8
$excluded = @('SHA256SUMS','seal.json','seal-verification.json')
$members = @()
foreach ($file in (Get-ChildItem -LiteralPath $packet -Recurse -File | Where-Object { $_.Name -notin $excluded } | Sort-Object FullName)) {
 $relative = $file.FullName.Substring($packet.Length + 1).Replace([char]92,[char]47)
 $members += [ordered]@{ path=$relative; bytes=$file.Length; sha256=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLower() }
}
$lines = @($members | ForEach-Object { "$($_.sha256)  $($_.path)" })
[System.IO.File]::WriteAllLines("$packet\SHA256SUMS",$lines,[System.Text.UTF8Encoding]::new($false))
$seal = [ordered]@{ time=(Get-Date).ToUniversalTime().ToString('o'); candidate='b90ffd2dfce3d4a73b83c5722393298453cec07b'; tree='8ea6424a680177768fd9af9661e2d3cb2e3db9d8'; status='PASS bounded corrective QA; independent CI/final audit/owner gates separate'; members=$members.Count; bytes=($members | ForEach-Object { $_['bytes'] } | Measure-Object -Sum).Sum; sumsSha256=(Get-FileHash -LiteralPath "$packet\SHA256SUMS" -Algorithm SHA256).Hash.ToLower(); reportSha256=(Get-FileHash -LiteralPath "$packet\REPORT.md" -Algorithm SHA256).Hash.ToLower(); noFurtherBehaviorExecution=$true }
$seal | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath "$packet\seal.json" -Encoding utf8
$mismatches = @()
foreach ($member in $members) { if ((Get-FileHash -LiteralPath (Join-Path $packet $member.path) -Algorithm SHA256).Hash.ToLower() -ne $member.sha256) { $mismatches += $member.path } }
[ordered]@{ time=(Get-Date).ToUniversalTime().ToString('o'); checked=$members.Count; mismatches=$mismatches; sumsSha256=(Get-FileHash -LiteralPath "$packet\SHA256SUMS" -Algorithm SHA256).Hash.ToLower() } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath "$packet\seal-verification.json" -Encoding utf8
if ($mismatches.Count -ne 0) { throw 'Seal verification mismatch' }
$seal | ConvertTo-Json -Depth 8
