# Removes exactly the named task-owned leftovers directly under the user temp folder.
# Refuses any path that is not a direct child of TEMP, or that is or contains a reparse point.
$t = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$names = 'gg-codex-abandoned-82r34L','gg-codex-abandoned-kUJDiz','gg-codex-abandoned-o3tA9i','gg-codex-abandoned-qqils5','gg-codex-probe-5d240cd2','gg-codex-probe-7128b44e'
foreach ($n in $names) {
  $p = [IO.Path]::GetFullPath((Join-Path $t $n))
  if ([IO.Path]::GetDirectoryName($p).TrimEnd('\') -ne $t.TrimEnd('\')) { "REFUSED (not a direct child of TEMP): $p"; continue }
  if (-not (Test-Path -LiteralPath $p)) { "absent: $p"; continue }
  $items = @(Get-Item -LiteralPath $p -Force) + @(Get-ChildItem -LiteralPath $p -Force -Recurse)
  $links = $items | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }
  if ($links) { "REFUSED (reparse point present): $p"; continue }
  [IO.Directory]::Delete($p, $true)
  "removed: $p (entries: $($items.Count)); exists now: $(Test-Path -LiteralPath $p)"
}
