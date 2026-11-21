$ErrorActionPreference = 'Stop'
$env:PATH = 'C:\Users\98jak\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64;' + $env:PATH
$evidence = 'C:\Users\98jak\graphgoblin-qa\2026-11-17-five-intents\i4-448-prose-correction-01'
$started = [DateTime]::UtcNow.ToString('o')
$nodeVersion = (& node --version).Trim()
if ($nodeVersion -ne 'v22.23.4') { throw "Unexpected runtime $nodeVersion" }
& pnpm.cmd exec prettier --write 'CHANGELOG.md' 'docs/11-security-and-distribution.md' *> (Join-Path $evidence 'commands\prettier.log')
$formatterExit = $LASTEXITCODE
& git diff --check *> (Join-Path $evidence 'commands\diff-check.log')
$diffExit = $LASTEXITCODE
[ordered]@{
  command = "pnpm.cmd exec prettier --write CHANGELOG.md docs/11-security-and-distribution.md"
  cwd = (Get-Location).Path
  nodeVersion = $nodeVersion
  startedUtc = $started
  finishedUtc = [DateTime]::UtcNow.ToString('o')
  formatterExitCode = $formatterExit
  diffCheckCommand = 'git diff --check'
  diffCheckExitCode = $diffExit
  tests = 'Not run: admitted documentation-only correction'
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $evidence 'commands\formatter-result.json') -Encoding utf8
Get-Content -LiteralPath (Join-Path $evidence 'commands\prettier.log')
Get-Content -LiteralPath (Join-Path $evidence 'commands\formatter-result.json')
if ($formatterExit -ne 0) { exit $formatterExit }
exit $diffExit
