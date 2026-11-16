#requires -Version 7.2
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$AdmissionPath,
  [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$AdmissionSha256
)

$ErrorActionPreference = 'Stop'
if (!$IsWindows) { throw 'This native launcher requires Windows.' }
$qaBatch = 'C:\Users\98jak\graphgoblin-qa\2026-11-13-aidlc-batch'
$qaSuite = Join-Path $qaBatch 'runtime-419-native-preparation'
$qaManifest = Join-Path $qaSuite 'SHA256SUMS.txt'
$qaFrozenHarnessSha = 'd3f2254c321dc3f495d9e7374646151ff5a69a082b15af377ecc788db978a8d9'
$qaNode = 'C:\Users\98jak\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64\node.exe'
$qaWorktrees = 'C:\Users\98jak\.codex\worktrees'
$qaDeadlineMilliseconds = 135000

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
  $child = $null
  $exit = $null
  try {
    $child = [Diagnostics.Process]::Start($Info)
    if (!$child) { throw "$Label returned no direct process" }
    $stdout = $child.StandardOutput.ReadToEndAsync()
    $stderr = $child.StandardError.ReadToEndAsync()
    if (!$child.WaitForExit(30000)) { throw "$Label exceeded 30 seconds; read-only child PID $($child.Id) left for exact readback" }
    $exit = [ordered]@{pid=$child.Id;exitCode=$child.ExitCode;exitTimeUtc=$child.ExitTime.ToUniversalTime().ToString('o')}
    if ($exit.exitCode -ne 0) {
      Write-QaJson (Join-Path $qaReceipt 'preparatory-child-exit.json') ([ordered]@{
        label=$Label; executable=$Info.FileName;arguments=@($Info.ArgumentList);childExit=$exit
      })
    }
    if (![Threading.Tasks.Task]::WaitAll(@($stdout,$stderr),5000)) { throw "$Label output was incomplete" }
    if ($exit.exitCode -ne 0) { throw "$Label exited $($exit.exitCode): $($stderr.Result)" }
    $stdout.Result
  } catch {
    Write-QaJson (Join-Path $qaReceipt 'preparatory-child-error.json') ([ordered]@{
      label=$Label; executable=$Info.FileName;arguments=@($Info.ArgumentList);pid=if($child){$child.Id};
      childExit=$exit;error=$_.Exception.Message
    })
    throw
  } finally { if ($child) { $child.Dispose() } }
}

function Read-QaGit([string]$Checkout, [string[]]$Arguments) {
  $info = New-QaProcessInfo $qaGit $Checkout $Arguments
  foreach ($name in @($info.Environment.Keys)) {
    if ($name -match '^GIT_(DIR|WORK_TREE|INDEX_FILE|INDEX_VERSION|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|CONFIG_COUNT|CONFIG_PARAMETERS|CONFIG_KEY_\d+|CONFIG_VALUE_\d+)$') {
      throw "Unexpected Git environment: $name"
    }
  }
  $info.Environment['GIT_OPTIONAL_LOCKS'] = '0'
  Read-QaProcessText $info 'Read-only Git query'
}

function Read-QaFrozenHarness {
  Confirm-QaSha $qaManifest $qaFrozenHarnessSha
  $expected = @('owned-store.mjs','README.md','run.mjs','transport.mjs')
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

function Confirm-QaBuildProof($Admission, $Binding) {
  $reference = $Binding.buildProof.buildReceipt
  $receiptFile = Confirm-QaPlainPath (Confirm-QaUnder $qaBatch $reference.path)
  $directory = Confirm-QaPlainPath (Split-Path -Parent $receiptFile) -Directory
  if ((Split-Path -Parent $directory) -cne $qaBatch -or (Split-Path -Leaf $receiptFile) -cne 'build-receipt.json' -or
      (Split-Path -Leaf $directory) -cnotmatch ('^runtime-419-build-' + $Admission.phase + '-[a-z0-9-]{3,48}$')) {
    throw 'Build receipt must belong to the exact #419 phase directory'
  }
  Confirm-QaSha $receiptFile $reference.sha256
  $receipt = Read-QaJson $receiptFile
  if ($receipt.schema -cne 'gg419-build-receipt/v1' -or $receipt.phase -cne $Admission.phase -or
      $receipt.checkout -cne $Admission.checkout -or $receipt.buildDirectory -cne $directory -or
      $receipt.merged381 -cne $Admission.merged381 -or $receipt.merged410 -cne $Admission.merged410 -or
      $receipt.nodePath -cne $qaNode -or $receipt.nodeSha256 -cne $Binding.nodeSha256 -or
      $receipt.cleanAfter -ne $true -or $receipt.command -cne 'pnpm.cmd build --force' -or
      $receipt.admissionPath -cne $Binding.input.admissionPath -or $receipt.admissionSha256 -cne $Binding.input.admissionSha256 -or
      $receipt.artifacts.inventorySha256 -cne $Binding.artifactInventorySha256 -or
      $receipt.artifacts.outputRoots -ne $Binding.outputRoots.Count -or $receipt.artifacts.outputFiles -ne $Binding.outputFiles.Count -or
      $receipt.artifacts.dependencyFiles -ne $Binding.dependencyFiles.Count -or
      $receipt.artifacts.workspaceLinks -ne $Binding.workspaceLinks.Count) { throw 'Build receipt differs from the readback binding' }
  foreach ($identity in @($receipt.before,$receipt.after)) {
    foreach ($field in @('head','tree','actualMain','actualMainTree','indexSha256')) {
      if ($identity[$field] -cne $Binding[$field]) { throw "Build identity mismatch: $field" }
    }
    if ($identity.clean -ne $true) { throw 'Build worktree was not clean' }
  }
  $buildAdmission = Confirm-QaPlainPath (Confirm-QaUnder $qaBatch $receipt.admissionPath)
  Confirm-QaSha $buildAdmission $receipt.admissionSha256
  $buildInput = Read-QaJson $buildAdmission
  if ($buildInput.schema -cne 'gg419-root-build-admission/v1' -or $buildInput.state -cne 'root-admitted-build' -or
      $buildInput.phase -cne $Admission.phase -or $buildInput.checkout -cne $Admission.checkout -or
      $buildInput.buildDirectory -cne $directory -or $buildInput.head -cne $Admission.head -or
      $buildInput.merged381 -cne $Admission.merged381 -or $buildInput.merged410 -cne $Admission.merged410) {
    throw 'Build was not admitted for this exact phase and source'
  }
  $tools = @('runtime-419-execution-preparation/build.mjs','runtime-419-execution-preparation/capture-binding.mjs',
    'runtime-419-execution-preparation/common.mjs','runtime-410-build-preparation/common.mjs','runtime-410-build-preparation/artifacts.mjs')
  if ($Binding.tooling.Count -ne $tools.Count -or $receipt.tooling.Count -ne $tools.Count -or
      $buildInput.tooling.Count -ne $tools.Count) { throw 'Incomplete build tooling map' }
  foreach ($tool in $tools) {
    $sha = $Binding.tooling[$tool]
    if ($receipt.tooling[$tool] -cne $sha -or $buildInput.tooling[$tool] -cne $sha) { throw "Build tooling mismatch: $tool" }
    Confirm-QaSha (Confirm-QaPlainPath (Join-QaRepoPath $qaBatch $tool)) $sha
  }
  foreach ($pair in @(@{key='exit';file='build-exit.json';bound=$Binding.buildProof.exitReceipt},
                       @{key='log';file='build.log';bound=$Binding.buildProof.log},
                       @{key='launch';file='build-launch.json';bound=$receipt.launch})) {
    $artifact = $receipt[$pair.key]
    $expected = Confirm-QaPlainPath (Join-Path $directory $pair.file)
    if ($artifact.path -cne $expected -or $pair.bound.path -cne $expected -or $artifact.sha256 -cne $pair.bound.sha256) {
      throw 'Build child proof paths differ from captured proof'
    }
    Confirm-QaSha $expected $artifact.sha256
  }
  $raw = Read-QaJson $receipt.exit.path
  $launch = Read-QaJson $receipt.launch.path
  if ($raw.schema -cne 'gg419-build-child-exit/v1' -or $launch.schema -cne 'gg419-build-launch/v1' -or
      $raw.pid -le 0 -or $raw.pid -ne $launch.pid -or $raw.pid -ne $receipt.rawExit.pid -or
      $raw.exitCode -ne 0 -or $null -ne $raw.signal -or $raw.Contains('spawnError') -or
      $receipt.rawExit.exitCode -ne 0 -or $launch.command -cne $receipt.command -or
      $launch.checkout -cne $Admission.checkout -or $launch.before.head -cne $Admission.head) {
    throw 'Invalid raw build exit or launch proof'
  }
  [ordered]@{receipt=$reference; admission=$receipt.admissionSha256; exit=$receipt.exit; log=$receipt.log; launch=$receipt.launch}
}

function Read-QaBuild($Admission, $Binding) {
  $checkout = $Admission.checkout
  if ($Binding.schema -cne 'gg419-reviewed-build-binding/v1' -or
      $Binding.checkout -cne $checkout -or $Binding.head -cne $Admission.head -or
      $Binding.tree -cne $Admission.tree -or $Binding.actualMain -cne $Admission.actualMain -or
      $Binding.actualMainTree -cne $Admission.actualMainTree -or $Binding.nodePath -cne $qaNode -or
      $Binding.nodeVersion -cne 'v22.23.4' -or $Binding.buildProof.exitCode -ne 0 -or
      $Binding.input.phase -cne $Admission.phase -or $Binding.input.merged381 -cne $Admission.merged381 -or
      $Binding.input.merged410 -cne $Admission.merged410) { throw 'Build binding does not match this admission' }
  Confirm-QaSha $qaNode $Binding.nodeSha256
  $proof = Confirm-QaBuildProof $Admission $Binding
  $head = (Read-QaGit $checkout @('rev-parse','HEAD')).Trim()
  $tree = (Read-QaGit $checkout @('rev-parse','HEAD^{tree}')).Trim()
  $main = (Read-QaGit $checkout @('rev-parse','refs/remotes/origin/main')).Trim()
  $mainTree = (Read-QaGit $checkout @('rev-parse','refs/remotes/origin/main^{tree}')).Trim()
  if ($head -cne $Binding.head -or $tree -cne $Binding.tree -or $main -cne $Binding.actualMain -or
      $mainTree -cne $Binding.actualMainTree -or
      (Read-QaGit $checkout @('status','--porcelain=v1','--untracked-files=all','--no-ahead-behind')).Trim()) {
    throw 'Source identity or clean worktree check failed'
  }
  [void](Read-QaGit $checkout @('merge-base','--is-ancestor',$Admission.merged381,$Admission.merged410))
  [void](Read-QaGit $checkout @('merge-base','--is-ancestor',$Admission.merged410,$main))
  [void](Read-QaGit $checkout @('merge-base','--is-ancestor',$main,$head))
  if ($Admission.phase -eq 'baseline' -and ($head -cne $main -or $tree -cne $mainTree)) { throw 'Baseline must bind actual main' }
  if ($Admission.phase -eq 'candidate' -and $head -ceq $main) { throw 'Candidate must bind its own exact head' }
  $indexPath = Confirm-QaPlainPath ((Read-QaGit $checkout @('rev-parse','--path-format=absolute','--git-path','index')).Trim().Replace('/','\'))
  Confirm-QaSha $indexPath $Binding.indexSha256

  $tracked = (Read-QaGit $checkout @('ls-files','-z')).Split([char]0,[StringSplitOptions]::RemoveEmptyEntries)
  if ($Binding.sourceFiles.Count -ne $tracked.Count -or
      @($tracked | Where-Object { !$Binding.sourceFiles.Contains($_) }).Count) { throw 'Tracked source map is incomplete' }
  Confirm-QaFileMap $checkout $Binding.sourceFiles

  $expectedRoots = @('apps/api/dist','apps/mcp/dist','apps/plugin-claude/dist','apps/plugin-codex/dist',
    'apps/web/dist','apps/web/dist-goblin','packages/adapter-codex/dist','packages/adapter-jev/dist',
    'packages/api-client/dist','packages/contracts/dist','packages/domain/dist','packages/engine/dist','packages/infrastructure/dist')
  $discovered = @(foreach ($group in @('apps','packages')) {
    foreach ($package in (Get-ChildItem -LiteralPath (Join-Path $checkout $group) -Directory)) {
      foreach ($item in (Get-ChildItem -LiteralPath $package.FullName -Force)) {
        if ($item.Name -cmatch '^dist(?:-|$)') { "$group/$($package.Name)/$($item.Name)" }
      }
    }
  })
  if (($Binding.outputRoots -join '|') -cne ($expectedRoots -join '|') -or
      (($discovered | Sort-Object -CaseSensitive) -join '|') -cne ($expectedRoots -join '|')) {
    throw 'Expected the complete 13 named output roots'
  }
  $output = @(Read-QaOutputPaths $checkout $expectedRoots)
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
  foreach ($entry in @('apps/api/dist/main.js','apps/api/dist/index.js','apps/api/dist/container.js','apps/mcp/dist/main.js',
    'apps/api/dist/run-history.js','apps/api/dist/routes/runs.js','apps/api/dist/plugins/auth.js',
    'apps/api/dist/plugins/errors.js','apps/api/dist/routes/system.js')) {
    if (!$Binding.outputFiles.Contains($entry)) { throw "Missing bound entry point $entry" }
  }
  foreach ($package in @(
    @{name='infrastructure';export='./sqlite'},
    @{name='contracts';export='.'},
    @{name='domain';export='.'},
    @{name='engine';export='./testing'}
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
      workspaceLinks=$Binding.workspaceLinks.Count;buildBindingSha256=$Admission.buildBinding.sha256;buildProof=$proof}
}

function Confirm-QaCompletedSummary($Summary, [string]$Phase, [string]$Evidence, [string]$Checkout) {
  if ($Summary.phase -cne $Phase -or $Summary.result -cne 'assertions-met' -or
      $Summary.checkout -cne $Checkout -or $Summary.evidenceDir -cne $Evidence -or $Summary.error -or
      $Summary.runner.exe -cne $qaNode -or $Summary.runner.node -cne 'v22.23.4' -or $Summary.runner.pid -le 0 -or
      $Summary.cases.Count -ne 29 -or $Summary.positives.Count -ne 11 -or $Summary.history.Count -ne 4) {
    throw 'Incomplete #419 harness identity or matrix'
  }
  if ($Summary.transport.bound.address -cne '127.0.0.1' -or !$Summary.transport.ownsOnlyThisListener -or
      $Summary.transport.bound.port -le 0 -or $Summary.transport.bound.port -in @(4747,4748) -or
      $Summary.cleanup.fastify -cne 'closed' -or $Summary.cleanup.container -cne 'closed' -or
      $Summary.cleanup.sockets.clients -ne 0 -or $Summary.cleanup.sockets.server -ne 0 -or
      $null -ne $Summary.cleanup.remainingListener -or $Summary.cleanup.empty -ne $true -or
      $Summary.cleanup.collectionPasses -ne 2 -or !$Summary.cleanup.Contains('remainingStoreFiles') -or
      @($Summary.cleanup.remainingStoreFiles).Count -ne 0 -or $Summary.cleanup.probe.pid -le 0 -or
      $Summary.cleanup.probe.exit.code -ne 0 -or $Summary.cleanup.probe.close.code -ne 0 -or
      $null -ne $Summary.cleanup.probe.exit.signal -or $null -ne $Summary.cleanup.probe.close.signal) {
    throw 'Harness reports incomplete owned cleanup'
  }
  $store = Confirm-QaPlainPath (Join-Path $Evidence 'store') -Directory
  if (@(Get-ChildItem -LiteralPath $store -Force).Count) { throw 'Exact owned store is not empty' }
}

function Read-QaBaseline($Admission) {
  $reference = $Admission.baselineEvidence
  if ($reference.evidenceName -cnotmatch '^evidence-baseline-[a-z0-9-]{3,48}$') { throw 'Invalid baseline evidence basename' }
  $directory = Confirm-QaPlainPath (Join-Path $qaSuite $reference.evidenceName) -Directory
  $summaryPath = Confirm-QaPlainPath (Join-Path $directory 'summary.json')
  if ($summaryPath -cne $reference.summary.path) { throw 'Unexpected baseline summary pathname' }
  Confirm-QaSha $summaryPath $reference.summary.sha256
  $acceptancePath = Confirm-QaPlainPath (Confirm-QaUnder $qaBatch $reference.acceptance.path)
  Confirm-QaSha $acceptancePath $reference.acceptance.sha256
  $acceptance = Read-QaJson $acceptancePath
  if ($acceptance.schema -cne 'gg419-baseline-acceptance/v1' -or $acceptance.state -cne 'accepted-baseline' -or
      $acceptance.evidenceName -cne $reference.evidenceName -or $acceptance.summarySha256 -cne $reference.summary.sha256 -or
      $acceptance.harnessManifestSha256 -cne $qaFrozenHarnessSha -or
      $acceptance.head -cne $Admission.actualMain -or $acceptance.tree -cne $Admission.actualMainTree -or
      $acceptance.merged381 -cne $Admission.merged381 -or $acceptance.merged410 -cne $Admission.merged410) {
    throw 'Baseline differs from root acceptance on the current target'
  }
  $receipt = Confirm-QaPlainPath (Join-Path $qaBatch ('runtime-419-launch-execution-' + $reference.evidenceName.Substring(9))) -Directory
  $resultPath = Confirm-QaPlainPath (Join-Path $receipt 'launch-result.json')
  if ($acceptance.launchResult.path -cne $resultPath) { throw 'Unexpected baseline launch result pathname' }
  Confirm-QaSha $resultPath $acceptance.launchResult.sha256
  $result = Read-QaJson $resultPath
  if ($result.schema -cne 'gg419-native-launch-result/v1' -or $result.phase -cne 'baseline' -or
      $result.wrapperStatus -cne 'matrix-finished-for-review' -or $result.evidence -cne $directory -or
      $result.evidenceSha256['summary.json'] -cne $reference.summary.sha256 -or $result.closingBuild.head -cne $acceptance.head) {
    throw 'Baseline launch result is incomplete or binds a different summary'
  }
  $exitFile = Confirm-QaPlainPath (Join-Path $receipt 'child-exit.json')
  $closeFile = Confirm-QaPlainPath (Join-Path $receipt 'child-close.json')
  Confirm-QaSha $exitFile $result.childExitSha256
  Confirm-QaSha $closeFile $result.childCloseSha256
  $exit = Read-QaJson $exitFile
  $close = Read-QaJson $closeFile
  if ($exit.schema -cne 'gg419-native-child-exit/v1' -or $close.schema -cne 'gg419-native-child-close/v1' -or
      $exit.pid -le 0 -or $exit.pid -ne $close.pid -or !$exit.creationUtc -or $exit.deadlineExpired -or
      $exit.exitCode -ne 0 -or $close.exitCode -ne 0) { throw 'Baseline lacks a successful exact child exit and close' }
  $oldCheckout = Confirm-QaUnder $qaWorktrees $acceptance.checkout
  if ([IO.Path]::GetRelativePath($qaWorktrees,$oldCheckout) -notmatch '^gg-[^\\]+\\GraphGoblin$') {
    throw 'Unexpected baseline checkout provenance'
  }
  $summary = Read-QaJson $summaryPath
  Confirm-QaCompletedSummary $summary 'baseline' $directory $oldCheckout
  if ($summary.runner.pid -ne $exit.pid) { throw 'Baseline summary PID differs from the accepted child' }
  [ordered]@{summary=$reference.summary;acceptance=$reference.acceptance;launchResult=$acceptance.launchResult;
    evidenceName=$reference.evidenceName;head=$acceptance.head}
}

function Confirm-QaLoadedBindings($Summary, $Binding) {
  $names = @('api','routes','history','auth','errors','system','contracts','domain','testing','fastify','zodProvider')
  if ($Summary.bindings.Count -ne $names.Count) { throw 'Incomplete harness runtime binding' }
  foreach ($name in $names) {
    $entry = $Summary.bindings[$name]
    $path = Confirm-QaPlainPath (Confirm-QaUnder $Binding.checkout $entry.file)
    $relative = [IO.Path]::GetRelativePath($Binding.checkout,$path).Replace('\','/')
    $files = if ($name -in @('fastify','zodProvider')) { $Binding.dependencyFiles } else { $Binding.outputFiles }
    if (!$files.Contains($relative) -or $entry.sha256 -cne $files[$relative]) {
      throw "Harness loaded an unbound runtime entry: $name"
    }
  }
}

if ((Confirm-QaPlainPath $PSScriptRoot -Directory) -cne (Join-Path $qaBatch 'runtime-419-execution-preparation')) {
  throw 'Use the reviewed external launch directory'
}
[void](Confirm-QaPlainPath $qaBatch -Directory)
[void](Confirm-QaPlainPath $qaSuite -Directory)
[void](Confirm-QaPlainPath $qaWorktrees -Directory)
[void](Confirm-QaPlainPath $qaNode)
$qaGit = (Get-Command git.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$qaAdmissionPath = Confirm-QaPlainPath (Confirm-QaUnder $qaBatch $AdmissionPath)
Confirm-QaSha $qaAdmissionPath $AdmissionSha256
$qaAdmission = Read-QaJson $qaAdmissionPath
if ($qaAdmission.schema -cne 'gg419-native-launch-admission/v1' -or $qaAdmission.state -cne 'root-admitted' -or
    $qaAdmission.phase -cnotin @('baseline','candidate') -or
    $qaAdmission.evidenceName -cnotmatch ('^evidence-' + $qaAdmission.phase + '-[a-z0-9-]{3,48}$') -or
    $qaAdmission.stopExactSupervisorOnDeadline -isnot [bool] -or !$qaAdmission.Contains('baselineEvidence') -or
    (($qaAdmission.phase -eq 'baseline') -ne ($null -eq $qaAdmission.baselineEvidence))) {
  throw 'Invalid launch admission'
}
foreach ($field in @('head','tree','actualMain','actualMainTree','merged381','merged410')) {
  if ($qaAdmission[$field] -cnotmatch '^[a-f0-9]{40}$') { throw "Invalid bound commit or tree: $field" }
}
if ($qaAdmission.merged381 -ceq $qaAdmission.merged410) { throw 'Expected separate integration commits' }
$qaCheckout = Confirm-QaPlainPath (Confirm-QaUnder $qaWorktrees $qaAdmission.checkout) -Directory
if ([IO.Path]::GetRelativePath($qaWorktrees,$qaCheckout) -notmatch '^gg-[^\\]+\\GraphGoblin$') { throw 'Expected the admitted isolated worktree' }
[void](Confirm-QaPlainPath (Split-Path -Parent $qaCheckout) -Directory)
$qaLauncher = Confirm-QaPlainPath $PSCommandPath
Confirm-QaSha $qaLauncher $qaAdmission.launcherSha256
$qaBindingPath = Confirm-QaPlainPath (Confirm-QaUnder $qaBatch $qaAdmission.buildBinding.path)
Confirm-QaSha $qaBindingPath $qaAdmission.buildBinding.sha256
$qaBinding = Read-QaJson $qaBindingPath
$qaEvidence = Join-Path $qaSuite $qaAdmission.evidenceName
$qaReceipt = Confirm-QaUnder $qaBatch $qaAdmission.receiptDirectory
if ((Split-Path -Parent $qaReceipt) -cne $qaBatch -or
    (Split-Path -Leaf $qaReceipt) -cne ('runtime-419-launch-execution-' + $qaAdmission.evidenceName.Substring(9)) -or
    (Test-Path -LiteralPath $qaReceipt) -or (Test-Path -LiteralPath $qaEvidence)) {
  throw 'Expected fresh #419 supervisor and harness evidence paths'
}

New-Item -ItemType Directory -Path $qaReceipt | Out-Null
[void](Confirm-QaPlainPath $qaReceipt -Directory)
try {
  $qaVersionProbe = New-QaProcessInfo $qaNode $qaBatch @('--version')
  $qaVersionProbe.Environment.Clear()
  $qaVersionProbe.Environment['SystemRoot'] = $env:SystemRoot
  $qaVersionProbe.Environment['WINDIR'] = $env:SystemRoot
  if ((Read-QaProcessText $qaVersionProbe 'Project Node version query').Trim() -cne 'v22.23.4') {
    throw 'Wrong project Node version'
  }
  $qaHarnessBefore = Read-QaFrozenHarness
  $qaBuildBefore = Read-QaBuild $qaAdmission $qaBinding
  $qaBaselineBefore = if ($qaAdmission.phase -eq 'candidate') { Read-QaBaseline $qaAdmission } else { $null }
  Write-QaJson (Join-Path $qaReceipt 'preflight.json') ([ordered]@{
    checkedAtUtc=[DateTime]::UtcNow.ToString('o'); admissionPath=$qaAdmissionPath; admissionSha256=$AdmissionSha256;
    bindingPath=$qaBindingPath; build=$qaBuildBefore; harness=$qaHarnessBefore; baseline=$qaBaselineBefore;
    exactEvidence=$qaEvidence; launcherSha256=$qaAdmission.launcherSha256
  })
} catch {
  Write-QaJson (Join-Path $qaReceipt 'preflight-error.json') ([ordered]@{
    error=$_.Exception.Message; observedAtUtc=[DateTime]::UtcNow.ToString('o'); harnessLaunched=$false
  })
  throw
}

$qaTemp = Join-Path $qaReceipt 'process-temp'
New-Item -ItemType Directory -Path $qaTemp | Out-Null
[void](Confirm-QaPlainPath $qaTemp -Directory)
$qaArgs = @('--expose-gc',(Join-Path $qaSuite 'run.mjs'),$qaAdmission.phase,$qaCheckout,$qaAdmission.evidenceName)
if ($qaAdmission.phase -eq 'candidate') { $qaArgs += $qaAdmission.baselineEvidence.evidenceName }
$qaInfo = New-QaProcessInfo $qaNode $qaReceipt $qaArgs
$qaInfo.Environment.Clear()
$qaInfo.Environment['SystemRoot'] = $env:SystemRoot
$qaInfo.Environment['WINDIR'] = $env:SystemRoot
$qaInfo.Environment['TEMP'] = $qaTemp
$qaInfo.Environment['TMP'] = $qaTemp
$qaOut = $null
$qaErr = $null
$qaChild = $null
$qaBirth = $null
$qaBirthError = $null
$qaExpired = $false
$qaExit = $null
$qaExitFile = Join-Path $qaReceipt 'child-exit.json'
function Write-QaExit {
  $raw = [ordered]@{schema='gg419-native-child-exit/v1';pid=$qaChild.Id;exitCode=$qaChild.ExitCode;
    creationUtc=if($qaBirth){$qaBirth.ToString('o')};creationError=$qaBirthError;
    exitTimeUtc=$qaChild.ExitTime.ToUniversalTime().ToString('o');deadlineExpired=$qaExpired}
  Write-QaJson $qaExitFile $raw
  $raw
}

try {
  if (Test-Path -LiteralPath $qaEvidence) { throw 'Evidence path occupied before launch' }
  $qaOut = [IO.File]::Open((Join-Path $qaReceipt 'stdout.log'),'CreateNew','Write','Read')
  $qaErr = [IO.File]::Open((Join-Path $qaReceipt 'stderr.log'),'CreateNew','Write','Read')
  Write-QaJson (Join-Path $qaReceipt 'launch-attempt.json') ([ordered]@{
    requestedAtUtc=[DateTime]::UtcNow.ToString('o'); executable=$qaNode;arguments=$qaArgs;workingDirectory=$qaReceipt;
    environmentKeys=@($qaInfo.Environment.Keys|Sort-Object);evidence=$qaEvidence;deadlineMilliseconds=$qaDeadlineMilliseconds
  })
  $qaChild = [Diagnostics.Process]::Start($qaInfo)
  if (!$qaChild) { throw 'Could not obtain a direct harness child' }
  $qaClock = [Diagnostics.Stopwatch]::StartNew()
  $qaOutTask = $qaChild.StandardOutput.BaseStream.CopyToAsync($qaOut)
  $qaErrTask = $qaChild.StandardError.BaseStream.CopyToAsync($qaErr)
  try { $qaBirth = $qaChild.StartTime.ToUniversalTime() } catch { $qaBirthError = $_.Exception.Message }
  $qaLaunch = [ordered]@{pid=$qaChild.Id;parentPid=$PID;creationUtc=if($qaBirth){$qaBirth.ToString('o')};
    creationError=$qaBirthError;executable=$qaNode;arguments=$qaArgs;workingDirectory=$qaReceipt;
    nodeOptionsPresent=$false;evidence=$qaEvidence;deadlineMilliseconds=$qaDeadlineMilliseconds}
  Write-QaJson (Join-Path $qaReceipt 'launch.json') $qaLaunch
  $qaLaunch | ConvertTo-Json -Depth 6 -Compress

  while (!$qaChild.WaitForExit(1000)) {
    if (!$qaExpired -and $qaClock.ElapsedMilliseconds -ge $qaDeadlineMilliseconds) {
      $qaExpired = $true
      Write-QaJson (Join-Path $qaReceipt 'supervisor-deadline.json') ([ordered]@{
        pid=$qaChild.Id;creationUtc=$qaLaunch.creationUtc;observedAtUtc=[DateTime]::UtcNow.ToString('o');
        stopExactSupervisorOnDeadline=$qaAdmission.stopExactSupervisorOnDeadline
      })
      if ($qaAdmission.stopExactSupervisorOnDeadline -and $qaBirth -and !$qaChild.HasExited) {
        if ($qaChild.StartTime.ToUniversalTime() -ne $qaBirth) { throw 'Supervisor birth identity changed' }
        try { $qaChild.Kill($false) } catch { if (!$qaChild.HasExited) { throw } }
      }
      [Console]::Error.WriteLine('QA supervisor deadline elapsed. See the exact process receipt for disposition.')
    }
  }

  # Retain the actual child exit before pipe drains, harness JSON or any derived readback.
  $qaExit = Write-QaExit
  if (![Threading.Tasks.Task]::WaitAll(@($qaOutTask,$qaErrTask),10000)) { throw 'Child output did not close after the recorded exit' }
  Write-QaJson (Join-Path $qaReceipt 'child-close.json') ([ordered]@{
    schema='gg419-native-child-close/v1'; pid=$qaChild.Id; exitCode=$qaExit.exitCode;
    stdoutBytes=$qaOut.Length; stderrBytes=$qaErr.Length; closedAtUtc=[DateTime]::UtcNow.ToString('o')
  })
} catch {
  $qaError = $_.Exception.Message
  if ($qaChild -and $qaChild.HasExited -and !(Test-Path -LiteralPath $qaExitFile)) { $qaExit = Write-QaExit }
  Write-QaJson (Join-Path $qaReceipt 'supervision-error.json') ([ordered]@{
    pid=if($qaChild){$qaChild.Id};creationUtc=if($qaBirth){$qaBirth.ToString('o')};
    knownExited=[bool]($qaChild -and $qaChild.HasExited);error=$qaError;observedAtUtc=[DateTime]::UtcNow.ToString('o')
  })
  throw
} finally {
  if ($qaOut) { $qaOut.Dispose() }
  if ($qaErr) { $qaErr.Dispose() }
  if ($qaChild) { $qaChild.Dispose() }
}

try {
  $qaEvidenceHashes = [ordered]@{}
  if (Test-Path -LiteralPath $qaEvidence) {
    [void](Confirm-QaPlainPath $qaEvidence -Directory)
    foreach ($name in @('runner.json','summary.json')) {
      $path = Join-Path $qaEvidence $name
      if (Test-Path -LiteralPath $path) { $qaEvidenceHashes[$name] = Get-QaSha (Confirm-QaPlainPath $path) }
    }
  }
  $qaSummary = if ($qaEvidenceHashes.Contains('summary.json')) { Read-QaJson (Join-Path $qaEvidence 'summary.json') } else { $null }
  Confirm-QaSha $qaAdmissionPath $AdmissionSha256
  Confirm-QaSha $qaBindingPath $qaAdmission.buildBinding.sha256
  Confirm-QaSha $qaLauncher $qaAdmission.launcherSha256
  $qaHarnessAfter = Read-QaFrozenHarness
  $qaBuildAfter = Read-QaBuild $qaAdmission $qaBinding
  $qaBaselineAfter = if ($qaAdmission.phase -eq 'candidate') { Read-QaBaseline $qaAdmission } else { $null }
  $qaCompleted = $qaExit.exitCode -eq 0 -and !$qaExpired -and $null -ne $qaBirth -and
    $qaEvidenceHashes.Contains('runner.json') -and $qaSummary.result -ceq 'assertions-met'
  if ($qaCompleted) {
    Confirm-QaCompletedSummary $qaSummary $qaAdmission.phase $qaEvidence $qaCheckout
    if ($qaSummary.runner.pid -ne $qaExit.pid) { throw 'Harness summary PID differs from exact child' }
    Confirm-QaLoadedBindings $qaSummary $qaBinding
    if ($qaAdmission.phase -eq 'candidate' -and
        ($qaSummary.baseline.directory -cne (Join-Path $qaSuite $qaAdmission.baselineEvidence.evidenceName))) {
      throw 'Harness consumed a different baseline'
    }
  }
  $qaResult = [ordered]@{schema='gg419-native-launch-result/v1';phase=$qaAdmission.phase;childExit=$qaExit;
    wrapperStatus=if($qaCompleted){'matrix-finished-for-review'}else{'incomplete'};
    harnessResult=$qaSummary.result;evidence=$qaEvidence;evidenceSha256=$qaEvidenceHashes;
    childExitSha256=(Get-QaSha $qaExitFile);childCloseSha256=(Get-QaSha (Join-Path $qaReceipt 'child-close.json'));
    stdoutSha256=(Get-QaSha (Join-Path $qaReceipt 'stdout.log'));stderrSha256=(Get-QaSha (Join-Path $qaReceipt 'stderr.log'));
    closingBuild=$qaBuildAfter;closingHarness=$qaHarnessAfter;baseline=$qaBaselineAfter;
    phaseInterpretation=if($qaAdmission.phase -eq 'baseline'){
      'Baseline oracles require extra replay pages after observed response close in non-rejection cases'
    }else{'Candidate oracles require no further reads or writes after observed response close and baseline-equivalent connected responses'}
  }
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
exit 0

