$env:PATH = "$env:USERPROFILE\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64;$env:PATH"
$env:TEMP='G:/ggq/gg-i5-386-repair-review2-probe/tmp'
$env:TMP=$env:TEMP
node --version
pnpm.cmd --version
pnpm.cmd --dir 'G:/ggq/gg-i5-truthful-inspector/GraphGoblin/apps/web' exec vitest run --root 'G:/ggq/gg-i5-386-repair-review2-probe/source/apps/web' --config 'G:/ggq/gg-i5-386-repair-review2-probe/source/apps/web/vitest.config.ts' src/runs/boundary-witness.test.tsx --reporter=verbose
exit $LASTEXITCODE
