# One continuation for the sealed old-attempt-1 cleanup receipt. No product process or database client.
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath 'C:\Users\98jak\graphgoblin-qa\2026-11-13-aidlc-batch\runtime-361-native').Path
$fixture = Join-Path $root 'old-attempt-1'
$store = Join-Path $fixture 'disposable-store'
$receipt = Join-Path $fixture 'cleanup-continuation.json'
if (Test-Path -LiteralPath $receipt) { throw 'Preserve the first continuation receipt' }
$resultPath = Join-Path $fixture 'result.json'
$originalPath = Join-Path $fixture 'cleanup.json'
$resultHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $resultPath).Hash.ToLowerInvariant()
$originalHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $originalPath).Hash.ToLowerInvariant()
if ($resultHash -cne 'c526423fadfd4bd571c4a82751322d79bd5a287795f9f84940f56825bbaf40a9' -or
    $originalHash -cne '532ddfb8d709ed489398cd0d6a1ce40a230a37598fd9ad82170b4348d55dfb9c') {
  throw 'Unexpected first execution or cleanup bytes'
}
$result = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json
$original = Get-Content -LiteralPath $originalPath -Raw | ConvertFrom-Json
$record = [ordered]@{
  attempt = 'old-attempt-1'
  observedAt = [DateTime]::UtcNow.ToString('o')
  firstResultSha256 = $resultHash
  firstCleanupSha256 = $originalHash
  firstCleanupExitObserved = 1
  firstCleanupReason = 'The first cleanup refused to remove the store while SQLite WAL and SHM sidecars remained.'
  firstCleanupSidecars = @($original.remainingRuntimeFilesBeforeRemoval)
  approvedPath = $store
  exclusiveOpen = @()
  error = $null
}
function Confirm-SafePath {
  foreach ($path in @($root, $fixture, $store)) {
    $resolved = (Resolve-Path -LiteralPath $path).Path
    if ($path -cne $resolved) { throw 'A fixture directory resolved to an unexpected path' }
    if ((Get-Item -LiteralPath $path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
      throw 'A fixture directory is a reparse point'
    }
  }
  if ((Split-Path -Parent $store) -cne $fixture -or (Split-Path -Parent $fixture) -cne $root) {
    throw 'The exact disposable store is not nested under the fixture root'
  }
}
function Read-Ownership {
  $processIds = @($result.processPid) + @($result.gatewayProcesses | ForEach-Object { $_.pid })
  $ports = @($result.sourcePort) + @($result.gatewayProcesses | ForEach-Object { $_.port })
  if (($ports -contains 4747) -or ($ports -contains 4748) -or $ports.Count -ne 3 -or $processIds.Count -ne 3) {
    throw 'Unexpected native scope in first receipt'
  }
  $owned = @(foreach ($pidValue in $processIds) {
    Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $([int]$pidValue)" | Select-Object -ExpandProperty ProcessId
  })
  $listeners = @(Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in $ports } |
    Select-Object LocalAddress, LocalPort, OwningProcess)
  return [ordered]@{checkedPids = $processIds; checkedPorts = $ports; presentPids = $owned; listeners = $listeners}
}
try {
  Confirm-SafePath
  $record.beforeOwnership = Read-Ownership
  if ($record.beforeOwnership.presentPids.Count -or $record.beforeOwnership.listeners.Count) {
    throw 'An owned process identifier or listener is live'
  }
  $contents = @(Get-ChildItem -LiteralPath $store -Recurse -Force)
  $reparse = @($contents | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint })
  if ($reparse.Count) { throw 'A store entry is a reparse point' }
  $record.filesBeforeRemoval = @($contents | Where-Object { !$_.PSIsContainer } | ForEach-Object {
    [ordered]@{relativePath = $_.FullName.Substring($store.Length + 1); bytes = $_.Length}
  })
  $handles = [System.Collections.Generic.List[System.IO.FileStream]]::new()
  try {
    foreach ($name in @('poll.sqlite','poll.sqlite-wal','poll.sqlite-shm')) {
      $path = Join-Path $store $name
      if ((Resolve-Path -LiteralPath $path).Path -cne $path) { throw 'Unexpected resolved SQLite path' }
      $handle = [IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)
      $handles.Add($handle)
      $record.exclusiveOpen += [ordered]@{relativePath = $name; acquired = $true}
    }
    if ($handles.Count -ne 3) { throw 'Could not exclusively open all three SQLite files' }
    $record.allThreeHeldAtOnce = $true
  } finally {
    foreach ($handle in $handles) { $handle.Dispose() }
  }
  Confirm-SafePath
  $record.immediateOwnership = Read-Ownership
  if ($record.immediateOwnership.presentPids.Count -or $record.immediateOwnership.listeners.Count) {
    throw 'Ownership changed before removal'
  }
  Remove-Item -LiteralPath $store -Recurse -Force
  $record.storeRemoved = !(Test-Path -LiteralPath $store)
  $record.afterOwnership = Read-Ownership
  if (!$record.storeRemoved -or $record.afterOwnership.presentPids.Count -or $record.afterOwnership.listeners.Count) {
    throw 'The final cleanup observed a remaining store, PID or listener'
  }
} catch {
  $record.error = $_.Exception.Message
  $record.storeRemoved = !(Test-Path -LiteralPath $store)
} finally {
  $record.finishedAt = [DateTime]::UtcNow.ToString('o')
  $record | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $receipt -Encoding utf8NoBOM
}
if ($record.error) { throw $record.error }
'Both initial and restart PIDs, the supervisor PID and all three listeners are absent. Exclusive handles acquired for all SQLite files. Disposable store removed.'
