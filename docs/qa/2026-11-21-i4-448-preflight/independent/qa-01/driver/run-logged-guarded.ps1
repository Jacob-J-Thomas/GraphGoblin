# Independent QA #448 guarded command runner: like run-logged.ps1, plus a child-only NODE_OPTIONS
# preload that blocks/records fetches to port 11434. Environment changes are process-scoped to this
# PowerShell child and its descendants only.
param(
  [Parameter(Mandatory = $true)][string]$Log,
  [Parameter(Mandatory = $true)][string]$ExitFile,
  [Parameter(Mandatory = $true)][string]$GuardLog,
  [Parameter(Mandatory = $true)][string]$CommandLine
)
$ErrorActionPreference = 'Continue'
$env:PATH = 'C:\Users\98jak\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64;' + $env:PATH
$env:NODE_OPTIONS = '--require=C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i4-448-independent-01/driver/qa448-fetch-guard.cjs'
$env:QA448_FETCH_GUARD_LOG = $GuardLog
Set-Location -LiteralPath 'G:\ggq\gg-i4-448-qa\GraphGoblin'
"# command: $CommandLine" | Out-File -LiteralPath $Log -Encoding utf8
"# cwd: $((Get-Location).Path)" | Out-File -LiteralPath $Log -Encoding utf8 -Append
"# node: $(node --version)" | Out-File -LiteralPath $Log -Encoding utf8 -Append
"# NODE_OPTIONS (child-only): $env:NODE_OPTIONS" | Out-File -LiteralPath $Log -Encoding utf8 -Append
"# started_utc: $((Get-Date).ToUniversalTime().ToString('o'))" | Out-File -LiteralPath $Log -Encoding utf8 -Append
$sw = [System.Diagnostics.Stopwatch]::StartNew()
cmd.exe /d /c "$CommandLine 2>&1" | Out-File -LiteralPath $Log -Encoding utf8 -Append
$code = $LASTEXITCODE
$sw.Stop()
"# exit_code: $code" | Out-File -LiteralPath $Log -Encoding utf8 -Append
"# elapsed_s: $([math]::Round($sw.Elapsed.TotalSeconds, 2))" | Out-File -LiteralPath $Log -Encoding utf8 -Append
"# finished_utc: $((Get-Date).ToUniversalTime().ToString('o'))" | Out-File -LiteralPath $Log -Encoding utf8 -Append
"$code" | Out-File -LiteralPath $ExitFile -Encoding ascii
exit $code
