. 'G:/ggq/delivery-evidence/2026-11-17-five-intents/i4-486-d215-author-01/verification-environment.ps1'
$typed = Invoke-RetainedStep '31-infrastructure-typecheck' 'pnpm.cmd' @('--filter', '@graphgoblin/infrastructure', 'typecheck')
$linted = Invoke-RetainedStep '32-scoped-eslint' 'pnpm.cmd' @('--filter', '@graphgoblin/infrastructure', 'exec', 'eslint', 'src/fs/fs.test.ts')
$formatted = Invoke-RetainedStep '33-scoped-prettier' 'pnpm.cmd' @('exec', 'prettier', '--check', $source)
if ($typed + $linted + $formatted -ne 0) { throw "Gate results typecheck=$typed lint=$linted format=$formatted" }
