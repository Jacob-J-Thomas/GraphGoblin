$ErrorActionPreference = 'Stop'
$env:PATH = "$env:USERPROFILE\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64;$env:PATH"
$keep = 'Path','PathExt','SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','ComSpec','LOCALAPPDATA','APPDATA','ProgramData','ProgramFiles','ProgramFiles(x86)','PUBLIC','USERNAME','USERDOMAIN','HOMEDRIVE','HOMEPATH','OS','PROCESSOR_ARCHITECTURE','NUMBER_OF_PROCESSORS','SYSTEMDRIVE','ALLUSERSPROFILE','COMPUTERNAME'
Get-ChildItem Env: | Where-Object {$_.Name -notin $keep} | ForEach-Object {[Environment]::SetEnvironmentVariable($_.Name,$null,'Process')}
$env:GG_TEST_PORT_START = '63900'
$env:LIVE = '0'
$fixture = Join-Path $PSScriptRoot 'native-runner-temp'
New-Item -ItemType Directory -Path $fixture | Out-Null
$env:RUNNER_TEMP = $fixture
$env:GITHUB_OUTPUT = Join-Path $PSScriptRoot 'native-prepare-output.txt'
$env:GITHUB_STEP_SUMMARY = Join-Path $PSScriptRoot 'native-summary.md'
$env:QA_WINDOWS_PRIVATE_CANARY = 'i1-native-qa-bbcd101e82a54a0aa620ffbadc440249'
node tooling/scripts/windows-launcher-evidence.mjs init *> (Join-Path $PSScriptRoot 'native-prepare.log')
$initCode = $LASTEXITCODE
if ($initCode) { throw "prepare exited $initCode" }
foreach ($line in Get-Content -LiteralPath $env:GITHUB_OUTPUT) {
  $key,$value = $line -split '=',2
  if ($key -eq 'dir') { $env:GG_TEST_WINDOWS_LAUNCHER_EVIDENCE_DIR = $value }
  if ($key -eq 'id') { $preparedId = $value }
}
$startTime = [DateTime]::UtcNow
pnpm.cmd test:windows-launcher *> (Join-Path $PSScriptRoot 'native-tap.log')
$nativeCode = $LASTEXITCODE
$endTime = [DateTime]::UtcNow
$env:GITHUB_OUTPUT = Join-Path $PSScriptRoot 'native-finalize-output.txt'
$env:GG_TEST_WINDOWS_LAUNCHER_EVIDENCE_ID = $preparedId
$env:GG_TEST_EVIDENCE_INSTALL_OUTCOME = 'success'
$env:GG_TEST_EVIDENCE_BUILD_OUTCOME = 'success'
$env:GG_TEST_EVIDENCE_NATIVE_OUTCOME = if ($nativeCode) { 'failure' } else { 'success' }
node tooling/scripts/windows-launcher-evidence.mjs finalize *> (Join-Path $PSScriptRoot 'native-finalize.log')
$finalizeCode = $LASTEXITCODE
[ordered]@{init=$initCode;native=$nativeCode;finalize=$finalizeCode;seconds=($endTime-$startTime).TotalSeconds;start=$startTime;end=$endTime;bundle=$env:GG_TEST_WINDOWS_LAUNCHER_EVIDENCE_DIR} |
  ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'native-exits.json') -Encoding utf8
Get-Content -LiteralPath (Join-Path $PSScriptRoot 'native-tap.log') -Tail 10
Get-Content -LiteralPath (Join-Path $PSScriptRoot 'native-finalize.log')
