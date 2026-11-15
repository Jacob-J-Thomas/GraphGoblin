# Preparation only. Root must admit this exact one-shot continuation before invoking it.
$ErrorActionPreference = 'Stop'
$qaBatch = 'C:\Users\98jak\graphgoblin-qa\2026-11-13-aidlc-batch'
$qaHarness = Join-Path $qaBatch 'runtime-381-native-functional-preparation-v4'
$qaAttempt = Join-Path $qaHarness 'baseline-attempt-2'
$qaStore = Join-Path $qaAttempt 'disposable'
$qaNative = Join-Path $qaStore 'native'
$qaComposed = Join-Path $qaStore 'composed'
$qaProfile = Join-Path $qaStore 'edge-profile'
$qaReceiptRoot = Join-Path $qaBatch 'runtime-381-functional-baseline-execution-2'
$qaReceiptPath = Join-Path $qaReceiptRoot 'cleanup-continuation.json'
if ((Resolve-Path -LiteralPath $PSScriptRoot).Path -cne $qaReceiptRoot) { throw 'Unexpected continuation script directory' }
if (Test-Path -LiteralPath $qaReceiptPath) { throw 'Preserve the first cleanup continuation receipt' }

$qaPids = @(39544,42680,10828,16188,31836,47708,32308,42924,30920,31188,32548,28240,37668)
$qaPorts = @(60619,54804)
$qaExitBoundary = [DateTimeOffset]::Parse('2026-11-15T14:50:22.1787469Z').UtcDateTime
$qaRecord = [ordered]@{
  startedAtUtc = [DateTime]::UtcNow.ToString('o')
  attempt = $qaAttempt
  disposablePath = $qaStore
  checkedPids = $qaPids
  checkedPorts = $qaPorts
  supervisorExitedAtUtc = $qaExitBoundary.ToString('o')
  rawSha256 = [ordered]@{}
  exclusiveOpens = @()
  heldAllSixAtOnce = $false
  removalRequested = $false
  error = $null
}

function Confirm-Directory([string]$qaPath) {
  $qaItem = Get-Item -LiteralPath $qaPath -Force
  if (!$qaItem.PSIsContainer -or $qaItem.LinkType -or ($qaItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw "Expected an ordinary directory at $qaPath"
  }
  if ((Resolve-Path -LiteralPath $qaPath).Path -cne $qaPath) { throw "Unexpected resolved directory $qaPath" }
}

function Confirm-ExactScope {
  foreach ($qaPath in @('C:\Users','C:\Users\98jak','C:\Users\98jak\graphgoblin-qa',
      $qaBatch,$qaHarness,$qaAttempt,$qaStore,$qaNative,$qaComposed,$qaProfile,$qaReceiptRoot)) {
    Confirm-Directory $qaPath
  }
  if ((Split-Path -Parent $qaStore) -cne $qaAttempt -or (Split-Path -Parent $qaAttempt) -cne $qaHarness) {
    throw 'Disposable root escapes the exact admitted attempt'
  }
}

function Read-OwnedAbsence {
  $qaFound = @(foreach ($qaId in $qaPids) {
    $qaProcess = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId=$qaId"
    if (!$qaProcess) { continue }
    $qaCreation = $qaProcess.CreationDate.ToUniversalTime()
    $qaCommandLine = $qaProcess.CommandLine
    $qaProfileOrDriverMatch = $qaCommandLine -and
      $qaCommandLine.IndexOf($qaHarness,[StringComparison]::OrdinalIgnoreCase) -ge 0
    $qaReused = $qaCreation -gt $qaExitBoundary -and $qaCommandLine -and !$qaProfileOrDriverMatch
    [ordered]@{pid=$qaId; parent=$qaProcess.ParentProcessId; creation=$qaCreation.ToString('o');
      fixtureInCommand=[bool]$qaProfileOrDriverMatch; qualifiedPostExitReuse=[bool]$qaReused}
  })
  $qaListeners = @(Get-NetTCPConnection -State Listen |
    Where-Object LocalPort -in $qaPorts | Select-Object LocalPort,LocalAddress,OwningProcess)
  return [ordered]@{checkedAtUtc=[DateTime]::UtcNow.ToString('o'); currentPids=$qaFound; listeners=$qaListeners}
}

function Confirm-OwnedAbsence($qaObservation) {
  if (@($qaObservation.currentPids | Where-Object { !$_.qualifiedPostExitReuse }).Count -or $qaObservation.listeners.Count) {
    throw 'An unqualified recorded process identity or its recorded listener is present'
  }
}

function Confirm-NoLinkedEntries {
  $qaDirectories = [System.Collections.Generic.Stack[string]]::new()
  $qaDirectories.Push($qaStore)
  $qaEntries = 0
  $qaPrefix = $qaStore + '\'
  while ($qaDirectories.Count) {
    $qaDirectory = $qaDirectories.Pop()
    Confirm-Directory $qaDirectory
    foreach ($qaChild in (Get-ChildItem -LiteralPath $qaDirectory -Force)) {
      if (!$qaChild.FullName.StartsWith($qaPrefix,[StringComparison]::OrdinalIgnoreCase) -or
          $qaChild.LinkType -or ($qaChild.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw "Unexpected path or reparse point $($qaChild.FullName)"
      }
      $qaEntries++
      if ($qaChild.PSIsContainer) { $qaDirectories.Push($qaChild.FullName) }
    }
  }
  return $qaEntries
}

try {
  Confirm-ExactScope
  $qaExpected = [ordered]@{
    (Join-Path $qaAttempt 'cleanup.json') = '33d7f9e5070d7d825b37a141e42bbb3319ea423f0cc02121d28cc5bcd9ed571c'
    (Join-Path $qaAttempt 'result.json') = '98a091a15376aadfbdccb1392bf854149b68292e16f0fbc88231b85fb569bb1b'
    (Join-Path $qaReceiptRoot 'launch.json') = 'a31d181045545b9e1eba4963fe32b1fa5248723140cb83750ea5632777f003ef'
    (Join-Path $qaReceiptRoot 'exit.json') = 'dbcb19e6f02576ba092128b33164011b7fbd3d87a9f2fb5cc6d5153c6015c65b'
    (Join-Path $qaReceiptRoot 'post-exit-readback.json') = 'f35fb1b513c7206cf2d948a00ecf55171aa21e1b7c2d8b51147bfae671a3959f'
  }
  foreach ($qaPath in $qaExpected.Keys) {
    $qaHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $qaPath).Hash.ToLowerInvariant()
    if ($qaHash -cne $qaExpected[$qaPath]) { throw "Attempt receipts changed at $qaPath" }
    $qaRecord.rawSha256[$qaPath] = $qaHash
  }
  $qaRecord.beforeOwnership = Read-OwnedAbsence
  Confirm-OwnedAbsence $qaRecord.beforeOwnership
  $qaRecord.checkedDirectoryEntries = Confirm-NoLinkedEntries

  $qaHandles = [System.Collections.Generic.List[System.IO.FileStream]]::new()
  try {
    foreach ($qaRelative in @('native\graphgoblin.db','native\graphgoblin.db-wal','native\graphgoblin.db-shm',
        'composed\graphgoblin.db','composed\graphgoblin.db-wal','composed\graphgoblin.db-shm')) {
      $qaPath = Join-Path $qaStore $qaRelative
      $qaFile = Get-Item -LiteralPath $qaPath -Force
      if ($qaFile.PSIsContainer -or $qaFile.LinkType -or ($qaFile.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
          (Resolve-Path -LiteralPath $qaPath).Path -cne $qaPath) {
        throw "Unexpected SQLite file identity at $qaPath"
      }
      $qaHandle = [IO.File]::Open($qaPath,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None)
      $qaHandles.Add($qaHandle)
      $qaRecord.exclusiveOpens += [ordered]@{path=$qaPath; bytes=$qaHandle.Length; acquired=$true}
    }
    if ($qaHandles.Count -ne 6) { throw 'Expected six simultaneous exclusive SQLite handles' }
    $qaRecord.heldAllSixAtOnce = $true
  } finally {
    foreach ($qaHandle in $qaHandles) { $qaHandle.Dispose() }
  }

  Confirm-ExactScope
  $qaRecord.recheckedDirectoryEntries = Confirm-NoLinkedEntries
  $qaRecord.immediateOwnership = Read-OwnedAbsence
  Confirm-OwnedAbsence $qaRecord.immediateOwnership
  $qaRecord.removalRequested = $true
  Remove-Item -LiteralPath $qaStore -Recurse -Force
  if (Test-Path -LiteralPath $qaStore) { throw 'The exact owned disposable directory remains' }
  $qaRecord.afterOwnership = Read-OwnedAbsence
  Confirm-OwnedAbsence $qaRecord.afterOwnership
} catch {
  $qaRecord.error = $_.Exception.Message
} finally {
  $qaRecord.disposablePresent = Test-Path -LiteralPath $qaStore
  $qaRecord.finishedAtUtc = [DateTime]::UtcNow.ToString('o')
  $qaRecord | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath $qaReceiptPath -Encoding utf8NoBOM
}
if ($qaRecord.error) { throw $qaRecord.error }
'Exact owned baseline disposable directory removed after exclusive file and process readbacks.'
