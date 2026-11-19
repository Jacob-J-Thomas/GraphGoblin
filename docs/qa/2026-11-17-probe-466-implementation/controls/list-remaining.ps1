$t = [IO.Path]::GetTempPath()
Get-ChildItem -LiteralPath $t -Force -Directory | Where-Object { $_.Name -like 'gg-codex-*' } | ForEach-Object { "remaining (not task-owned, untouched): $($_.FullName) created=$($_.CreationTimeUtc.ToString('o'))" }
