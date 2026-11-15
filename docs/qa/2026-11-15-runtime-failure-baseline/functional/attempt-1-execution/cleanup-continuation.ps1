# Preparation only. Root must admit this exact one-shot continuation before invoking it.
$ErrorActionPreference = 'Stop'
$qaBatch = 'C:\Users\98jak\graphgoblin-qa\2026-11-13-aidlc-batch'
$qaHarness = Join-Path $qaBatch 'runtime-381-native-functional-preparation-v3'
$qaAttempt = Join-Path $qaHarness 'baseline-attempt-1'
$qaStore = Join-Path $qaAttempt 'disposable'
$qaNative = Join-Path $qaStore 'native'
$qaProfile = Join-Path $qaStore 'edge-profile'
$qaReceiptRoot = Join-Path $qaBatch 'runtime-381-functional-baseline-execution-1'
$qaReceiptPath = Join-Path $qaReceiptRoot 'cleanup-continuation.json'
if ((Resolve-Path -LiteralPath $PSScriptRoot).Path -cne $qaReceiptRoot) { throw 'Unexpected continuation script directory' }
if (Test-Path -LiteralPath $qaReceiptPath) { throw 'Preserve the first cleanup continuation receipt' }

$qaPids = @(37560,23560,51732,9256,47072,52064,48656,36448,34992,39480,6300)
$qaPort = 63632
$qaRecord = [ordered]@{
  startedAtUtc = [DateTime]::UtcNow.ToString('o')
  attempt = $qaAttempt
  disposablePath = $qaStore
  checkedPids = $qaPids
  checkedPort = $qaPort
  rawSha256 = [ordered]@{}
  exclusiveOpens = @()
  heldAllThreeAtOnce = $false
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
      $qaBatch,$qaHarness,$qaAttempt,$qaStore,$qaNative,$qaProfile,$qaReceiptRoot)) {
    Confirm-Directory $qaPath
  }
  if ((Split-Path -Parent $qaStore) -cne $qaAttempt -or (Split-Path -Parent $qaAttempt) -cne $qaHarness) {
    throw 'Disposable root escapes the exact admitted attempt'
  }
}

function Read-OwnedAbsence {
  $qaFound = @(foreach ($qaId in $qaPids) {
    Get-CimInstance -ClassName Win32_Process -Filter "ProcessId=$qaId" |
      Select-Object ProcessId,ParentProcessId,CreationDate
  })
  $qaListeners = @(Get-NetTCPConnection -State Listen |
    Where-Object LocalPort -eq $qaPort | Select-Object LocalPort,LocalAddress,OwningProcess)
  return [ordered]@{checkedAtUtc=[DateTime]::UtcNow.ToString('o'); currentPids=$qaFound; listeners=$qaListeners}
}

function Confirm-OwnedAbsence($qaObservation) {
  if ($qaObservation.currentPids.Count -or $qaObservation.listeners.Count) {
    throw 'A recorded PID or the exact recorded listener is present'
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
    (Join-Path $qaAttempt 'first-failure.json') = 'd6148db79b7d75a330b382d248edc511f8f67a062ee6ae491b3da091c319374d'
    (Join-Path $qaAttempt 'cleanup.json') = 'f050f504c03d43bea8ccd8917a890a82054f3a529a3dfed10160f317508ae5a9'
    (Join-Path $qaAttempt 'result.json') = 'ff5166f4f7ad636966ff05e7036032fe6ba4eaa4c983bcf412db9079ca7c8b1b'
    (Join-Path $qaReceiptRoot 'launch.json') = '150ee2b70e70fae7b8c057de024ab40b462a2fc33766ada771ef8923b4c17d6a'
    (Join-Path $qaReceiptRoot 'post-exit-readback.json') = '98b628326fde1f6a9849484e55d5fa6bba0d273cf8542eb0ec6b24243c309168'
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
    foreach ($qaName in @('graphgoblin.db','graphgoblin.db-wal','graphgoblin.db-shm')) {
      $qaPath = Join-Path $qaNative $qaName
      $qaFile = Get-Item -LiteralPath $qaPath -Force
      if ($qaFile.PSIsContainer -or $qaFile.LinkType -or ($qaFile.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
          (Resolve-Path -LiteralPath $qaPath).Path -cne $qaPath) {
        throw "Unexpected SQLite file identity at $qaPath"
      }
      $qaHandle = [IO.File]::Open($qaPath,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None)
      $qaHandles.Add($qaHandle)
      $qaRecord.exclusiveOpens += [ordered]@{path=$qaPath; bytes=$qaHandle.Length; acquired=$true}
    }
    if ($qaHandles.Count -ne 3) { throw 'Expected three simultaneous exclusive SQLite handles' }
    $qaRecord.heldAllThreeAtOnce = $true
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
