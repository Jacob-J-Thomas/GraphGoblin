param([Parameter(Mandatory=$true)][int]$TaskRootPid,[Parameter(Mandatory=$true)][string]$EvidenceBase)
$ErrorActionPreference='Stop'
$observations=[System.Collections.Generic.List[object]]::new()
$seenPorts=[System.Collections.Generic.HashSet[int]]::new()
$seenPids=[System.Collections.Generic.HashSet[int]]::new()
$watch=[Diagnostics.Stopwatch]::StartNew()
while ($watch.Elapsed.TotalSeconds -lt 90) {
  $all=@(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name,ExecutablePath)
  $owned=[System.Collections.Generic.HashSet[int]]::new()
  [void]$owned.Add($TaskRootPid)
  $changed=$true
  while ($changed) { $changed=$false; foreach($proc in $all) { if($owned.Contains([int]$proc.ParentProcessId) -and $owned.Add([int]$proc.ProcessId)) { $changed=$true } } }
  foreach($taskPid in $owned){[void]$seenPids.Add($taskPid)}
  $active=@($all | Where-Object {$owned.Contains([int]$_.ProcessId)})
  $listens=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object {$owned.Contains([int]$_.OwningProcess)} | Select-Object LocalAddress,LocalPort,OwningProcess)
  foreach($conn in $listens){[void]$seenPorts.Add([int]$conn.LocalPort)}
  $observations.Add([pscustomobject]@{utc=[DateTime]::UtcNow.ToString('o');ownedProcesses=@($active|Select-Object ProcessId,ParentProcessId,Name,ExecutablePath);listening=$listens})
  if (-not ($all | Where-Object {$_.ProcessId -eq $TaskRootPid})) { break }
  Start-Sleep -Milliseconds 750
}
$remaining=@(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name,ExecutablePath | Where-Object {$seenPids.Contains([int]$_.ProcessId)} | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath)
$bound=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object {$seenPorts.Contains([int]$_.LocalPort)} | Select-Object LocalAddress,LocalPort,OwningProcess)
[pscustomobject]@{state='PASSIVE_OWNED_BROWSER_PROCESS_AND_PORT_OBSERVATION';rootPid=$TaskRootPid;observations=$observations;observedPids=@($seenPids);observedPorts=@($seenPorts);remainingObservedProcesses=$remaining;observedPortsStillBound=$bound;processesKilledByObserver=0;ownerProcessesControlled=0;limit='Snapshots may miss short-lived descendants or ports. Only descendants of the admitted command were retained.'} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath ($EvidenceBase+'.owned-processes-and-ports.json') -Encoding utf8
