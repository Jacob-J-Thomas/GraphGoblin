$ErrorActionPreference = 'Stop'
$packetRoot = [System.IO.Path]::GetFullPath('G:/ggq/delivery-evidence/2026-11-17-five-intents/i4-553-browser-reproduction-01')
$taskRoot = [System.IO.Path]::GetFullPath('G:/ggq/gg-i4-553-browser-diagnostic/GraphGoblin')
$knownIds = [System.Collections.Generic.HashSet[int]]::new()
Get-ChildItem -LiteralPath $packetRoot -Filter '*-started.json' | ForEach-Object {
  $started = Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json
  $null = $knownIds.Add([int]$started.pid)
}
foreach ($name in @('isolated.log','sequence.log')) {
  foreach ($line in (Get-Content -LiteralPath (Join-Path $packetRoot $name))) {
    if ($line.StartsWith('__GG_PWA_SERVER_PID__')) {
      $identity = $line.Substring('__GG_PWA_SERVER_PID__'.Length) | ConvertFrom-Json
      $null = $knownIds.Add([int]$identity.pid)
      $null = $knownIds.Add([int]$identity.parentPid)
    }
  }
}
foreach ($attempt in @('isolated','sequence')) {
  foreach ($line in (Get-Content -LiteralPath (Join-Path $packetRoot "attempts/$attempt/events.jsonl"))) {
    $record = $line | ConvertFrom-Json
    $null = $knownIds.Add([int]$record.nodePid)
  }
}
if (Test-Path -LiteralPath (Join-Path $packetRoot 'task-processes-during-sequence.json')) {
  $observed = @(Get-Content -LiteralPath (Join-Path $packetRoot 'task-processes-during-sequence.json') -Raw | ConvertFrom-Json)
  foreach ($process in $observed) { $null = $knownIds.Add([int]$process.ProcessId) }
}
$allProcesses = @(Get-CimInstance Win32_Process)
$activeKnown = @($allProcesses | Where-Object { $knownIds.Contains([int]$_.ProcessId) } | Select-Object ProcessId,ParentProcessId,Name,CreationDate)
$taskMatches = @($allProcesses | Where-Object {
  $_.Name -in @('node.exe','msedge.exe','cmd.exe','python.exe','esbuild.exe') -and $_.CommandLine -and
  ($_.CommandLine.Contains('gg-i4-553-browser-diagnostic') -or $_.CommandLine.Contains('i4-553-browser-reproduction-01'))
} | Select-Object ProcessId,ParentProcessId,Name,CreationDate,CommandLine)
$listeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $knownIds.Contains([int]$_.OwningProcess) } | Select-Object LocalAddress,LocalPort,OwningProcess)
$scratchBefore = @(Get-ChildItem -LiteralPath (Join-Path $packetRoot 'temp') -Force | Select-Object Name,Mode)
$apiScratch = @(Get-ChildItem -LiteralPath (Join-Path $packetRoot 'temp') -Directory -Filter 'gg-api-*' | Select-Object FullName)
if ($activeKnown.Count -or $taskMatches.Count -or $listeners.Count) {
  [pscustomobject]@{ActiveKnown=$activeKnown;TaskMatches=$taskMatches;Listeners=$listeners} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $packetRoot 'cleanup-blocked.json') -Encoding utf8
  throw 'Task processes/listeners remain; no deletion or broad kill performed.'
}
$removed = @()
foreach ($leaf in @('cache','temp')) {
  $absolute = [System.IO.Path]::GetFullPath((Join-Path $packetRoot $leaf))
  if (-not $absolute.StartsWith($packetRoot + [System.IO.Path]::DirectorySeparatorChar,[System.StringComparison]::OrdinalIgnoreCase)) { throw "Out-of-packet cleanup target: $absolute" }
  if (Test-Path -LiteralPath $absolute) { Remove-Item -LiteralPath $absolute -Recurse -Force; $removed += $absolute }
}
$record = [pscustomobject]@{
  UTC = [DateTime]::UtcNow.ToString('o')
  KnownTaskPids = @($knownIds | Sort-Object)
  ActiveKnownPids = $activeKnown
  ExactTaskCommandLineMatches = $taskMatches
  KnownTaskListeners = $listeners
  SurvivingApiScratchBeforeCleanup = $apiScratch
  TempEntriesBeforeCleanup = $scratchBefore
  DeletedOnly = $removed
  ForcedProcessTerminations = 0
  WorktreeRetained = $taskRoot
  Notes = 'Normal Playwright/global-setup teardown had already stopped task processes and removed gg-api scratch. Only this packet cache/temp were removed after path bounds and zero-PID/listener checks. No key revocation or reusable-store safety claim.'
}
$record | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $packetRoot 'cleanup.json') -Encoding utf8
$record | Select-Object UTC,ForcedProcessTerminations,@{Name='KnownPids';Expression={$_.KnownTaskPids.Count}},@{Name='ActiveKnown';Expression={$_.ActiveKnownPids.Count}},@{Name='Listeners';Expression={$_.KnownTaskListeners.Count}},@{Name='ApiScratchRemaining';Expression={$_.SurvivingApiScratchBeforeCleanup.Count}} | ConvertTo-Json
