$ErrorActionPreference='Stop'
$knownPids=@()
$records=@()
foreach($name in @('served-lifecycle.json','merge-lifecycle.json','background-lifecycle.json')){
 $p=Join-Path $PSScriptRoot $name
 if(Test-Path -LiteralPath $p){$life=Get-Content -LiteralPath $p -Raw|ConvertFrom-Json;foreach($e in $life.exits){$knownPids+=$e.pid;$alive=Get-Process -Id $e.pid -ErrorAction SilentlyContinue;$records+=@{source=$name;pid=$e.pid;exitObserved=$e.exitObserved;pidPresentAtCloseout=($null -ne $alive);exitCode=$e.exitCode;signalCode=$e.signalCode}}}
}
$edgeProcess=Join-Path $PSScriptRoot 'edge-process.json'
if(Test-Path -LiteralPath $edgeProcess){$e=Get-Content -LiteralPath $edgeProcess -Raw|ConvertFrom-Json;$knownPids+=$e.pid;$alive=Get-Process -Id $e.pid -ErrorAction SilentlyContinue;$records+=@{source='edge-process.json';pid=$e.pid;exitObserved=$e.exitObserved;pidPresentAtCloseout=($null -ne $alive);exitCode=$e.exitCode;signalCode=$e.signalCode}}
$stores=@(Get-ChildItem -LiteralPath $env:TEMP -Directory -Filter 'gg-qa-f2b-r5-*'|ForEach-Object{
 $qaFull=[IO.Path]::GetFullPath($_.FullName)
 $qaBase=[IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')+'\'
 if(-not $qaFull.StartsWith($qaBase,[StringComparison]::OrdinalIgnoreCase) -or -not $_.Name.StartsWith('gg-qa-f2b-r5-')){throw 'Unexpected cleanup inventory path'}
 $files=@(Get-ChildItem -LiteralPath $qaFull -File -Recurse)
 @{directory=('%TEMP%/'+$_.Name);bytes=($files|Measure-Object Length -Sum).Sum;files=$files.Count;action='Retained for orchestrator removal; QA-COMMON prohibits Codex directory deletion'}
})
$result=@{checkedUtc=[DateTimeOffset]::UtcNow.ToString('o');processes=$records;directories=$stores;allRecordedPidsAbsent=(@($records|Where-Object pidPresentAtCloseout).Count -eq 0);note='Read-only inventory. No directory deletion or process termination performed. Existing round-4 stores excluded.'}
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'cleanup-manifest.json'),($result|ConvertTo-Json -Depth 10)+[Environment]::NewLine)
Write-Output ('Inventoried '+$stores.Count+' retained directories; API/E2E process presence recorded.')