$ErrorActionPreference = 'Stop'
$env:PATH = "$env:USERPROFILE\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64;$env:PATH"
$qaTools = Join-Path $env:TEMP 'gg-qa-426f-tools'
$qaAssembly = Join-Path $qaTools 'fake\claude.exe'
if (Test-Path -LiteralPath $qaAssembly) { throw 'QA fake already exists; refusing to overwrite or delete it' }
node (Join-Path $PSScriptRoot 'prepare-final.mjs')
if ($LASTEXITCODE -ne 0) { throw 'QA script preparation failed' }
Add-Type -Path (Join-Path $qaTools 'fake-cli.cs') -OutputAssembly $qaAssembly -OutputType ConsoleApplication
Copy-Item -LiteralPath $qaAssembly -Destination (Join-Path $qaTools 'fake\codex.exe')
