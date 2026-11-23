$env:PATH = "$env:USERPROFILE\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64;$env:PATH"
$env:TMP='G:/ggq/gg-i5-386-review1-probe/tmp'
$env:TEMP=$env:TMP
New-Item -Force -ItemType Directory -Path $env:TMP | Out-Null
node --version
pnpm.cmd --version
pnpm.cmd --dir 'G:/ggq/gg-i5-truthful-inspector/GraphGoblin/apps/web' exec vitest run --root 'G:/ggq/gg-i5-386-review1-probe/source-copy/apps/web' --config 'G:/ggq/gg-i5-386-review1-probe/source-copy/apps/web/vitest.config.ts' src/runs/review-witness.test.tsx --reporter=verbose *> 'G:/ggq/delivery-evidence/2026-11-17-five-intents/i5-386-gpt-review-01/witness-run-02.log'
$testExit=$LASTEXITCODE
Get-Content -LiteralPath 'G:/ggq/delivery-evidence/2026-11-17-five-intents/i5-386-gpt-review-01/witness-run-02.log' | Select-Object -First 35
exit $testExit