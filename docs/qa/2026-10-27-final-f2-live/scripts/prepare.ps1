# Final F2 helpers: compile the console helpers (acceptance C sources, unchanged) and the
# acceptance A recording CLI (used only for dry runs of the drivers, never as a live provider)
# into a disposable tools directory under the system temp directory.
$ErrorActionPreference = 'Stop'
$scripts = Split-Path -Parent $MyInvocation.MyCommand.Path
$tools = Join-Path $env:TEMP 'gg-final-f2-tools'
New-Item -ItemType Directory -Force -Path $tools | Out-Null
foreach ($name in @('launcher2', 'ctrlc', 'conslist')) {
  $out = Join-Path $tools ($name + '.exe')
  if (-not (Test-Path $out)) {
    Add-Type -TypeDefinition ([IO.File]::ReadAllText((Join-Path $scripts ($name + '.cs.txt')))) -OutputAssembly $out -OutputType ConsoleApplication
  }
}
$fake = Join-Path $tools 'fake'
New-Item -ItemType Directory -Force -Path $fake | Out-Null
$claude = Join-Path $fake 'claude.exe'
if (-not (Test-Path $claude)) {
  Add-Type -TypeDefinition ([IO.File]::ReadAllText((Join-Path $scripts 'session-cli.cs.txt'))) -OutputAssembly $claude -OutputType ConsoleApplication
}
Copy-Item -LiteralPath $claude -Destination (Join-Path $fake 'codex.exe') -Force
Get-ChildItem -Recurse $tools | Select-Object -ExpandProperty Name
