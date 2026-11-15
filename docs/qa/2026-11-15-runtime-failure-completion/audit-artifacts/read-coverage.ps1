$ErrorActionPreference = 'Stop'
$batch = 'C:\Users\98jak\graphgoblin-qa\2026-11-13-aidlc-batch'
$archivePath = Join-Path $batch 'review-381\current-ci-693e-attempt2\coverage-artifact-14176387060.zip'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
try {
  $rows = @($archive.Entries | ForEach-Object {
    $entry = $_
    $reader = [System.IO.StreamReader]::new($entry.Open())
    try { $summary = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
    [pscustomobject]@{path=$entry.FullName;bytes=$entry.Length;lines=$summary.total.lines.pct;branches=$summary.total.branches.pct;statements=$summary.total.statements.pct;functions=$summary.total.functions.pct;floorsPassed=($summary.total.lines.pct -ge 90 -and $summary.total.branches.pct -ge 90)}
  })
} finally { $archive.Dispose() }
$result = [pscustomobject]@{at=(Get-Date).ToUniversalTime().ToString('o');archiveSHA256=(Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath).Hash.ToLower();entries=$rows;allFloorsPassed=(@($rows | Where-Object {-not $_.floorsPassed}).Count -eq 0)}
$result | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $batch 'review-485-astra-scan2/coverage-archive-readback.json') -Encoding utf8
$result | ConvertTo-Json -Depth 5
