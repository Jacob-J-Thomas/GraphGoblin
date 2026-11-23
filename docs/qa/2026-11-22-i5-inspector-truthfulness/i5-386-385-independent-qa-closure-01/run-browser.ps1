$env:PATH = 'C:/Users/98jak/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64;' + $env:PATH
$env:TEMP = 'G:/ggq/delivery-evidence/2026-11-17-five-intents/i5-386-385-independent-qa-closure-01/tmp'
$env:TMP = $env:TEMP
$env:GIT_NO_LAZY_FETCH = '1'
$env:GG_E2E_MAIN_PORT = '18786'
$env:GG_E2E_CONTROL_PORT = '18787'
$env:GG_E2E_WEB_DIST = 'G:/ggq/gg-i5-truthfulness-qa/GraphGoblin/apps/web/dist'
$env:GG_E2E_BROWSER_CHANNEL = 'msedge'
$env:PLAYWRIGHT_JSON_OUTPUT_NAME = 'G:/ggq/delivery-evidence/2026-11-17-five-intents/i5-386-385-independent-qa-closure-01/browser-results.json'
pnpm.cmd --filter @graphgoblin/web exec playwright test e2e/inspector-truthfulness.spec.ts --retries=0 --trace on --output G:/ggq/delivery-evidence/2026-11-17-five-intents/i5-386-385-independent-qa-closure-01/output/playwright --reporter=list,json
exit $LASTEXITCODE
