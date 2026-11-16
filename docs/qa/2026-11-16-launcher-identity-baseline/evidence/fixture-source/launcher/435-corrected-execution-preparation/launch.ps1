#requires -Version 7.2
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$AdmissionPath,
  [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$AdmissionSha256
)

$ErrorActionPreference = 'Stop'
$qaBatch = 'C:\Users\98jak\graphgoblin-qa\2026-11-13-aidlc-batch'
$qaNode = 'C:\Users\98jak\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64\node.exe'
$qaDeadlineMs = 270000
$qaOldPrep = Join-Path $qaBatch 'launcher\435-execution-preparation'
$qaOldTool = Join-Path $qaOldPrep 'job.mjs'
$qaOldToolSha = '3fd3d55808e5c3cd300a05aff41d2c47705b3abac855cc157fd7485560d5917c'
$qaOldLauncherSha = '333856077b76da59567d80116b3f413d35a6c8e46d3548db50dc93882171283a'
$qaSuites = [ordered]@{
  junction = @{
    directory = Join-Path $qaBatch 'launcher-435-native-preparation-progress-correction'
    sha256 = '748a1b65e2800d6af0519fed6f0b0455eef9e4194e53156e70f343db27c2756a'
    expectedNames = @('README.md', 'native.mjs', 'run.mjs', 'syntax-readback.json')
  }
  symlink = @{
    directory = Join-Path $qaBatch 'launcher\435-native-symlink-preparation-progress-correction'
    sha256 = '5ad918110aea6f18cea78e16c341589af37fdbb41e526416c2df5647897e9c62'
    expectedNames = @('README.md', 'run.mjs', 'source-delta.patch', 'syntax-readback.json')
  }
}

function Get-QaSha([string]$Path) {
  (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Confirm-QaFile([string]$Path, [string]$Sha) {
  if (![IO.Path]::IsPathFullyQualified($Path) -or [IO.Path]::GetFullPath($Path) -cne $Path -or
      $Sha -cnotmatch '^[a-f0-9]{64}$') { throw "Invalid bound file reference: $Path" }
  $entry = Get-Item -LiteralPath $Path -Force
  if ($entry.PSIsContainer -or ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
      (Resolve-Path -LiteralPath $Path).Path -cne $Path -or (Get-QaSha $Path) -cne $Sha) {
    throw "Byte binding mismatch: $Path"
  }
}

function Write-QaJson([string]$Name, $Record) {
  $path = Join-Path $qaPlan.receiptDirectory $Name
  $bytes = [Text.Encoding]::UTF8.GetBytes(($Record | ConvertTo-Json -Depth 25) + [Environment]::NewLine)
  $file = [IO.File]::Open($path, 'CreateNew', 'Write', 'Read')
  try { $file.Write($bytes); $file.Flush($true) } finally { $file.Dispose() }
}

function Read-QaJson([string]$Path) {
  Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -AsHashtable
}

function Confirm-QaDirectory([string]$Path) {
  $entry = Get-Item -LiteralPath $Path -Force
  if (!$entry.PSIsContainer -or ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
      (Resolve-Path -LiteralPath $Path).Path -cne $Path) { throw "Unexpected directory: $Path" }
}

function Read-QaCorrectedSuite([string]$Kind) {
  $suite = $qaSuites[$Kind]
  Confirm-QaDirectory $suite.directory
  $declared = $qaInput.correctedManifestSha256[$Kind]
  if ($declared -cne $suite.sha256) { throw "Unreviewed corrected fixture manifest: $Kind" }
  $manifest = Join-Path $suite.directory 'SHA256SUMS.txt'
  Confirm-QaFile $manifest $declared
  $members = [ordered]@{}
  foreach ($row in (Get-Content -LiteralPath $manifest)) {
    if ($row -cnotmatch '^([a-f0-9]{64})  ([A-Za-z0-9._-]+)$') { throw "Malformed fixture seal: $Kind" }
    $sha = $Matches[1]
    $name = $Matches[2]
    if ($name -cnotin $suite.expectedNames -or $members.Contains($name)) { throw "Unexpected fixture member: $name" }
    $file = Join-Path $suite.directory $name
    Confirm-QaFile $file $sha
    $members[$name] = [ordered]@{ file = $file; sha256 = $sha }
  }
  if ($members.Count -ne $suite.expectedNames.Count) { throw "Incomplete corrected fixture seal: $Kind" }
  [ordered]@{ directory = $suite.directory; manifest = [ordered]@{ file = $manifest; sha256 = $declared }; members = $members }
}

function Invoke-QaVerification {
  Confirm-QaFile $AdmissionPath $AdmissionSha256
  Confirm-QaFile $PSCommandPath $qaInput.supervisorSha256
  Confirm-QaFile $qaOldTool $qaOldToolSha
  Confirm-QaFile (Join-Path $qaOldPrep 'launch.ps1') $qaOldLauncherSha
  Confirm-QaFile $qaNode $qaInput.nodeSha256
  $proof = $qaInput.originalVerification
  if (!$proof.path.StartsWith($qaBatch + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Expected a sealed v1 verification input under the external batch'
  }
  Confirm-QaFile $proof.path $proof.sha256
  $text = & $qaNode $qaOldTool 'verify-launch' $proof.path $proof.sha256
  if ($LASTEXITCODE -ne 0) { throw "Original binding verification exited $LASTEXITCODE" }
  if (@($text).Count -ne 1) { throw 'Original verification must return exactly one JSON line' }
  $original = $text | ConvertFrom-Json -AsHashtable
  if ($original.input.phase -cne $qaInput.phase -or $original.input.fixture -cne $qaInput.fixture -or
      $original.node.nodeSha256 -cne $qaInput.nodeSha256 -or
      $original.buildBinding.path -cne $qaInput.buildBinding.path -or
      $original.buildBinding.sha256 -cne $qaInput.buildBinding.sha256) {
    throw 'Original proof names a different phase, fixture kind, runtime or build'
  }
  $suites = [ordered]@{ junction = Read-QaCorrectedSuite 'junction'; symlink = Read-QaCorrectedSuite 'symlink' }
  $executed = $suites[$qaInput.fixture]
  $expected = [ordered]@{}
  foreach ($entry in $original.expectedFixtureBindings.GetEnumerator()) { $expected[$entry.Key] = $entry.Value }
  if ($qaInput.fixture -ceq 'symlink') {
    $expected['junctionManifest'] = $suites.junction.manifest
    $expected['junctionRunner'] = $suites.junction.members['run.mjs']
    $expected['windowsNativeUtilities'] = $suites.junction.members['native.mjs']
  }
  $plan = [ordered]@{
    schema = 'gg435-corrected-native-execution-plan/v1'
    originalProof = [ordered]@{ usage = 'build-verification-only'; input = $proof; proofJson = $text }
    correctedFixtures = $suites; executedFixture = $qaInput.fixture; executedRunner = $executed.members['run.mjs']
    receiptDirectory = $qaInput.receiptDirectory; evidence = Join-Path $executed.directory $qaInput.evidenceName
    args = @($executed.members['run.mjs'].file, $qaInput.phase, $original.checkout, $qaInput.evidenceName)
    node = $original.node; checkout = $original.checkout; nativeTools = $original.nativeTools
    buildBinding = $original.buildBinding; expectedFixtureBindings = $expected
  }
  $plan | ConvertTo-Json -Depth 25 -Compress
}

if (!$IsWindows -or $PSScriptRoot -cne (Join-Path $qaBatch 'launcher\435-corrected-execution-preparation') -or
    (Test-Path Env:NODE_OPTIONS) -or (Test-Path Env:NODE_PATH)) {
  throw 'Use the reviewed Windows supervisor path with NODE_OPTIONS and NODE_PATH absent'
}
if (!$AdmissionPath.StartsWith($qaBatch + '\', [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Expected an external #435 root admission'
}
Confirm-QaFile $AdmissionPath $AdmissionSha256
$qaInput = Read-QaJson $AdmissionPath
if ($qaInput.schema -cne 'gg435-corrected-native-launch-admission/v1' -or $qaInput.state -cne 'root-admitted' -or
    $qaInput.fixture -cnotin @('junction', 'symlink') -or $qaInput.phase -cnotin @('baseline', 'candidate') -or
    $qaInput.evidenceName -cnotmatch ('^evidence-' + $qaInput.phase + '-[a-z0-9-]{3,48}$')) {
  throw 'Invalid corrected fixture admission'
}
$qaLauncherDirectory = Join-Path $qaBatch 'launcher'
foreach ($directory in @($qaBatch, $qaLauncherDirectory, $PSScriptRoot, $qaOldPrep)) {
  Confirm-QaDirectory $directory
}
$qaExpectedReceipt = Join-Path $qaLauncherDirectory ('435-native-corrected-' + $qaInput.fixture + '-' + $qaInput.evidenceName.Substring(9))
if ($qaInput.receiptDirectory -cne $qaExpectedReceipt) { throw 'Invalid corrected fixture receipt directory' }
$qaPreflight = Invoke-QaVerification
$qaPlan = $qaPreflight | ConvertFrom-Json -AsHashtable
if ($qaPlan.node.nodePath -cne $qaNode -or $qaPlan.node.nodeVersion -cne 'v22.23.4' -or
    $qaPlan.nativeTools.systemRoot -ine $env:SystemRoot -or $qaPlan.args.Count -ne 4) {
  throw 'Unexpected preflight invocation'
}
if ((Test-Path -LiteralPath $qaPlan.evidence) -or (Test-Path -LiteralPath $qaPlan.receiptDirectory)) {
  throw 'Expected fresh fixture and supervisor evidence paths'
}
New-Item -ItemType Directory -Path $qaPlan.receiptDirectory | Out-Null
$qaTemp = Join-Path $qaPlan.receiptDirectory 'process-temp'
New-Item -ItemType Directory -Path $qaTemp | Out-Null
Write-QaJson 'preflight.json' $qaPlan

$qaInfo = [Diagnostics.ProcessStartInfo]::new()
$qaInfo.FileName = $qaNode
$qaInfo.WorkingDirectory = $qaPlan.receiptDirectory
$qaInfo.UseShellExecute = $false
$qaInfo.CreateNoWindow = $true
$qaInfo.RedirectStandardOutput = $true
$qaInfo.RedirectStandardError = $true
foreach ($arg in $qaPlan.args) { $qaInfo.ArgumentList.Add($arg) }
$qaInfo.Environment.Clear()
$qaInfo.Environment['SystemRoot'] = $qaPlan.nativeTools.systemRoot
$qaInfo.Environment['WINDIR'] = $qaPlan.nativeTools.systemRoot
$qaInfo.Environment['TEMP'] = $qaTemp
$qaInfo.Environment['TMP'] = $qaTemp

$qaChild = $null
$qaStdout = $null
$qaStderr = $null
$qaBirth = $null
$qaBirthError = $null
$qaExpired = $false
$qaRaw = $null
$qaClose = $null
$qaSupervisionError = $null

function Write-QaExit {
  $record = [ordered]@{
    schema = 'gg435-native-child-exit/v1'; pid = $qaChild.Id; exitCode = $qaChild.ExitCode
    birthUtc = $qaBirth; birthError = $qaBirthError; deadlineExpired = $qaExpired
    exitUtc = $qaChild.ExitTime.ToUniversalTime().ToString('o')
  }
  Write-QaJson 'child-exit.json' $record
  $record
}

try {
  if (Test-Path -LiteralPath $qaPlan.evidence) { throw 'Fixture evidence path became occupied' }
  $qaStdout = [IO.File]::Open((Join-Path $qaPlan.receiptDirectory 'stdout.log'), 'CreateNew', 'Write', 'Read')
  $qaStderr = [IO.File]::Open((Join-Path $qaPlan.receiptDirectory 'stderr.log'), 'CreateNew', 'Write', 'Read')
  $qaLaunch = [ordered]@{
    executable = $qaNode; arguments = $qaPlan.args; workingDirectory = $qaInfo.WorkingDirectory
    evidence = $qaPlan.evidence; environmentNames = @($qaInfo.Environment.Keys | Sort-Object)
    requestedUtc = [DateTime]::UtcNow.ToString('o'); deadlineMs = $qaDeadlineMs
  }
  Write-QaJson 'launch-attempt.json' $qaLaunch
  $qaChild = [Diagnostics.Process]::Start($qaInfo)
  if (!$qaChild) { throw 'Failed to obtain a direct native fixture process' }
  $qaClock = [Diagnostics.Stopwatch]::StartNew()
  $qaOutTask = $qaChild.StandardOutput.BaseStream.CopyToAsync($qaStdout)
  $qaErrTask = $qaChild.StandardError.BaseStream.CopyToAsync($qaStderr)
  try { $qaBirth = $qaChild.StartTime.ToUniversalTime().ToString('o') }
  catch { $qaBirthError = $_.Exception.Message }
  $qaLaunch['pid'] = $qaChild.Id
  $qaLaunch['parentPid'] = $PID
  $qaLaunch['birthUtc'] = $qaBirth
  $qaLaunch['birthError'] = $qaBirthError
  Write-QaJson 'launch.json' $qaLaunch
  $qaLaunch | ConvertTo-Json -Depth 5 -Compress

  $qaRemaining = [Math]::Max(0, $qaDeadlineMs - $qaClock.ElapsedMilliseconds)
  if (!$qaChild.WaitForExit([int]$qaRemaining) -or $qaClock.ElapsedMilliseconds -gt $qaDeadlineMs) {
    $qaExpired = $true
    Write-QaJson 'supervisor-deadline.json' ([ordered]@{
      pid = $qaChild.Id; birthUtc = $qaBirth; observedUtc = [DateTime]::UtcNow.ToString('o')
      deadlineMs = $qaDeadlineMs
    })
    if (!$qaChild.HasExited) { throw 'Native observation deadline expired with no observed child exit' }
  }
  # Record the process result before waiting for, or interpreting, either pipe.
  $qaRaw = Write-QaExit
  if (![Threading.Tasks.Task]::WaitAll(@($qaOutTask, $qaErrTask), 10000)) {
    throw 'Output pipes did not close after the recorded exit'
  }
  $qaStdout.Flush($true)
  $qaStderr.Flush($true)
  $qaClose = [ordered]@{
    schema = 'gg435-native-child-close/v1'; pid = $qaChild.Id; exitCode = $qaRaw.exitCode
    stdoutBytes = $qaStdout.Length; stderrBytes = $qaStderr.Length; closedUtc = [DateTime]::UtcNow.ToString('o')
  }
  Write-QaJson 'child-close.json' $qaClose
} catch {
  $qaSupervisionError = $_.Exception.Message
  if ($qaChild -and $qaChild.HasExited -and !(Test-Path -LiteralPath (Join-Path $qaPlan.receiptDirectory 'child-exit.json'))) {
    $qaRaw = Write-QaExit
  }
  Write-QaJson 'supervision-error.json' ([ordered]@{
    error = $qaSupervisionError; pid = if ($qaChild) { $qaChild.Id }; birthUtc = $qaBirth
    observedUtc = [DateTime]::UtcNow.ToString('o')
  })
} finally {
  if ($qaStdout) { $qaStdout.Dispose() }
  if ($qaStderr) { $qaStderr.Dispose() }
  if ($qaChild) { $qaChild.Dispose() }
}

function Confirm-QaFixtureRecord($Record) {
  if ($Record.runnerPid -ne $qaRaw.pid -or $Record.phase -cne $qaInput.phase -or
      $Record.checkout -cne $qaPlan.checkout -or $Record.node -cne $qaNode -or
      $Record.evidence -cne $qaPlan.evidence) { throw 'Fixture provenance differs from the launched process' }
  foreach ($reference in $qaPlan.expectedFixtureBindings.GetEnumerator()) {
    $binding = $Record.bindings[$reference.Key]
    if (!$binding -or $binding.file -cne $reference.Value.file -or $binding.sha256 -cne $reference.Value.sha256) {
      throw "Fixture input differs from the build binding: $($reference.Key)"
    }
  }
}

try {
  $qaPostflight = Invoke-QaVerification
  if ($qaPreflight -cne $qaPostflight) { throw 'Postflight differs from the verified preflight binding' }
  if (Test-Path -LiteralPath $qaPlan.evidence) {
    $qaEvidenceDirectory = Get-Item -LiteralPath $qaPlan.evidence -Force
    if (!$qaEvidenceDirectory.PSIsContainer -or
        ($qaEvidenceDirectory.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
      throw 'Expected a plain fixture evidence directory'
    }
  }
  $qaEvidenceHashes = [ordered]@{}
  foreach ($name in @('runner.json', 'summary.json', 'first-failure.json')) {
    $file = Join-Path $qaPlan.evidence $name
    if (Test-Path -LiteralPath $file) { $qaEvidenceHashes[$name] = Get-QaSha $file }
  }
  $qaStatus = 'incomplete'
  if (!$qaSupervisionError -and !$qaExpired -and $qaBirth -and $qaRaw -and $qaClose -and
      $qaEvidenceHashes.Contains('runner.json') -and $qaEvidenceHashes.Contains('summary.json')) {
    $qaSummary = Read-QaJson (Join-Path $qaPlan.evidence 'summary.json')
    Confirm-QaFixtureRecord (Read-QaJson (Join-Path $qaPlan.evidence 'runner.json'))
    Confirm-QaFixtureRecord $qaSummary
    if ($qaRaw.exitCode -eq 0 -and $qaSummary.status -ceq 'assertions-met' -and
        !$qaEvidenceHashes.Contains('first-failure.json')) {
      $qaStatus = 'matrix-finished-for-review'
    } elseif ($qaRaw.exitCode -eq 2 -and $qaInput.fixture -ceq 'symlink' -and
              $qaSummary.status -ceq 'capability-unavailable' -and
              $qaEvidenceHashes.Contains('first-failure.json')) {
      $qaFailure = Read-QaJson (Join-Path $qaPlan.evidence 'first-failure.json')
      Confirm-QaFixtureRecord $qaFailure
      $qaCapability = $qaSummary.symlinkCapability
      if ($qaCapability.state -ceq 'creation-refused' -and $qaCapability.requestedType -ceq 'dir' -and
          $qaCapability.aliasAbsent -eq $true -and $qaCapability.target -ceq $qaPlan.checkout -and
          $qaCapability.alias -ceq (Join-Path $qaPlan.evidence 'checkout symlink α 雪 %') -and
          @((Get-ChildItem -LiteralPath $qaPlan.evidence -Force) |
            Where-Object Name -ieq (Split-Path -Leaf $qaCapability.alias)).Count -eq 0 -and
          $qaCapability.error.code -cin @('EPERM', 'EACCES') -and
          $qaFailure.firstFailure.stage -ceq 'native directory symbolic link creation' -and
          $qaFailure.firstFailure.error.code -ceq $qaCapability.error.code -and
          $qaSummary.processes.Count -eq 0 -and $qaSummary.ports.Count -eq 0 -and
          $qaSummary.cases.Count -eq 0 -and $qaSummary.cleanup.Count -eq 0 -and
          @((Get-ChildItem -LiteralPath $qaPlan.evidence -Force) |
            Where-Object Name -cnotin @('runner.json', 'summary.json', 'first-failure.json', 'temp')).Count -eq 0 -and
          @(Get-ChildItem -LiteralPath (Join-Path $qaPlan.evidence 'temp') -Force).Count -eq 0 -and
          $qaSummary.remainingVerifiedGateways.Count -eq 0) {
        $qaStatus = 'capability-unavailable'
      }
    }
  }
  $qaRawHashes = [ordered]@{}
  foreach ($name in @('launch-attempt.json', 'launch.json', 'child-exit.json', 'child-close.json', 'stdout.log', 'stderr.log')) {
    $file = Join-Path $qaPlan.receiptDirectory $name
    if (Test-Path -LiteralPath $file) { $qaRawHashes[$name] = Get-QaSha $file }
  }
  $qaResult = [ordered]@{
    schema = 'gg435-corrected-native-launch-result/v1'; phase = $qaInput.phase; fixture = $qaInput.fixture
    status = $qaStatus; childExit = $qaRaw; childClose = $qaClose
    evidence = $qaPlan.evidence; evidenceSha256 = $qaEvidenceHashes; rawSha256 = $qaRawHashes
    buildBinding = $qaPlan.buildBinding; admissionSha256 = $AdmissionSha256
    originalVerification = $qaInput.originalVerification; executedRunner = $qaPlan.executedRunner
    correctedFixtures = $qaPlan.correctedFixtures
    preflightSha256 = Get-QaSha (Join-Path $qaPlan.receiptDirectory 'preflight.json')
    closingBindingVerified = $true; observationError = $qaSupervisionError
  }
  Write-QaJson 'launch-result.json' $qaResult
  $qaResult | ConvertTo-Json -Depth 8 -Compress
  switch ($qaStatus) {
    'matrix-finished-for-review' { exit 0 }
    'capability-unavailable' { exit 2 }
    default { exit 1 }
  }
} catch {
  Write-QaJson 'closing-error.json' ([ordered]@{
    status = 'incomplete'; error = $_.Exception.Message; childExit = $qaRaw; childClose = $qaClose
    observedUtc = [DateTime]::UtcNow.ToString('o')
  })
  throw
}
