$ErrorActionPreference = 'Stop'
$run = (Get-Content -LiteralPath 'docs/qa/2026-10-21-wp-g4-qa/r2-ids.json' -Raw | ConvertFrom-Json).history.run
node docs/qa/2026-10-19-wp-g4-exit-evidence/omit-null-result.mjs "$env:GG_DATA_DIR\graphgoblin.db" "$run"
exit $LASTEXITCODE