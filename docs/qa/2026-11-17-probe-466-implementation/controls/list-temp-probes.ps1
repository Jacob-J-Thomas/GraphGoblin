# Lists top-level gg-codex-probe-* directories in the user temp folder (read-only).
$t = [IO.Path]::GetTempPath()
Get-ChildItem -LiteralPath $t -Force -Directory -Filter 'gg-codex-probe-*' | ForEach-Object { "$($_.FullName) created=$($_.CreationTimeUtc.ToString('o')) attrs=$($_.Attributes)" }
