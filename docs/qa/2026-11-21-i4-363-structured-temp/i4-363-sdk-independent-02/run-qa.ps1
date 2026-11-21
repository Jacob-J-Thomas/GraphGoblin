$ErrorActionPreference = 'Stop'
$env:PATH = "$env:USERPROFILE\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64;$env:PATH"
Set-Location -LiteralPath 'G:/ggq/gg-i4-363-sdk-qa/GraphGoblin'
& node C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i4-363-sdk-independent-02/run-qa-v1.mjs *>&1 | Tee-Object -FilePath C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i4-363-sdk-independent-02/raw/driver-v1-console.txt
$taskQaExit = $LASTEXITCODE
Write-Output "INDEPENDENT_QA_V1_EXIT=$taskQaExit"
exit $taskQaExit
