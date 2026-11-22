# C5 cleanup check (read-only): recorded native fixture PIDs, any process whose command line names
# the QA fixture or binary copy, owner-port listeners (listing only) and listeners owned by recorded PIDs.
param([string]$PidFile)
$ids = (Get-Content -Raw $PidFile).Trim().Split(',') | ForEach-Object { [int]$_ }
$fixture = ('qa-' + 'cli.mjs')
$copy = ('claude-' + 'qa.exe')
$alive = Get-Process -Id $ids -ErrorAction SilentlyContinue | Select-Object Id, ProcessName, StartTime
$matching = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and ($_.CommandLine.Contains($fixture) -or $_.CommandLine.Contains($copy)) } | Select-Object ProcessId, Name
$owner = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in @(4747, 4748, 11434) } | Select-Object LocalAddress, LocalPort, OwningProcess
$recordedListeners = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $ids -contains $_.OwningProcess } | Select-Object LocalAddress, LocalPort, OwningProcess
[pscustomobject]@{
  utc = (Get-Date).ToUniversalTime().ToString('o')
  recordedPids = $ids.Count
  recordedPidsPresentNow = @($alive)
  fixtureCommandLineProcesses = @($matching)
  ownerPortListeners = @($owner)
  listenersOwnedByRecordedPids = @($recordedListeners)
} | ConvertTo-Json -Depth 4
