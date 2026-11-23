$env:PATH = 'C:/Users/98jak/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64;' + $env:PATH
$env:TEMP = 'G:/ggq/gg-i5-truthfulness-qa-scratch'
$env:TMP = $env:TEMP
$env:GIT_OPTIONAL_LOCKS = '0'
$env:GIT_NO_LAZY_FETCH = '1'
pnpm.cmd --filter @graphgoblin/web typecheck
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
pnpm.cmd --filter @graphgoblin/web exec eslint src/runs/RunInspectorPage.corrective-independent-qa.test.tsx src/runs/RunInspectorPage.corrective-boundaries-qa.test.tsx src/runs/RunInspectorPage.independent-qa.test.tsx e2e/inspector-final-independent-qa.spec.ts
exit $LASTEXITCODE
