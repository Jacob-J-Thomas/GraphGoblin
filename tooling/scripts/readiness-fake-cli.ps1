# Owner-QA tooling: Windows PowerShell 5.1 only (powershell.exe, not pwsh).
param(
  [Parameter(Mandatory = $true)][string]$Directory,
  [Parameter(Mandatory = $true)][ValidateSet('claude', 'codex')][string]$Harness,
  [ValidateSet('ready', 'old', 'missing-model', 'missing-effort', 'hang', 'auth', 'quota', 'transport', 'unknown')][string]$Scenario = 'ready'
)
$ErrorActionPreference = 'Stop'
$target = [System.IO.Path]::GetFullPath($Directory)
if (Test-Path -LiteralPath $target) {
  if (@(Get-ChildItem -LiteralPath $target -Force).Count -ne 0) { throw 'Choose an empty disposable directory.' }
} else {
  New-Item -ItemType Directory -Path $target | Out-Null
}
$output = Join-Path $target "$Harness.exe"
Add-Type -Path (Join-Path $PSScriptRoot '../fixtures/readiness-cli.cs') -OutputAssembly $output -OutputType ConsoleApplication
Set-Content -LiteralPath (Join-Path $target 'harness.txt') -Value $Harness -Encoding ASCII
Set-Content -LiteralPath (Join-Path $target 'scenario.txt') -Value $Scenario -Encoding ASCII
Write-Output $output
