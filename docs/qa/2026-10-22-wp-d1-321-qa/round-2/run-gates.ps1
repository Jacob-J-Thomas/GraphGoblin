param([string]$Only)
$ErrorActionPreference = 'Continue'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../..'))
Set-Location -LiteralPath $repo
$env:PATH = "$env:APPDATA\nvm\v22.14.0;$env:PATH"
$env:LIVE = '0'
Get-ChildItem Env:GG_* | ForEach-Object { Remove-Item -LiteralPath ('Env:' + $_.Name) }
Remove-Item Env:JEV_API_KEY -ErrorAction SilentlyContinue
if ((& node --version) -notmatch '^v22\.') { throw 'Node 22 required' }
$relative = 'docs/qa/2026-10-22-wp-d1-321-qa/round-2'
$packageConfig = '../../' + $relative
$commands = @(
  @('build','build'),
  @('prepare','exec','node',"$relative/prepare-fixtures.mjs"),
  @('independent','exec','node',"$relative/independent.mjs"),
  @('mcp-wire','exec','node',"$relative/mcp-provenance.mjs"),
  @('recovery-process','exec','node','--test',"$relative/recovery-process.integration.mjs"),
  @('restart','--filter','@graphgoblin/api','exec','vitest','run','src/script-restart.test.ts',"--config=$packageConfig/api.config.mts",'--maxWorkers=1'),
  @('edge','--filter','@graphgoblin/web','exec','playwright','test','-c',"$packageConfig/playwright.script-recovery.config.ts"),
  @('native-start','--filter','@graphgoblin/infrastructure','exec','vitest','run','src/process/script-recovery.test.ts',"--config=$packageConfig/infrastructure.config.mts",'--maxWorkers=1'),
  @('mcp','--filter','@graphgoblin/mcp','exec','vitest','run','src/describe.test.ts','src/tools.test.ts','--maxWorkers=1'),
  @('client-types','exec','tsc','-p',"$relative/client-config.json"),
  @('typecheck','typecheck'),
  @('format','format:check')
)
foreach ($task in $commands) {
  $label = $task[0]
  if ($Only -and $label -notin $Only.Split(',')) { continue }
  if (!$Only -and $label -eq 'format') { continue }
  $arguments = $task[1..($task.Length-1)]
  $logPath = Join-Path $PSScriptRoot ($label + '.log')
  $writer = [IO.StreamWriter]::new($logPath,$false,[Text.UTF8Encoding]::new($false))
  $start = Get-Date
  Write-Output "START $label"
  try {
    & pnpm.cmd @arguments 2>&1 | ForEach-Object {
      $line = $_.ToString().Replace($repo,'<repo>').Replace($repo.Replace('\','/'),'<repo>').Replace($repo.Replace('\','\\'),'<repo>')
      $line = $line.Replace($env:USERPROFILE,'<user>').Replace($env:USERPROFILE.Replace('\','/'),'<user>').Replace($env:USERPROFILE.Replace('\','\\'),'<user>')
      $writer.WriteLine([regex]::Replace($line,'\bgg_[A-Za-z0-9_-]+','[redacted-key]'))
    }
    $result = $LASTEXITCODE
  } finally { $writer.Dispose() }
  $record = [ordered]@{name=$label;command=('pnpm.cmd '+($arguments -join ' '));exitCode=$result;seconds=[math]::Round(((Get-Date)-$start).TotalSeconds,2)}
  $record | ConvertTo-Json -Compress | Add-Content -Encoding UTF8 (Join-Path $PSScriptRoot 'gate-results.jsonl')
  Write-Output ($record | ConvertTo-Json -Compress)
  if ($label -eq 'build' -and $result -ne 0) { throw 'Build failed; do not start runtime checks.' }
}
