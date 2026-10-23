# From <repo>: build, then run the API replay exactly once. No other suites.
$env:PATH = "$env:APPDATA\nvm\v22.14.0;$env:PATH"
$ErrorActionPreference = 'Continue'
$qaRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../../..')).Path
Set-Location -LiteralPath $qaRoot
$qaVersion = node --version
if ($qaVersion -notmatch '^v22\.') { throw 'Node 22 required' }
$qaHead = git rev-parse HEAD
if ($qaHead -ne '9f654e7f7cfe4180dd8d1258174cc4a2d2a30110') { throw 'Unexpected HEAD' }
function Protect-QALine($qaLine) {
  ([string]$qaLine).Replace($qaRoot, '<repo>').Replace($env:USERPROFILE, '<user>')
}
$qaCommands = @()
$qaStart = [DateTime]::UtcNow
& pnpm.cmd build 2>&1 | ForEach-Object { Protect-QALine $_ } | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $PSScriptRoot 'build.log.txt')
$qaBuildExit = $LASTEXITCODE
$qaCommands += @{ command='pnpm.cmd build'; exitCode=$qaBuildExit; elapsedMs=([DateTime]::UtcNow-$qaStart).TotalMilliseconds }
if ($qaBuildExit -eq 0) {
  $qaStart = [DateTime]::UtcNow
  & node (Join-Path $PSScriptRoot 'api-replay.mjs') 2>&1 | ForEach-Object { Protect-QALine $_ } | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $PSScriptRoot 'api-replay.log.txt')
  $qaApiExit = $LASTEXITCODE
  $qaCommands += @{ command='node docs/qa/2026-10-22-wp-f3-qa/round-4/api-replay.mjs'; exitCode=$qaApiExit; elapsedMs=([DateTime]::UtcNow-$qaStart).TotalMilliseconds }
}
@{head=$qaHead; node=$qaVersion; commands=$qaCommands} | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $PSScriptRoot 'command-results.json')
$qaCommands | ForEach-Object { Write-Output ($_.command+' exit='+$_.exitCode) }
if ($qaCommands.Where({$_.exitCode -ne 0}).Count -gt 0) { exit 1 }
