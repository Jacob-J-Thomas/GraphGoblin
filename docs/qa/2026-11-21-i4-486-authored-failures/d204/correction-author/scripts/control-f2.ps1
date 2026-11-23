$ErrorActionPreference = 'Stop'
pnpm.cmd --filter @graphgoblin/engine test src/handlers/inference-workspace.test.ts -t 'inference workspace preparation|retains stored|keeps the earlier'
exit $LASTEXITCODE
