$cases = @(
  @('api-scope-alone', 'src/adversarial.test.ts', 'ADV-008: every advertised route'),
  @('api-catalog-alone', 'src/container.test.ts', 'reads existing manual catalog entries'),
  @('api-main-auth-alone', 'src/main.test.ts', 'serves authenticated requests'),
  @('api-main-cli-alone', 'src/main.test.ts', 'dispatches the API-key and preflight CLIs'),
  @('api-c6-down-alone', 'src/subloop-restart.test.ts', 'recovers a child finished while down'),
  @('api-c6-wake-alone', 'src/subloop-restart.test.ts', 'recovers a parent interrupted mid-wake'),
  @('api-version-alone', 'src/version-migration.test.ts', 'recovers a current-format pinned run'),
  @('api-template-alone', 'src/routes/template-drafts.test.ts', 'creates independent review copies'),
  @('api-github-alone', 'src/triggers/github-recipe.test.ts', 'curates all pages')
)
foreach ($case in $cases) {
  & (Join-Path $PSScriptRoot 'run-command.ps1') -Name $case[0] -PnpmArguments @(
    '--filter', '@graphgoblin/api', 'exec', 'vitest', 'run', $case[1], '-t', $case[2],
    '--config', '../../docs/qa/2026-10-22-wp-d1-qa/api.config.mjs'
  )
}
