$ErrorActionPreference = 'Stop'
Get-Content -LiteralPath 'packages/engine/src/handlers/inference.test.ts' | Select-Object -Skip 420 -First 115
Get-Content -LiteralPath 'packages/engine/src/handlers/flow.test.ts' | Select-Object -First 95
git rev-parse HEAD 'HEAD^{tree}'
git diff --cached --exit-code
exit $LASTEXITCODE
