# Windows PowerShell 5.1 only (powershell.exe).
param([Parameter(Mandatory = $true)][string]$Directory)
$ErrorActionPreference = 'Stop'
$target = [System.IO.Path]::GetFullPath($Directory)
if ((Test-Path -LiteralPath $target) -and @(Get-ChildItem -LiteralPath $target -Force).Count -ne 0) {
  throw 'Choose a new empty disposable directory.'
}
New-Item -ItemType Directory -Path $target -Force | Out-Null
Add-Type -Path (Join-Path $PSScriptRoot '../fixtures/model-switch-cli.cs') -OutputAssembly (Join-Path $target 'claude.exe') -OutputType ConsoleApplication
Copy-Item -LiteralPath (Join-Path $target 'claude.exe') -Destination (Join-Path $target 'codex.exe')
Write-Output $target
