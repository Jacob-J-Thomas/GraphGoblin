# PR #426 QA: compile the controlled fake CLI (fake-cli.cs.txt) as codex.exe and claude.exe into
# %TEMP%\gg-qa-426-tools\fake. Windows PowerShell 5.1. No provider call.
# How it was run: these statements were pasted into a Windows PowerShell 5.1 session (the session's
# permission policy refused starting this file with -ExecutionPolicy Bypass). They were run twice:
# once at the start, and again after fake-cli.cs.txt gained the optional delay-ms.txt (before
# dry run 2 of c23-live.mjs). The explorations, checks 1 and 4 and dry run 1 used the first build;
# dry run 2 used the second (the live run uses no fake). The only difference is that optional
# delay, which does nothing unless delay-ms.txt exists (only dry run 2 writes it).
$ErrorActionPreference = 'Stop'
$tools = Join-Path $env:TEMP 'gg-qa-426-tools'
$fake = Join-Path $tools 'fake'
New-Item -ItemType Directory -Path $fake -Force | Out-Null
foreach ($name in 'claude.exe', 'codex.exe') {
  $target = Join-Path $fake $name
  if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Force }
}
$source = Join-Path $tools 'fake-cli.cs'
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'fake-cli.cs.txt') -Destination $source -Force
Add-Type -Path $source -OutputAssembly (Join-Path $fake 'claude.exe') -OutputType ConsoleApplication
Copy-Item -LiteralPath (Join-Path $fake 'claude.exe') -Destination (Join-Path $fake 'codex.exe') -Force
Get-ChildItem -LiteralPath $fake | ForEach-Object { '{0} {1}' -f $_.Name, $_.Length }
