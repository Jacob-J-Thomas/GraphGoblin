$qaGates = @(
  @('typecheck', 'typecheck', '--concurrency=2'),
  @('lint', 'lint', '--concurrency=2'),
  @('layers', 'check:layers'),
  @('deps', 'check:deps')
)
foreach ($qaGate in $qaGates) {
  & (Join-Path $PSScriptRoot 'run-command.ps1') -Name $qaGate[0] -PnpmArguments $qaGate[1..($qaGate.Length - 1)]
}
