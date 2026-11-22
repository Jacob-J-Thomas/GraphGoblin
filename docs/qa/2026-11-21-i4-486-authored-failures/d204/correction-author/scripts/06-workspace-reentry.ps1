$ErrorActionPreference = 'Stop'
rg -n -- 'workingDirectory:|workingDirectory\(|workspaceCache|workspace =|workingDirectoryResult' packages/engine/src/run-manager.ts
Get-Content -LiteralPath 'packages/engine/src/run-manager.ts' | Select-Object -Skip 2455 -First 45
Get-Content -LiteralPath 'packages/engine/src/run-manager.ts' | Select-Object -Skip 3230 -First 115
Get-Content -LiteralPath 'packages/engine/src/prompt-provenance.test.ts' | Select-Object -First 85
Get-Content -LiteralPath 'packages/engine/src/prompt-recovery.test.ts' | Select-Object -First 140
rg -n -- 'thread.run|attempt' packages/domain/src/template.ts packages/domain/src/thread-view.ts packages/engine/src/run-manager.ts | Select-Object -Last 25
