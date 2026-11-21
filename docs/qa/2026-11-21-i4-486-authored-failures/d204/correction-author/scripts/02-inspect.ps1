$ErrorActionPreference = 'Stop'
node --version
Write-Output "TEMP=$env:TEMP TMP=$env:TMP"
git status --porcelain=v1
git branch --show-current
git rev-parse HEAD 'HEAD^{tree}'
Get-Content -LiteralPath 'packages/engine/src/failure-publication.ts'
Get-Content -LiteralPath 'packages/engine/src/handlers/inference-context.ts'
Get-Content -LiteralPath 'packages/engine/src/handlers/inference-context.test.ts'
Get-Content -LiteralPath 'packages/engine/src/run-manager.ts' | Select-Object -Skip 2635 -First 85
rg -n -- 'authored|diagnostic|canonical|Bug|workspace' docs/05-execution-engine.md
rg --files docs/decisions -g '*0088*'
Get-Content -LiteralPath 'docs/12-implementation-plan.md' | Select-Object -First 120
Get-Content -LiteralPath 'packages/engine/package.json'
