$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archivePath = 'C:\Users\98jak\graphgoblin-qa\2026-11-13-aidlc-batch\proposed\docs\qa\2026-11-15-poll-dedupe-current-ci\artifacts\coverage.zip'
$outputPath = 'C:\Users\98jak\graphgoblin-qa\2026-11-13-aidlc-batch\audit-484-astra-scan2\coverage-archive-readback.json'
$archive = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
try {
  $summaries = @()
  foreach ($entry in $archive.Entries) {
    if ($entry.FullName.EndsWith('/coverage-summary.json')) {
      $reader = [System.IO.StreamReader]::new($entry.Open())
      try { $content = $reader.ReadToEnd() } finally { $reader.Dispose() }
      $data = $content | ConvertFrom-Json
      $summaries += [pscustomobject]@{ path = $entry.FullName; total = $data.total }
      if ($data.total.lines.pct -lt 90 -or $data.total.branches.pct -lt 90) { throw "Coverage floor failed: $($entry.FullName)" }
    }
  }
  if ($summaries.Count -ne 13) { throw "Expected 13 summaries, found $($summaries.Count)" }
  $result = [pscustomobject]@{ at = (Get-Date).ToUniversalTime().ToString('o'); sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath).Hash.ToLower(); entries = @($archive.Entries | ForEach-Object { $_.FullName }); summaries = $summaries; pass = $true }
  [System.IO.File]::WriteAllText($outputPath, ($result | ConvertTo-Json -Depth 12), [System.Text.UTF8Encoding]::new($false))
  $summaries | ForEach-Object { [pscustomobject]@{ path=$_.path; lines=$_.total.lines.pct; branches=$_.total.branches.pct } } | ConvertTo-Json
} finally { $archive.Dispose() }
