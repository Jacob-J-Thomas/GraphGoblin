$ErrorActionPreference = 'Stop'
pnpm.cmd exec prettier --write packages/engine/src/handlers/inference-context.test.ts packages/engine/src/handlers/inference-workspace.test.ts
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
pnpm.cmd --filter @graphgoblin/engine test src/handlers/inference-context.test.ts src/handlers/inference-workspace.test.ts
exit $LASTEXITCODE
