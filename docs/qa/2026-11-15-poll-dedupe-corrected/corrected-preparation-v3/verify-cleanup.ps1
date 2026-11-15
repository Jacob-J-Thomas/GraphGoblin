param([Parameter(Mandatory=$true)][ValidatePattern('^(corrected|race)-attempt-[1-9][0-9]*$')][string]$Attempt)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$fixture = Join-Path $root $Attempt
$store = Join-Path $fixture 'disposable-store'
$receipt = Join-Path $fixture 'cleanup.json'
if (Test-Path -LiteralPath $receipt) { throw 'Preserve the first cleanup receipt' }
$path = Join-Path $fixture 'result.json'
$result = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
$record = [ordered]@{
  attempt = $Attempt
  checkedAt = [DateTime]::UtcNow.ToString('o')
  resultSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant()
  store = $store
  exclusiveOpen = @()
  error = $null
}
$ports = @()
$processIds = @()
if ($Attempt.StartsWith('corrected-')) {
  $admission = Get-Content -LiteralPath (Join-Path $fixture 'admission.json') -Raw | ConvertFrom-Json
  if ($admission.cwd -cne $store -or $admission.sqlitePath -cne (Join-Path $store 'poll.sqlite')) {
    throw 'Unexpected corrected storage path'
  }
  $processIds = @($result.processPid) + @($result.gatewayProcesses | ForEach-Object { $_.pid })
  $ports = @($result.sourcePort) + @($result.gatewayProcesses | ForEach-Object { $_.port })
  if (($ports -contains 4747) -or ($ports -contains 4748)) { throw 'A protected port appears in fixture metadata' }
  $record.cleanDrain = !$result.sourceListening -and !$result.cleanupFailed -and
    @($result.gatewayProcesses).Count -eq 2 -and
    @($result.gatewayProcesses | Where-Object { $_.exit.code -ne 0 -or $_.drain.status -ne 202 -or $_.fallbackOwnedChildStop }).Count -eq 0
} else {
  if ($result.data -cne $store -or $result.db -cne (Join-Path $store 'poll.sqlite')) {
    throw 'Unexpected race storage path'
  }
  $processIds = @($result.pid)
  $record.cleanDrain = $true
}
function Confirm-SafePath {
  foreach ($pathName in @($root, $fixture, $store)) {
    if ($pathName -cne (Resolve-Path -LiteralPath $pathName).Path) { throw 'Unexpected resolved fixture directory' }
    if ((Get-Item -LiteralPath $pathName -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
      throw 'A fixture directory is a reparse point'
    }
  }
  if ((Split-Path -Parent $store) -cne $fixture -or (Split-Path -Parent $fixture) -cne $root) {
    throw 'Unexpected fixture nesting'
  }
}
function Read-Ownership {
  $present = @(foreach ($childId in $processIds) {
    if ($childId -gt 0) {
      Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $([int]$childId)" | Select-Object -ExpandProperty ProcessId
    }
  })
  $listeners = @()
  if ($ports.Count) {
    $listeners = @(Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in $ports } |
      Select-Object LocalAddress, LocalPort, OwningProcess)
  }
  return [ordered]@{checkedPids = $processIds; checkedPorts = $ports; presentPids = $present; listeners = $listeners}
}
try {
  Confirm-SafePath
  $record.beforeOwnership = Read-Ownership
  if ($record.beforeOwnership.presentPids.Count -or $record.beforeOwnership.listeners.Count) {
    throw 'A fixture PID or listener is present'
  }
  if (!$record.cleanDrain) { throw 'Normal gateway cleanup did not finish' }
  $entries = @(Get-ChildItem -LiteralPath $store -Recurse -Force)
  if (@($entries | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count) {
    throw 'Unexpected store reparse point'
  }
  $record.filesBeforeRemoval = @($entries | Where-Object { !$_.PSIsContainer } | ForEach-Object {
    [ordered]@{relativePath = $_.FullName.Substring($store.Length + 1); bytes = $_.Length}
  })
  $locks = @($entries | Where-Object { $_.Name -match '[.]lock(?:[.].*)?|[.]reclaim$' })
  if ($locks.Count) { throw 'A store lock or reclamation marker remains' }
  $handles = [System.Collections.Generic.List[System.IO.FileStream]]::new()
  try {
    foreach ($name in @('poll.sqlite','poll.sqlite-wal','poll.sqlite-shm')) {
      $sqliteFile = Join-Path $store $name
      if ($name -eq 'poll.sqlite' -or (Test-Path -LiteralPath $sqliteFile)) {
        if ((Resolve-Path -LiteralPath $sqliteFile).Path -cne $sqliteFile) { throw 'Unexpected resolved SQLite path' }
        $opened = [IO.File]::Open($sqliteFile,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None)
        $handles.Add($opened)
        $record.exclusiveOpen += [ordered]@{relativePath = $name; acquired = $true}
      }
    }
    $record.allPresentSqliteFilesHeldAtOnce = $true
  } finally {
    foreach ($opened in $handles) { $opened.Dispose() }
  }
  Confirm-SafePath
  $record.immediateOwnership = Read-Ownership
  if ($record.immediateOwnership.presentPids.Count -or $record.immediateOwnership.listeners.Count) {
    throw 'Ownership changed before disposable removal'
  }
  Remove-Item -LiteralPath $store -Recurse -Force
  $record.storeRemoved = !(Test-Path -LiteralPath $store)
  $record.afterOwnership = Read-Ownership
  if (!$record.storeRemoved -or $record.afterOwnership.presentPids.Count -or $record.afterOwnership.listeners.Count) {
    throw 'A fixture path, PID or listener remains'
  }
} catch {
  $record.error = $_.Exception.Message
  $record.storeRemoved = !(Test-Path -LiteralPath $store)
} finally {
  $record.finishedAt = [DateTime]::UtcNow.ToString('o')
  $record | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $receipt -Encoding utf8NoBOM
}
if ($record.error) { throw $record.error }
'Disposable storage removed after all present SQLite files passed exclusive-open inspection.'
