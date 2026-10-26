param(
  [Parameter(Mandatory = $true)][string]$Name,
  [Parameter(Mandatory = $true)][string[]]$CommandArguments
)

$env:PATH = "$env:APPDATA\nvm\v22.14.0;$env:PATH"
$env:FORCE_COLOR = '0'
$env:CI = '1'
if ((& node --version) -notmatch '^v22\.') { throw 'Node 22 is required.' }
$evidenceDirectory = Join-Path (Get-Location) 'docs/qa/2026-10-22-wp-f3-round-4'
$logPath = Join-Path $evidenceDirectory "$Name.log.txt"
if ((Test-Path -LiteralPath $logPath) -or (Test-Path -LiteralPath (Join-Path $evidenceDirectory "$Name-result.json"))) {
  throw 'Capture already exists; choose a fresh gate name to preserve the original run.'
}
$started = [DateTime]::UtcNow
$writer = [System.IO.StreamWriter]::new($logPath, $false, [System.Text.UTF8Encoding]::new($false))
$writer.AutoFlush = $true
Write-Output "Starting pnpm.cmd $($CommandArguments -join ' ')"
try {
  & pnpm.cmd @CommandArguments 2>&1 | ForEach-Object {
    $line = [string]$_
    $line = $line -replace '\x1b\[[0-9;]*m', ''
    $line = $line -replace '(?i)(?:[a-z]:)?[\\/]+Users[\\/]+[^\\/\s"'']+', '<USERPROFILE>'
    $writer.WriteLine($line)
  }
  $gateExit = $LASTEXITCODE
} finally {
  $writer.Dispose()
}
$capture = Get-Item -LiteralPath $logPath
$hash = (Get-FileHash -LiteralPath $logPath -Algorithm SHA256).Hash.ToLowerInvariant()
$kept = $capture.Length -le 1000000
if (-not $kept) {
  $notKeptPath = Join-Path $evidenceDirectory 'NOT-KEPT.md'
  if (-not (Test-Path -LiteralPath $notKeptPath)) {
    [System.IO.File]::WriteAllText($notKeptPath, "# Captures not kept (D-034)`n`nSizes and hashes identify sanitized capture bytes above 1,000,000 bytes.`n`n| Name | Bytes | SHA-256 | Reason |`n| --- | --- | --- | --- |`n", [System.Text.UTF8Encoding]::new($false))
  }
  [System.IO.File]::AppendAllText($notKeptPath, "| $Name.log.txt | $($capture.Length) | $hash | Above 1,000,000 bytes; not kept |`n", [System.Text.UTF8Encoding]::new($false))
  Remove-Item -LiteralPath $logPath
}
$result = [ordered]@{
  command = "pnpm.cmd $($CommandArguments -join ' ')"
  node = (& node --version)
  exitCode = $gateExit
  startedAt = $started.ToString('o')
  elapsedSeconds = [Math]::Round(([DateTime]::UtcNow - $started).TotalSeconds, 3)
  captureName = "$Name.log.txt"
  captureBytes = $capture.Length
  captureSha256 = $hash
  kept = $kept
}
[System.IO.File]::WriteAllText((Join-Path $evidenceDirectory "$Name-result.json"), (($result | ConvertTo-Json -Depth 8) + "`n"), [System.Text.UTF8Encoding]::new($false))
Write-Output ($result | ConvertTo-Json -Compress)
if ($kept) { Get-Content -LiteralPath $logPath -Tail 12 }
exit $gateExit
