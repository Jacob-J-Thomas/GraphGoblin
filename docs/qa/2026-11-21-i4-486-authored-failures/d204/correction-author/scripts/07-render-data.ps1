$ErrorActionPreference = 'Stop'
Get-Content -LiteralPath 'packages/engine/src/run-manager.ts' | Select-Object -Skip 3360 -First 65
rg -n -- 'function threadView|now|signals' packages/domain/src/thread.ts packages/domain/src/template.ts packages/engine/src/thread.ts packages/engine/src/run-manager.ts | Select-Object -First 55
Get-Content -LiteralPath 'packages/domain/src/template.ts' | Select-Object -First 110
rg -n -- 'snapshot|initialState|states\.|events.append' packages/engine/src/prompt-recovery.test.ts packages/engine/src/run-manager.test.ts | Select-Object -Last 35
Get-Content -LiteralPath 'packages/engine/src/testing/fakes.ts' | Select-Object -Skip 125 -First 35
