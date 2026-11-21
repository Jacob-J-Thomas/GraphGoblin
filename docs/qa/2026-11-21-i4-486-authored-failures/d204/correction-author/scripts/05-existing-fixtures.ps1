$ErrorActionPreference = 'Stop'
Get-Content -LiteralPath 'packages/engine/src/prompt-provenance.test.ts' | Select-Object -Skip 460 -First 145
Get-Content -LiteralPath 'packages/engine/src/run-manager.test.ts' | Select-Object -First 120
Get-Content -LiteralPath 'packages/engine/src/handlers/inference-boundaries.test.ts' | Select-Object -First 205
Get-Content -LiteralPath 'packages/engine/src/testing/fakes.ts' | Select-Object -Skip 490 -First 180
rg -n -- 'logger:|lines:|class MemoryLogger|rows:' packages/engine/src/testing/fakes.ts
Get-Content -LiteralPath 'packages/engine/src/handlers/inference.ts' | Select-Object -Skip 425 -First 145
Get-Content -LiteralPath 'packages/engine/src/run-manager.ts' | Select-Object -Skip 2350 -First 95
