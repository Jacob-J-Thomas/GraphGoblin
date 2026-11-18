$ErrorActionPreference = 'Stop'
$hardlink = @(Get-ChildItem -LiteralPath $env:HARDLINK_DIR -Force | ForEach-Object Name | Sort-Object)
$manifest = @(Get-ChildItem -LiteralPath $env:MANIFEST_DIR -Force | ForEach-Object Name | Sort-Object)
$outside = Get-Content -LiteralPath (Join-Path $env:RUNNER_TEMP 'qa496-outside-store.db') -Raw
$report = [ordered]@{ evidence = 'qa-496-refusal'; hardlink = $env:HARDLINK_OUTCOME; manifest = $env:MANIFEST_OUTCOME; hardlinkPaths = $env:HARDLINK_PATHS; manifestPaths = $env:MANIFEST_PATHS; hardlinkEntries = $hardlink; manifestEntries = $manifest; outsideUnchanged = ($outside -eq "QA496-$env:GITHUB_RUN_ID-HARDLINK-CANARY") }
$report | ConvertTo-Json -Compress
if ($env:HARDLINK_OUTCOME -ne 'failure' -or $env:MANIFEST_OUTCOME -ne 'failure' -or $env:HARDLINK_PATHS -ne '' -or $env:MANIFEST_PATHS -ne '' -or ($hardlink -contains 'result.json') -or ($manifest -contains 'result.json') -or -not $report.outsideUnchanged) { throw 'Refusal control failed.' }
