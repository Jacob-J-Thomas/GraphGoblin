param([Parameter(Mandatory=$true)][string]$Checkout)
$ErrorActionPreference='Stop'
$proofRoot=(Get-Location).Path
$run=Join-Path $proofRoot 'repository-two-e2e-first'
if(Test-Path -LiteralPath $run){throw 'First repository test attempt is retained'}
New-Item -ItemType Directory -Path $run | Out-Null
$dist=Join-Path $run 'web-dist'
Copy-Item -LiteralPath (Join-Path $Checkout 'apps/web/dist') -Destination $dist -Recurse
$collect=@()
foreach($file in Get-ChildItem -File -Recurse -LiteralPath $dist){
  $rel=[IO.Path]::GetRelativePath($dist,$file.FullName).Replace('\','/')
  $collect+= [pscustomobject]@{path=$rel;sha=(Get-FileHash -LiteralPath $file.FullName).Hash.ToLowerInvariant()}
}
$first=@($collect | Sort-Object path)
$expected = @(Get-Content -LiteralPath (Join-Path $proofRoot 'final-manifests/apps_web_dist.sha256'))
if($first.Count -ne $expected.Count){throw 'External served web copy file set mismatch'}
foreach($file in $first){
 if(($file.sha+' *'+$file.path) -cnotin $expected){throw ('Exact served web copy file mismatch '+$file.path)}
}
$runtimeTemp=Join-Path $run 'tmp'
New-Item -ItemType Directory -Path $runtimeTemp | Out-Null
$env:PATH = "$env:USERPROFILE\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64;$env:PATH"
Get-ChildItem Env: | Where-Object Name -Like 'GG_*' | ForEach-Object {Remove-Item -LiteralPath ('Env:'+$_.Name)}
$env:GIT_OPTIONAL_LOCKS='0'
$env:TMP=$runtimeTemp
$env:TEMP=$runtimeTemp
$env:TMPDIR=$runtimeTemp
$env:GG_E2E_WEB_DIST=$dist
$env:GG_E2E_MAIN_PORT='0'
$env:GG_E2E_CONTROL_PORT='0'
$env:GG_E2E_BROWSER_CHANNEL='msedge'
$env:LIVE='0'
$env:PLAYWRIGHT_JSON_OUTPUT_FILE=(Join-Path $run 'playwright-result.json')
$requested='option IDs stay connected when numeric display labels change, save, and reload|Loop issues remove the edge a blank route ID owns, and one Undo restores the whole draft'
$results=Join-Path $run 'test-results'
$started=[DateTime]::UtcNow.ToString('o')
Push-Location -LiteralPath $Checkout
try {
  if((git rev-parse HEAD) -ne 'bc9094fd426fe1c1a4b81b0e490e3887f977dbc7' -or (git status --porcelain=v1)){throw 'Frozen head changed'}
  pnpm.cmd --filter '@graphgoblin/web' test:e2e e2e/decision-routes.spec.ts --grep $requested --workers=1 --retries=0 '--reporter=list,json' "--output=$results" 2>&1 |
    Tee-Object -FilePath (Join-Path $run 'stdio.log')
  $code=$LASTEXITCODE
}finally {Pop-Location}
$finished=[DateTime]::UtcNow.ToString('o')
$after=@(Get-ChildItem -File -Recurse -LiteralPath $dist | ForEach-Object {
  $rel=[IO.Path]::GetRelativePath($dist,$_.FullName).Replace('\','/')
  [pscustomobject]@{path=$rel;sha=(Get-FileHash -LiteralPath $_.FullName).Hash.ToLowerInvariant()}
} | Sort-Object path)
$leaves=@(Get-ChildItem -LiteralPath $runtimeTemp -Force | Select-Object Name)
$still=@(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'e2e/server\.ts' } |
  Select-Object ProcessId,ParentProcessId,Name,CreationDate)
[ordered]@{startedAt=$started;finishedAt=$finished;exitCode=$code;head='bc9094fd426fe1c1a4b81b0e490e3887f977dbc7';
  tests=$requested;mainPortRequest=0;controlPortRequest=0;output=$results;externalDist=$dist;originalCopyHashes=$first;
  afterCopyHashes=$after;externalTempLeaves=$leaves;possibleLiveServers=$still} | ConvertTo-Json -Depth 7 |
  Set-Content -Encoding utf8NoBOM -LiteralPath (Join-Path $run 'execution.json')
if($code -ne 0){exit $code}
if(Compare-Object @($first|ForEach-Object {$_.sha+' '+$_.path}) @($after|ForEach-Object {$_.sha+' '+$_.path})){throw 'External copy not restored'}
