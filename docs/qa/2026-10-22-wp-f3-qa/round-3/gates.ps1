# Replay from <repo>. No product edits, commits, paid turns or owner listeners.
param([string[]]$Only=@())
$env:PATH="$env:APPDATA\nvm\v22.14.0;$env:PATH"
$ErrorActionPreference='Continue'
$qaRepo=(Resolve-Path (Join-Path $PSScriptRoot '../../../..')).Path
Set-Location -LiteralPath $qaRepo
if((node --version) -notmatch '^v22\.'){throw 'Node 22 is required'}
$qaLedger=@()
if($Only.Count -eq 0 -or $Only -contains 'build'){
 & pnpm.cmd build 2>&1 | ForEach-Object {([string]$_).Replace($qaRepo,'<repo>').Replace($env:USERPROFILE,'<user>')} | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'build.log.txt') -Encoding utf8
 $qaLedger+=@{Name='build';ExitCode=$LASTEXITCODE}
}
foreach($qaName in @('native-recipe','api-checks','claude-checks','child-and-inspector','migration-check','migration-supplement','edge-specs','edge-extra','interactive-detail','engine-focused')){
 if($Only.Count -gt 0 -and $Only -notcontains $qaName){continue}
 & node (Join-Path $PSScriptRoot ($qaName+'.mjs')) 2>&1 | ForEach-Object {([string]$_).Replace($qaRepo,'<repo>').Replace($env:USERPROFILE,'<user>')} | Set-Content -LiteralPath (Join-Path $PSScriptRoot ($qaName+'.log.txt')) -Encoding utf8
 $qaLedger+=@{Name=$qaName;ExitCode=$LASTEXITCODE}
 Write-Output "$qaName exit=$LASTEXITCODE"
}
$qaLedger | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'gates-results.json') -Encoding utf8
& node (Join-Path $PSScriptRoot 'finalize-evidence.mjs')
if($qaLedger.Where({$_.ExitCode -ne 0}).Count -gt 0){exit 1}
