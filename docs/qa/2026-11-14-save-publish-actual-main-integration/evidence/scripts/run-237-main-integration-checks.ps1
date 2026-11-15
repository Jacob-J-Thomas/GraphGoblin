$ErrorActionPreference='Stop'
$env:PATH="$env:USERPROFILE\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64;$env:PATH"
$checkRoot='C:\Users\98jak\graphgoblin-qa\2026-11-13-aidlc-batch\review-237'
Set-Location -LiteralPath 'C:\Users\98jak\.codex\worktrees\gg-20261114-save-publish\GraphGoblin'
$started=(Get-Date).ToUniversalTime().ToString('o')
& pnpm.cmd --filter '@graphgoblin/web' exec vitest run src/editor/usePublish.test.ts src/editor/EditorPage.publish.test.tsx src/editor/EditorPage.reconcile.test.tsx src/editor/useAutosave.test.tsx src/editor/EditorPage.test.tsx src/editor/EditorPage.rename.test.tsx src/editor/EditorPage.rename-activation.test.tsx src/editor/NodeEditorDialog.test.tsx src/editor/RenameNotice.test.tsx src/editor/pointer-press.test.tsx src/forms/SchemaForm.repair.test.tsx src/forms/repair.test.ts *> (Join-Path $checkRoot 'actual-main-focused-first.log')
$focusedExit=$LASTEXITCODE
& pnpm.cmd --filter '@graphgoblin/web' exec tsc -p tsconfig.json --noEmit *> (Join-Path $checkRoot 'actual-main-types-first.log')
$typesExit=$LASTEXITCODE
& pnpm.cmd --filter '@graphgoblin/web' exec eslint src/editor/store.ts --max-warnings 0 *> (Join-Path $checkRoot 'actual-main-lint-first.log')
$lintExit=$LASTEXITCODE
& pnpm.cmd exec prettier --check CHANGELOG.md docs/09-frontend-and-pwa.md docs/delivery/2026-11-13-four-intents-register.md *> (Join-Path $checkRoot 'actual-main-format-first.log')
$formatExit=$LASTEXITCODE
$result=[ordered]@{startedAt=$started;finishedAt=(Get-Date).ToUniversalTime().ToString('o');focusedExit=$focusedExit;typesExit=$typesExit;lintExit=$lintExit;formatExit=$formatExit}
$result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $checkRoot 'actual-main-checks-first.json') -Encoding utf8
$result | ConvertTo-Json -Compress
if($focusedExit -ne 0 -or $typesExit -ne 0 -or $lintExit -ne 0 -or $formatExit -ne 0){exit 1}
