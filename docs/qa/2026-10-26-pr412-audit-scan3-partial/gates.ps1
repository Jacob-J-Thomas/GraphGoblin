$capture = Join-Path $PSScriptRoot 'capture.ps1'
& $capture -Name runtime -Program node -CommandArgs @('--version')
foreach ($gate in @('build', 'typecheck', 'lint', 'format:check', 'check:layers', 'check:deps', 'check:docs', 'check:tokens', 'check:migrations')) {
  & $capture -Name ($gate.Replace(':','-')) -CommandArgs @($gate)
}
foreach ($package in @('contracts', 'engine', 'api-client', 'mcp', 'web', 'infrastructure', 'api')) {
  & $capture -Name "coverage-$package" -CommandArgs @('--filter', "@graphgoblin/$package", 'test:coverage', '--maxWorkers=2', '--coverage.reportOnFailure', "--coverage.reportsDirectory=$env:TEMP\gg-audit-e3r3-coverage-$package")
}
