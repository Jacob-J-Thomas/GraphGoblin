$qaRoot = (Get-Location).Path
$qaRunner = Join-Path $qaRoot 'docs/qa/2026-10-25-wp-a2-241-qa/evidence/run-command.ps1'
$qaFailed = $false
foreach ($qaGate in @('typecheck','lint','check:layers','check:deps','check:tokens')) {
  $qaName = 'gate-' + $qaGate.Replace(':','-')
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $qaRunner -Name $qaName -WorkingDirectory $qaRoot -Executable pnpm.cmd -CommandArguments $qaGate
  if ($LASTEXITCODE -ne 0) { $qaFailed = $true }
}
if ($qaFailed) { exit 1 }
exit 0
