$ErrorActionPreference = 'Stop'
Get-Content -LiteralPath 'docs/decisions/ADR-0088-authored-execution-failures.md'
Get-Content -LiteralPath 'packages/engine/src/run-manager.ts' | Select-Object -Skip 2660 -First 45
Get-Content -LiteralPath 'packages/engine/src/handlers/inference.ts' | Select-Object -Skip 245 -First 145
rg -n -- 'prior|definitely-not-submitted|delivery-uncertain|workspace|evaluator|marker' packages/engine/src/handlers/inference-authored* packages/engine/src/run-manager*test.ts packages/engine/src/handlers/*workspace* packages/engine/src/testing/scenario.ts
rg --files packages/engine/src -g '*authored*' -g '*workspace*' -g '*publication*'
Get-Content -LiteralPath 'packages/engine/src/testing/scenario.ts' | Select-Object -First 250
Get-Content -LiteralPath 'packages/engine/src/handlers/inference-turn.ts' | Select-Object -First 250
