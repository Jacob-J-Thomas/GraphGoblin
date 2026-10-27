$ErrorActionPreference = 'Stop'
$env:PATH = "$env:USERPROFILE\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64;$env:PATH"
$env:GG_TEST_PORT_START = '6750'
$env:GG_TEST_PORT_COUNT = '40'
$qaDir = $PSScriptRoot
foreach ($probe in @('observation-cost','races','pending-read','a11y-strict','live-state','history','bounds','bounds-recheck','review-live-state','migration')) {
  Write-Output "Starting $probe at $(Get-Date -Format o)"
  & node (Join-Path $qaDir "$probe.mjs") 2>&1 | ForEach-Object { $_.ToString().Replace($env:USERPROFILE,'%USERPROFILE%').Replace($env:COMPUTERNAME,'%COMPUTERNAME%') -replace 'S-1-\d+(?:-\d+)+','<SID>' } | Out-File -Encoding utf8 (Join-Path $qaDir "$probe-console.log.txt")
  Write-Output "$probe exit=$LASTEXITCODE"
}
