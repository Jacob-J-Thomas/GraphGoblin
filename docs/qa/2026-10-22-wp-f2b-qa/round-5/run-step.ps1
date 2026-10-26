param([Parameter(Mandatory=$true)][ValidateSet('build','served','merge','background','web-tests','api-tests','edge','typecheck','lint','format','format-r5','format-evidence','layers','deps','tokens')][string]$Step)
$ErrorActionPreference='Continue'
$repoRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../..'))
Set-Location -LiteralPath $repoRoot
$env:PATH="$env:APPDATA\nvm\v22.14.0;$env:PATH"
$nodeVersion=(& node --version)
if($nodeVersion -notmatch '^v22\.'){throw 'Node 22 required'}
$head=(& git rev-parse HEAD).Trim()
if($head -ne '86e96bbc7f99a65cbf26d6feb7fb9fc0b2f61f60'){throw 'HEAD mismatch'}
$env:QA_OUTPUT_DIR=$PSScriptRoot
$env:QA_ONLY=$null
switch($Step){
 'build' {$exe='pnpm.cmd';$a=@('build','--concurrency=1')}
 'served' {$exe='node';$a=@((Join-Path $PSScriptRoot 'observed-served-checks.mjs'));$env:QA_PORT='5860';$env:QA_TEMP_PREFIX='gg-qa-f2b-r5-served-'}
 'merge' {$exe='node';$a=@((Join-Path $PSScriptRoot 'merge-ui.mjs'));$env:QA_PORT='5861';$env:QA_TEMP_PREFIX='gg-qa-f2b-r5-ui-'}
 'background' {$exe='node';$a=@((Join-Path $PSScriptRoot 'background-ui.mjs'));$env:QA_PORT='5862';$env:QA_TEMP_PREFIX='gg-qa-f2b-r5-background-';$env:QA_ONLY='background-recheck-1440,background-recheck-390'}
 'web-tests' {$exe='pnpm.cmd';$a=@('--filter','@graphgoblin/web','test','src/editor/harness-switch.test.tsx','src/forms/fields/harness-switch.test.tsx','src/editor/ClaudePolicyField.test.tsx','src/forms/fields/model.test.tsx','src/editor/model-pickers.test.tsx','--maxWorkers=1')}
 'api-tests' {$exe='pnpm.cmd';$a=@('--filter','@graphgoblin/api','test','src/harness-switch.test.ts','src/model-readiness.test.ts','src/nested-readiness.test.ts','src/readiness-evidence.test.ts','--maxWorkers=1')}
 'edge' {$exe='pnpm.cmd';$a=@('--filter','@graphgoblin/web','exec','playwright','test','--config', (Join-Path $PSScriptRoot 'edge.config.ts'),'model-picker.spec.ts');$env:GG_E2E_BROWSER_CHANNEL='msedge';$env:CI=$null}
 'typecheck' {$exe='pnpm.cmd';$a=@('typecheck','--concurrency=1')}
 'lint' {$exe='pnpm.cmd';$a=@('lint','--concurrency=1')}
 'format-evidence' {$exe='pnpm.cmd';$a=@('exec','prettier','--write','docs/qa/2026-10-22-wp-f2b-qa/round-5')}
 'format-r5' {$exe='pnpm.cmd';$a=@('exec','prettier','--check','docs/qa/2026-10-22-wp-f2b-qa/round-5')}
 'format' {$exe='pnpm.cmd';$a=@('format:check')}
 'layers' {$exe='pnpm.cmd';$a=@('check:layers')}
 'deps' {$exe='pnpm.cmd';$a=@('check:deps')}
 'tokens' {$exe='pnpm.cmd';$a=@('check:tokens')}
}
$logFile=Join-Path $PSScriptRoot ($Step+'.log.txt')
$started=[DateTimeOffset]::UtcNow
& $exe @a *> $logFile
$exitCode=$LASTEXITCODE
$ended=[DateTimeOffset]::UtcNow
$s=Get-Content -LiteralPath $logFile -Raw
$s=$s.Replace($repoRoot,'<repo>').Replace($repoRoot.Replace('\','/'),'<repo>').Replace($env:TEMP,'<temp>')
$s=[regex]::Replace($s,'(?i)C:[\\/]Users[\\/][^\\/\s]+','<user>')
$s=[regex]::Replace($s,'(?i)[\\/]Users[\\/][^\\/\s]+','<user>')
[IO.File]::WriteAllText($logFile,$s)
$record=[ordered]@{step=$Step;head=$head;node=$nodeVersion;command=($exe+' '+(($a|ForEach-Object{$_.Replace($repoRoot,'<repo>')}) -join ' '));startedUtc=$started.ToString('o');endedUtc=$ended.ToString('o');durationSeconds=($ended-$started).TotalSeconds;exitCode=$exitCode;port=$env:QA_PORT;retries=0;log=($Step+'.log.txt')}
[IO.File]::WriteAllText((Join-Path $PSScriptRoot ($Step+'-command.json')),(ConvertTo-Json -InputObject $record -Depth 12)+[Environment]::NewLine)
$record|ConvertTo-Json -Compress
Get-Content -LiteralPath $logFile -Tail 8
exit $exitCode