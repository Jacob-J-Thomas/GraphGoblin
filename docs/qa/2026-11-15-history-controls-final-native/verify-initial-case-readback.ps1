param([Parameter(Mandatory=$true)][string]$Packet,[Parameter(Mandatory=$true)][string]$Group)
$ErrorActionPreference='Stop'
$dir=Join-Path $Packet ('runs/'+$Group+'-initial')
$receipt=Join-Path $Packet ('exit-'+$Group+'-initial.json')
$exit=Get-Content -Raw -LiteralPath $receipt|ConvertFrom-Json
$run=Get-Content -Raw -LiteralPath (Join-Path $dir 'run.json')|ConvertFrom-Json
$observed=Get-Content -Raw -LiteralPath (Join-Path $dir 'observed.json')|ConvertFrom-Json
$start=Get-Content -Raw -LiteralPath (Join-Path $dir 'gateway.json')|ConvertFrom-Json
$end=Get-Content -Raw -LiteralPath (Join-Path $dir 'gateway-closed.json')|ConvertFrom-Json
$ports=@(([uri]$run.origin).Port,([uri]$run.sinkOrigin).Port)
if($ports|Where-Object {$_ -in @(4747,4748)}){throw 'Unexpected reserved port'}
$cutoff=([datetime]$run.startedAt).ToUniversalTime().AddSeconds(-2)
$ids=@($run.orchestratorPid,$run.gatewayPid,$run.browserPid)|Where-Object {$_}
$live=@(Get-CimInstance Win32_Process|Where-Object {
 $_.CreationDate -and $_.CreationDate.ToUniversalTime() -ge $cutoff -and
 ($_.ProcessId -in $ids -or $_.ParentProcessId -in $ids -or
 ($_.CommandLine -like ('*'+$run.session+'*') -and $_.Name -match '^(node|msedge|chrome)\.exe$'))
}|Select-Object ProcessId,ParentProcessId,CreationDate,Name)
$listeners=@(Get-NetTCPConnection -State Listen | Where-Object LocalPort -in $ports|Select-Object LocalPort,LocalAddress,OwningProcess)
$binding=(Get-FileHash -LiteralPath (Join-Path $dir 'binding-before.json')).Hash.ToLowerInvariant()
$readonly=(Get-FileHash -LiteralPath (Join-Path $dir 'binding-readonly-before.json')).Hash.ToLowerInvariant()
$sameAssets=(($start.served|ConvertTo-Json -Compress) -ceq ($end.servedAfter|ConvertTo-Json -Compress))
$closed=$sameAssets -and !$end.listening -and ($run.gatewayPid -eq $start.pid) -and ($start.pid -eq $end.pid) -and
 ($run.browserClose -eq 0) -and ($run.gatewayExit.code -eq 0) -and $run.store.removed -and !(Test-Path -LiteralPath $end.scratch) -and
 !@($run.store.residualLockWalShm).Count -and !$live.Count -and !$listeners.Count
$pass=($exit.exit -eq 0) -and ($run.driverExit -eq 0) -and !$run.failure -and !$run.harnessError -and !$run.noStructuredResult -and !@($run.pageErrors).Count
if($run.scenario -cne $Group -or $run.head -cne '6b0eae62ea98ae73b22903c9922bba198e219608' -or
    $binding -cne '241e04ffe55ae4a9ab1af3586d61060039ca9e973fe19cd0d8c820885f275273' -or
    $readonly -cne '7cc5e70f4c96371fa0f9734594228d66368814ce4583276986912e5be5033f7b'){throw 'Frozen identity or binding differs'}
$record=[ordered]@{at=[DateTime]::UtcNow.ToString('o');group=$Group;pass=$pass;failure=$run.failure;harnessError=$run.harnessError;
    observedHead=$run.head;exit=$exit.exit;rawFiles=@($run.sunk).Count;summary=$observed.summary;browserClose=$run.browserClose;gatewayExit=$run.gatewayExit.code;
    actualPorts=$ports;active=$live;listeners=$listeners;storeRemoved=$run.store.removed;residue=$run.store.residualLockWalShm;
    sameServed=$sameAssets;binding=$binding;readOnlyBinding=$readonly;clean=$closed}
$path=Join-Path $dir 'independent-case-readback.json'
if(Test-Path -LiteralPath $path){throw 'Keep independent first readback'}
$record|ConvertTo-Json -Depth 9 | Set-Content -LiteralPath $path -Encoding utf8NoBOM
$record|ConvertTo-Json -Depth 9
if(!$pass -or !$closed){exit 2}
