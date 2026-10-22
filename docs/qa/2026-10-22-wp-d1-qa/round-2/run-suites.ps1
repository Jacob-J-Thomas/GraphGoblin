$env:PATH = "$env:APPDATA\nvm\v22.14.0;$env:PATH"
$qaAnyFailure = 0
foreach ($qaPackage in @('engine', 'infrastructure', 'api')) {
  $env:QA_STAGE_ARGS = ConvertTo-Json -Compress -InputObject @(
    '--filter', "@graphgoblin/$qaPackage", 'test:coverage', '--config',
    "../../docs/qa/2026-10-22-wp-d1-qa/round-2/$qaPackage.config.mjs"
  )
  & node --expose-gc (Join-Path $PSScriptRoot 'run-stage.mjs') ($qaPackage + '-coverage')
  if ($LASTEXITCODE -ne 0) { $qaAnyFailure = 1 }
}
exit $qaAnyFailure
