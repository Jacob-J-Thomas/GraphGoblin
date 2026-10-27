# Run from the QA worktree root in Windows PowerShell. Creates no directory links.
$env:PATH = "$env:USERPROFILE\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64;$env:PATH"
$env:GG_TEST_PORT_START = '6970'
$env:GG_TEST_PORT_COUNT = '30'
$qaRoot = Join-Path $env:TEMP ('gg-qa-422r-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $qaRoot 'cli') | Out-Null
Add-Type -TypeDefinition ([IO.File]::ReadAllText((Join-Path $PWD 'docs/qa/2026-10-26-acceptance-a/session-cli.cs'))) -OutputAssembly (Join-Path $qaRoot 'cli/claude.exe') -OutputType ConsoleApplication
Copy-Item -LiteralPath (Join-Path $qaRoot 'cli/claude.exe') -Destination (Join-Path $qaRoot 'cli/codex.exe')
[IO.File]::WriteAllText((Join-Path $env:TEMP 'gg-qa-422r-independent-root.txt'), $qaRoot, [Text.UTF8Encoding]::new($false))
$env:GG_QA_ROOT = $qaRoot
node --version
(Get-Command node).Source
