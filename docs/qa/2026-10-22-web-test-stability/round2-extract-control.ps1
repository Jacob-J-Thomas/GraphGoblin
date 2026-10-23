Add-Type -AssemblyName System.IO.Compression.FileSystem
$ggTrace = Join-Path $env:TEMP 'gg-chore-web-browser-extra-results/classifiers-Settings-and-t-572d2-stom-entry-a-missing-secret-chromium/trace.zip'
$ggZip = [System.IO.Compression.ZipFile]::OpenRead($ggTrace)
try {
  foreach ($ggEntry in $ggZip.Entries) {
    if (-not $ggEntry.FullName.EndsWith('.network')) { continue }
    $ggReader = [System.IO.StreamReader]::new($ggEntry.Open())
    try { $ggLines = $ggReader.ReadToEnd() -split "`n" } finally { $ggReader.Dispose() }
    foreach ($ggLine in $ggLines) {
      if (-not $ggLine.Trim()) { continue }
      $ggRecord = $ggLine | ConvertFrom-Json
      $ggSnapshot = $ggRecord.snapshot
      if ($ggSnapshot.request.url -notmatch '/apps$' -or $ggSnapshot.response.status -lt 400) { continue }
      $ggContent = $ggSnapshot.response.content
      $ggSha = if ($ggContent._sha1) { $ggContent._sha1 } else { $ggContent.sha1 }
      $ggResource = if ($ggContent._file) { $ggContent._file } else { 'resources/' + $ggSha }
      $ggBodyEntry = $ggZip.GetEntry($ggResource)
      if ($null -eq $ggBodyEntry) {
        @{ url = $ggSnapshot.request.url; status = $ggSnapshot.response.status; content = $ggContent } | ConvertTo-Json -Depth 6 -Compress
        continue
      }
      $ggBodyReader = [System.IO.StreamReader]::new($ggBodyEntry.Open())
      try { $ggBody = $ggBodyReader.ReadToEnd() } finally { $ggBodyReader.Dispose() }
      @{ url = $ggSnapshot.request.url; status = $ggSnapshot.response.status; body = $ggBody } | ConvertTo-Json -Compress
    }
  }
} finally { $ggZip.Dispose() }
