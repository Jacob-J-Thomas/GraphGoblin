param([string]$Driver = 'scenarios.mjs')
$ErrorActionPreference = 'Stop'
$env:PATH = "$env:USERPROFILE\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64;$env:PATH"
$qaTools = Join-Path $env:TEMP ('gg-qa423-tools-' + [Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($qaTools) | Out-Null
Add-Type -TypeDefinition ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'fake-cli.cs.txt'))) -OutputAssembly (Join-Path $qaTools 'codex.exe') -OutputType ConsoleApplication
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'tools-path.local.txt'), $qaTools, [Text.UTF8Encoding]::new($false))
& node (Join-Path $PSScriptRoot $Driver)
exit $LASTEXITCODE
