$ErrorActionPreference = 'Stop'
pnpm.cmd --filter @graphgoblin/engine test src/handlers/inference-context.test.ts src/handlers/inference-workspace.test.ts
exit $LASTEXITCODE
