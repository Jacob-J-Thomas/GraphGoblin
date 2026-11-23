. 'G:/ggq/delivery-evidence/2026-11-17-five-intents/i4-486-d216-author-01/environment.ps1'
$typed = Invoke-Retained '24-infrastructure-typecheck' 'pnpm.cmd' @('--filter', '@graphgoblin/infrastructure', 'typecheck')
$linted = Invoke-Retained '25-scoped-eslint' 'pnpm.cmd' @('--filter', '@graphgoblin/infrastructure', 'exec', 'eslint', 'src/fs/fs.test.ts')
$formatted = Invoke-Retained '26-scoped-prettier' 'pnpm.cmd' @('exec', 'prettier', '--check', $source)
if ($typed -ne 0 -or $linted -ne 0 -or $formatted -ne 0) { throw "Gate results typecheck=$typed lint=$linted format=$formatted" }
