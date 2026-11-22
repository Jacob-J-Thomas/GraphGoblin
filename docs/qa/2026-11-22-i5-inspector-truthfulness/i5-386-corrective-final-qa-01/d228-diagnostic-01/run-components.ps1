$env:PATH = 'C:/Users/98jak/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64;' + $env:PATH
$env:TEMP = 'G:/ggq/gg-i5-truthfulness-qa-scratch'
$env:TMP = $env:TEMP
$env:GIT_OPTIONAL_LOCKS = '0'
$env:GIT_NO_LAZY_FETCH = '1'
pnpm.cmd --filter @graphgoblin/web exec vitest run src/runs/RunInspectorPage.corrective-independent-qa.test.tsx src/runs/RunInspectorPage.corrective-boundaries-qa.test.tsx src/runs/RunInspectorPage.independent-qa.test.tsx src/runs/RunInspectorPage.review2-independent-qa.test.tsx --retry=0 --reporter=default --reporter=json --outputFile=G:/ggq/delivery-evidence/2026-11-17-five-intents/i5-386-corrective-final-qa-01/d228-diagnostic-01/components.json
exit $LASTEXITCODE
