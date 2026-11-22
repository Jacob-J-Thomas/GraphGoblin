param([ValidateSet('ordinary', 'junction', 'cross-volume')][string]$Environment = 'ordinary')
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$task = 'G:/ggq/gg-i4-486-d215-fix'
$evidence = 'G:/ggq/delivery-evidence/2026-11-17-five-intents/i4-486-d215-author-01'
$source = 'packages/infrastructure/src/fs/fs.test.ts'
Set-Location -LiteralPath "$task/GraphGoblin"
$env:Path = 'C:/Users/98jak/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64;' + $env:Path
$baselineTemp = "$task/process-temp"
$env:TEMP = $baselineTemp
$env:TMP = $baselineTemp
if ((node --version) -ne 'v22.23.4') { throw 'Unexpected Node runtime' }

function Invoke-RetainedStep {
  param([string]$Name, [string]$Executable, [string[]]$Arguments)
  $log = "$evidence/$Name.log"
  if (Test-Path -LiteralPath $log) { throw "Evidence already exists at $log" }
  "utc=$((Get-Date).ToUniversalTime().ToString('o')) cwd=$((Get-Location).Path) TEMP=$env:TEMP TMP=$env:TMP" | Tee-Object -FilePath $log | Out-Host
  "$Executable $($Arguments | ConvertTo-Json -Compress)" | Tee-Object -FilePath $log -Append | Out-Host
  & $Executable @Arguments 2>&1 | Tee-Object -FilePath $log -Append | Out-Host
  $exit = $LASTEXITCODE
  "exit=$exit" | Tee-Object -FilePath $log -Append | Out-Host
  return $exit
}

function Assert-TestCleanup {
  param([string]$TempRoot)
  $package = "$task/GraphGoblin/packages/infrastructure"
  $tempFixtures = @(Get-ChildItem -LiteralPath $TempRoot -Filter 'gg-wp-e3-*' -Force)
  $relativeFixtures = @(Get-ChildItem -LiteralPath $package -Filter 'gg-wp-relative-*' -Force)
  $checkoutFixtures = @(Get-ChildItem -LiteralPath "$task/GraphGoblin" -Filter 'gg-wp-relative-*' -Force)
  "tempRoot=$TempRoot tempFixtures=$($tempFixtures.Count) packageRelativeFixtures=$($relativeFixtures.Count) checkoutRelativeFixtures=$($checkoutFixtures.Count)" | Out-Host
  if ($tempFixtures.Count + $relativeFixtures.Count + $checkoutFixtures.Count -ne 0) { throw 'Test fixture cleanup failed' }
}

$testArgs = @('--filter', '@graphgoblin/infrastructure', 'test', 'src/fs/fs.test.ts')
$gitOptions = @('-c', 'maintenance.auto=false', '-c', 'gc.auto=0')
