$ErrorActionPreference = 'Continue'
$env:PATH = "$env:APPDATA\nvm\v22.14.0;$env:PATH"
$qaRoot = Join-Path ([System.IO.Path]::GetTempPath()) 'gg-qa-231-9896cf-independent'
$qaEvidence = Join-Path (Get-Location) 'docs/qa/2026-10-22-wp-g2-qa'
New-Item -ItemType Directory -Path (Join-Path $qaRoot 'tests') -Force | Out-Null
$env:TEMP = Join-Path $qaRoot 'tests'
$env:TMP = $env:TEMP
$env:LIVE = '0'
foreach ($qaPackage in @('infrastructure', 'api', 'api-client', 'mcp', 'web')) {
  $qaLog = Join-Path $qaEvidence ("suite-" + $qaPackage + '.txt')
  "COMMAND: pnpm.cmd --filter @graphgoblin/$qaPackage test:coverage --maxWorkers=1 --coverage.reportOnFailure --reporter=verbose" | Set-Content $qaLog
  $qaStarted = Get-Date
  & pnpm.cmd --filter "@graphgoblin/$qaPackage" test:coverage --maxWorkers=1 --coverage.reportOnFailure --reporter=verbose 2>&1 | ForEach-Object {
    $qaLine = ([string]$_).Replace((Get-Location).Path, '<worktree>').Replace($env:USERPROFILE, '<user>')
    $qaLine = $qaLine -replace '\x1B\[[0-?]*[ -/]*[@-~]', ''
    Add-Content -LiteralPath $qaLog -Value $qaLine
  }
  $qaCode = $LASTEXITCODE
  "EXIT: $qaCode; ELAPSED_SECONDS: $([math]::Round(((Get-Date) - $qaStarted).TotalSeconds, 1))" | Add-Content $qaLog
  Write-Output "$qaPackage exit=$qaCode"
}
