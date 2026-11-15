param([string]$Checkout,[string]$Output)
$ErrorActionPreference='Stop'
$env:GIT_OPTIONAL_LOCKS='0'
$env:PATH="$env:USERPROFILE\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64;$env:PATH"
$commands=Get-Content -Raw -LiteralPath (Join-Path $Output 'commands.json')|ConvertFrom-Json -AsHashtable
$before=Get-Content -Raw -LiteralPath (Join-Path $Output 'source-before.json')|ConvertFrom-Json -AsHashtable
function Confirm-Git {
 $ids=@(git rev-parse HEAD 'HEAD^{tree}' origin/main)
 $status=@(git status --porcelain=v1 --untracked-files=all)
 $index=(Get-FileHash -LiteralPath ((git rev-parse --git-path index).Trim())).Hash.ToLowerInvariant()
 if((Compare-Object $ids @($before.head,$before.tree,$before.actualMain) -SyncWindow 0) -or $status.Count -or $index -cne $before.indexSha256){throw 'Frozen checkout changed'}
 foreach($file in @($before.source)+@($before.testFiles)){
  if((Get-FileHash -LiteralPath $file.path).Hash.ToLowerInvariant() -cne $file.workingSha256){throw "Source changed at $($file.path)"}
  if((git rev-parse ('HEAD:'+$file.path)).Trim() -cne $file.gitBlob){throw "Commit blob changed at $($file.path)"}
 }
 return [ordered]@{head=$ids[0];tree=$ids[1];actualMain=$ids[2];indexSha256=$index;status=$status;source=$before.source;testFiles=$before.testFiles}
}
Push-Location -LiteralPath $Checkout
try {
 $runtime=(node --version).Trim()
 if($runtime -cne 'v22.23.4'){throw 'Exact Node required'}
 [void](Confirm-Git)
 $checks=@()
 foreach($gate in @('types','eslint','format')){
  $argsToUse=@($commands[$gate])
  $stem=if($gate -eq 'format'){'format-first'}else{$gate+'-exit-readback'}
  $log=Join-Path $Output ($stem+'.log')
  if(Test-Path -LiteralPath $log){throw 'Preserve first and recovery logs'}
  [IO.File]::WriteAllBytes($log,[byte[]]@())
  $start=[DateTime]::UtcNow.ToString('o')
  pnpm.cmd @argsToUse 2>&1 | Tee-Object -FilePath $log
  $code=$LASTEXITCODE
  $reply=[ordered]@{gate=$gate;file=$stem+'.log';exit=$code;started=$start;finished=[DateTime]::UtcNow.ToString('o');sha256=(Get-FileHash -LiteralPath $log).Hash.ToLowerInvariant()}
  $reply|ConvertTo-Json -Depth 5|Set-Content -Encoding utf8NoBOM -LiteralPath (Join-Path $Output ($stem+'.json'))
  $checks+=$reply
 }
 Confirm-Git | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8NoBOM -LiteralPath (Join-Path $Output 'source-after.json')
 $log=Get-Content -Raw -LiteralPath (Join-Path $Output 'focused-first.log')
 if($log -notmatch 'Test Files\s+13 passed \(13\)' -or $log -notmatch 'Tests\s+224 passed \(224\)'){throw 'First Vitest counts differ'}
 [ordered]@{runtime=$runtime;head=$before.head;tree=$before.tree;actualMain=$before.actualMain;stableSourceAndIndex=$true;
   focusedFirstResult=[ordered]@{filesPassed=13;testsPassed=224;logSha256=(Get-FileHash -LiteralPath (Join-Path $Output 'focused-first.log')).Hash.ToLowerInvariant();rerun=$false};
   staticChecks=$checks;originalWrapperError='eslint-first.log missing on silent command; first tests and type log retained'} |
   ConvertTo-Json -Depth 7 | Set-Content -Encoding utf8NoBOM -LiteralPath (Join-Path $Output 'results.json')
 if($checks|Where-Object {$_.exit -ne 0}){exit 2}
} finally { Pop-Location }
