param([string]$Name, [string[]]$PnpmArguments)
if (-not $PnpmArguments) {
  $qaParsedArguments = ConvertFrom-Json $env:QA_PNPM_ARGUMENTS
  $PnpmArguments = [string[]]$qaParsedArguments
}
$ErrorActionPreference = 'Continue'
$env:PATH = "$env:APPDATA\nvm\v22.14.0;$env:PATH"
$destination = Join-Path $PSScriptRoot ($Name + '.txt')
$started = [DateTime]::UtcNow.ToString('o')
"START $started`nnode $(node --version)`npnpm.cmd $($PnpmArguments -join ' ')" | Set-Content -LiteralPath $destination
& pnpm.cmd @PnpmArguments 2>&1 | ForEach-Object {
  $line = $_.ToString() -replace '\x1B\[[0-?]*[ -/]*[@-~]', ''
  $line = $line.Replace((Get-Location).Path, '<worktree>').Replace($env:USERPROFILE, '<user>').Replace($env:TEMP, '<temp>')
  $line = $line.Replace((Get-Location).Path.Replace('\', '/'), '<worktree>').Replace($env:USERPROFILE.Replace('\', '/'), '<user>').Replace($env:TEMP.Replace('\', '/'), '<temp>')
  $line = $line -creplace '\bgg_[A-Za-z0-9_-]+', '[redacted-key]'
  Add-Content -LiteralPath $destination -Value $line
}
$result = $LASTEXITCODE
"END $([DateTime]::UtcNow.ToString('o')) EXIT $result" | Add-Content -LiteralPath $destination
Get-Content -LiteralPath $destination -Tail 32
exit $result
