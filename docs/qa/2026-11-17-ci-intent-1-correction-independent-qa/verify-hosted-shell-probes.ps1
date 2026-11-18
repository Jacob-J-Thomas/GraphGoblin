$ErrorActionPreference = 'Stop'
$env:PATH = "$env:USERPROFILE\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64;$env:PATH"
$env:GITHUB_RUN_ID = '8496'
$env:GITHUB_WORKSPACE = (Get-Location).Path
$root = [IO.Directory]::CreateTempSubdirectory('i1-hosted-shell-probe-').FullName
$runner = New-Item -ItemType Directory -Path (Join-Path $root 'invalid-runner')
$env:RUNNER_TEMP = $runner.FullName
$env:GITHUB_OUTPUT = Join-Path $root 'invalid-init-output.txt'
$scriptDirectory = Join-Path $PSScriptRoot 'hosted-shell-probes'
$probeLogs = Join-Path $PSScriptRoot 'hosted-shell-logs'
New-Item -ItemType Directory -Path $probeLogs | Out-Null
& pwsh -NoProfile -File (Join-Path $scriptDirectory 'invalid-init-overlay.ps1') *> (Join-Path $probeLogs 'invalid-init-overlay.log')
$invalidCode = $LASTEXITCODE
if ($invalidCode -ne 1 -or (Test-Path -LiteralPath $env:GITHUB_OUTPUT)) { throw 'invalid prepare did not refuse cleanly' }
if (!(Select-String -LiteralPath (Join-Path $probeLogs 'invalid-init-overlay.log') -Pattern 'inside-checkout')) { throw 'wrong invalid prepare error' }

$runner = New-Item -ItemType Directory -Path (Join-Path $root 'original-runner')
$env:RUNNER_TEMP = $runner.FullName
$env:GITHUB_OUTPUT = Join-Path $root 'original-prepare-output.txt'
& pwsh -NoProfile -File (Join-Path $scriptDirectory 'refusal-prepare-original.ps1') *> (Join-Path $probeLogs 'refusal-prepare-original.log')
$originalCode = $LASTEXITCODE
if ($originalCode -ne 1) { throw 'original control should fail before refusal' }

$runner = New-Item -ItemType Directory -Path (Join-Path $root 'overlay-runner')
$env:RUNNER_TEMP = $runner.FullName
$env:GITHUB_OUTPUT = Join-Path $root 'overlay-prepare-output.txt'
& pwsh -NoProfile -File (Join-Path $scriptDirectory 'refusal-prepare-overlay.ps1') *> (Join-Path $probeLogs 'refusal-prepare-overlay.log')
$overlayCode = $LASTEXITCODE
if ($overlayCode -ne 0) { throw 'overlay did not plant refusal probes' }
$outputs = @{}
Get-Content -LiteralPath $env:GITHUB_OUTPUT | ForEach-Object {
  $key,$value = $_ -split '=',2
  $outputs[$key] = $value
}
$outcomes = [ordered]@{}
foreach ($case in 'hardlink','manifest') {
  $env:GITHUB_OUTPUT = Join-Path $root "finalize-$case-output.txt"
  $evidenceDir = $outputs[$case + '_dir']
  $env:GG_TEST_WINDOWS_LAUNCHER_EVIDENCE_DIR = $evidenceDir
  $env:GG_TEST_WINDOWS_LAUNCHER_EVIDENCE_ID = $outputs[$case + '_id']
  $env:GG_TEST_EVIDENCE_INSTALL_OUTCOME = 'success'
  $env:GG_TEST_EVIDENCE_BUILD_OUTCOME = 'success'
  $env:GG_TEST_EVIDENCE_NATIVE_OUTCOME = if ($case -eq 'hardlink') {'success'} else {'skipped'}
  $log = Join-Path $probeLogs "finalize-$case.log"
  node tooling/scripts/windows-launcher-evidence.mjs finalize *> $log
  $outcomes[$case] = $LASTEXITCODE
  $expected = if ($case -eq 'hardlink') {'hard-link'} else {'manifest-invalid'}
  if ($outcomes[$case] -ne 1 -or (Test-Path -LiteralPath $env:GITHUB_OUTPUT) -or (Test-Path -LiteralPath (Join-Path $evidenceDir 'result.json'))) {
    throw "refusal $case published paths or result"
  }
  if (!(Select-String -LiteralPath $log -Pattern $expected)) { throw "refusal $case used wrong result" }
}
$env:HARDLINK_DIR = $outputs['hardlink_dir']
$env:MANIFEST_DIR = $outputs['manifest_dir']
$env:HARDLINK_OUTCOME = 'failure'
$env:MANIFEST_OUTCOME = 'failure'
$env:HARDLINK_PATHS = ''
$env:MANIFEST_PATHS = ''
& pwsh -NoProfile -File (Join-Path $scriptDirectory 'refusal-assert-overlay.ps1') *> (Join-Path $probeLogs 'refusal-assert-overlay.log')
$assertCode = $LASTEXITCODE
if ($assertCode -ne 0) { throw 'exact overlay refusal readback failed' }

$probeReport = [ordered]@{
  invalidPrepare=$invalidCode; failedPreparedControl=$originalCode; correctedPreparedControl=$overlayCode
  finalize=$outcomes; assertion=$assertCode; fixtureRoot=$root
}
$probeReport | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'hosted-shell-probes.json') -Encoding utf8
Get-Content -LiteralPath (Join-Path $PSScriptRoot 'hosted-shell-probes.json')
Get-Content -LiteralPath (Join-Path $probeLogs 'refusal-assert-overlay.log')
