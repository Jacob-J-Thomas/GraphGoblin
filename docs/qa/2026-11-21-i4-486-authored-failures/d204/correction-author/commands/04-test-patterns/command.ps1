$ErrorActionPreference = 'Stop'
rg -n --glob '*test.ts' -- 'prior.*provenance|prior task|workspace.template|empty rendered|private.*marker|evaluator marker|definitely-not-submitted' packages/engine/src/handlers packages/engine/src | Select-Object -First 125
rg -n -- 'class FakeLogger|class FakeSessions|class FakeHarness|class FakeWorkspace' packages/engine/src/testing/fakes.ts
Get-Content -LiteralPath 'packages/engine/src/handlers/inference.test.ts' | Select-Object -First 180
Get-Content -LiteralPath 'packages/engine/src/run-manager.ts' | Select-Object -First 105
Get-Content -LiteralPath 'packages/engine/src/errors.ts' | Select-Object -First 115
Get-Content -LiteralPath 'vitest.config.ts' -ErrorAction SilentlyContinue
Get-Content -LiteralPath 'packages/engine/vitest.config.ts'
