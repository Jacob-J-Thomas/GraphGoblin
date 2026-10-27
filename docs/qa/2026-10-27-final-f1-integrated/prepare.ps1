$env:PATH = "$env:USERPROFILE\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64;$env:PATH"
$env:GG_TEST_PORT_START = '6850'
$env:GG_TEST_PORT_COUNT = '40'
$f1Root = Join-Path $env:TEMP ('gg-final-f1-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $f1Root 'cli') | Out-Null
$f1Record = Join-Path $PWD 'docs/qa/2026-10-27-final-f1-integrated'
Add-Type -TypeDefinition ([IO.File]::ReadAllText((Join-Path $f1Record 'session-cli.cs'))) -OutputAssembly (Join-Path $f1Root 'cli/claude.exe') -OutputType ConsoleApplication
Copy-Item -LiteralPath (Join-Path $f1Root 'cli/claude.exe') -Destination (Join-Path $f1Root 'cli/codex.exe')
Add-Type -TypeDefinition ([IO.File]::ReadAllText((Join-Path $f1Record 'console-tool.cs'))) -OutputAssembly (Join-Path $f1Root 'cli/console-tool.exe') -OutputType ConsoleApplication
[IO.File]::WriteAllText((Join-Path $env:TEMP 'gg-final-f1-active-root.txt'), $f1Root, [Text.UTF8Encoding]::new($false))
$env:GG_QA_ROOT = $f1Root
node --version
(Get-Command node).Source
