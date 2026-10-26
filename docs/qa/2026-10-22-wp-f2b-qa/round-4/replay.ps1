param([ValidateSet('Served','Components')][string]$Stage='Served')
# <repo>: use the committed round-3 replay unchanged; round-4 outputs stay here.
$qaRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../..'))
$env:PATH="$env:APPDATA\nvm\v22.14.0;$env:PATH"
Push-Location $qaRoot
try{
  $qaHead=git rev-parse HEAD
  if($qaHead -ne '492b283b49747e91470d94dca7028caa4eeb6c3d'){throw 'Pinned HEAD differs'}
  if(-not((node --version) -match '^v22\.')){throw 'Node22 required'}
  $qaStarted=(Get-Date).ToUniversalTime().ToString('o')
  $qaTimer=[Diagnostics.Stopwatch]::StartNew()
  $qaRaw=Join-Path $env:TEMP ('gg-qa-f2b-r4-'+$Stage.ToLowerInvariant()+'.raw.txt')
  if($Stage -eq 'Served'){
    Remove-Item Env:QA_ONLY -ErrorAction SilentlyContinue
    $env:QA_OUTPUT_DIR=$PSScriptRoot
    $env:QA_PORT='5860'
    $env:QA_TEMP_PREFIX='gg-qa-f2b-r4-served-'
    $qaCommand='QA_PORT=5860 QA_TEMP_PREFIX=gg-qa-f2b-r4-served- QA_OUTPUT_DIR=<round-4> node <repo>/docs/qa/2026-10-22-wp-f2b-qa/round-3/served-checks.mjs'
    & node (Join-Path $PSScriptRoot '../round-3/served-checks.mjs') *> $qaRaw
  }else{
    $qaCommand='pnpm.cmd --filter @graphgoblin/web exec vitest run src/editor/harness-switch.test.tsx src/forms/fields/harness-switch.test.tsx --maxWorkers=1'
    & pnpm.cmd --filter @graphgoblin/web exec vitest run src/editor/harness-switch.test.tsx src/forms/fields/harness-switch.test.tsx --maxWorkers=1 *> $qaRaw
  }
  $qaExit=$LASTEXITCODE
  $qaTimer.Stop()
  $qaMeta=@{head=$qaHead;stage=$Stage;command=$qaCommand;node=(node --version);startedUtc=$qaStarted;elapsedSeconds=$qaTimer.Elapsed.TotalSeconds;exitCode=$qaExit;processExited=$true;invocations=1;retries=0}
  [IO.File]::WriteAllText((Join-Path $PSScriptRoot ($Stage.ToLowerInvariant()+'-command.json')),($qaMeta | ConvertTo-Json -Depth 5))
  & node (Join-Path $PSScriptRoot 'capture.mjs') $Stage
  if($LASTEXITCODE -ne 0){throw 'Evidence capture failed'}
  Write-Output "$Stage exit: $qaExit"
}finally{Pop-Location}
exit $qaExit