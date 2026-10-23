param(
  [ValidateSet('All','Build','Served','Collector','Edge','Components','Coverage')]
  [string]$Stage='All'
)
# <repo>: replay from this script's directory; no machine-specific checkout paths.
$qaRepo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../..'))
$env:PATH="$env:APPDATA\nvm\v22.14.0;$env:PATH"
if (-not ((node --version) -match '^v22\.')) { throw 'Node 22 is required' }
if ($Stage -eq 'All') {
  foreach ($qaStage in @('Build','Served','Collector','Edge','Components','Coverage')) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath -Stage $qaStage
    if ($LASTEXITCODE -ne 0 -and $qaStage -ne 'Edge') { exit $LASTEXITCODE }
  }
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'cleanup.ps1') -Remove
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  & node (Join-Path $PSScriptRoot 'report.mjs')
  exit $LASTEXITCODE
}
$qaStarted=(Get-Date).ToUniversalTime().ToString('o')
$qaTimer=[Diagnostics.Stopwatch]::StartNew()
$qaRaw=Join-Path $env:TEMP ('gg-qa-204-r3-'+$Stage.ToLowerInvariant()+'.raw.log')
Push-Location $qaRepo
try {
  switch ($Stage) {
    'Build' {
      $qaCommand='pnpm.cmd build'
      & pnpm.cmd build *> $qaRaw
    }
    'Served' {
      $qaCommand='node <evidence>/served-checks.mjs'
      & node (Join-Path $PSScriptRoot 'served-checks.mjs') *> $qaRaw
    }
    'Collector' {
      $qaCommand='from apps/web: GG_SWITCH_PORT=5880 GG_SWITCH_EXPECT_FIXED=1 node --import tsx <evidence>/collector.mjs'
      $env:GG_SWITCH_PORT='5880';$env:GG_SWITCH_EXPECT_FIXED='1'
      Push-Location (Join-Path $qaRepo 'apps/web')
      try { & node --import tsx (Join-Path $PSScriptRoot 'collector.mjs') *> $qaRaw }
      finally { Pop-Location }
    }
    'Edge' {
      $qaCommand='pnpm.cmd --filter @graphgoblin/web exec playwright test --config ../../docs/qa/2026-10-22-wp-f2b-qa/round-3/edge.config.ts model-picker.spec.ts'
      & pnpm.cmd --filter @graphgoblin/web exec playwright test --config ../../docs/qa/2026-10-22-wp-f2b-qa/round-3/edge.config.ts model-picker.spec.ts *> $qaRaw
    }
    'Components' {
      $qaCommand='pnpm.cmd --filter @graphgoblin/web exec vitest run src/editor/harness-switch.test.tsx src/forms/fields/harness-switch.test.tsx --maxWorkers=1'
      & pnpm.cmd --filter @graphgoblin/web exec vitest run src/editor/harness-switch.test.tsx src/forms/fields/harness-switch.test.tsx --maxWorkers=1 *> $qaRaw
    }
    'Coverage' {
      $qaDirectory='gg-qa-204-r3-webcov-'+[Guid]::NewGuid().ToString('N').Substring(0,8)
      $qaCoverage=Join-Path $env:TEMP $qaDirectory
      New-Item -ItemType Directory -Path $qaCoverage | Out-Null
      $qaCommand='pnpm.cmd --filter @graphgoblin/web test:coverage --maxWorkers=2 --coverage.reportOnFailure=true --coverage.reportsDirectory=<disposable>'
      [IO.File]::WriteAllText((Join-Path $PSScriptRoot 'coverage-location.json'),(@{directory=$qaDirectory;command=$qaCommand} | ConvertTo-Json))
      & pnpm.cmd --filter @graphgoblin/web test:coverage --maxWorkers=2 --coverage.reportOnFailure=true "--coverage.reportsDirectory=$qaCoverage" *> $qaRaw
    }
  }
  $qaExit=$LASTEXITCODE
  $qaTimer.Stop()
  $qaMetadata=@{head=(git rev-parse HEAD);stage=$Stage;command=$qaCommand;node=(node --version);exitCode=$qaExit;startedUtc=$qaStarted;elapsedSeconds=[math]::Round($qaTimer.Elapsed.TotalSeconds,3);processExited=$true}
  [IO.File]::WriteAllText((Join-Path $PSScriptRoot ($Stage.ToLowerInvariant()+'-command.json')),($qaMetadata | ConvertTo-Json -Depth 5))
  & node (Join-Path $PSScriptRoot 'collect-evidence.mjs') $Stage
  if ($LASTEXITCODE -ne 0) { throw 'Evidence collection failed' }
  Write-Output "$Stage exit: $qaExit"
} finally { Pop-Location }
exit $qaExit