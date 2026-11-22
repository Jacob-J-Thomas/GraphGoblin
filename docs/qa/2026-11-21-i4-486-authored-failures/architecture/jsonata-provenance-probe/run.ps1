$ErrorActionPreference = 'Stop'
$env:PATH = "$env:USERPROFILE\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64;$env:PATH"
Set-Location -LiteralPath 'G:/ggq/gg-i4-486-authored-errors/GraphGoblin'
node --version
node --import=./apps/api/node_modules/tsx/dist/loader.mjs --conditions=development 'C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i4-486-jsonata-contract-01/probe.mjs'
exit $LASTEXITCODE
