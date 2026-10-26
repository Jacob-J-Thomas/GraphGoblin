$ErrorActionPreference='Stop'
$qaSystemTemp=[System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\')
$qaRoot=[System.IO.Path]::GetFullPath((Join-Path $qaSystemTemp 'gg-qa-231-9896cf-independent')).TrimEnd('\')
$qaEvidence=Join-Path (Get-Location) 'docs/qa/2026-10-22-wp-g2-qa'
if(-not $qaRoot.StartsWith($qaSystemTemp+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'QA cleanup escaped system temp.' }
if((Split-Path $qaRoot -Leaf) -ne 'gg-qa-231-9896cf-independent') { throw 'Unexpected QA cleanup leaf.' }
$qaNotes=[System.Collections.Generic.List[string]]::new()
$qaNotes.Add('SCOPE: %TEMP%/gg-qa-231-9896cf-independent only; evidence and generated worktree outputs preserved.')
foreach($qaPort in @(5633,5634,5635,5639)) {
 $qaClient=[System.Net.Sockets.TcpClient]::new()
 try { $qaConnect=$qaClient.ConnectAsync('127.0.0.1',$qaPort); $qaDone=$qaConnect.Wait(350); $qaOpen=$qaDone -and $qaClient.Connected } catch { $qaOpen=$false } finally { $qaClient.Dispose() }
 $qaNotes.Add("PORT $qaPort LISTENING: $qaOpen")
 if($qaOpen) { throw "Owned QA listener still open on $qaPort; do not remove its store." }
}
if(Test-Path -LiteralPath $qaRoot) {
 $qaInfo=Get-Item -LiteralPath $qaRoot -Force
 if(($qaInfo.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Root is a reparse point; refusing recursive cleanup.' }
 $qaQueue=[System.Collections.Generic.Queue[System.IO.DirectoryInfo]]::new()
 $qaQueue.Enqueue([System.IO.DirectoryInfo]::new($qaRoot))
 $qaLinks=[System.Collections.Generic.List[System.IO.FileSystemInfo]]::new()
 $qaFiles=0; $qaDirs=1; $qaBytes=[long]0; $qaStores=0
 while($qaQueue.Count -gt 0) {
  $qaDir=$qaQueue.Dequeue()
  foreach($qaEntry in $qaDir.EnumerateFileSystemInfos()) {
   if(($qaEntry.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { $qaLinks.Add($qaEntry); continue }
   if(($qaEntry.Attributes -band [System.IO.FileAttributes]::Directory) -ne 0) { $qaDirs++; $qaQueue.Enqueue([System.IO.DirectoryInfo]$qaEntry) }
   else { $qaFiles++; $qaBytes+=([System.IO.FileInfo]$qaEntry).Length; if($qaEntry.Name -match '\.(db|sqlite|sqlite3)$') { $qaStores++; $qaNotes.Add('STORE: '+$qaEntry.FullName.Substring($qaRoot.Length+1)) } }
  }
 }
 $qaNotes.Add("INVENTORY: files=$qaFiles directories=$qaDirs bytes=$qaBytes databaseFiles=$qaStores reparsePoints=$($qaLinks.Count)")
 $qaNotes | Set-Content -LiteralPath (Join-Path $qaEvidence 'cleanup-inventory.txt') -Encoding UTF8
 foreach($qaLink in $qaLinks) {
  $qaLinkPath=[System.IO.Path]::GetFullPath($qaLink.FullName)
  if(-not $qaLinkPath.StartsWith($qaRoot+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Link cleanup escaped root.' }
  $qaNotes.Add('UNLINK ONLY: '+$qaLinkPath.Substring($qaRoot.Length+1))
  if(($qaLink.Attributes -band [System.IO.FileAttributes]::Directory) -ne 0) { [System.IO.Directory]::Delete($qaLinkPath,$false) }
  else { [System.IO.File]::Delete($qaLinkPath) }
 }
 Remove-Item -LiteralPath $qaRoot -Recurse -Force
}
$qaRemaining=Test-Path -LiteralPath $qaRoot
$qaNotes.Add("ROOT REMAINS: $qaRemaining")
$qaNotes.Add('RESULT: PASS; all QA temporary stores, keys, screenshots and temporary harness files removed.')
$qaNotes | Set-Content -LiteralPath (Join-Path $qaEvidence 'cleanup.txt') -Encoding UTF8
if($qaRemaining) { throw 'QA temporary root still exists.' }
Write-Output "Cleanup passed; $qaStores database files removed."

