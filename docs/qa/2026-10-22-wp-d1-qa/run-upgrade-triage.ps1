$filters = @(
  'blocks ordinary running runs without cancelling them',
  'blocks ordinary waiting runs without cancelling them',
  'requires every hash-bound review',
  'refuses changed source, damaged SQL/ledger',
  'rolls back deletions, DDL',
  'rechecks safety at commit',
  'refuses an ordinary definition',
  "refuses invalid/conflicting owner defaults: UPDATE settings SET value='not JSON'"
)
for ($i = 0; $i -lt $filters.Count; $i++) {
  & (Join-Path $PSScriptRoot 'run-command.ps1') -Name ('upgrade-alone-' + ($i + 1)) -PnpmArguments @(
    '--filter', '@graphgoblin/infrastructure', 'exec', 'vitest', 'run',
    'src/sqlite/upgrade.test.ts', '-t', $filters[$i], '--config',
    '../../docs/qa/2026-10-22-wp-d1-qa/infrastructure.config.mjs'
  )
}
