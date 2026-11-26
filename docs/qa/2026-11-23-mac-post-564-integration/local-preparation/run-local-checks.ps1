#Requires -Version 7.0
param([Parameter(Mandatory=$true)][string]$BindingPath, [switch]$Execute)
$ErrorActionPreference = 'Stop'
if (-not $Execute) { throw 'UNARMED: root binding and explicit -Execute are required' }
$taskRoot = 'G:/ggq/gg-macos-current-main/GraphGoblin'
$taskOutput = 'G:/ggq/delivery-evidence/2026-11-17-five-intents/mac-post-564-local-checks-01'
$binding = Get-Content -Raw -LiteralPath $BindingPath | ConvertFrom-Json -AsHashtable
$template = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'ROOT-BINDING.template.json') | ConvertFrom-Json -AsHashtable
function Sha([string]$Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
function Same($Left, $Right) {
  if ($null -eq $Left) { return $null -eq $Right }
  if ($Left -is [Collections.IDictionary]) {
    if ($Right -isnot [Collections.IDictionary] -or $Left.Count -ne $Right.Count) { return $false }
    foreach ($key in $Left.Keys) { if (-not $Right.Contains($key) -or -not (Same $Left[$key] $Right[$key])) { return $false } }
    return $true
  }
  if ($Left -is [Collections.IList]) {
    if ($Right -isnot [Collections.IList] -or $Left.Count -ne $Right.Count) { return $false }
    for ($i=0; $i -lt $Left.Count; $i++) { if (-not (Same $Left[$i] $Right[$i])) { return $false } }
    return $true
  }
  return $Left -ceq $Right
}
function Same-Path([string]$Left, [string]$Right) { [string]::Equals([IO.Path]::GetFullPath($Left), [IO.Path]::GetFullPath($Right), [StringComparison]::OrdinalIgnoreCase) }
if ($binding.schemaVersion -ne 1 -or $binding.executionAdmitted -ne $true) { throw 'UNARMED: root admission absent' }
if (-not (Same-Path $binding.worktree $taskRoot) -or -not (Same-Path $binding.executionDirectory $taskOutput)) { throw 'Unadmitted worktree/output path' }
foreach ($key in @('runtime','source18','gates','childEnvironmentControl')) { if (-not (Same $binding[$key] $template[$key])) { throw "Unadmitted preparation change: $key" } }
foreach ($key in @('head','tree','mainRef')) { if ($binding.source[$key] -notmatch '^[0-9a-f]{40}$') { throw "Missing immutable source field: $key" } }
foreach ($key in @('indexSha256','stagedEntriesSha256','commonHeadSha256')) { if ($binding.source[$key] -notmatch '^[0-9a-f]{64}$') { throw "Missing source preservation field: $key" } }
if ($binding.source.commonIndexExists -ne $false -or $binding.source.status.Count -ne 0) { throw 'Clean NEXT/common-index absence required' }
if ($binding.rootAdmission.sha256 -notmatch '^[0-9a-f]{64}$' -or (Sha $binding.rootAdmission.path) -ne $binding.rootAdmission.sha256) { throw 'Root admission digest mismatch' }
$admission = Get-Content -Raw -LiteralPath $binding.rootAdmission.path | ConvertFrom-Json -AsHashtable
if ($admission.executionAdmitted -ne $true -or $admission.head -ne $binding.source.head) { throw 'Root admission must explicitly name this head' }
$manifestPath = Join-Path $PSScriptRoot 'MANIFEST.json'
if ((Sha $manifestPath) -ne $binding.preparationManifestSha256) { throw 'Preparation seal mismatch' }
foreach ($member in (Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json -AsHashtable).members) {
  $path = Join-Path $PSScriptRoot $member.path
  if ((Get-Item -LiteralPath $path).Length -ne $member.bytes -or (Sha $path) -ne $member.sha256) { throw "Preparation drift: $($member.path)" }
}
if (Test-Path -LiteralPath $taskOutput) { throw 'Execution directory exists; no overwrite or retry' }
[void][IO.Directory]::CreateDirectory($taskOutput)
[IO.File]::Copy([IO.Path]::GetFullPath($BindingPath), (Join-Path $taskOutput 'ROOT-BINDING.executed.json'), $false)
$env:PATH = "$(Split-Path -Parent $binding.runtime.node.path);$env:PATH"
$env:GIT_OPTIONAL_LOCKS = '0'
$commands = [Collections.Generic.List[object]]::new()
function Save([string]$Name, $Value) {
  $path = Join-Path $taskOutput $Name
  if (Test-Path -LiteralPath $path) { throw "Refusing overwrite: $Name" }
  [IO.File]::WriteAllText($path, ($Value | ConvertTo-Json -Depth 100) + "`n", [Text.UTF8Encoding]::new($false))
}
function Git([string[]]$Arguments) {
  $psi = [Diagnostics.ProcessStartInfo]::new(); $psi.FileName = 'git'; $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
  foreach ($arg in @('--no-optional-locks','-C',$taskRoot) + $Arguments) { $psi.ArgumentList.Add($arg) }
  $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
  $process = [Diagnostics.Process]::new(); $process.StartInfo = $psi; $memory = [IO.MemoryStream]::new()
  try {
    if (-not $process.Start()) { throw 'Read-only Git did not start' }
    $out = $process.StandardOutput.BaseStream.CopyToAsync($memory); $err = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit(); [void]$out.GetAwaiter().GetResult(); $errorText = $err.GetAwaiter().GetResult()
    if ($process.ExitCode -ne 0) { throw "Read-only Git failed: $errorText" }
    return ,($memory.ToArray())
  } finally { $memory.Dispose(); $process.Dispose() }
}
function Git-Text([string[]]$Arguments) { [Text.Encoding]::UTF8.GetString((Git $Arguments)) }
function Pins {
  $index = (Git-Text @('rev-parse','--path-format=absolute','--git-path','index')).Trim()
  $common = (Git-Text @('rev-parse','--path-format=absolute','--git-common-dir')).Trim()
  $staged = Git @('ls-files','--stage','-z')
  $blobs = @{}
  $entries = (Git-Text (@('ls-tree','-r','-z','HEAD','--') + @($binding.source18.Keys))).Split([char]0)
  foreach ($entry in $entries) {
    if ($entry -match '^([0-7]{6}) blob ([0-9a-f]{40})\t(.+)$') { $blobs[$Matches[3]] = @{mode=$Matches[1]; blob=$Matches[2]} }
  }
  if ($blobs.Count -ne 18) { throw 'Frozen18 blob cohort missing' }
  $sources = [ordered]@{}
  foreach ($path in $binding.source18.Keys) {
    $absolute = Join-Path $taskRoot $path
    $sources[$path] = [ordered]@{mode=$blobs[$path].mode; blob=$blobs[$path].blob; bytes=(Get-Item -LiteralPath $absolute).Length; sha256=(Sha $absolute)}
  }
  return [ordered]@{
    head=(Git-Text @('rev-parse','HEAD')).Trim(); tree=(Git-Text @('rev-parse','HEAD^{tree}')).Trim()
    mainRef=(Git-Text @('rev-parse','refs/heads/main')).Trim()
    indexSha256=(Sha $index); stagedEntriesSha256=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($staged)).ToLowerInvariant()
    commonHeadSha256=(Sha (Join-Path $common 'HEAD')); commonIndexExists=(Test-Path -LiteralPath (Join-Path $common 'index'))
    status=@((Git-Text @('status','--porcelain=v1','--untracked-files=all','-z')).Split([char]0) | Where-Object { $_ -ne '' })
    source18=$sources; indexPath=$index
  }
}
function Assert-Pins($Actual) {
  foreach ($key in @('head','tree','mainRef','indexSha256','stagedEntriesSha256','commonHeadSha256','commonIndexExists','status')) {
    if (-not (Same $Actual[$key] $binding.source[$key])) { throw "Source/index/main drift: $key" }
  }
  if (-not (Same $Actual.source18 $binding.source18)) { throw 'Source18 bytes/blob drift from the frozen post-564 Mac baseline' }
  if ($Actual.commonIndexExists -or $Actual.status.Count -ne 0) { throw 'NEXT is not clean or common index appeared' }
}
function Runtime {
  if (-not (Same-Path (Get-Command node).Source $binding.runtime.node.path) -or (Sha $binding.runtime.node.path) -ne $binding.runtime.node.sha256) { throw 'Whole-process Node identity drift' }
  foreach ($pair in @(@('pnpmLauncher','launcherSha256'),@('pnpmExecutable','executableSha256'),@('packagePath','packageSha256'))) {
    if ((Sha $binding.runtime.pnpm[$pair[0]]) -ne $binding.runtime.pnpm[$pair[1]]) { throw "pnpm identity drift: $($pair[0])" }
  }
}
function Pnpm([string]$Label, [string[]]$Arguments) {
  Runtime
  $stdout = Join-Path $taskOutput "$Label.stdout.log"; $stderr = Join-Path $taskOutput "$Label.stderr.log"
  $start = [DateTimeOffset]::UtcNow.ToString('o')
  Save "$Label.start.json" ([ordered]@{label=$Label; fileName=$binding.runtime.pnpm.pnpmExecutable; argv=$Arguments; cwd=$taskRoot; startUtc=$start; shell=$false; nodeFirstOnPath=$binding.runtime.node.path; childEnvironmentControl=$binding.childEnvironmentControl})
  $psi = [Diagnostics.ProcessStartInfo]::new(); $psi.FileName = $binding.runtime.pnpm.pnpmExecutable; $psi.WorkingDirectory = $taskRoot
  foreach ($arg in $Arguments) { $psi.ArgumentList.Add($arg) }
  $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
  $psi.Environment['GG_OLLAMA_ENABLED'] = 'false'; $psi.Environment['LIVE'] = '0'
  $process = [Diagnostics.Process]::new(); $process.StartInfo = $psi
  $outStream = [IO.File]::Open($stdout,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
  $errStream = [IO.File]::Open($stderr,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
  $exitCode=$null; $failure=$null
  try {
    if (-not $process.Start()) { throw 'pnpm did not start' }
    $out = $process.StandardOutput.BaseStream.CopyToAsync($outStream); $err = $process.StandardError.BaseStream.CopyToAsync($errStream)
    $process.WaitForExit(); [void]$out.GetAwaiter().GetResult(); [void]$err.GetAwaiter().GetResult(); $exitCode=$process.ExitCode
  } catch { $failure=$_.Exception.Message }
  finally { $outStream.Dispose(); $errStream.Dispose(); $process.Dispose() }
  $receipt = [ordered]@{label=$Label; fileName=$binding.runtime.pnpm.pnpmExecutable; argv=$Arguments; cwd=$taskRoot; startUtc=$start; endUtc=[DateTimeOffset]::UtcNow.ToString('o'); exitCode=$exitCode; startOrCaptureFailure=$failure; shell=$false; nodeFirstOnPath=$binding.runtime.node.path; childEnvironmentControl=$binding.childEnvironmentControl; stdout=$stdout; stderr=$stderr; stdoutSha256=(Sha $stdout); stderrSha256=(Sha $stderr)}
  Save "$Label.receipt.json" $receipt; $commands.Add($receipt)
  if ($failure -or $exitCode -ne 0) { throw "Stop after $Label (exit=$exitCode): $failure" }
  return $receipt
}
$stage='before'; $failure=$null; $afterMatches=$false
try {
  $before=Pins; Save 'before.json' $before; Assert-Pins $before
  [IO.File]::Copy($before.indexPath,(Join-Path $taskOutput 'index.before.raw'),$false)
  if ((Sha (Join-Path $taskOutput 'index.before.raw')) -ne $before.indexSha256) { throw 'Before-index copy mismatch' }
  $stage='node-probe'
  $probe=Pnpm '00-node-probe' @('exec','node','--eval','process.stdout.write(JSON.stringify({version:process.version,path:process.execPath}))')
  $node=Get-Content -Raw -LiteralPath $probe.stdout | ConvertFrom-Json -AsHashtable
  if ($node.version -ne 'v22.23.4' -or -not (Same-Path $node.path $binding.runtime.node.path) -or (Sha $node.path) -ne $binding.runtime.node.sha256) { throw 'pnpm did not select the pinned project Node' }
  foreach ($gate in $binding.gates) {
    $stage=$gate.label; $checkpoint=Pins; Save "$stage.before.json" $checkpoint; Assert-Pins $checkpoint
    [void](Pnpm $gate.label ([string[]]$gate.argv))
  }
  $stage='completed'
} catch { $failure=$_.Exception.Message }
finally {
  $closureFailure=$null
  try {
    $after=Pins; Save 'after.json' $after
    [IO.File]::Copy($after.indexPath,(Join-Path $taskOutput 'index.after.raw'),$false)
    if ((Sha (Join-Path $taskOutput 'index.after.raw')) -ne $after.indexSha256) { throw 'After-index copy mismatch' }
    Assert-Pins $after; $afterMatches=$true
  } catch { $closureFailure=$_.Exception.Message }
  Save 'PHASE-RECEIPT.json' ([ordered]@{stageReached=$stage; failure=$failure; closureFailure=$closureFailure; afterMatchesRootBinding=$afterMatches; rootBindingPath=$BindingPath; rootBindingSha256=(Sha $BindingPath); preparationManifestSha256=$binding.preparationManifestSha256; commands=@($commands); noRetry=$true; noCorrectiveWrites=$true})
}
if ($failure -or $closureFailure -or -not $afterMatches) { Write-Error "Static phase failed: $failure; closure: $closureFailure"; exit 1 }
Write-Output 'Build and both bounded local test checks completed with exact before/after controls; hosted CI remains separate.'
exit 0
