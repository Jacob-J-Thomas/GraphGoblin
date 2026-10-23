$ErrorActionPreference='Continue'
$env:PATH="$env:APPDATA\nvm\v22.14.0;$env:PATH"
$qaEvidence=Join-Path (Get-Location) 'docs/qa/2026-10-22-wp-g2-qa'
$qaRoot=Join-Path ([System.IO.Path]::GetTempPath()) 'gg-qa-231-9896cf-independent'
$env:TEMP=Join-Path $qaRoot 'tests'
$env:TMP=$env:TEMP
$env:LIVE='0'
$qaCases=Get-Content (Join-Path $qaEvidence 'triage-cases.json') -Raw | ConvertFrom-Json
$qaIndex=0
foreach($qaCase in $qaCases) {
 $qaIndex++
 $qaCaseTitle=($qaCase.name -split ' > ')[-1]; $qaTokens=[regex]::Matches($qaCaseTitle,'[A-Za-z0-9_]+') | ForEach-Object { [regex]::Escape($_.Value) }; $qaName=$qaTokens -join '.*'
 $qaLog=Join-Path $qaEvidence ("triage-"+$qaIndex.ToString('00')+".txt")
 @("PACKAGE: $($qaCase.package)","FILE: $($qaCase.file)","TEST: $($qaCase.name)","COMMAND: pnpm.cmd --filter @graphgoblin/$($qaCase.package) exec vitest run $($qaCase.file) --maxWorkers=1 --reporter=verbose -t <escaped exact full name>") | Set-Content $qaLog
 "FILTER_REGEX: $qaName" | Add-Content $qaLog
 $qaBuffer = & pnpm.cmd --filter "@graphgoblin/$($qaCase.package)" exec vitest run $qaCase.file --maxWorkers=1 --reporter=verbose -t $qaName 2>&1
 $qaCode=$LASTEXITCODE
 $qaBuffer | ForEach-Object { ([string]$_).Replace((Get-Location).Path,'<worktree>').Replace($env:USERPROFILE,'<user>') -replace '\x1B\[[0-?]*[ -/]*[@-~]','' } | Add-Content $qaLog
 "EXIT: $qaCode" | Add-Content $qaLog
 Write-Output "triage $qaIndex $($qaCase.package) exit=$qaCode"
}



