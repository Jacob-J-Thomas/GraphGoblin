#Requires -Version 7.0
param([Parameter(Mandatory=$true)][string]$BindingPath, [switch]$Execute)
$ErrorActionPreference = 'Stop'
if (-not $Execute) { throw 'UNARMED: explicit root-bound execution switch absent' }
$taskRoot = 'G:/ggq/gg-i5-offline-ui-qa/GraphGoblin'
$taskEvidence = 'G:/ggq/delivery-evidence/2026-11-17-five-intents/i5-d242-b2-independent63-execution-01'
$binding = Get-Content -LiteralPath $BindingPath -Raw | ConvertFrom-Json -AsHashtable
if ($binding.schemaVersion -ne 1 -or $binding.executionAdmitted -ne $true) { throw 'UNARMED: root admission absent' }
if ([IO.Path]::GetFullPath($binding.worktree) -ine [IO.Path]::GetFullPath($taskRoot) -or [IO.Path]::GetFullPath($binding.executionDirectory) -ine [IO.Path]::GetFullPath($taskEvidence)) { throw 'Unexpected owned paths' }
if ($binding.source.head -notmatch '^[0-9a-f]{40}$' -or $binding.source.tree -notmatch '^[0-9a-f]{40}$' -or $binding.source.indexSha256 -notmatch '^[0-9a-f]{64}$' -or $binding.source.stagedEntriesSha256 -notmatch '^[0-9a-f]{64}$') { throw 'UNARMED: immutable corrected-source/index binding absent' }
function Get-Sha([string]$Path) { return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
function Save-Json([string]$Name, $Value) {
  $path = Join-Path $taskEvidence $Name
  if (Test-Path -LiteralPath $path) { throw "Refusing to overwrite $Name" }
  [IO.File]::WriteAllText($path, ($Value | ConvertTo-Json -Depth 100) + "`n", [Text.UTF8Encoding]::new($false))
}
function Same-Path([string]$Left, [string]$Right) {
  return [string]::Equals([IO.Path]::GetFullPath($Left), [IO.Path]::GetFullPath($Right), [StringComparison]::OrdinalIgnoreCase)
}
function Same-Value($Left, $Right) {
  if ($null -eq $Left) { return $null -eq $Right }
  if ($Left -is [Collections.IDictionary]) {
    if ($Right -isnot [Collections.IDictionary] -or $Left.Count -ne $Right.Count) { return $false }
    foreach ($key in $Left.Keys) { if (-not $Right.Contains($key) -or -not (Same-Value $Left[$key] $Right[$key])) { return $false } }
    return $true
  }
  if ($Left -is [Collections.IList]) {
    if ($Right -isnot [Collections.IList] -or $Left.Count -ne $Right.Count) { return $false }
    for ($i=0; $i -lt $Left.Count; $i++) { if (-not (Same-Value $Left[$i] $Right[$i])) { return $false } }
    return $true
  }
  return $Left -ceq $Right
}
if ($binding.rootAdmission.sha256 -notmatch '^[0-9a-f]{64}$' -or (Get-Sha $binding.rootAdmission.path) -ne $binding.rootAdmission.sha256) { throw 'Root admission receipt mismatch' }
$manifestPath = Join-Path $PSScriptRoot 'MANIFEST.json'
if ($binding.preparationManifestSha256 -notmatch '^[0-9a-f]{64}$' -or (Get-Sha $manifestPath) -ne $binding.preparationManifestSha256) { throw 'Preparation manifest mismatch' }
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json -AsHashtable
foreach ($member in $manifest.members) {
  $path = Join-Path $PSScriptRoot $member.path
  if ((Get-Item -LiteralPath $path).Length -ne $member.bytes -or (Get-Sha $path) -ne $member.sha256) { throw "Preparation member drift: $($member.path)" }
}
$template = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'ROOT-BINDING.template.json') -Raw | ConvertFrom-Json -AsHashtable
foreach ($key in @('selection','overlays','runtime','selectedModules','childEnvironmentControl')) {
  if (-not (Same-Value $binding[$key] $template[$key])) { throw "Unadmitted mechanics change: $key" }
}
if ($binding.rootInstallInputs19.Count -ne 19 -or $binding.independentInputs18.Count -ne 18 -or $binding.metadata.Count -ne 3 -or $binding.overlays.Count -ne 5 -or $binding.selectedModules.Count -ne 11) { throw 'Cohort count mismatch' }
foreach ($group in @('rootInstallInputs19','independentInputs18','metadata')) {
  if (-not (Same-Value $binding[$group] $template[$group])) { throw "Existing install/dependency cohort changed: $group" }
}
foreach ($requiredSource in $template.source.selectedSources.Keys) {
  if (-not $binding.source.selectedSources.Contains($requiredSource)) { throw "Required source pin absent: $requiredSource" }
}
if (Test-Path -LiteralPath $taskEvidence) { throw 'Execution directory already exists; no overwrite or automatic rerun' }
[void][IO.Directory]::CreateDirectory($taskEvidence)
$env:PATH = "$env:USERPROFILE/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64;$env:PATH"
$env:GIT_OPTIONAL_LOCKS = '0'
$pnpmExe = $binding.runtime.pnpm.pnpmExecutable
$nodeExe = (Get-Command node).Source
$receipts = [Collections.Generic.List[object]]::new()

function Invoke-GitBytes([string[]]$Arguments) {
  $psi = [Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = 'git'
  foreach ($argument in @('--no-optional-locks','-C',$taskRoot) + $Arguments) { $psi.ArgumentList.Add($argument) }
  $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
  $process = [Diagnostics.Process]::new(); $process.StartInfo = $psi
  $memory = [IO.MemoryStream]::new()
  try {
    if (-not $process.Start()) { throw 'Read-only Git failed to start' }
    $outTask = $process.StandardOutput.BaseStream.CopyToAsync($memory)
    $errTask = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit(); [void]$outTask.GetAwaiter().GetResult()
    $errorText = $errTask.GetAwaiter().GetResult()
    if ($process.ExitCode -ne 0) { throw "Read-only Git failed [$($Arguments -join ' ')]: $errorText" }
    return ,($memory.ToArray())
  } finally { $memory.Dispose(); $process.Dispose() }
}
function Git-Text([string[]]$Arguments) { return [Text.Encoding]::UTF8.GetString((Invoke-GitBytes -Arguments $Arguments)) }
function Get-RelativeSha([string]$Relative) {
  $path = [IO.Path]::GetFullPath((Join-Path $taskRoot $Relative))
  if (-not $path.StartsWith(([IO.Path]::GetFullPath($taskRoot).TrimEnd('\') + '\'), [StringComparison]::OrdinalIgnoreCase)) { throw 'Binding path escaped owned checkout' }
  return Get-Sha $path
}
function Get-Pins {
  $index = (Git-Text -Arguments @('rev-parse','--path-format=absolute','--git-path','index')).Trim()
  $common = (Git-Text -Arguments @('rev-parse','--path-format=absolute','--git-common-dir')).Trim()
  $stagedBytes = Invoke-GitBytes -Arguments @('ls-files','--stage','-z')
  $result = [ordered]@{
    head = (Git-Text -Arguments @('rev-parse','HEAD')).Trim()
    tree = (Git-Text -Arguments @('rev-parse','HEAD^{tree}')).Trim()
    indexSha256 = Get-Sha $index
    stagedEntriesSha256 = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($stagedBytes)).ToLowerInvariant()
    commonIndexExists = Test-Path -LiteralPath (Join-Path $common 'index')
    status = @((Git-Text -Arguments @('status','--porcelain=v1','--untracked-files=all','-z')).Split([char]0) | Where-Object { $_ -ne '' })
  }
  foreach ($group in @('selectedSources','rootInstallInputs19','independentInputs18','metadata','overlays')) {
    $expected = if ($group -eq 'selectedSources') { $binding.source.selectedSources } else { $binding[$group] }
    $pins = [ordered]@{}
    foreach ($path in $expected.Keys) {
      $digest = Get-RelativeSha $path
      $pins[$path] = if ($group -eq 'rootInstallInputs19') { [ordered]@{bytes=(Get-Item -LiteralPath (Join-Path $taskRoot $path)).Length; sha256=$digest} } else { $digest }
    }
    $result[$group] = $pins
  }
  if ((Invoke-GitBytes -Arguments @('diff','--exit-code','--no-ext-diff')).Length -ne 0) { throw 'Tracked diff output' }
  if ((Invoke-GitBytes -Arguments @('diff','--cached','--exit-code','--no-ext-diff')).Length -ne 0) { throw 'Staged diff output' }
  $result['trackedAndStagedDiffExit'] = 0
  return $result
}
function Assert-Pins($Actual) {
  foreach ($key in @('head','tree','indexSha256','stagedEntriesSha256','commonIndexExists','status','selectedSources')) {
    if (-not (Same-Value $Actual[$key] $binding.source[$key])) { throw "Source/index drift: $key" }
  }
  foreach ($key in @('rootInstallInputs19','independentInputs18','metadata','overlays')) {
    if (-not (Same-Value $Actual[$key] $binding[$key])) { throw "Cohort drift: $key" }
  }
  if ($Actual.commonIndexExists) { throw 'Unexpected common index' }
}
function Invoke-RecordedPnpm([string]$Label, [string[]]$Arguments) {
  if ((Get-Sha $pnpmExe) -ne $binding.runtime.pnpm.executableSha256 -or -not (Same-Path (Get-Command node).Source $nodeExe) -or (Get-Sha $nodeExe) -ne $binding.runtime.node.sha256) { throw 'Runtime identity changed before command' }
  $start = [DateTimeOffset]::UtcNow.ToString('o')
  $outPath = Join-Path $taskEvidence "$Label.stdout.log"
  $errPath = Join-Path $taskEvidence "$Label.stderr.log"
  Save-Json "$Label.start.json" ([ordered]@{label=$Label; fileName=$pnpmExe; argv=$Arguments; cwd=$taskRoot; startUtc=$start; shell=$false; nodeFirstOnPath=$nodeExe; childEnvironmentControl=$binding.childEnvironmentControl})
  $psi = [Diagnostics.ProcessStartInfo]::new(); $psi.FileName = $pnpmExe
  foreach ($argument in $Arguments) { $psi.ArgumentList.Add($argument) }
  $psi.WorkingDirectory = $taskRoot; $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
  $psi.Environment['GG_OLLAMA_ENABLED'] = 'false'; [void]$psi.Environment.Remove('LIVE')
  $process = [Diagnostics.Process]::new(); $process.StartInfo = $psi
  $stdout = [IO.File]::Open($outPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
  $stderr = [IO.File]::Open($errPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
  $exitCode = $null; $failure = $null
  try {
    if (-not $process.Start()) { throw 'pnpm failed to start' }
    $outTask = $process.StandardOutput.BaseStream.CopyToAsync($stdout)
    $errTask = $process.StandardError.BaseStream.CopyToAsync($stderr)
    $process.WaitForExit(); [void]$outTask.GetAwaiter().GetResult(); [void]$errTask.GetAwaiter().GetResult()
    $exitCode = $process.ExitCode
  } catch { $failure = $_.Exception.Message }
  finally { $stdout.Dispose(); $stderr.Dispose(); $process.Dispose() }
  $receipt = [ordered]@{label=$Label; fileName=$pnpmExe; argv=$Arguments; cwd=$taskRoot; startUtc=$start; endUtc=[DateTimeOffset]::UtcNow.ToString('o'); exitCode=$exitCode; startOrCaptureFailure=$failure; shell=$false; nodeFirstOnPath=$nodeExe; childEnvironmentControl=$binding.childEnvironmentControl; stdout=$outPath; stderr=$errPath; stdoutSha256=(Get-Sha $outPath); stderrSha256=(Get-Sha $errPath)}
  Save-Json "$Label.receipt.json" $receipt; $receipts.Add($receipt)
  if ($failure) { throw $failure }
  return $receipt
}
function Assert-Command($Receipt) { if ($Receipt.exitCode -ne 0) { throw "Command failed: $($Receipt.label), exit$($Receipt.exitCode); stop, preserve, await root" } }
function Assert-Modules($Actual) {
  if ($Actual.node.version -ne 'v22.23.4' -or -not (Same-Path $Actual.node.path $binding.runtime.node.path) -or $Actual.node.sha256 -ne $binding.runtime.node.sha256) { throw 'Module snapshot Node drift' }
  if ($Actual.selected.Count -ne $binding.selectedModules.Count) { throw 'Module count drift' }
  for ($i=0; $i -lt $binding.selectedModules.Count; $i++) {
    $wanted = $binding.selectedModules[$i]; $got = $Actual.selected[$i]
    foreach ($key in $wanted.Keys) {
      $equal = if ($key -in @('entry','realEntry','manifest')) { Same-Path $got[$key] $wanted[$key] } else { $got[$key] -eq $wanted[$key] }
      if (-not $equal) { throw "Selected module drift: $($wanted.name)/$key" }
    }
  }
}
$stage = 'before'; $phaseFailure = $null; $beforeModules = $false; $afterEqual = $false
try {
  Save-Json 'ROOT-BINDING.executed.json' $binding
  $before = Get-Pins; Save-Json 'before.json' $before; Assert-Pins $before
  if (-not (Same-Path $nodeExe $binding.runtime.node.path) -or (Get-Sha $nodeExe) -ne $binding.runtime.node.sha256) { throw 'First Node on PATH drift' }
  foreach ($pair in @(@('pnpmLauncher','launcherSha256'),@('pnpmExecutable','executableSha256'),@('packagePath','packageSha256'))) {
    if ((Get-Sha $binding.runtime.pnpm[$pair[0]]) -ne $binding.runtime.pnpm[$pair[1]]) { throw "pnpm identity drift: $($pair[0])" }
  }
  $probe = Invoke-RecordedPnpm -Label '01-node-probe' -Arguments @('--filter','@graphgoblin/web','exec','node','--eval','process.stdout.write(JSON.stringify({version:process.version,path:process.execPath}))')
  Assert-Command $probe
  $selected = Get-Content -LiteralPath $probe.stdout -Raw | ConvertFrom-Json -AsHashtable
  if ($selected.version -ne 'v22.23.4' -or -not (Same-Path $selected.path $nodeExe) -or (Get-Sha $selected.path) -ne (Get-Sha $nodeExe)) { throw 'pnpm selected unexpected Node' }
  Save-Json 'NODE-PROBE-QUALIFICATION.json' ([ordered]@{selectedVersion=$selected.version; selectedPath=$selected.path; expectedPath=$nodeExe; selectedNormalized=[IO.Path]::GetFullPath($selected.path); expectedNormalized=[IO.Path]::GetFullPath($nodeExe); selectedSha256=(Get-Sha $selected.path); equal=$true})
  $moduleScript = Join-Path $PSScriptRoot 'module-boundary.cjs'
  $moduleBefore = Invoke-RecordedPnpm -Label '02-before-modules' -Arguments @('--filter','@graphgoblin/web','exec','node',$moduleScript)
  Assert-Command $moduleBefore
  Assert-Modules (Get-Content -LiteralPath $moduleBefore.stdout -Raw | ConvertFrom-Json -AsHashtable)
  $beforeModules = $true
  $stage = 'typecheck'
  Assert-Command (Invoke-RecordedPnpm -Label '03-web-typecheck' -Arguments @('--filter','@graphgoblin/web','typecheck'))
  $relativeOverlays = @('src/runs/RunInspectorPage.independent-416.qa.test.tsx')
  $stage = 'lint'
  Assert-Command (Invoke-RecordedPnpm -Label '04-scoped-eslint' -Arguments (@('--filter','@graphgoblin/web','exec','eslint') + $relativeOverlays))
  $stage = 'format'
  Assert-Command (Invoke-RecordedPnpm -Label '05-scoped-prettier' -Arguments (@('exec','prettier','--check') + @($relativeOverlays | ForEach-Object { 'apps/web/' + $_ })))
  Assert-Pins (Get-Pins)
  $stage = 'fresh2'
  $jsonPath = Join-Path $taskEvidence '06-fresh2.json'
  $test = Invoke-RecordedPnpm -Label '06-fresh2' -Arguments @('--filter','@graphgoblin/web','exec','vitest','run','src/runs/RunInspectorPage.independent-416.qa.test.tsx','--testNamePattern','B1 residual: observation replacement after surfaced loss','--maxWorkers=1','--retry=0','--reporter=default','--reporter=json',"--outputFile=$jsonPath")
  if (Test-Path -LiteralPath $jsonPath) {
    $result = Get-Content -LiteralPath $jsonPath -Raw | ConvertFrom-Json -AsHashtable
    $cases = @($result.testResults | ForEach-Object { $_.assertionResults } | ForEach-Object { $_ })
    $summary = [ordered]@{actualCases=$cases.Count; passed=@($cases | Where-Object status -eq 'passed').Count; failed=@($cases | Where-Object status -eq 'failed').Count; filteredOrPending=@($cases | Where-Object { $_.status -in @('pending','skipped') }).Count; todo=@($cases | Where-Object status -eq 'todo').Count; expectedCases=63; expectedSelected=2; expectedFiltered=61; patternUsed=$true; processExit=$test.exitCode}
    Save-Json 'FRESH2-SELECTION.json' $summary
    if ($summary.actualCases -ne 63 -or ($summary.passed + $summary.failed) -ne 2 -or $summary.filteredOrPending -ne 61 -or $summary.todo -ne 0) { throw 'Targeted2 selection mismatch; no pass or automatic retry' }
  } else { throw 'Vitest JSON missing; no result inferred' }
  Assert-Command $test
  Assert-Pins (Get-Pins)
  # A separate pnpm/Vitest invocation creates another fresh worker. Its earlier61 cases
  # create browser-loss history, so full63 is broader regression, not the fresh2 witness.
  $stage = 'full63'
  $fullJsonPath = Join-Path $taskEvidence '07-full63.json'
  $fullTest = Invoke-RecordedPnpm -Label '07-full63' -Arguments @('--filter','@graphgoblin/web','exec','vitest','run','src/runs/RunInspectorPage.independent-416.qa.test.tsx','--maxWorkers=1','--retry=0','--reporter=default','--reporter=json',"--outputFile=$fullJsonPath")
  if (Test-Path -LiteralPath $fullJsonPath) {
    $fullResult = Get-Content -LiteralPath $fullJsonPath -Raw | ConvertFrom-Json -AsHashtable
    $fullCases = @($fullResult.testResults | ForEach-Object { $_.assertionResults } | ForEach-Object { $_ })
    $fullSummary = [ordered]@{actualCases=$fullCases.Count; passed=@($fullCases | Where-Object status -eq 'passed').Count; failed=@($fullCases | Where-Object status -eq 'failed').Count; filteredOrPending=@($fullCases | Where-Object { $_.status -in @('pending','skipped') }).Count; todo=@($fullCases | Where-Object status -eq 'todo').Count; expectedCases=63; expectedSelected=63; expectedFiltered=0; patternUsed=$false; processExit=$fullTest.exitCode}
    Save-Json 'FULL63-SELECTION.json' $fullSummary
    if ($fullSummary.actualCases -ne 63 -or ($fullSummary.passed + $fullSummary.failed) -ne 63 -or $fullSummary.filteredOrPending -ne 0 -or $fullSummary.todo -ne 0) { throw 'Full63 selection mismatch; no pass or automatic retry' }
  } else { throw 'Full63 Vitest JSON missing; no result inferred' }
  Assert-Command $fullTest
  $stage = 'completed'
} catch { $phaseFailure = $_.ToString() }
finally {
  try {
    if ($beforeModules) {
      $moduleAfter = Invoke-RecordedPnpm -Label '08-after-modules' -Arguments @('--filter','@graphgoblin/web','exec','node',(Join-Path $PSScriptRoot 'module-boundary.cjs'))
      Assert-Command $moduleAfter
      Assert-Modules (Get-Content -LiteralPath $moduleAfter.stdout -Raw | ConvertFrom-Json -AsHashtable)
    }
  } catch { $phaseFailure = "$phaseFailure`nRead-only closure: $($_.ToString())" }
  try {
    $after = Get-Pins; Save-Json 'after.json' $after; Assert-Pins $after; $afterEqual = $true
  } catch { $phaseFailure = "$phaseFailure`nFinal source/index closure: $($_.ToString())" }
  Save-Json 'PHASE-RECEIPT.json' ([ordered]@{stageReached=$stage; failure=$phaseFailure; afterMatchesRootBinding=$afterEqual; rootBindingPath=$BindingPath; rootBindingSha256=(Get-Sha $BindingPath); commands=$receipts.ToArray(); testsBuildBrowserScope='Only admitted static checks and one component file; no build/browser/install/provider/native-listener launch'; sourceFixesOrReruns=$false})
}
if ($phaseFailure) { Write-Error -Message $phaseFailure -ErrorAction Continue; exit 1 }
Get-Content -LiteralPath (Join-Path $taskEvidence 'FRESH2-SELECTION.json') -Raw
Get-Content -LiteralPath (Join-Path $taskEvidence 'FULL63-SELECTION.json') -Raw
exit 0
