param([string]$Checkout,[string]$Out)
$ErrorActionPreference='Stop'
$PSNativeCommandUseErrorActionPreference=$false
$env:GIT_OPTIONAL_LOCKS='0'
$env:PATH="$env:USERPROFILE\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64;$env:PATH"
if(Test-Path -LiteralPath $Out){throw 'Preserve first coverage attempt'}
[IO.Directory]::CreateDirectory($Out)|Out-Null
$dir=Join-Path $Out 'coverage'
$log=Join-Path $Out 'web-coverage-first.log'
$expected=@('20875894b0f2a9206141f3c469c649d7155d3e45','b23ac01c96358443047067cd9fd26d2e3afe4b86','1cfca9bce3967c9d41950266c83aab636667e0ab')
$files=@('apps/web/package.json','apps/web/vitest.config.ts','tooling/vitest.shared.mjs','pnpm-lock.yaml','apps/web/src/editor/Canvas.tsx','apps/web/src/editor/SpaceCardsOffer.tsx','apps/web/src/editor/store.ts','apps/web/src/editor/space-cards.ts','apps/web/src/editor/Canvas.space-cards.test.tsx','apps/web/src/editor/Canvas.space-cards.gate.test.tsx','apps/web/src/editor/EditorPage.space-cards.test.tsx','apps/web/src/editor/space-cards.test.ts','apps/web/src/editor/store.space-cards.test.ts')
function Read-Frozen {
 $ids=@(git rev-parse HEAD 'HEAD^{tree}' origin/main)
 if($LASTEXITCODE -or (Compare-Object $ids $expected -SyncWindow 0)){throw 'Unexpected frozen Space identity'}
 $status=@(git status --porcelain=v1 --untracked-files=all)
 if($LASTEXITCODE -or $status.Count){throw 'Worktree must stay clean'}
 $indexPath=(git rev-parse --git-path index).Trim()
 $source=@(foreach($file in $files){
  $gitBlob=(git rev-parse ('HEAD:'+$file)).Trim()
  if($gitBlob -cne (git hash-object --no-filters -- $file).Trim()){throw "Working and Git content differs at $file"}
  [ordered]@{path=$file;gitBlob=$gitBlob;sha256=(Get-FileHash -LiteralPath $file).Hash.ToLowerInvariant()}
 })
 return [ordered]@{head=$ids[0];tree=$ids[1];observedMain=$ids[2];index=$indexPath;indexSha256=(Get-FileHash -LiteralPath $indexPath).Hash.ToLowerInvariant();status=$status;source=$source}
}
Push-Location -LiteralPath $Checkout
try{
 $node=(node --version).Trim()
 if($node -cne 'v22.23.4'){throw 'Use exact project Node 22'}
 $web=Get-Content -Raw -LiteralPath 'apps/web/package.json'|ConvertFrom-Json
 if($web.name -cne '@graphgoblin/web' -or $web.scripts.'test:coverage' -cne 'vitest run --coverage'){throw 'Coverage entry point changed'}
 $before=Read-Frozen
 $before|ConvertTo-Json -Depth 7 | Set-Content -Encoding utf8NoBOM -LiteralPath (Join-Path $Out 'source-before.json')
 $argsToUse=@('--filter','@graphgoblin/web','test:coverage',('--coverage.reportsDirectory='+$dir))
 [ordered]@{node=$node;packageScript=$web.scripts.'test:coverage';command='pnpm.cmd';args=$argsToUse;cwd=$Checkout}|ConvertTo-Json -Depth 5|Set-Content -Encoding utf8NoBOM -LiteralPath (Join-Path $Out 'command.json')
 [IO.File]::WriteAllBytes($log,[byte[]]@())
 $started=[DateTime]::UtcNow.ToString('o')
 pnpm.cmd @argsToUse 2>&1|Tee-Object -FilePath $log
 $code=$LASTEXITCODE
 [ordered]@{node=$node;head=$before.head;tree=$before.tree;observedMain=$before.observedMain;exit=$code;startedAt=$started;finishedAt=[DateTime]::UtcNow.ToString('o');logSha256=(Get-FileHash -LiteralPath $log).Hash.ToLowerInvariant();coverageSummaryExists=(Test-Path -LiteralPath (Join-Path $dir 'coverage-summary.json'))}|ConvertTo-Json -Depth 5|Set-Content -Encoding utf8NoBOM -LiteralPath (Join-Path $Out 'exit-first.json')
 $after=Read-Frozen
 $after|ConvertTo-Json -Depth 7|Set-Content -Encoding utf8NoBOM -LiteralPath (Join-Path $Out 'source-after.json')
 if(($before|ConvertTo-Json -Depth 7 -Compress) -cne ($after|ConvertTo-Json -Depth 7 -Compress)){throw 'Source/index changed'}
 exit $code
}finally{Pop-Location}
