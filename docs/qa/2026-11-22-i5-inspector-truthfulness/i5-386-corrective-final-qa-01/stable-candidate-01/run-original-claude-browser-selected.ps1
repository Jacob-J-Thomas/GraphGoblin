$env:PATH = 'C:/Users/98jak/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64;' + $env:PATH
$env:TEMP = 'G:/ggq/gg-i5-truthfulness-qa-scratch'
$env:TMP = $env:TEMP
$env:GIT_OPTIONAL_LOCKS = '0'
$env:GIT_NO_LAZY_FETCH = '1'
$occupied = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in @(18786,18787) })
if ($occupied.Count -ne 0) { throw 'Owned QA browser ports are occupied; no process control is authorized' }
$env:GG_E2E_MAIN_PORT = '18786'
$env:GG_E2E_CONTROL_PORT = '18787'
$env:GG_E2E_WEB_DIST = 'G:/ggq/gg-i5-truthfulness-qa/GraphGoblin/apps/web/dist'
$env:GG_E2E_BROWSER_CHANNEL = 'msedge'
$env:PLAYWRIGHT_JSON_OUTPUT_NAME = 'G:/ggq/delivery-evidence/2026-11-17-five-intents/i5-386-corrective-final-qa-01/stable-candidate-01/original-claude-browser-selected.json'
pnpm.cmd --filter @graphgoblin/web exec playwright test e2e/claude-harness.spec.ts --grep 'Claude inference selection stays family-specific through publish and run' --retries=0 --trace on --output G:/ggq/delivery-evidence/2026-11-17-five-intents/i5-386-corrective-final-qa-01/stable-candidate-01/output/playwright/original-claude-selected --reporter=list,json
exit $LASTEXITCODE
