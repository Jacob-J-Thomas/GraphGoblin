$env:PATH = 'C:/Users/98jak/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64;' + $env:PATH
$env:TEMP = 'G:/ggq/gg-i5-truthfulness-qa-scratch'
$env:TMP = $env:TEMP
$env:GIT_OPTIONAL_LOCKS = '0'
$env:GIT_NO_LAZY_FETCH = '1'
pnpm.cmd --filter @graphgoblin/web exec vitest run src/runs/RunInspectorPage.review2-independent-qa.test.tsx -t 'review2 R2-2: a wrong-ID 200' --retry=0 --reporter=default --reporter=json --outputFile=G:/ggq/delivery-evidence/2026-11-17-five-intents/i5-386-corrective-final-qa-01/d228-diagnostic-01/r2-2-schema-fixture-closure-01/component.json
exit $LASTEXITCODE
