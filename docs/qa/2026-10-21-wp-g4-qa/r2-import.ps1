$ErrorActionPreference = 'Stop'
$qa = 'docs\qa\2026-10-19-wp-g4-exit-evidence'
$ids = @{}
$records = @()
foreach ($file in 'gate-loop.json', 'suppressed-loop.json', 'quiet-loop.json', 'history-loop.json') {
  $created = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:5641/loops' `
    -ContentType 'application/json' -InFile (Join-Path $qa $file)
  # Windows PowerShell sends a form content type on a bodiless POST, which the API refuses (415).
  Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:5641/loops/$($created.loop.id)/publish" `
    -ContentType 'application/json' -Body '{}' | Out-Null
  "$file -> $($created.loop.id)"
  $name = $file.Replace('-loop.json','')
  $ids[$name] = @{ loop=$created.loop.id }
  $published = Invoke-RestMethod -Uri "http://127.0.0.1:5641/loops/$($created.loop.id)"
  $records += @{ file=$file; loop=$created.loop.id; currentVersion=$published.loop.currentVersionId; published=($null -ne $published.current) }
}
$encoding = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText((Join-Path (Get-Location) 'docs/qa/2026-10-21-wp-g4-qa/r2-ids.json'),($ids | ConvertTo-Json -Depth 6),$encoding)
[IO.File]::WriteAllText((Join-Path (Get-Location) 'docs/qa/2026-10-21-wp-g4-qa/r2-imports.json'),(@{ powershell=$PSVersionTable.PSVersion.ToString(); records=$records } | ConvertTo-Json -Depth 6),$encoding)