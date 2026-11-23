# Recorded final verification commands; run from the owned author checkout.
# The assigned ports were verified free before each browser run.
$env:PATH = 'C:/Users/98jak/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64;' + $env:PATH
$evidenceRoot = 'G:/ggq/delivery-evidence/2026-11-17-five-intents/i5-386-browser-fixture-correction-01'
if (@(Get-NetTCPConnection -LocalPort 18794,18795 -ErrorAction SilentlyContinue | Where-Object State -eq Listen).Count -gt 0) {
  throw 'Owned test ports are not free'
}
$env:GG_E2E_MAIN_PORT = '18794'
$env:GG_E2E_CONTROL_PORT = '18795'
$env:GG_E2E_BROWSER_CHANNEL = 'msedge'
$env:GG_E2E_WEB_DIST = 'G:/ggq/gg-i5-truthfulness-qa/GraphGoblin/apps/web/dist'
$env:PLAYWRIGHT_JSON_OUTPUT_FILE = Join-Path $evidenceRoot 'browser-results.json'
pnpm.cmd --filter @graphgoblin/web exec playwright test e2e/inspector-truthfulness.spec.ts --output (Join-Path $evidenceRoot 'output/playwright/final-artifacts') --reporter=list,json --trace=on *> (Join-Path $evidenceRoot 'browser.log.txt')

pnpm.cmd --filter @graphgoblin/web typecheck *> (Join-Path $evidenceRoot 'final-typecheck.log.txt')
pnpm.cmd --filter @graphgoblin/web exec eslint e2e/inspector-truthfulness.spec.ts *> (Join-Path $evidenceRoot 'final-lint.log.txt')
pnpm.cmd exec prettier --check apps/web/e2e/inspector-truthfulness.spec.ts *> (Join-Path $evidenceRoot 'final-format.log.txt')
git diff --check *> (Join-Path $evidenceRoot 'final-diff-check.log.txt')
