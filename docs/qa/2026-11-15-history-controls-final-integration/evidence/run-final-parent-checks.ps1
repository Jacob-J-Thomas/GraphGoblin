param([string]$Checkout,[string]$Output,[string]$Integration)
$ErrorActionPreference='Stop'
$env:GIT_OPTIONAL_LOCKS='0'
$env:PATH="$env:USERPROFILE\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64;$env:PATH"
$head='6b0eae62ea98ae73b22903c9922bba198e219608'
$tree='5996caf9f060c899b305553fc3e359bf86990847'
$main='1cfca9bce3967c9d41950266c83aab636667e0ab'
$expected=@($head,$tree,$main)
$reviewed='c2cffebb7ca1bbea41ae72a37b9f232c90681906'
$parents=@('832c1b3271195f108dcb26b00b585b47f0eb9114',$main)
if(Test-Path -LiteralPath $Output){throw 'Preserve first checks'}
[IO.Directory]::CreateDirectory($Output)|Out-Null
$recorded=Get-Content -LiteralPath $Integration -Raw|ConvertFrom-Json
$webPaths=@($recorded.productDeltaPaths)
$tests=@(
  'src/components/layout/connection-banner.test.tsx',
  'src/editor/EditorConnectionBanner.test.tsx',
  'src/editor/EditorPage.connection.test.tsx',
  'src/editor/EditorToolbar.test.tsx',
  'src/editor/UndoRedo.press.test.tsx',
  'src/editor/UndoRedo.test.tsx',
  'src/editor/EditorPage.undo.test.tsx',
  'src/editor/EditorPage.conflict.test.tsx',
  'src/editor/EditorPage.device.test.tsx',
  'src/editor/EditorPage.publish.test.tsx',
  'src/editor/Canvas.test.tsx',
  'src/editor/OrthogonalEdge.test.tsx',
  'src/editor/viewport-gesture.contract.test.tsx'
)
$formatPaths=@($webPaths)+@('CHANGELOG.md','docs/09-frontend-and-pwa.md','docs/decisions/ADR-0078-stationary-history-controls.md','docs/decisions/README.md','docs/delivery/2026-11-13-four-intents-register.md','docs/guide/02-build-a-loop.md')
$testArgs=@('--filter','@graphgoblin/web','exec','vitest','run','--reporter=verbose')+$tests
$typeArgs=@('--filter','@graphgoblin/web','typecheck')
$lintArgs=@('exec','eslint')+$webPaths
$formatArgs=@('exec','prettier','--check')+$formatPaths
$commands=[ordered]@{focused=$testArgs;types=$typeArgs;eslint=$lintArgs;format=$formatArgs}
function Verify-Source {
  $ids=@(git rev-parse HEAD 'HEAD^{tree}' origin/main)
  if($LASTEXITCODE -or (Compare-Object $ids $expected -SyncWindow 0) -or @(git status --porcelain=v1 --untracked-files=all).Count){throw 'Actual worktree is outside frozen checkout'}
  $actualParents=(git show -s --format=%P HEAD).Trim().Split(' ')
  if(Compare-Object $actualParents $parents -SyncWindow 0){throw 'Unexpected integrated parents'}
  $files=@(git diff --name-only $main $head -- apps/web)
  if((Compare-Object $files $webPaths) -or $files.Count -ne 13){throw 'Unexpected web product delta'}
  $indexName=(git rev-parse --git-path index).Trim()
  $index=(Get-FileHash -LiteralPath $indexName).Hash.ToLowerInvariant()
  $source=@(foreach($path in $webPaths) {
    $blob=(git rev-parse ('HEAD:'+$path)).Trim()
    $older=(git rev-parse ($reviewed+':'+$path)).Trim()
    $workBlob=(git hash-object --no-filters -- $path).Trim()
    $reported=($recorded.records|Where-Object {$_.path -ceq $path}).blob
    if($blob -cne $older -or $blob -cne $reported -or $blob -cne $workBlob){throw "Product bytes differ for $path"}
    [ordered]@{path=$path;gitBlob=$blob;workingSha256=(Get-FileHash -LiteralPath $path).Hash.ToLowerInvariant()}
  })
  $tested=@(foreach($file in $tests){
    $path='apps/web/'+$file
    $blob=(git rev-parse ('HEAD:'+$path)).Trim()
    if($blob -cne (git hash-object --no-filters -- $path).Trim()){throw "Test bytes differ for $path"}
    [ordered]@{path=$path;gitBlob=$blob;workingSha256=(Get-FileHash -LiteralPath $path).Hash.ToLowerInvariant()}
  })
  return [ordered]@{head=$ids[0];tree=$ids[1];actualMain=$ids[2];parents=$actualParents;indexSha256=$index;source=$source;testFiles=$tested;status=@()}
}
Push-Location -LiteralPath $Checkout
try {
  $runtime=(node --version).Trim()
  if($runtime -cne 'v22.23.4'){throw 'Use the exact supported Node'}
  $before=Verify-Source
  $before|ConvertTo-Json -Depth 8|Set-Content -Encoding utf8NoBOM -LiteralPath (Join-Path $Output 'source-before.json')
  $commands|ConvertTo-Json -Depth 6|Set-Content -Encoding utf8NoBOM -LiteralPath (Join-Path $Output 'commands.json')
  $result=@()
  foreach($group in $commands.Keys) {
    $argsToUse=$commands[$group]
    $started=[DateTime]::UtcNow.ToString('o')
    $log=Join-Path $Output ($group+'-first.log')
    Write-Output ("Running "+$group+" on "+$head)
    pnpm.cmd @argsToUse 2>&1|Tee-Object -FilePath $log
    $code=$LASTEXITCODE
    $result+=[ordered]@{gate=$group;exit=$code;started=$started;finished=[DateTime]::UtcNow.ToString('o');logSha256=(Get-FileHash -LiteralPath $log).Hash.ToLowerInvariant()}
  }
  $after=Verify-Source
  $after|ConvertTo-Json -Depth 8|Set-Content -Encoding utf8NoBOM -LiteralPath (Join-Path $Output 'source-after.json')
  $stable=(($before|ConvertTo-Json -Depth 8 -Compress) -ceq ($after|ConvertTo-Json -Depth 8 -Compress))
  [ordered]@{node=$runtime;head=$head;tree=$tree;actualMain=$main;stable=$stable;results=$result}|ConvertTo-Json -Depth 8|Set-Content -Encoding utf8NoBOM -LiteralPath (Join-Path $Output 'results.json')
  if(!$stable -or ($result|Where-Object {$_.exit -ne 0})){exit 2}
} finally {
  Pop-Location
}
