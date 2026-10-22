param([string]$Name, [string[]]$TaskArguments)
$ErrorActionPreference = 'Stop'
$env:PATH = "$env:APPDATA\nvm\v22.14.0;$env:PATH"
$qaRepo = (Get-Location).Path
$qaEvidence = Join-Path $qaRepo 'docs/qa/2026-10-22-wp-b3-qa/round-3'
$qaTemp = if ($env:QA_ORIGINAL_TEMP) { $env:QA_ORIGINAL_TEMP } else { $env:TEMP }
Get-ChildItem Env: | Where-Object { $_.Name -like 'GG_*' -or $_.Name -eq 'JEV_API_KEY' } | ForEach-Object { Remove-Item "Env:$($_.Name)" }
$qaStarted = Get-Date
$ErrorActionPreference = 'Continue'
$qaOutput = & pnpm.cmd @TaskArguments 2>&1
$qaExit = $LASTEXITCODE
$qaText = ($qaOutput | Out-String) -replace '\x1b\[[0-9;]*m', ''
foreach ($qaPair in @(@($qaRepo, '<worktree>'), @($qaTemp, '%TEMP%'), @($env:USERPROFILE, '%USERPROFILE%'))) {
  $qaText = $qaText.Replace($qaPair[0].Replace('\','\\'), $qaPair[1]).Replace($qaPair[0].Replace('\','/'), $qaPair[1]).Replace($qaPair[0], $qaPair[1])
}
$qaText | Set-Content -LiteralPath (Join-Path $qaEvidence "$Name.log") -Encoding utf8
@{ command = "pnpm.cmd $($TaskArguments -join ' ')"; exitCode = $qaExit; elapsedSeconds = [math]::Round(((Get-Date) - $qaStarted).TotalSeconds, 2); node = (& node --version); output = "$Name.log" } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $qaEvidence "$Name.json") -Encoding utf8
$qaText -split "`n" | Select-Object -Last 14
"$Name exit=$qaExit"
exit $qaExit


