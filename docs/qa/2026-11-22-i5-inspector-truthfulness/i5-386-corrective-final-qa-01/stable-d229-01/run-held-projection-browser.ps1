$env:PATH = 'C:/Users/98jak/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64;' + $env:PATH
$env:TEMP = 'G:/ggq/gg-i5-truthfulness-qa-scratch'
$env:TMP = $env:TEMP
$env:GIT_OPTIONAL_LOCKS = '0'
$env:GIT_NO_LAZY_FETCH = '1'
$occupied = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in @(18786,18787) })
$portReceipt = [ordered]@{atUtc=[DateTime]::UtcNow.ToString('o');ownedPorts=@(18786,18787);listeners=@($occupied|Select-Object LocalAddress,LocalPort,OwningProcess)}
$portReceipt|ConvertTo-Json -Depth 5|Set-Content -LiteralPath 'G:/ggq/delivery-evidence/2026-11-17-five-intents/i5-386-corrective-final-qa-01/stable-d229-01/ports-before-held-projection.json' -Encoding utf8
if ($occupied.Count -ne 0) { throw 'Owned QA browser ports are occupied; no process control is authorized' }
$env:GG_E2E_MAIN_PORT = '18786'
$env:GG_E2E_CONTROL_PORT = '18787'
$env:GG_E2E_WEB_DIST = 'G:/ggq/gg-i5-truthfulness-qa/GraphGoblin/apps/web/dist'
$env:GG_E2E_BROWSER_CHANNEL = 'msedge'
$env:PLAYWRIGHT_JSON_OUTPUT_NAME = 'G:/ggq/delivery-evidence/2026-11-17-five-intents/i5-386-corrective-final-qa-01/stable-d229-01/held-projection-browser.json'
pnpm.cmd --filter @graphgoblin/web exec playwright test e2e/inspector-truthfulness.spec.ts e2e/inspector-final-independent-qa.spec.ts --retries=0 --trace on --output G:/ggq/delivery-evidence/2026-11-17-five-intents/i5-386-corrective-final-qa-01/stable-d229-01/output/playwright/held-and-projection --reporter=list,json
exit $LASTEXITCODE
