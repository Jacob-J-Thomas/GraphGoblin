param([Parameter(Mandatory=$true)][string]$Name)
$ErrorActionPreference = 'Stop'
$qa = 'C:\Users\98jak\graphgoblin-qa\2026-11-17-five-intents\i4-363-marker-author-01'
Set-Location 'G:\ggq\gg-i4-363-structured\GraphGoblin'
$env:PATH = "$env:USERPROFILE\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64;$env:PATH"
$env:TEMP = 'G:\ggq\qa-scratch\i4-363-marker'
$env:TMP = $env:TEMP
$env:TMPDIR = $env:TEMP
$arguments = switch ($Name) {
  'format' { @('exec','prettier','--write','packages/adapter-codex/src/fixtures/schema-cli.mjs','packages/adapter-codex/src/fixtures/sdk-schema-case.mjs','packages/adapter-codex/src/sdk-schema.test.ts') }
  'focused' { @('--filter','@graphgoblin/adapter-codex','exec','vitest','run','src/sdk-schema.test.ts','--reporter','verbose') }
  'typecheck' { @('--filter','@graphgoblin/adapter-codex','typecheck') }
  'lint' { @('--filter','@graphgoblin/adapter-codex','lint') }
  'coverage' { @('--filter','@graphgoblin/adapter-codex','test:coverage','--coverage.reportsDirectory=G:/ggq/qa-scratch/i4-363-marker/coverage') }
  'formatcheck' { @('exec','prettier','--check','packages/adapter-codex/src/fixtures/schema-cli.mjs','packages/adapter-codex/src/fixtures/sdk-schema-case.mjs','packages/adapter-codex/src/sdk-schema.test.ts') }
  default { throw "Unknown command $Name" }
}
$attempt = @((Get-ChildItem -LiteralPath $qa -Filter "$Name-*.log")).Count + 1
$log = Join-Path $qa "$Name-$('{0:d2}' -f $attempt).log"
$started = [DateTime]::UtcNow.ToString('o')
"started=$started`nrepo=$((Get-Location).Path)`nTEMP=$env:TEMP`nnode=$(& node --version)`ncommand=pnpm.cmd $($arguments -join ' ')" | Set-Content -LiteralPath $log
& pnpm.cmd @arguments >> $log 2>&1
$code = $LASTEXITCODE
"exit=$code`nfinished=$([DateTime]::UtcNow.ToString('o'))" | Add-Content -LiteralPath $log
Get-Content -LiteralPath $log
exit $code
