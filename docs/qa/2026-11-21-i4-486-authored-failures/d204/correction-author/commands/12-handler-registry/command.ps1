$ErrorActionPreference = 'Stop'
Get-Content -LiteralPath 'packages/engine/src/handlers/index.ts'
rg -n -- 'HandlerRegistry|handlers\[' packages/engine/src/handler.ts packages/engine/src/run-manager.ts
Get-Content -LiteralPath 'packages/engine/src/handlers/inference-context.test.ts' | Select-Object -First 110
