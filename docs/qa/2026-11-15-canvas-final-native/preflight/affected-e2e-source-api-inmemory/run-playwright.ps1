$ErrorActionPreference='Stop'
$packet=$PSScriptRoot
$env:GIT_OPTIONAL_LOCKS='0'
$env:GG_E2E_WEB_DIST=Join-Path $packet 'web-dist'
$env:GG_E2E_BROWSER_CHANNEL='msedge'
$env:GG_E2E_MAIN_PORT='0'
$env:GG_E2E_CONTROL_PORT='0'
$env:GG_E2E_KEEP_STDIN='0'
$env:GG_E2E_BASE_URL=''
$env:GG_E2E_CONTROL_URL=''
$env:GG_ROUTING_SCREENSHOTS='0'
$env:LIVE='0'
$env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD='1'
$env:PLAYWRIGHT_JSON_OUTPUT_FILE=Join-Path $packet 'results.json'
$env:TMP=Join-Path $packet 't'
$env:TEMP=$env:TMP
$env:TMPDIR=$env:TMP
$env:GG_TEST_DATA_PREFIX='gg-affected-e2e-'
$grep='(?:keyboard: Tab reaches the handles, arrows nudge by grid steps, Escape returns to the edge|a double click on a connection\u2019s line, where its toolbar then puts Remove connection, selects it and removes nothing; a separate click removes it once \(#207\))$'
$pwArgs=@('--filter','@graphgoblin/web','exec','playwright','test','--config','playwright.config.ts','e2e/edge-routes.spec.ts','--grep',$grep,'--workers=1','--retries=0','--reporter=list,json',('--output=' + (Join-Path $packet 'test-results')))
$pnpm=(Get-Command pnpm.cmd).Source
$started=[DateTime]::UtcNow.ToString('o')
[ordered]@{startedAt=$started;pid=$PID;cwd=(Get-Location).Path;executable=$pnpm;args=$pwArgs;node=(node --version);browserChannel=$env:GG_E2E_BROWSER_CHANNEL;
 webDist=$env:GG_E2E_WEB_DIST;tempDirectory=$env:TMP;mainPort=$env:GG_E2E_MAIN_PORT;controlPort=$env:GG_E2E_CONTROL_PORT} |
 ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8NoBOM -LiteralPath (Join-Path $packet 'command.json')
& $pnpm @pwArgs 1> (Join-Path $packet 'stdout.log') 2> (Join-Path $packet 'stderr.log')
$code=$LASTEXITCODE
[ordered]@{pid=$PID;startedAt=$started;finishedAt=[DateTime]::UtcNow.ToString('o');exitCode=$code} |
 ConvertTo-Json | Set-Content -Encoding utf8NoBOM -LiteralPath (Join-Path $packet 'exit.json')
exit $code
