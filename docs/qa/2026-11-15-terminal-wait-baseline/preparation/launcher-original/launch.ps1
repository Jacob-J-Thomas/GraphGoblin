#requires -Version 7.2
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$AdmissionPath,
  [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$AdmissionSha256
)

$ErrorActionPreference = 'Stop'
if (!$IsWindows) { throw 'This native launcher requires Windows.' }
$qaBatch = 'C:\Users\98jak\graphgoblin-qa\2026-11-13-aidlc-batch'
$qaSuite = Join-Path $qaBatch 'runtime-410-native-preparation'
$qaManifest = Join-Path $qaSuite 'SHA256SUMS.txt'
$qaFrozenHarnessSha = 'acd42fe76f48392598096d15833302792906eb95467c3124cbadb69b8d47296f'
$qaNode = 'C:\Users\98jak\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64\node.exe'
$qaWorktrees = 'C:\Users\98jak\.codex\worktrees'
$qaDeadlineMilliseconds = 240000

function Get-QaSha([string]$Path) {
  (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Confirm-QaSha([string]$Path, [string]$Expected) {
  if ($Expected -cnotmatch '^[a-f0-9]{64}$' -or (Get-QaSha $Path) -cne $Expected) { throw "Byte binding mismatch for $Path" }
}

function Confirm-QaPlainPath([string]$Path, [switch]$Directory) {
  if (![IO.Path]::IsPathFullyQualified($Path) -or [IO.Path]::GetFullPath($Path) -cne $Path) {
    throw "Expected a canonical absolute path: $Path"
  }
  $item = Get-Item -LiteralPath $Path -Force
  if ($item.PSIsContainer -ne [bool]$Directory -or
      ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
      (Resolve-Path -LiteralPath $Path).Path -cne $Path) {
    throw "Unexpected path identity: $Path"
  }
  $Path
}

function Confirm-QaUnder([string]$Parent, [string]$Path) {
  if (![IO.Path]::IsPathFullyQualified($Path) -or
      !$Path.StartsWith($Parent + '\', [StringComparison]::OrdinalIgnoreCase) -or
      [IO.Path]::GetFullPath($Path) -cne $Path) {
    throw "Path must be under $Parent : $Path"
  }
  $Path
}

function Join-QaRepoPath([string]$Checkout, [string]$Relative) {
  if (!$Relative -or $Relative.Contains('\') -or $Relative.Contains(':') -or
      @($Relative.Split('/') | Where-Object { $_ -in @('', '.', '..') }).Count) {
    throw "Expected a bound repository-relative path: $Relative"
  }
  Confirm-QaUnder $Checkout (Join-Path $Checkout $Relative.Replace('/', '\'))
}

function Write-QaJson([string]$Path, $Record) {
  $bytes = [Text.Encoding]::UTF8.GetBytes(($Record | ConvertTo-Json -Depth 25) + [Environment]::NewLine)
  $stream = [IO.File]::Open($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
  try { $stream.Write($bytes); $stream.Flush($true) } finally { $stream.Dispose() }
}

function Read-QaJson([string]$Path) {
  Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -AsHashtable
}

function New-QaProcessInfo([string]$File, [string]$WorkingDirectory, [string[]]$Arguments) {
  $info = [Diagnostics.ProcessStartInfo]::new()
  $info.FileName = $File
  $info.WorkingDirectory = $WorkingDirectory
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $info.StandardOutputEncoding = [Text.UTF8Encoding]::new($false)
  $info.StandardErrorEncoding = [Text.UTF8Encoding]::new($false)
  foreach ($argument in $Arguments) { $info.ArgumentList.Add($argument) }
  $info
}

function Read-QaProcessText([Diagnostics.ProcessStartInfo]$Info, [string]$Label) {
  $child = [Diagnostics.Process]::Start($Info)
  try {
    $stdout = $child.StandardOutput.ReadToEndAsync()
    $stderr = $child.StandardError.ReadToEndAsync()
    if (!$child.WaitForExit(30000)) { $child.Kill($false); throw "$Label exceeded 30 seconds" }
    if (![Threading.Tasks.Task]::WaitAll(@($stdout,$stderr),5000)) { throw "$Label output was incomplete" }
    if ($child.ExitCode -ne 0) { throw "$Label failed: $($stderr.Result)" }
    $stdout.Result
  } finally { $child.Dispose() }
}

function Read-QaGit([string]$Checkout, [string[]]$Arguments) {
  $info = New-QaProcessInfo $qaGit $Checkout $Arguments
  $info.Environment['GIT_OPTIONAL_LOCKS'] = '0'
  Read-QaProcessText $info 'Read-only Git query'
}

function Read-QaFrozenHarness {
  Confirm-QaSha $qaManifest $qaFrozenHarnessSha
  $expected = @('gateway.mjs','owned-store.mjs','README.md','resources.mjs','run.mjs')
  $seen = @{}
  foreach ($line in (Get-Content -LiteralPath $qaManifest)) {
    if ($line -cnotmatch '^([a-f0-9]{64})  ([A-Za-z0-9._-]+)$') { throw 'Unexpected frozen manifest line' }
    $sha = $Matches[1]
    $name = $Matches[2]
    if ($name -cnotin $expected -or $seen.ContainsKey($name)) { throw "Unexpected frozen harness member: $name" }
    $path = Confirm-QaPlainPath (Join-Path $qaSuite $name)
    Confirm-QaSha $path $sha
    $seen[$name] = $sha
  }
  if ($seen.Count -ne $expected.Count) { throw 'Incomplete frozen harness verification' }
  [ordered]@{manifest=$qaManifest;manifestSha256=$qaFrozenHarnessSha;files=$seen}
}

function Confirm-QaFileMap([string]$Checkout, $Files) {
  foreach ($entry in $Files.GetEnumerator()) {
    $path = Confirm-QaPlainPath (Join-QaRepoPath $Checkout $entry.Key)
    Confirm-QaSha $path $entry.Value
  }
}

function Read-QaOutputPaths([string]$Checkout, [string[]]$Roots) {
  $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  foreach ($root in $Roots) {
    $pending = [Collections.Generic.Stack[string]]::new()
    $pending.Push((Confirm-QaPlainPath (Join-QaRepoPath $Checkout $root) -Directory))
    while ($pending.Count) {
      $directory = $pending.Pop()
      foreach ($entry in (Get-ChildItem -LiteralPath $directory -Force)) {
        if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Unexpected linked artifact $($entry.FullName)" }
        [void](Confirm-QaUnder $Checkout $entry.FullName)
        if ($entry.PSIsContainer) { $pending.Push($entry.FullName) }
        else {
          $path = [IO.Path]::GetRelativePath($Checkout,$entry.FullName).Replace('\','/')
          if (!$seen.Add($path)) { throw "Overlapping output roots at $path" }
        }
      }
    }
  }
  $seen
}

function Read-QaBuild($Admission, $Binding) {
  $checkout = $Admission.checkout
  if ($Binding.schema -cne 'gg410-reviewed-build-binding/v1' -or
      $Binding.checkout -cne $checkout -or $Binding.head -cne $Admission.head -or
      $Binding.tree -cne $Admission.tree -or $Binding.actualMain -cne $Admission.actualMain -or
      $Binding.actualMainTree -cne $Admission.actualMainTree -or $Binding.nodePath -cne $qaNode -or
      $Binding.nodeVersion -cne 'v22.23.4' -or $Binding.buildProof.exitCode -ne 0) { throw 'Build binding does not match this admission' }
  Confirm-QaSha $qaNode $Binding.nodeSha256
  foreach ($proof in @($Binding.buildProof.exitReceipt,$Binding.buildProof.log)) {
    $path = Confirm-QaPlainPath (Confirm-QaUnder $qaBatch $proof.path)
    Confirm-QaSha $path $proof.sha256
  }
  $head = (Read-QaGit $checkout @('rev-parse','HEAD')).Trim()
  $tree = (Read-QaGit $checkout @('rev-parse','HEAD^{tree}')).Trim()
  $main = (Read-QaGit $checkout @('rev-parse','refs/remotes/origin/main')).Trim()
  $mainTree = (Read-QaGit $checkout @('rev-parse','refs/remotes/origin/main^{tree}')).Trim()
  if ($head -cne $Binding.head -or $tree -cne $Binding.tree -or $main -cne $Binding.actualMain -or
      $mainTree -cne $Binding.actualMainTree -or
      (Read-QaGit $checkout @('status','--porcelain=v1','--untracked-files=all','--no-ahead-behind')).Trim()) {
    throw 'Source identity or clean worktree check failed'
  }
  [void](Read-QaGit $checkout @('merge-base','--is-ancestor',$Admission.merged381,$main))
  [void](Read-QaGit $checkout @('merge-base','--is-ancestor',$main,$head))
  if ($Admission.phase -eq 'baseline' -and ($head -cne $main -or $tree -cne $mainTree)) { throw 'Baseline must bind actual main' }
  if ($Admission.phase -eq 'candidate' -and $head -ceq $main) { throw 'Candidate must bind its own exact head' }
  $indexPath = Confirm-QaPlainPath ((Read-QaGit $checkout @('rev-parse','--path-format=absolute','--git-path','index')).Trim().Replace('/','\'))
  Confirm-QaSha $indexPath $Binding.indexSha256

  $tracked = (Read-QaGit $checkout @('ls-files','-z')).Split([char]0,[StringSplitOptions]::RemoveEmptyEntries)
  if ($Binding.sourceFiles.Count -ne $tracked.Count -or
      @($tracked | Where-Object { !$Binding.sourceFiles.Contains($_) }).Count) { throw 'Tracked source map is incomplete' }
  Confirm-QaFileMap $checkout $Binding.sourceFiles

  $output = @(Read-QaOutputPaths $checkout $Binding.outputRoots)
  if ($Binding.outputFiles.Count -ne $output.Count -or
      @($output | Where-Object { !$Binding.outputFiles.Contains($_) }).Count) { throw 'Build-output inventory changed' }
  Confirm-QaFileMap $checkout $Binding.outputFiles
  if (!$Binding.dependencyFiles.Count -or !$Binding.workspaceLinks.Count) { throw 'Transitive runtime binding is empty' }
  Confirm-QaFileMap $checkout $Binding.dependencyFiles
  foreach ($edge in $Binding.workspaceLinks.GetEnumerator()) {
    $link = Get-Item -LiteralPath (Join-QaRepoPath $checkout $edge.Key) -Force
    if ($link.LinkType -notin @('Junction','SymbolicLink')) { throw "Unexpected dependency link $($edge.Key)" }
    $target = Confirm-QaPlainPath (Join-QaRepoPath $checkout $edge.Value) -Directory
    $resolvedLink = $link.ResolveLinkTarget($true)
    if (!$resolvedLink -or $resolvedLink.FullName -cne $target) { throw "Changed workspace dependency target for $($edge.Key)" }
  }
  foreach ($entry in @('apps/api/dist/main.js','apps/api/dist/index.js','apps/api/dist/container.js','apps/mcp/dist/main.js')) {
    if (!$Binding.outputFiles.Contains($entry)) { throw "Missing bound entry point $entry" }
  }
  foreach ($package in @(
    @{name='infrastructure';export='./sqlite'},
    @{name='contracts';export='.'}
  )) {
    $prefix = "packages/$($package.name)/"
    $metadata = Read-QaJson (Join-QaRepoPath $checkout ($prefix+'package.json'))
    $target = $metadata.exports[$package.export].import
    if ($target -cnotmatch '^\./dist/(?:[a-z-]+/)*index\.js$' -or
        !$Binding.outputFiles.Contains($prefix+$target.Substring(2))) { throw 'Missing bound SQLite or contracts runtime export' }
  }

  [ordered]@{head=$head;tree=$tree;actualMain=$main;actualMainTree=$mainTree;indexPath=$indexPath;
    indexSha256=$Binding.indexSha256;sourceFiles=$tracked.Count;outputFiles=$output.Count;
    outputRoots=$Binding.outputRoots;dependencyFiles=$Binding.dependencyFiles.Count;
    workspaceLinks=$Binding.workspaceLinks.Count;buildBindingSha256=$Admission.buildBinding.sha256}
}

function Read-QaHistoricalSeed($History) {
  if ($History.evidenceName -cnotmatch '^evidence-baseline-[a-z0-9-]{3,48}$') { throw 'Invalid baseline evidence basename' }
  $root = Confirm-QaPlainPath (Join-Path $qaSuite $History.evidenceName) -Directory
  $summaryPath = Confirm-QaPlainPath (Join-Path $root 'summary.json')
  if ($summaryPath -cne $History.summary.path) { throw 'Unexpected historical summary pathname' }
  Confirm-QaSha $summaryPath $History.summary.sha256
  $seedDir = Confirm-QaPlainPath (Join-Path $root 'private-history-seed') -Directory
  $seed = Confirm-QaPlainPath (Join-Path $seedDir 'graphgoblin.db')
  if ($seed -cne $History.seed.path -or
      @(Get-ChildItem -LiteralPath $seedDir -Force).Count -ne 1) { throw 'W4 requires the exact standalone baseline database' }
  Confirm-QaSha $seed $History.seed.sha256
  $accepted = Confirm-QaPlainPath (Confirm-QaUnder $qaBatch $History.acceptance.path)
  Confirm-QaSha $accepted $History.acceptance.sha256
  $approval = Read-QaJson $accepted
  if ($approval.schema -cne 'gg410-baseline-acceptance/v1' -or $approval.state -cne 'accepted-baseline' -or
      $approval.evidenceName -cne $History.evidenceName -or $approval.summarySha256 -cne $History.summary.sha256 -or
      $approval.seedPath -cne $seed -or $approval.seedSha256 -cne $History.seed.sha256) { throw 'Historical evidence differs from root acceptance' }
  $summary = Read-QaJson $summaryPath
  if ($summary.phase -cne 'baseline' -or $summary.result -cne 'assertions-met' -or !$summary.W4.after -or
      $summary.cleanup.live.seed.database -cne $seed -or $summary.cleanup.live.seed.sha256 -cne $History.seed.sha256 -or
      $summary.W4.seed.parentId -cne $approval.parentId) { throw 'Historical seed is not the accepted fully projected baseline row' }
  [ordered]@{summary=$History.summary;seed=$History.seed;acceptance=$History.acceptance;parentId=$approval.parentId}
}

function Read-QaProducedSeed([string]$Evidence, $Summary, [string]$SummarySha256) {
  $seedDir = Confirm-QaPlainPath (Join-Path $Evidence 'private-history-seed') -Directory
  $seed = Confirm-QaPlainPath (Join-Path $seedDir 'graphgoblin.db')
  $record = $Summary.cleanup.live.seed
  if ($record.database -cne $seed -or $Summary.W4.seed.database -cne $seed -or
      $Summary.W4.seed.sha256 -cne $record.sha256 -or
      @(Get-ChildItem -LiteralPath $seedDir -Force).Count -ne 1) { throw 'Produced historical seed identity mismatch' }
  Confirm-QaSha $seed $record.sha256
  [ordered]@{summarySha256=$SummarySha256;seedPath=$seed;seedSha256=$record.sha256;parentId=$Summary.W4.seed.parentId}
}

if ((Confirm-QaPlainPath $PSScriptRoot -Directory) -cne (Join-Path $qaBatch 'runtime-410-launch-preparation')) {
  throw 'Use the reviewed external launch directory'
}
[void](Confirm-QaPlainPath $qaBatch -Directory)
[void](Confirm-QaPlainPath $qaSuite -Directory)
[void](Confirm-QaPlainPath $qaWorktrees -Directory)
[void](Confirm-QaPlainPath $qaNode)
$qaGit = (Get-Command git.exe -CommandType Application -ErrorAction Stop).Source
$qaAdmissionPath = Confirm-QaPlainPath (Confirm-QaUnder $qaBatch $AdmissionPath)
Confirm-QaSha $qaAdmissionPath $AdmissionSha256
$qaAdmission = Read-QaJson $qaAdmissionPath
if ($qaAdmission.schema -cne 'gg410-native-launch-admission/v1' -or $qaAdmission.state -cne 'root-admitted' -or
    $qaAdmission.phase -cnotin @('baseline','candidate') -or
    $qaAdmission.evidenceName -cnotmatch ('^evidence-' + $qaAdmission.phase + '-[a-z0-9-]{3,48}$') -or
    $qaAdmission.stopExactSupervisorOnDeadline -isnot [bool]) { throw 'Invalid launch admission' }
foreach ($field in @('head','tree','actualMain','actualMainTree','merged381')) {
  if ($qaAdmission[$field] -cnotmatch '^[a-f0-9]{40}$') { throw "Invalid bound commit or tree: $field" }
}
$qaCheckout = Confirm-QaPlainPath (Confirm-QaUnder $qaWorktrees $qaAdmission.checkout) -Directory
if ([IO.Path]::GetRelativePath($qaWorktrees,$qaCheckout) -notmatch '^gg-[^\\]+\\GraphGoblin$') { throw 'Expected the admitted isolated worktree' }
[void](Confirm-QaPlainPath (Split-Path -Parent $qaCheckout) -Directory)
$qaLauncher = Confirm-QaPlainPath $PSCommandPath
Confirm-QaSha $qaLauncher $qaAdmission.launcherSha256
$qaBindingPath = Confirm-QaPlainPath (Confirm-QaUnder $qaBatch $qaAdmission.buildBinding.path)
Confirm-QaSha $qaBindingPath $qaAdmission.buildBinding.sha256
$qaBinding = Read-QaJson $qaBindingPath
$qaEvidence = Join-Path $qaSuite $qaAdmission.evidenceName
if (Test-Path -LiteralPath $qaEvidence) { throw 'Preserve the existing evidence attempt' }
$qaReceipt = Confirm-QaUnder $qaBatch $qaAdmission.receiptDirectory
if ((Split-Path -Parent $qaReceipt) -cne $qaBatch -or
    (Split-Path -Leaf $qaReceipt) -cnotmatch ('^runtime-410-launch-execution-' + $qaAdmission.phase + '-[a-z0-9-]{3,48}$') -or
    (Test-Path -LiteralPath $qaReceipt)) { throw 'Expected a new exact external launch receipt directory' }
if (($qaAdmission.phase -eq 'baseline') -ne ($null -eq $qaAdmission.historicalBaseline)) { throw 'Historical admission must match phase' }
$qaVersionProbe = New-QaProcessInfo $qaNode $qaBatch @('--version')
$qaVersionProbe.Environment.Clear()
$qaVersionProbe.Environment['SystemRoot'] = $env:SystemRoot
$qaVersionProbe.Environment['WINDIR'] = $env:SystemRoot
$qaNodeVersion = (Read-QaProcessText $qaVersionProbe 'Project Node version query').Trim()
if ($qaNodeVersion -cne 'v22.23.4') { throw 'Wrong project Node version' }
$qaHarnessBefore = Read-QaFrozenHarness
$qaBuildBefore = Read-QaBuild $qaAdmission $qaBinding
$qaHistoryBefore = if ($qaAdmission.phase -eq 'candidate') { Read-QaHistoricalSeed $qaAdmission.historicalBaseline } else { $null }

New-Item -ItemType Directory -Path $qaReceipt | Out-Null
[void](Confirm-QaPlainPath $qaReceipt -Directory)
$qaTemp = Join-Path $qaReceipt 'process-temp'
New-Item -ItemType Directory -Path $qaTemp | Out-Null
[void](Confirm-QaPlainPath $qaTemp -Directory)
Write-QaJson (Join-Path $qaReceipt 'preflight.json') ([ordered]@{
  checkedAtUtc=[DateTime]::UtcNow.ToString('o'); admissionPath=$qaAdmissionPath; admissionSha256=$AdmissionSha256;
  bindingPath=$qaBindingPath; build=$qaBuildBefore; harness=$qaHarnessBefore; historicalBaseline=$qaHistoryBefore;
  exactEvidence=$qaEvidence; launcherSha256=$qaAdmission.launcherSha256
})

$qaArgs = @('--expose-gc',(Join-Path $qaSuite 'run.mjs'),$qaAdmission.phase,$qaCheckout,$qaAdmission.evidenceName)
if ($qaAdmission.phase -eq 'candidate') { $qaArgs += $qaAdmission.historicalBaseline.evidenceName }
$qaInfo = New-QaProcessInfo $qaNode $qaReceipt $qaArgs
$qaInfo.Environment.Clear()
$qaInfo.Environment['SystemRoot'] = $env:SystemRoot
$qaInfo.Environment['WINDIR'] = $env:SystemRoot
$qaInfo.Environment['TEMP'] = $qaTemp
$qaInfo.Environment['TMP'] = $qaTemp
$qaOut = [IO.File]::Open((Join-Path $qaReceipt 'stdout.log'),[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
$qaErr = [IO.File]::Open((Join-Path $qaReceipt 'stderr.log'),[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
$qaChild = $null
$qaBirth = $null
$qaExpired = $false
try {
  $qaChild = [Diagnostics.Process]::Start($qaInfo)
  $qaBirth = $qaChild.StartTime.ToUniversalTime()
  $qaOutTask = $qaChild.StandardOutput.BaseStream.CopyToAsync($qaOut)
  $qaErrTask = $qaChild.StandardError.BaseStream.CopyToAsync($qaErr)
  $qaLaunch = [ordered]@{pid=$qaChild.Id;parentPid=$PID;creationUtc=$qaBirth.ToString('o');
    executable=$qaNode;arguments=$qaArgs;workingDirectory=$qaReceipt;nodeOptionsPresent=$false;
    environmentKeys=@($qaInfo.Environment.Keys|Sort-Object);evidence=$qaEvidence;deadlineMilliseconds=$qaDeadlineMilliseconds}
  Write-QaJson (Join-Path $qaReceipt 'launch.json') $qaLaunch
  $qaLaunch | ConvertTo-Json -Depth 6 -Compress

  $qaClock = [Diagnostics.Stopwatch]::StartNew()
  while (!$qaChild.WaitForExit(1000)) {
    if (!$qaExpired -and $qaClock.ElapsedMilliseconds -ge $qaDeadlineMilliseconds) {
      $qaExpired = $true
      Write-QaJson (Join-Path $qaReceipt 'supervisor-deadline.json') ([ordered]@{
        pid=$qaChild.Id;creationUtc=$qaBirth.ToString('o');observedAtUtc=[DateTime]::UtcNow.ToString('o');
        stopExactSupervisorOnDeadline=$qaAdmission.stopExactSupervisorOnDeadline
      })
      if ($qaAdmission.stopExactSupervisorOnDeadline -and !$qaChild.HasExited) {
        if ($qaChild.StartTime.ToUniversalTime() -ne $qaBirth) { throw 'Supervisor identity changed' }
        try { $qaChild.Kill($false) } catch { if (!$qaChild.HasExited) { throw } }
      }
      [Console]::Error.WriteLine('QA supervisor deadline elapsed. See the exact process receipt for disposition.')
    }
  }

  # Persist the OS process disposition before output drains, hashing or parsing any harness report.
  $qaExit = [ordered]@{pid=$qaChild.Id;exitCode=$qaChild.ExitCode;creationUtc=$qaBirth.ToString('o');
    exitTimeUtc=$qaChild.ExitTime.ToUniversalTime().ToString('o');deadlineExpired=$qaExpired}
  Write-QaJson (Join-Path $qaReceipt 'child-exit.json') $qaExit
  if (![Threading.Tasks.Task]::WaitAll(@($qaOutTask,$qaErrTask),10000)) { throw 'Child output did not close after the recorded exit' }
} catch {
  $qaError = $_.Exception.Message
  if ($qaChild -and $qaChild.HasExited -and !(Test-Path -LiteralPath (Join-Path $qaReceipt 'child-exit.json'))) {
    Write-QaJson (Join-Path $qaReceipt 'child-exit.json') ([ordered]@{
      pid=$qaChild.Id;exitCode=$qaChild.ExitCode;creationUtc=if($qaBirth){$qaBirth.ToString('o')};
      exitTimeUtc=$qaChild.ExitTime.ToUniversalTime().ToString('o');deadlineExpired=$qaExpired
    })
  }
  Write-QaJson (Join-Path $qaReceipt 'supervision-error.json') ([ordered]@{
    pid=if($qaChild){$qaChild.Id};creationUtc=if($qaBirth){$qaBirth.ToString('o')};
    knownExited=[bool]($qaChild -and $qaChild.HasExited);error=$qaError;observedAtUtc=[DateTime]::UtcNow.ToString('o')
  })
  throw
} finally {
  $qaOut.Dispose()
  $qaErr.Dispose()
  if ($qaChild) { $qaChild.Dispose() }
}

try {
  $qaEvidenceHashes = [ordered]@{}
  foreach ($name in @('runner.json','first-failure.json','summary.json','W2-verified-before-interruption.json','W2-post-crash-before-reopen.json')) {
    $path = Join-Path $qaEvidence $name
    if (Test-Path -LiteralPath $path) { $qaEvidenceHashes[$name] = Get-QaSha (Confirm-QaPlainPath $path) }
  }
  $qaSummary = if ($qaEvidenceHashes.Contains('summary.json')) { Read-QaJson (Join-Path $qaEvidence 'summary.json') } else { $null }
  Confirm-QaSha $qaAdmissionPath $AdmissionSha256
  Confirm-QaSha $qaBindingPath $qaAdmission.buildBinding.sha256
  Confirm-QaSha $qaLauncher $qaAdmission.launcherSha256
  $qaHarnessAfter = Read-QaFrozenHarness
  $qaBuildAfter = Read-QaBuild $qaAdmission $qaBinding
  $qaCompleted = $qaExit.exitCode -eq 0 -and !$qaExpired -and
    $qaSummary.phase -ceq $qaAdmission.phase -and $qaSummary.checkout -ceq $qaCheckout -and
    $qaSummary.result -ceq 'assertions-met' -and $qaSummary.W4.after -and
    !$qaEvidenceHashes.Contains('first-failure.json') -and
    $qaEvidenceHashes.Contains('W2-verified-before-interruption.json') -and $qaEvidenceHashes.Contains('W2-post-crash-before-reopen.json')
  if ($qaCompleted -and (@($qaSummary.remaining.writers).Count -or @($qaSummary.remaining.mcp).Count -or
      $qaSummary.remaining.observers -ne 0 -or $null -ne $qaSummary.remaining.helper)) { throw 'Harness reported remaining resources' }
  if ($qaCompleted) {
    $qaRuntimeNames = @('gateway','apiIndex','container','mcp','sqlite','contracts')
    if ($qaSummary.runtimeBindings.Count -ne $qaRuntimeNames.Count) { throw 'Incomplete harness entry-point readback' }
    foreach ($name in $qaRuntimeNames) {
      $entry = $qaSummary.runtimeBindings[$name]
      $path = Confirm-QaUnder $qaCheckout $entry.file
      $relative = [IO.Path]::GetRelativePath($qaCheckout, $path).Replace('\', '/')
      if (!$qaBinding.outputFiles.Contains($relative) -or $entry.sha256 -cne $qaBinding.outputFiles[$relative]) {
        throw "Harness loaded an unbound runtime entry: $name"
      }
    }
  }
  $qaHistoryAfter = if ($qaAdmission.phase -eq 'candidate') { Read-QaHistoricalSeed $qaAdmission.historicalBaseline } else { $null }
  $qaNewSeed = if ($qaCompleted -and $qaAdmission.phase -eq 'baseline') {
    Read-QaProducedSeed $qaEvidence $qaSummary $qaEvidenceHashes['summary.json']
  } else { $null }
  $qaResult = [ordered]@{phase=$qaAdmission.phase;childExit=$qaExit;
    wrapperStatus=$(if($qaCompleted){'matrix-finished-for-review'}else{'incomplete'});
    harnessResult=$qaSummary.result;evidence=$qaEvidence;evidenceSha256=$qaEvidenceHashes;
    stdoutSha256=(Get-QaSha (Join-Path $qaReceipt 'stdout.log'));stderrSha256=(Get-QaSha (Join-Path $qaReceipt 'stderr.log'));
    closingBuild=$qaBuildAfter;closingHarness=$qaHarnessAfter;historicalBaseline=$qaHistoryAfter;
    producedBaselineSeed=$qaNewSeed;
    phaseInterpretation=$(if($qaAdmission.phase -eq 'baseline'){'Baseline oracles expect stale W1 and W2 waits'}else{'Candidate oracles expect cleared W1 and W2 waits'});}
  Write-QaJson (Join-Path $qaReceipt 'launch-result.json') $qaResult
  if (!$qaCompleted) {
    if ($qaExit.exitCode -ne 0) { exit $qaExit.exitCode }
    exit 1
  }
} catch {
  Write-QaJson (Join-Path $qaReceipt 'closing-error.json') ([ordered]@{
    childExit=$qaExit;error=$_.Exception.Message;observedAtUtc=[DateTime]::UtcNow.ToString('o')
  })
  throw
}
