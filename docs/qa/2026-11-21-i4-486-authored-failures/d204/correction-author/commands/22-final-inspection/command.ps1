$ErrorActionPreference = 'Stop'
git diff --stat
git status --porcelain=v1
git diff -- packages/engine/src/failure-publication.ts packages/engine/src/run-manager.ts packages/engine/src/handlers/inference-context.ts packages/engine/src/handlers/inference-context.test.ts docs/05-execution-engine.md
rg -n -- 'logger|SECRET|secret|marker' packages/engine/src/handlers/inference.test.ts packages/engine/src/handlers/flow.test.ts packages/engine/src/prompt-provenance.test.ts
Get-Content -LiteralPath 'packages/engine/src/handlers/inference-workspace.test.ts'
