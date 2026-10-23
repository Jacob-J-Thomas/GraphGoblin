# Serial isolated triage; no timeout changes or retries.
param([ValidateSet('web','api')][string]$Package)
$ErrorActionPreference='Continue'
$env:PATH="$env:APPDATA\nvm\v22.14.0;$env:PATH"
$qaCheckout=(Get-Location).Path
$qaEvidence=Join-Path $qaCheckout 'docs/qa/2026-10-22-wp-f2b-qa'
$qaOuterTemp=$env:TEMP
$qaTemp=Join-Path $qaOuterTemp ('gg-qa-204-triage-'+$Package+'-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $qaTemp | Out-Null
$env:TEMP=$qaTemp
$env:TMP=$qaTemp
$qaCases=([IO.File]::ReadAllText((Join-Path $qaEvidence ($Package+'-initial-summary.json'))) | ConvertFrom-Json).failures
$qaResults=@()
$qaIndex=0
foreach($qaCase in $qaCases) {
  $qaIndex++
  $qaJson=Join-Path $qaTemp ($qaIndex.ToString()+'.json')
  $qaLog=Join-Path $qaTemp ($qaIndex.ToString()+'.log')
  $qaPattern=[regex]::Escape($qaCase.name)+'$'
  $qaConfigArgs=@(); if($Package -eq "api") { $qaConfigArgs=@("--config",(Join-Path $qaEvidence "api-triage.config.ts")) }; & pnpm.cmd --filter ("@graphgoblin/"+$Package) exec vitest run @qaConfigArgs $qaCase.file -t $qaPattern --maxWorkers=1 --reporter=json --outputFile $qaJson *> $qaLog
  $qaExit=$LASTEXITCODE
  $qaPassed=0; $qaFailed=0; $qaMessages=@()
  if(Test-Path -LiteralPath $qaJson) {
    $qaData=[IO.File]::ReadAllText($qaJson) | ConvertFrom-Json
    $qaPassed=$qaData.numPassedTests; $qaFailed=$qaData.numFailedTests
    foreach($qaFile in $qaData.testResults) {
      foreach($qaTest in $qaFile.assertionResults) {
        if($qaTest.status -eq 'failed') { $qaMessages+=@($qaTest.failureMessages) }
      }
    }
  } else { $qaMessages+=((Get-Content -LiteralPath $qaLog -Tail 18) -join [Environment]::NewLine) }
  $qaSafeMessages=@($qaMessages | ForEach-Object { $_.Replace($qaCheckout,'<checkout>').Replace($qaTemp,'<disposable>').Replace($qaCheckout.Replace('\','/'),'<checkout>').Replace($qaTemp.Replace('\','/'),'<disposable>').Replace($env:USERPROFILE,'<local>').Replace($env:USERPROFILE.Replace('\','/'),'<local>') })
  $qaResult=[pscustomobject]@{file=$qaCase.file;name=$qaCase.name;exit=$qaExit;passed=$qaPassed;failed=$qaFailed;messages=$qaSafeMessages}
  $qaResults+=$qaResult
  [IO.File]::WriteAllText((Join-Path $qaEvidence ($Package+'-isolated-triage.json')),($qaResults | ConvertTo-Json -Depth 12))
  Write-Output ($Package+' '+$qaIndex+'/'+$qaCases.Count+' exit='+$qaExit+' passed='+$qaPassed+' '+$qaCase.file+' :: '+$qaCase.name)
}
Write-Output ('Owned disposable directory: '+$qaTemp)
