# Lists exact named leftovers under the user temp folder with attributes and link types (read-only).
$t = [IO.Path]::GetTempPath()
$names = 'gg-codex-abandoned-82r34L','gg-codex-abandoned-kUJDiz','gg-codex-abandoned-o3tA9i','gg-codex-abandoned-qqils5','gg-codex-probe-5d240cd2'
foreach ($n in $names) {
  $p = Join-Path $t $n
  if (-not (Test-Path -LiteralPath $p)) { "== $p absent"; continue }
  $i = Get-Item -LiteralPath $p -Force
  "== $($i.FullName) attrs=$($i.Attributes) linktype=$($i.LinkType) created=$($i.CreationTimeUtc.ToString('o'))"
  Get-ChildItem -LiteralPath $p -Force -Recurse | ForEach-Object {
    "   $($_.FullName) attrs=$($_.Attributes) linktype=$($_.LinkType) created=$($_.CreationTimeUtc.ToString('o'))"
  }
}
