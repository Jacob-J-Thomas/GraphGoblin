$ErrorActionPreference='Stop'
$packet=$PSScriptRoot
$pwsh=(Get-Process -Id $PID).Path
function Connections { @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,OwningProcess) }
$beforeListeners=Connections
$ownerBefore=@($beforeListeners | Where-Object LocalPort -In @(4747,4748))
$boot=[DateTime]::UtcNow
$test=Start-Process -FilePath $pwsh -ArgumentList @('-NoProfile','-File',(Join-Path $packet 'run-playwright.ps1')) -WorkingDirectory (Get-Location).Path -WindowStyle Hidden -PassThru
$owned=@{}
$listeners=@{}
$frames=0
function Observe {
  $script:frames++
  $processes=@(Get-CimInstance Win32_Process | Where-Object { $_.CreationDate -and $_.CreationDate.ToUniversalTime() -ge $boot.AddSeconds(-1) })
  $expanded=$true
  while($expanded) {
    $expanded=$false
    foreach($process in $processes) {
      $processId=[int]$process.ProcessId
      $parentId=[int]$process.ParentProcessId
      if ($processId -ne $test.Id -and !$owned.ContainsKey($parentId)) { continue }
      $born=$process.CreationDate.ToUniversalTime().ToString('o')
      if ($owned.ContainsKey($processId)) { continue }
      $cmd=$process.CommandLine
      $role=if($processId -eq $test.Id){'wrapper'}elseif($cmd -match 'e2e[\\/]+server\.ts'){'e2e-server'}elseif($process.Name -eq 'msedge.exe'){'edge'}else{'descendant'}
      $owned[$processId]=[ordered]@{pid=$processId;parentPid=$parentId;born=$born;name=$process.Name;role=$role}
      $expanded=$true
    }
  }
  $live=@($processes | Where-Object {
    $owned.ContainsKey([int]$_.ProcessId) -and $owned[[int]$_.ProcessId].born -eq $_.CreationDate.ToUniversalTime().ToString('o')
  })
  foreach($row in (Connections | Where-Object { $_.OwningProcess -in $live.ProcessId })) {
    $key="$($row.LocalAddress):$($row.LocalPort)/$($row.OwningProcess)"
    $listeners[$key]=[ordered]@{address=$row.LocalAddress;port=$row.LocalPort;pid=$row.OwningProcess;role=$owned[[int]$row.OwningProcess].role}
  }
}
while(!$test.HasExited) { Observe; Start-Sleep -Milliseconds 350; $test.Refresh() }
$test.WaitForExit()
for($n=0;$n -lt 3;$n++) { Observe; Start-Sleep -Milliseconds 350 }
$finalProcesses=@(Get-CimInstance Win32_Process)
$remaining=@($finalProcesses | Where-Object {
  $_.CreationDate -and $owned.ContainsKey([int]$_.ProcessId) -and $owned[[int]$_.ProcessId].born -eq $_.CreationDate.ToUniversalTime().ToString('o')
} | Select-Object ProcessId,ParentProcessId,Name,CreationDate)
$after=Connections
$byPid=@($after | Where-Object OwningProcess -In $remaining.ProcessId)
$byPort=@($after | Where-Object LocalPort -In @($listeners.Values.port))
$ownerAfter=@($after | Where-Object LocalPort -In @(4747,4748))
$tempRoot=Join-Path $packet 't'
$temp=@(Get-ChildItem -LiteralPath $tempRoot -Force | Select-Object Name,Mode)
$leftovers=@(Get-ChildItem -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue | Where-Object {
  $_.Name -like 'gg-affected-e2e-*' -or $_.Name -like 'playwright*profile*' -or $_.Name -match '(\.db|\.sqlite3?|-wal|-shm|\.lock|master\.key)$'
} | Select-Object -ExpandProperty FullName)
[ordered]@{startedAt=$boot.ToString('o');finishedAt=[DateTime]::UtcNow.ToString('o');wrapperPid=$test.Id;exitCode=$test.ExitCode;
 processSamples=$frames;observedProcesses=@($owned.Values);observedListeners=@($listeners.Values);
 remainingOwned=$remaining;remainingOwnedListeners=$byPid;observedPortsListeningAfter=$byPort;ownerPortsBefore=$ownerBefore;ownerPortsAfter=$ownerAfter;
 tempRoot=$tempRoot;tempEntries=$temp;runtimeLeftovers=$leftovers} |
 ConvertTo-Json -Depth 7 | Set-Content -Encoding utf8NoBOM -LiteralPath (Join-Path $packet 'cleanup.json')
exit $test.ExitCode
