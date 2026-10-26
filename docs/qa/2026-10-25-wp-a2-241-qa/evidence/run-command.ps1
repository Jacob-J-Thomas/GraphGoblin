param([string]$Name,[string]$WorkingDirectory,[string]$Executable,[string[]]$CommandArguments = @())
$ErrorActionPreference = 'Continue'
$env:PATH = "$env:APPDATA\nvm\v22.14.0;$env:PATH"
$env:GG_E2E_BROWSER_CHANNEL = 'msedge'
$env:LIVE = '0'
$env:CI = 'true'
$env:GG_E2E_MAIN_PORT = '6170'
$env:GG_E2E_CONTROL_PORT = '6171'
$qaEvidence = $PSScriptRoot
$qaLog = Join-Path $qaEvidence "$Name.log.txt"
$qaStart = [DateTime]::UtcNow
$qaWatch = [Diagnostics.Stopwatch]::StartNew()
$qaProfile = [regex]::Escape($env:USERPROFILE)
Set-Location -LiteralPath $WorkingDirectory
"START $Name $($qaStart.ToString('o'))" | Set-Content -Encoding utf8 $qaLog
"COMMAND $Executable $($CommandArguments -join ' ')" | Add-Content -Encoding utf8 $qaLog
"CWD $($WorkingDirectory -replace $qaProfile,'%USERPROFILE%')" | Add-Content -Encoding utf8 $qaLog
"NODE $(& node --version)" | Add-Content -Encoding utf8 $qaLog
"ENV GG_E2E_BROWSER_CHANNEL=msedge LIVE=0 CI=true GG_E2E_MAIN_PORT=6170 GG_E2E_CONTROL_PORT=6171" | Add-Content -Encoding utf8 $qaLog
Write-Output "Running $Name; output in $Name.log.txt"
& $Executable @CommandArguments 2>&1 | ForEach-Object { "$_" -replace $qaProfile,'%USERPROFILE%' } | Out-File -FilePath $qaLog -Append -Encoding utf8
$qaExit = $LASTEXITCODE
$qaWatch.Stop()
$qaResult = [ordered]@{name=$Name;command="$Executable $($CommandArguments -join ' ')";cwd=($WorkingDirectory -replace $qaProfile,'%USERPROFILE%');startedUtc=$qaStart.ToString('o');finishedUtc=[DateTime]::UtcNow.ToString('o');durationSeconds=[Math]::Round($qaWatch.Elapsed.TotalSeconds,3);exitCode=$qaExit}
$qaResult | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $qaEvidence "$Name.result.json")
"END exit=$qaExit durationSeconds=$($qaResult.durationSeconds)" | Add-Content -Encoding utf8 $qaLog
Get-Content -LiteralPath $qaLog -Tail 24
exit $qaExit
