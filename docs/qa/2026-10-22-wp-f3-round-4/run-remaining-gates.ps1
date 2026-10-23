$sequence = @(
  @{ Name = 'docs-generate-final'; Args = @('docs:generate') },
  @{ Name = 'typecheck-final'; Args = @('typecheck') },
  @{ Name = 'lint-final'; Args = @('lint') },
  @{ Name = 'check-docs'; Args = @('check:docs') },
  @{ Name = 'build'; Args = @('build') },
  @{ Name = 'check-migrations'; Args = @('check:migrations') },
  @{ Name = 'migration-proof'; Args = @('exec', 'node', 'docs/qa/2026-10-22-wp-f3-round-4/migration-proof.mjs') },
  @{ Name = 'coverage-infrastructure'; Args = @('--filter', '@graphgoblin/infrastructure', 'test:coverage', '--maxWorkers=1') },
  @{ Name = 'coverage-engine'; Args = @('--filter', '@graphgoblin/engine', 'test:coverage') },
  @{ Name = 'coverage-api'; Args = @('--filter', '@graphgoblin/api', 'test:coverage') },
  @{ Name = 'coverage-web'; Args = @('--filter', '@graphgoblin/web', 'test:coverage', '--maxWorkers=1') },
  @{ Name = 'coverage-contracts'; Args = @('--filter', '@graphgoblin/contracts', 'test:coverage') },
  @{ Name = 'coverage-api-client'; Args = @('--filter', '@graphgoblin/api-client', 'test:coverage') },
  @{ Name = 'check-layers'; Args = @('check:layers') },
  @{ Name = 'check-deps'; Args = @('check:deps') },
  @{ Name = 'check-tokens'; Args = @('check:tokens') }
)
$failed = @()
foreach ($entry in $sequence) {
  $arguments = ($entry.Args | ForEach-Object { "'" + $_.Replace("'", "''") + "'" }) -join ','
  $command = "& ([ScriptBlock]::Create((Get-Content 'docs/qa/2026-10-22-wp-f3-round-4/run-gate.ps1' -Raw))) -Name '$($entry.Name)' -CommandArguments @($arguments)"
  & powershell.exe -NoProfile -Command $command
  if ($LASTEXITCODE -ne 0) { $failed += $entry.Name }
}
Write-Output ('Failed gates: ' + ($failed -join ', '))
if ($failed.Count) { exit 1 }
