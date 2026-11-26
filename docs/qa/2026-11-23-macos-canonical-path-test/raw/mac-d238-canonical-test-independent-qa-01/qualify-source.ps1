$ErrorActionPreference = 'Stop'
$env:GIT_OPTIONAL_LOCKS = '0'
$taskRoot = 'G:\ggq\gg-mac-d238-alias-qa\GraphGoblin'
Set-Location -LiteralPath $taskRoot
function Get-GitBytes([string[]]$Arguments) {
  $psi = [Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = (Get-Command git.exe).Source
  foreach ($argument in $Arguments) { $psi.ArgumentList.Add($argument) }
  $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
  $process = [Diagnostics.Process]::new(); $process.StartInfo = $psi
  [void]$process.Start()
  $memory = [IO.MemoryStream]::new()
  $copy = $process.StandardOutput.BaseStream.CopyToAsync($memory)
  $errorRead = $process.StandardError.ReadToEndAsync()
  $process.WaitForExit(); [void]$copy.GetAwaiter().GetResult()
  if ($process.ExitCode -ne 0) { throw $errorRead.GetAwaiter().GetResult() }
  return ,$memory.ToArray()
}
function Hash-Bytes([byte[]]$Bytes) { [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($Bytes)).ToLowerInvariant() }
$before = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'before.state.json') -Raw | ConvertFrom-Json
$after = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'after.state.json') -Raw | ConvertFrom-Json
$beforeByPath = @{}; foreach ($row in $before.trackedFiles) { $beforeByPath[$row.path] = $row.sha256 }
$afterByPath = @{}; foreach ($row in $after.trackedFiles) { $afterByPath[$row.path] = $row.sha256 }
$raw = Get-GitBytes @('--no-optional-locks','ls-files','-z')
[IO.File]::WriteAllBytes((Join-Path $PSScriptRoot 'GIT-PATHS.z'), $raw)
$paths = [Text.Encoding]::UTF8.GetString($raw).Split([char[]]@([char]0),[StringSplitOptions]::RemoveEmptyEntries)
$qa = @($paths | Where-Object {$_.StartsWith('docs/qa/')})
$nonQa = @($paths | Where-Object {-not $_.StartsWith('docs/qa/')})
$missing = @(); $drift = @()
foreach ($relative in $nonQa) {
  $path = Join-Path $taskRoot $relative
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { $missing += $relative; continue }
  $hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($hash -cne $beforeByPath[$relative] -or $hash -cne $afterByPath[$relative]) { $drift += $relative }
}
$critical = foreach ($relative in @('apps/api/src/main.test.ts','apps/api/src/main.ts','apps/api/src/testing/api-subprocess.ts','apps/api/src/canonical-path.ts','apps/api/src/data-dir-lock.ts','apps/api/src/container.ts','apps/api/src/config.ts','packages/infrastructure/src/ollama/services.ts')) {
  $current = (Get-FileHash -LiteralPath (Join-Path $taskRoot $relative) -Algorithm SHA256).Hash.ToLowerInvariant()
  $blob = Hash-Bytes (Get-GitBytes @('--no-optional-locks','cat-file','blob',"HEAD:$relative"))
  [ordered]@{path=$relative;actualSha256=$current;headBlobSha256=$blob;beforeSha256=$beforeByPath[$relative];afterSha256=$afterByPath[$relative];allEqual=($current -ceq $blob -and $current -ceq $beforeByPath[$relative] -and $current -ceq $afterByPath[$relative])}
}
$rawOdd = @($after.trackedFiles | Where-Object {$null -eq $_.sha256 -and -not $_.path.StartsWith('docs/qa/')} | ForEach-Object {$_.path})
$qaAbsent = -not (Test-Path -LiteralPath (Join-Path $taskRoot 'docs/qa'))
$report = [ordered]@{utc=[DateTimeOffset]::UtcNow.ToString('o');firstParityFlagPreserved=$true;cause='Five Git C-quoted docs/qa labels with UTF8 octal apostrophes fail a raw StartsWith predicate; NUL-delimited UTF8 native paths avoid quoting.';nulPathListSha256=(Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'GIT-PATHS.z') -Algorithm SHA256).Hash.ToLowerInvariant();nativeTrackedCount=$paths.Count;nativeDocsQaCount=$qa.Count;nativeNonQaCount=$nonQa.Count;nativeMissingNonQaPaths=$missing;nativeNonQaHashDrift=$drift;docsQaDirectoryAbsent=$qaAbsent;allDecodedOmissionsAreDocsQa=($qaAbsent -and $missing.Count -eq 0);rawNonPrefixMissingLabels=$rawOdd;decodedNonAsciiQaNames=@($qa | Where-Object {$_ -match '[^\x00-\x7f]'});criticalSource=$critical}
$report | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'PARITY-QUALIFICATION.json') -Encoding utf8NoBOM
$report | ConvertTo-Json -Depth 7
