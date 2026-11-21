$ErrorActionPreference = 'Stop'
pnpm.cmd --filter @graphgoblin/engine typecheck
exit $LASTEXITCODE
