$ErrorActionPreference = 'Stop'
pnpm.cmd --filter @graphgoblin/engine test src/handlers/inference-context.test.ts -t 'privately logs canonical rerender'
exit $LASTEXITCODE
