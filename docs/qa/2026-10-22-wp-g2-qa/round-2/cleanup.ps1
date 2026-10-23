$ErrorActionPreference = 'Stop'
$taskEvidence = Join-Path (Get-Location).Path 'docs/qa/2026-10-22-wp-g2-qa/round-2'
$location = Get-Content -LiteralPath (Join-Path $taskEvidence 'fixture-location.json') -Raw | ConvertFrom-Json
if ($location.tempLeaf -notmatch '^gg-qa-g2-a9df185-[a-zA-Z0-9]+$') { throw 'Unexpected QA temp leaf' }
$tempBase = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')
$taskTemp = [IO.Path]::GetFullPath((Join-Path $tempBase $location.tempLeaf))
if (-not $taskTemp.StartsWith($tempBase + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'QA target outside temp' }
if ((Split-Path $taskTemp -Leaf) -ne $location.tempLeaf) { throw 'QA target leaf mismatch' }
$log = [Collections.Generic.List[string]]::new()
$log.Add('Cleanup target: %TEMP%/' + $location.tempLeaf)
$tcp = [Net.Sockets.TcpClient]::new()
try {
  $pending = $tcp.ConnectAsync('127.0.0.1', [int]$location.port)
  try { $null = $pending.Wait(500) } catch { }
  if ($tcp.Connected) { throw 'QA listener remains open; cleanup refused' }
  $log.Add('QA port ' + $location.port + ': closed')
} finally { $tcp.Dispose() }
$root = [IO.DirectoryInfo]::new($taskTemp)
if (-not $root.Exists) { throw 'Expected own QA root missing before cleanup' }
$queue = [Collections.Generic.Queue[IO.DirectoryInfo]]::new()
$queue.Enqueue($root)
$files = 0; $bytes = 0; $databases = 0
while ($queue.Count -gt 0) {
  $dir = $queue.Dequeue()
  if (($dir.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Unexpected QA reparse point; cleanup refused' }
  foreach ($entry in $dir.EnumerateFileSystemInfos()) {
    if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Unexpected QA reparse point; cleanup refused' }
    if ($entry -is [IO.DirectoryInfo]) { $queue.Enqueue($entry) }
    else {
      $files++; $bytes += $entry.Length
      if ($entry.Extension -in @('.db', '.sqlite', '.sqlite3')) {
        $databases++
        $log.Add('Database inventoried: ' + $entry.FullName.Substring($taskTemp.Length + 1).Replace('\', '/'))
      }
    }
  }
}
$log.Add('Inventory: files=' + $files + '; bytes=' + $bytes + '; databases=' + $databases)
$log.Add('All owned API/MCP/Edge child handles were closed by the harness before cleanup.')
$log | Set-Content -LiteralPath (Join-Path $taskEvidence 'cleanup.log.txt') -Encoding UTF8
# User explicitly authorized removal of every QA-created temp store in this session.
# The absolute target was checked above, and no reparse points will be traversed.
Remove-Item -LiteralPath $taskTemp -Recurse -Force
$remains = Test-Path -LiteralPath $taskTemp
('Root remains: ' + $remains) | Add-Content -LiteralPath (Join-Path $taskEvidence 'cleanup.log.txt') -Encoding UTF8
if ($remains) { throw 'QA cleanup incomplete' }
Get-Content -LiteralPath (Join-Path $taskEvidence 'cleanup.log.txt')
