param([Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference = 'Stop'
$packet = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
if (Test-Path -LiteralPath $Output) { throw 'Preserve the first cleanup audit' }
$binding = (Get-FileHash -LiteralPath (Join-Path $packet 'binding/binding-before.json')).Hash
$records = @(Get-ChildItem -LiteralPath (Join-Path $packet 'runs') -Directory | ForEach-Object {
  $fixture = $_.FullName
  $run = Get-Content -Raw -LiteralPath (Join-Path $fixture 'run.json') | ConvertFrom-Json
  $opened = Get-Content -Raw -LiteralPath (Join-Path $fixture 'gateway.json') | ConvertFrom-Json
  $closed = Get-Content -Raw -LiteralPath (Join-Path $fixture 'gateway-closed.json') | ConvertFrom-Json
  $scratch = [IO.Path]::GetFullPath($closed.scratch)
  if (!$scratch.StartsWith($fixture + '\',[StringComparison]::OrdinalIgnoreCase)) {
    throw "Gateway store escaped its fixture: $scratch"
  }
  $sameBinding = $binding -eq (Get-FileHash -LiteralPath (Join-Path $fixture 'binding-before.json')).Hash
  $beforeAssets = $opened.served | ConvertTo-Json -Compress
  $afterAssets = $closed.servedAfter | ConvertTo-Json -Compress
  $sameServedBytes = $beforeAssets -ceq $afterAssets
  $ports = @(([uri]$run.origin).Port, ([uri]$run.sinkOrigin).Port)
  $clean = $sameBinding -and $sameServedBytes -and !$closed.listening -and $opened.pid -eq $closed.pid -and
    $run.gatewayPid -eq $opened.pid -and $run.gatewayExit.code -eq 0 -and $run.browserClose -eq 0 -and
    $run.store.removed -and !(Test-Path -LiteralPath $scratch) -and @($run.store.residualLockWalShm).Count -eq 0 -and
    !($ports -contains 4747 -or $ports -contains 4748)
  [pscustomobject]@{ label = $run.label; startedAt = $run.startedAt; finishedAt = $run.finishedAt;
    pids = @($run.orchestratorPid,$run.gatewayPid,$run.browserPid) | Where-Object { $_ };
    ports = $ports; scratch = $scratch; resourceClean = [bool]$clean; outcome = $run.failure;
    browserClose = $run.browserClose; gatewayExit = $run.gatewayExit.code }
})
if (!$records.Count) { throw 'No recorded native groups' }
$ports = $records.ports | Sort-Object -Unique
$ids = $records.pids | Sort-Object -Unique
$live = @(Get-CimInstance Win32_Process)
$reused = @($live | Where-Object ProcessId -In $ids | ForEach-Object {
  $current = $_
  $matches = @($records | Where-Object { $_.pids -contains $current.ProcessId })
  $late = @($matches | Where-Object {
    $current.CreationDate.ToUniversalTime() -le [DateTimeOffset]::Parse($_.finishedAt).UtcDateTime
  }).Count -eq 0
  [pscustomobject]@{ pid = $current.ProcessId; name = $current.Name; born = $current.CreationDate.ToUniversalTime();
    recordedFor = @($matches.label); afterAllRecordingRuns = $late; thisAudit = $current.ProcessId -eq $PID }
})
$ownedLive = @($live | Where-Object {
  $_.ProcessId -ne $PID -and $_.Name -match '^(node|msedge|chrome)\.exe$' -and
  ($_.CommandLine -like '*gg208f-*' -or $_.CommandLine -like ('*' + $packet + '\runs\*'))
} | Select-Object ProcessId, ParentProcessId, Name, CreationDate)
$listeners = @(Get-NetTCPConnection -State Listen | Where-Object LocalPort -In $ports |
  Select-Object LocalAddress, LocalPort, OwningProcess)
$leftovers = @(Get-ChildItem -LiteralPath (Join-Path $packet 'runs') -Recurse -Force | Where-Object {
  ($_.PSIsContainer -and $_.Name -like 'gateway-store-*') -or
  (!$_.PSIsContainer -and $_.Name -match '(?i)(\.db|\.sqlite3?|-wal|-shm|\.lock(?:\..+)?|master\.key)$')
} | Select-Object -ExpandProperty FullName)
$bad = @($records | Where-Object { !$_.resourceClean })
$unexpectedIds = @($reused | Where-Object { !$_.afterAllRecordingRuns -and !$_.thisAudit })
$report = [ordered]@{ checkedAt = [DateTime]::UtcNow.ToString('o'); bindingSha256 = $binding; recorded = $records;
  ownedLive = $ownedLive; listeners = $listeners; leftoverStoresOrSqlite = $leftovers;
  pidReadback = $reused; unqualifiedPidMatches = $unexpectedIds; resourceFailures = $bad }
$report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $Output -Encoding utf8NoBOM
"runs=$($records.Count) resourceFailures=$($bad.Count) ownedLive=$($ownedLive.Count) listeners=$($listeners.Count) leftFiles=$($leftovers.Count) uncheckedPidOwnership=$($unexpectedIds.Count)"
if ($bad.Count -or $ownedLive.Count -or $listeners.Count -or $leftovers.Count -or $unexpectedIds.Count) { exit 2 }
