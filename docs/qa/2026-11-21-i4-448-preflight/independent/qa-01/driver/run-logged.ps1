# Independent QA #448 command runner. Prepends the project Node runtime for this child shell only,
# runs one pnpm.cmd command line in the candidate checkout, and retains raw output plus exit code.
param(
  [Parameter(Mandatory = $true)][string]$Log,
  [Parameter(Mandatory = $true)][string]$ExitFile,
  [Parameter(Mandatory = $true)][string]$CommandLine
)
$ErrorActionPreference = 'Continue'
$env:PATH = 'C:\Users\98jak\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64;' + $env:PATH
Set-Location -LiteralPath 'G:\ggq\gg-i4-448-qa\GraphGoblin'
$started = (Get-Date).ToUniversalTime().ToString('o')
"# command: $CommandLine" | Out-File -LiteralPath $Log -Encoding utf8
"# cwd: $((Get-Location).Path)" | Out-File -LiteralPath $Log -Encoding utf8 -Append
"# node: $(node --version)" | Out-File -LiteralPath $Log -Encoding utf8 -Append
"# started_utc: $started" | Out-File -LiteralPath $Log -Encoding utf8 -Append
$sw = [System.Diagnostics.Stopwatch]::StartNew()
cmd.exe /d /c "$CommandLine 2>&1" | Out-File -LiteralPath $Log -Encoding utf8 -Append
$code = $LASTEXITCODE
$sw.Stop()
"# exit_code: $code" | Out-File -LiteralPath $Log -Encoding utf8 -Append
"# elapsed_s: $([math]::Round($sw.Elapsed.TotalSeconds, 2))" | Out-File -LiteralPath $Log -Encoding utf8 -Append
"# finished_utc: $((Get-Date).ToUniversalTime().ToString('o'))" | Out-File -LiteralPath $Log -Encoding utf8 -Append
"$code" | Out-File -LiteralPath $ExitFile -Encoding ascii
exit $code
