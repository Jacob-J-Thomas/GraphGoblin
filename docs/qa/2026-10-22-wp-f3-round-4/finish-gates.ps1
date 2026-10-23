# Wait for the first acquisition sequence to finish its last lightweight gate.
$sentinel = 'docs/qa/2026-10-22-wp-f3-round-4/check-tokens-result.json'
while (-not (Test-Path -LiteralPath $sentinel)) { Start-Sleep -Seconds 2 }
$sequence = @(
  @{ Name = 'coverage-infrastructure-final'; Args = @('--filter', '@graphgoblin/infrastructure', 'test:coverage', '--maxWorkers=1', '--coverage.reportOnFailure') },
  @{ Name = 'typecheck-integrated'; Args = @('typecheck') },
  @{ Name = 'lint-integrated'; Args = @('lint') }
)
foreach ($entry in $sequence) {
  $arguments = ($entry.Args | ForEach-Object { "'" + $_.Replace("'", "''") + "'" }) -join ','
  $command = "& ([ScriptBlock]::Create((Get-Content 'docs/qa/2026-10-22-wp-f3-round-4/run-gate.ps1' -Raw))) -Name '$($entry.Name)' -CommandArguments @($arguments)"
  & powershell.exe -NoProfile -Command $command
}
$env:PYTHONIOENCODING = 'utf-8'
python docs/qa/2026-10-22-wp-f3-round-4/finalize.py
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
python docs/qa/2026-10-22-wp-f3-round-4/write-report.py
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$formatCommand = "& ([ScriptBlock]::Create((Get-Content 'docs/qa/2026-10-22-wp-f3-round-4/run-gate.ps1' -Raw))) -Name 'format-final' -CommandArguments @('format')"
& powershell.exe -NoProfile -Command $formatCommand
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
@'
from pathlib import Path
import json,re
r=Path('docs/qa/2026-10-22-wp-f3-round-4')
lines=(r/'format-final.log.txt').read_text(encoding='utf-8').splitlines()
changed=[re.match(r'^(.*) \d+ms$',s).group(1) for s in lines if re.match(r'^(.*) \d+ms$',s)]
(r/'format-final-changed-files.json').write_text(json.dumps(changed,indent=2)+'\n',encoding='utf-8',newline='\n')
print('Closing formatter changed:', ', '.join(changed))
'@ | python -
python docs/qa/2026-10-22-wp-f3-round-4/finalize.py
exit $LASTEXITCODE
