$ErrorActionPreference = 'Stop'
$env:PATH = 'C:/Users/98jak/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64;' + $env:PATH
Set-Location -LiteralPath 'G:/ggq/gg-i4-362-batch-guidance/GraphGoblin'
$evidenceRoot = 'C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i4-362-author-01'
node --version | Tee-Object -FilePath "$evidenceRoot/runtime.log"
pnpm.cmd exec prettier --write packages/infrastructure/src/process/scripts.test.ts docs/04-node-catalog.md docs/guide/07-troubleshooting.md CHANGELOG.md 2>&1 | Tee-Object -FilePath "$evidenceRoot/format.log"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run src/process/scripts.test.ts -t 'native .|synchronous EINVAL|spawn failures' 2>&1 | Tee-Object -FilePath "$evidenceRoot/native-focused.log"
$testCode = $LASTEXITCODE
"exitCode=$testCode" | Add-Content -LiteralPath "$evidenceRoot/native-focused.log"
if ($testCode -ne 0) { exit $testCode }
pnpm.cmd --filter @graphgoblin/infrastructure typecheck 2>&1 | Tee-Object -FilePath "$evidenceRoot/typecheck.log"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
pnpm.cmd exec eslint packages/infrastructure/src/process/scripts.test.ts 2>&1 | Tee-Object -FilePath "$evidenceRoot/lint.log"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
git diff --check 2>&1 | Tee-Object -FilePath "$evidenceRoot/diff-check.log"
exit $LASTEXITCODE
