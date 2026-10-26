param([string]$Name, [string]$Package, [string]$TestPath, [string]$Pattern)
$env:PATH = "$env:APPDATA\nvm\v22.14.0;$env:PATH"
$env:QA_STAGE_ARGS = ConvertTo-Json -Compress -InputObject @(
  '--filter', "@graphgoblin/$Package", 'exec', 'vitest', 'run', $TestPath,
  '-t', $Pattern, '--config', "../../docs/qa/2026-10-22-wp-d1-qa/round-2/$Package.config.mjs"
)
& node --expose-gc (Join-Path $PSScriptRoot 'run-stage.mjs') $Name
exit $LASTEXITCODE
