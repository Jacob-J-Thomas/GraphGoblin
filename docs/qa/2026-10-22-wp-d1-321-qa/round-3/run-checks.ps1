param([string]$Only)
$ErrorActionPreference = 'Continue'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../..'))
Set-Location -LiteralPath $repo
$env:PATH = "$env:APPDATA\nvm\v22.14.0;$env:PATH"
$env:LIVE = '0'
Get-ChildItem Env:GG_* | ForEach-Object { Remove-Item -LiteralPath ('Env:' + $_.Name) }
Remove-Item Env:JEV_API_KEY -ErrorAction SilentlyContinue
if ((& node --version) -notmatch '^v22\.') { throw 'Node 22 required' }
$config = '--config=../../docs/qa/2026-10-22-wp-d1-321-qa/round-3/qa.config.mts'
$pair = @('--filter','@graphgoblin/api','exec','vitest','run','src/script-restart.test.ts','src/child-creation-restart.test.ts',$config)
$commands = @(
  @('build','build'),
  (@('pair-1') + $pair),
  (@('pair-2') + $pair),
  (@('pair-3') + $pair),
  (@('with-subloop') + $pair + @('src/subloop-restart.test.ts')),
  @('coverage-requested','--filter','@graphgoblin/api','test:coverage','--','--maxWorkers=2',$config),
  @('coverage-two-workers','--filter','@graphgoblin/api','test:coverage','--maxWorkers=2',$config,'--coverage.reportOnFailure'),
  @('triage-child-zero','--filter','@graphgoblin/api','exec','vitest','run','src/child-creation-restart.test.ts','-t','kill 0ms',$config,'--maxWorkers=1')
)
foreach ($task in $commands) {
  $label=$task[0]
  if ($Only -and $label -notin $Only.Split(',')) { continue }
  if (!$Only -and $label.StartsWith('triage')) { continue }
  if (!$Only -and $label -eq 'coverage-two-workers') { continue }
  $arguments=$task[1..($task.Length-1)]
  $writer=[IO.StreamWriter]::new((Join-Path $PSScriptRoot ($label+'.log')),$false,[Text.UTF8Encoding]::new($false))
  $writer.AutoFlush=$true
  $start=Get-Date
  $savedTemp=$env:TEMP
  $savedTmp=$env:TMP
  $taskRoot=$null
  if ($label.StartsWith('coverage')) {
    $taskRoot=Join-Path $env:TEMP ('gg-qa-321-r3-coverage-'+[guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $taskRoot | Out-Null
    $env:TEMP=$taskRoot
    $env:TMP=$taskRoot
  }
  Write-Output "START $label"
  try {
    & pnpm.cmd @arguments 2>&1 | ForEach-Object {
      $line=$_.ToString()
      foreach ($prefix in @($repo,$env:USERPROFILE)) {
        foreach ($version in @($prefix.Replace('\','\\'),$prefix.Replace('\','/'),$prefix)) {
          $line=$line.Replace($version, $(if($prefix -eq $repo){'<repo>'}else{'<user>'}))
        }
      }
      $writer.WriteLine([regex]::Replace($line,'\bgg_[A-Za-z0-9_-]+','[redacted-key]'))
    }
    $result=$LASTEXITCODE
  } finally { $writer.Dispose(); $env:TEMP=$savedTemp; $env:TMP=$savedTmp }
  $record=[ordered]@{name=$label;command=('pnpm.cmd '+($arguments -join ' '));exitCode=$result;seconds=[math]::Round(((Get-Date)-$start).TotalSeconds,2);tempRoot=$(if($taskRoot){Split-Path $taskRoot -Leaf}else{$null})}
  $record | ConvertTo-Json -Compress | Add-Content -Encoding UTF8 (Join-Path $PSScriptRoot 'results.jsonl')
  Write-Output ($record | ConvertTo-Json -Compress)
  if ($label -eq 'build' -and $result -ne 0) { throw 'Build failed.' }
}
