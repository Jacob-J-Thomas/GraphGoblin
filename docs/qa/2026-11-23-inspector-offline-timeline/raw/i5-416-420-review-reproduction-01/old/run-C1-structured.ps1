$ErrorActionPreference = 'Stop'
$taskRoot = 'G:/ggq/gg-i5-offline-ui-qa/GraphGoblin'
$env:PATH = "$env:USERPROFILE/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64;$env:PATH"
$env:GIT_OPTIONAL_LOCKS = '0'
$pnpmExe = 'C:/nvm4w/nodejs/node_modules/pnpm/pnpm.exe'
$nodeExe = (Get-Command node).Source
$packagePath = 'C:/nvm4w/nodejs/node_modules/pnpm/package.json'
$identity = [ordered]@{
  pnpmLauncher = 'C:/nvm4w/nodejs/pnpm.cmd'
  launcherSha256 = (Get-FileHash -LiteralPath 'C:/nvm4w/nodejs/pnpm.cmd' -Algorithm SHA256).Hash.ToLowerInvariant()
  pnpmExecutable = $pnpmExe
  executableSha256 = (Get-FileHash -LiteralPath $pnpmExe -Algorithm SHA256).Hash.ToLowerInvariant()
  packagePath = $packagePath
  packageSha256 = (Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash.ToLowerInvariant()
  nodeFirstOnPath = $nodeExe
  nodeVersion = (& node --version)
  invocation = 'Exact installed standalone pnpm executable behind pnpm.cmd; no cmd shell, no invented JS CLI or installation'
}
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'CLI-IDENTITY.json'))) {
  $identity | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'CLI-IDENTITY.json') -Encoding utf8NoBOM
}
if ($identity.nodeVersion -ne 'v22.23.4') { throw 'Admitted Node version mismatch' }
$before = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'before.json') -Raw | ConvertFrom-Json
foreach ($collection in @($before.selectedSources,$before.dependencyInputs,$before.metadata)) {
  foreach ($item in $collection.PSObject.Properties) {
    if ((Get-FileHash -LiteralPath (Join-Path $taskRoot $item.Name) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $item.Value) { throw "Source/dependency drift: $($item.Name)" }
  }
}
$component = Join-Path $taskRoot 'apps/web/src/runs/RunInspectorPage.independent-416.qa.test.tsx'
if ((Get-FileHash -LiteralPath $component -Algorithm SHA256).Hash.ToLowerInvariant() -ne '4bf07f6fb1e26725dbc08247534eb364231a50564010f048bcc51bdb1101daa6') { throw 'Fixture drift' }
$indexPath = & git --no-optional-locks -C $taskRoot rev-parse --path-format=absolute --git-path index
if ((Get-FileHash -LiteralPath $indexPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $before.indexSha256) { throw 'Index drift' }
if ((& git --no-optional-locks -C $taskRoot rev-parse HEAD) -ne $before.head) { throw 'Head drift' }

function Invoke-RecordedPnpm([string]$Label,[string[]]$Arguments) {
  $start = [DateTimeOffset]::UtcNow
  $outPath = Join-Path $PSScriptRoot "$Label.stdout.log"
  $errPath = Join-Path $PSScriptRoot "$Label.stderr.log"
  $receiptPath = Join-Path $PSScriptRoot "$Label.receipt.json"
  if (Test-Path -LiteralPath $receiptPath) { throw 'Receipt already exists' }
  [ordered]@{ label=$Label;fileName=$pnpmExe;argv=$Arguments;cwd=$taskRoot;startUtc=$start.ToString('o');shell=$false;nodeFirstOnPath=$nodeExe } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $PSScriptRoot "$Label.start.json") -Encoding utf8NoBOM
  $psi = [Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = $pnpmExe
  foreach ($argument in $Arguments) { $psi.ArgumentList.Add($argument) }
  $psi.WorkingDirectory=$taskRoot;$psi.UseShellExecute=$false;$psi.CreateNoWindow=$true
  $psi.RedirectStandardOutput=$true;$psi.RedirectStandardError=$true
  $process=[Diagnostics.Process]::new();$process.StartInfo=$psi
  $stdout=[IO.File]::Open($outPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
  $stderr=[IO.File]::Open($errPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
  try {
    if (-not $process.Start()) { throw 'pnpm failed to start' }
    $outTask=$process.StandardOutput.BaseStream.CopyToAsync($stdout)
    $errTask=$process.StandardError.BaseStream.CopyToAsync($stderr)
    $process.WaitForExit()
    [void]$outTask.GetAwaiter().GetResult();[void]$errTask.GetAwaiter().GetResult()
    $exitCode=$process.ExitCode
  } finally { $stdout.Dispose();$stderr.Dispose() }
  $receipt=[ordered]@{label=$Label;fileName=$pnpmExe;argv=$Arguments;cwd=$taskRoot;startUtc=$start.ToString('o');endUtc=[DateTimeOffset]::UtcNow.ToString('o');exitCode=$exitCode;shell=$false;nodeFirstOnPath=$nodeExe;stdout=$outPath;stderr=$errPath;stdoutSha256=(Get-FileHash -LiteralPath $outPath -Algorithm SHA256).Hash.ToLowerInvariant();stderrSha256=(Get-FileHash -LiteralPath $errPath -Algorithm SHA256).Hash.ToLowerInvariant()}
  $receipt | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $receiptPath -Encoding utf8NoBOM
  return [pscustomobject]$receipt
}
$probeReceipt = Join-Path $PSScriptRoot '10-node-probe.receipt.json'
if (Test-Path -LiteralPath $probeReceipt) { $probe = Get-Content -LiteralPath $probeReceipt -Raw | ConvertFrom-Json }
else { $probe = Invoke-RecordedPnpm -Label '10-node-probe' -Arguments @('--filter','@graphgoblin/web','exec','node','--eval','process.stdout.write(JSON.stringify({version:process.version,path:process.execPath}))') }
if ($probe.exitCode -ne 0) { throw 'pnpm Node probe failed' }
$selected = Get-Content -LiteralPath $probe.stdout -Raw | ConvertFrom-Json
$selectedFull = [IO.Path]::GetFullPath($selected.path)
$expectedFull = [IO.Path]::GetFullPath($nodeExe)
$selectedSha = (Get-FileHash -LiteralPath $selected.path -Algorithm SHA256).Hash.ToLowerInvariant()
$expectedSha = (Get-FileHash -LiteralPath $nodeExe -Algorithm SHA256).Hash.ToLowerInvariant()
if ($selected.version -ne 'v22.23.4' -or -not [string]::Equals($selectedFull,$expectedFull,[StringComparison]::OrdinalIgnoreCase) -or $selectedSha -ne $expectedSha) { throw 'pnpm selected unexpected Node' }
[ordered]@{ probeReceipt=$probeReceipt;probeReexecuted=$false;selectedVersion=$selected.version;selectedPath=$selected.path;expectedPath=$nodeExe;selectedNormalized=$selectedFull;expectedNormalized=$expectedFull;selectedExeSha256=$selectedSha;expectedExeSha256=$expectedSha;equal=$true } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'NODE-PROBE-C1-QUALIFICATION.json') -Encoding utf8NoBOM
$probe | ConvertTo-Json -Depth 5
$selection = Invoke-RecordedPnpm -Label '13-structured-C1' -Arguments @('--filter','@graphgoblin/web','exec','vitest','run','src/runs/RunInspectorPage.independent-416.qa.test.tsx','--testNamePattern','review C1:','--maxWorkers=1','--retry=0','--reporter=default','--reporter=json','--outputFile=G:/ggq/delivery-evidence/2026-11-17-five-intents/i5-416-420-review-reproduction-01/old/13-structured-C1.json')
$selection | ConvertTo-Json -Depth 5
Get-Content -LiteralPath $selection.stdout -Tail 38
Get-Content -LiteralPath $selection.stderr -Tail 24
exit $selection.exitCode

