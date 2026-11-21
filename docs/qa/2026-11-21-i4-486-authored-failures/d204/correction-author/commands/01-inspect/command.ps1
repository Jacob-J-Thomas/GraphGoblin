$ErrorActionPreference = 'Stop'
node --version
Write-Output "TEMP=$env:TEMP TMP=$env:TMP"
git status --porcelain=v1
git branch --show-current
git rev-parse HEAD 'HEAD^{tree}'
$taskIndexPath = git rev-parse --git-path index
Get-FileHash -LiteralPath $taskIndexPath -Algorithm SHA256 | ConvertTo-Json | Set-Content -LiteralPath 'G:\ggq\delivery-evidence\2026-11-17-five-intents\i4-486-review-fixes-author-01\initial-index.json'
Get-Content -LiteralPath 'packages/engine/src/failure-publication.ts'
Get-Content -LiteralPath 'packages/engine/src/handlers/inference-context.ts'
Get-Content -LiteralPath 'packages/engine/src/handlers/inference-context.test.ts'
Get-Content -LiteralPath 'packages/engine/src/run-manager.ts' | Select-Object -Skip 2635 -First 85
rg -n -- 'authored|diagnostic|canonical|Bug|workspace' docs/05-execution-engine.md
Get-Content -LiteralPath 'docs/decisions/0088-authored-failure-classification.md'
Get-Content -LiteralPath 'docs/12-implementation-plan.md' | Select-Object -First 120
Get-Content -LiteralPath 'packages/engine/package.json'
