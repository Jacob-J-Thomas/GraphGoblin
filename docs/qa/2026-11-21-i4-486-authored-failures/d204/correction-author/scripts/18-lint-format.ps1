$ErrorActionPreference = 'Stop'
pnpm.cmd --filter @graphgoblin/engine lint
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
pnpm.cmd exec prettier --check packages/engine/src/failure-publication.ts packages/engine/src/handlers/inference-context.ts packages/engine/src/run-manager.ts packages/engine/src/handlers/inference-context.test.ts packages/engine/src/handlers/inference-workspace.test.ts docs/05-execution-engine.md
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
git diff --check
exit $LASTEXITCODE
