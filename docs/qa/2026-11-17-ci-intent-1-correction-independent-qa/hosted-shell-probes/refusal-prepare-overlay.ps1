$ErrorActionPreference = 'Stop'
$folders = foreach ($case in 'hardlink', 'manifest') {
  $env:GITHUB_OUTPUT_SAVED = $env:GITHUB_OUTPUT
  $env:GITHUB_OUTPUT = Join-Path $env:RUNNER_TEMP "qa496-$case-output.txt"
  node tooling/scripts/windows-launcher-evidence.mjs init | Out-Host
  $initCode = $LASTEXITCODE
  if ($initCode -ne 0) { throw "init failed for $case" }
  $values = @{}
  Get-Content -LiteralPath $env:GITHUB_OUTPUT | ForEach-Object { if ($_ -match '^(dir|id)=(.*)$') { $values[$Matches[1]] = $Matches[2] } }
  $env:GITHUB_OUTPUT = $env:GITHUB_OUTPUT_SAVED
  [pscustomobject]@{ case = $case; dir = $values.dir; id = $values.id }
}
$outside = Join-Path $env:RUNNER_TEMP 'qa496-outside-store.db'
[IO.File]::WriteAllText($outside, "QA496-$env:GITHUB_RUN_ID-HARDLINK-CANARY")
New-Item -ItemType HardLink -Path (Join-Path $folders[0].dir 'observations.ndjson') -Target $outside | Out-Null
$manifest = Join-Path $folders[1].dir 'manifest.json'
$text = [IO.File]::ReadAllText($manifest)
[IO.File]::WriteAllText($manifest, $text.Insert(1, "`n  `"path`": `"QA496-$env:GITHUB_RUN_ID-MANIFEST-CANARY`","), [Text.UTF8Encoding]::new($false))
"hardlink_dir=$($folders[0].dir)", "hardlink_id=$($folders[0].id)", "manifest_dir=$($folders[1].dir)", "manifest_id=$($folders[1].id)" | Add-Content -LiteralPath $env:GITHUB_OUTPUT
