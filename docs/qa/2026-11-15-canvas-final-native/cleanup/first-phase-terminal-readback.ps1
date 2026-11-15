param([Parameter(Mandatory=$true)][string]$EvidenceRoot,[Parameter(Mandatory=$true)][string]$Checkout)
$ErrorActionPreference='Stop'
$env:GIT_OPTIONAL_LOCKS='0'
$root=[IO.Path]::GetFullPath((Resolve-Path -LiteralPath $EvidenceRoot).Path)
$batch=Join-Path $root 'runs/initial-clicks'
$overview=Get-Content -Raw -LiteralPath (Join-Path $batch 'overview.json') | ConvertFrom-Json
$runtime=Get-CimInstance Win32_Process
$gitIdentity=@(git -C $Checkout rev-parse HEAD 'HEAD^{tree}' origin/main)
$gitStatus=@(git -C $Checkout status --porcelain=v1)
$fixtures=@()
foreach($item in $overview.outcomes){
 $case=Join-Path $batch $item.scenario
 $runPath=Join-Path $case 'run.json'
 $run=Get-Content -LiteralPath $runPath -Raw | ConvertFrom-Json
 $ports=@()
 if($run.origin){$ports+=([uri]$run.origin).Port}
 if($run.ownedMousePort){$ports+=$run.ownedMousePort}
 if($ports|Where-Object {$_ -in @(4747,4748)}){throw 'Unexpected fixture owner-port collision'}
 $seen=[Collections.Generic.HashSet[int]]::new()
 foreach($n in @($run.orchestratorPid,$run.gatewayPid,$run.browserPid,$run.browserOpen.pid,$run.browserRun.pid,$run.browserClose.pid)){
  if($n){[void]$seen.Add([int]$n)}
 }
 $nativeReceipts=@()
 foreach($phase in @('move','double')){
  $path=Join-Path $case ('owned-mouse-'+$phase+'.json')
  if(Test-Path -LiteralPath $path){
   $receipt=Get-Content -Raw -LiteralPath $path | ConvertFrom-Json
   [void]$seen.Add([int]$receipt.operation.pid)
   $nativeReceipts+=$path
  }
 }
 $threshold=([datetime]$run.startedAt).ToUniversalTime().AddSeconds(-2)
 $roots=@($runtime|Where-Object {$_.CreationDate -and $_.CreationDate.ToUniversalTime() -ge $threshold})
 $matches=[Collections.Generic.HashSet[int]]::new()
 do {
  $added=0
  foreach($proc in $roots){
   $line=[string]$proc.CommandLine
   if($seen.Contains($proc.ProcessId) -or $seen.Contains($proc.ParentProcessId) -or
       ($run.session -and $line.Contains($run.session)) -or $line.Contains($case)){
    if($matches.Add($proc.ProcessId)){$added++}
    [void]$seen.Add($proc.ProcessId)
   }
  }
 } while($added)
 $active=@($roots|Where-Object {$matches.Contains($_.ProcessId)}|ForEach-Object {
  [ordered]@{pid=$_.ProcessId;ppid=$_.ParentProcessId;exe=$_.ExecutablePath;started=$_.CreationDate.ToUniversalTime().ToString('o')}
 })
 $listeners=@(foreach($port in $ports){Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue|Select-Object LocalAddress,LocalPort,OwningProcess})
 $scratch=$run.gatewayCleanup.scratch
 $residual=@()
 if($scratch){
  $store=[IO.Path]::GetFullPath((Resolve-Path -LiteralPath $scratch).Path)
  if(!$store.StartsWith([IO.Path]::GetFullPath($case)+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Store outside disposable fixture'}
  $residual=@(Get-ChildItem -LiteralPath $store -Force -File|Where-Object {$_.Name -match '(?:\.lock|\.reclaim|-wal|-shm)$'}|Select-Object -ExpandProperty Name)
 }
 $fixtures+=[ordered]@{scenario=$run.scenario;result=$run.result;runPath=$runPath;session=$run.session;pids=@($seen|Sort-Object);active=$active;ports=$ports;listeners=$listeners;store=$scratch;residual=$residual;browserClose=$run.browserClose.code;gatewayExit=$run.gatewayExit.code;coordinatorClosed=$run.ownedMousePortClosed;nativeReceipts=$nativeReceipts}
}
$before=(Get-FileHash -LiteralPath (Join-Path $root 'binding-before.json')).Hash.ToLowerInvariant()
$after=(Get-FileHash -LiteralPath (Join-Path $batch 'binding-after.json')).Hash.ToLowerInvariant()
$allClean=!($fixtures|Where-Object {$_.active.Count -or $_.listeners.Count -or $_.residual.Count -or $_.browserClose -ne 0 -or $_.gatewayExit -ne 0 -or $_.coordinatorClosed -eq $false})
$record=[ordered]@{checkedUtc=[datetime]::UtcNow.ToString('o');gitIdentity=$gitIdentity;gitStatus=$gitStatus;bindingBefore=$before;bindingAfter=$after;allClosed=$allClean;fixtures=$fixtures}
$path=Join-Path $root 'first-phase-terminal-cleanup.json'
if(Test-Path -LiteralPath $path){throw 'Preserve original terminal proof'}
$record|ConvertTo-Json -Depth 12|Set-Content -LiteralPath $path -Encoding utf8NoBOM
$record | ConvertTo-Json -Depth 12
if(!$allClean -or $gitStatus.Count -or $before -cne $after){exit 2}
