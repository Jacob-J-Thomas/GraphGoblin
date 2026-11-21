$ErrorActionPreference = 'Stop'
$env:PATH = "$env:USERPROFILE\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64;$env:PATH"
$taskEvidence = 'C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i4-363-independent-01'
Set-Location -LiteralPath 'G:/ggq/gg-i4-363-qa/GraphGoblin'
Start-Transcript -LiteralPath "$taskEvidence/raw/run-native-01.transcript.txt" -NoClobber
node --version
pnpm.cmd --version
node --experimental-transform-types "$taskEvidence/fixture-v1.mjs"
$taskRunExit = $LASTEXITCODE
Write-Output "NATIVE_RUN_EXIT=$taskRunExit"
Stop-Transcript
exit $taskRunExit
