$ErrorActionPreference = 'Stop'
$env:PATH = "$env:USERPROFILE\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64;$env:PATH"
$taskEvidence = 'C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i4-363-sdk-boundary-01'
Set-Location -LiteralPath 'G:/ggq/gg-i4-363-qa/GraphGoblin'
& node "$taskEvidence/run-boundary-v1.mjs" *>&1 | Tee-Object -FilePath "$taskEvidence/raw/driver-console.txt"
$taskBoundaryExit = $LASTEXITCODE
Write-Output "BOUNDARY_RUN_EXIT=$taskBoundaryExit"
exit $taskBoundaryExit
