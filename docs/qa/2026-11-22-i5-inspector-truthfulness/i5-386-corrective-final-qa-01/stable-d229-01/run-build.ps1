$env:PATH = 'C:/Users/98jak/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64;' + $env:PATH
$env:TEMP = 'G:/ggq/gg-i5-truthfulness-qa-scratch'
$env:TMP = $env:TEMP
$env:GIT_OPTIONAL_LOCKS = '0'
$env:GIT_NO_LAZY_FETCH = '1'
pnpm.cmd build --filter=@graphgoblin/web...
exit $LASTEXITCODE
