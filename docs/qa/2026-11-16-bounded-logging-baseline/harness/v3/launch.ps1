#Requires -Version 7.0
param(
    [Parameter(Mandatory)][string]$Admission,
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$Sha256,
    [Parameter(Mandatory)][ValidatePattern('^(baseline|candidate)-attempt-[1-9][0-9]*$')][string]$ReceiptName
)

$ErrorActionPreference = 'Stop'
if (!$IsWindows) { throw 'Windows only' }
$batch = Split-Path -Parent $PSScriptRoot
$user = Split-Path -Parent (Split-Path -Parent $batch)
$projectNode = Join-Path $user '.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64/node.exe'
if (![IO.Path]::IsPathFullyQualified($Admission)) { throw 'Admission must be absolute' }
$Admission = [IO.Path]::GetFullPath($Admission)
if (!$Admission.StartsWith($batch + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Admission must be inside the QA batch'
}
if ((Get-FileHash -LiteralPath $Admission -Algorithm SHA256).Hash.ToLowerInvariant() -cne $Sha256) {
    throw 'Admission digest changed'
}
$admitted = Get-Content -LiteralPath $Admission -Raw | ConvertFrom-Json
if ($admitted.schema -cne 'gg438-native-admission/v1' -or $admitted.attempt -cne $ReceiptName) {
    throw 'Wrong execution admission'
}
$receipts = Join-Path $PSScriptRoot 'receipts'
[IO.Directory]::CreateDirectory($receipts) | Out-Null
if (([IO.File]::GetAttributes($receipts) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Unsafe receipt root' }
$output = Join-Path $receipts $ReceiptName
New-Item -ItemType Directory -Path $output | Out-Null

function Save-Receipt($Name, $Data) {
    $file = [IO.File]::Open((Join-Path $output $Name), [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
    try {
        $bytes = [Text.UTF8Encoding]::new($false).GetBytes(($Data | ConvertTo-Json -Depth 12) + "`n")
        $file.Write($bytes)
    } finally { $file.Dispose() }
}

$runner = Join-Path $PSScriptRoot 'run.mjs'
$info = [Diagnostics.ProcessStartInfo]::new($projectNode)
$info.WorkingDirectory = $PSScriptRoot
$info.UseShellExecute = $false
$info.CreateNoWindow = $true
$info.RedirectStandardOutput = $true
$info.RedirectStandardError = $true
$info.Environment.Remove('NODE_OPTIONS') | Out-Null
foreach ($arg in @($runner, $Admission, $Sha256)) { $info.ArgumentList.Add($arg) }
$stdout = [IO.File]::Open((Join-Path $output 'stdout.raw'), [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
$stderr = [IO.File]::Open((Join-Path $output 'stderr.raw'), [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
$child = $null
try {
    Save-Receipt 'requested.json' @{ executable = $projectNode; arguments = $info.ArgumentList; at = [DateTime]::UtcNow.ToString('o') }
    $child = [Diagnostics.Process]::Start($info)
    $outCopy = $child.StandardOutput.BaseStream.CopyToAsync($stdout)
    $errCopy = $child.StandardError.BaseStream.CopyToAsync($stderr)
    $created = try { $child.StartTime.ToUniversalTime().ToString('o') } catch { $null }
    Save-Receipt 'launch.json' @{ pid = $child.Id; creationUtc = $created; attempt = $ReceiptName }
    $deadline = [DateTime]::UtcNow.AddMinutes(25)
    do { $finished = $child.WaitForExit(10000) } until ($finished -or [DateTime]::UtcNow -ge $deadline)
    if (!$finished) {
        Save-Receipt 'timeout.json' @{ pid = $child.Id; creationUtc = $created; at = [DateTime]::UtcNow.ToString('o') }
        throw 'Runner disposition requires exact owned process readback'
    }
    $code = $child.ExitCode
    Save-Receipt 'exit.json' @{ pid = $child.Id; exitCode = $code; at = [DateTime]::UtcNow.ToString('o') }
    if (![Threading.Tasks.Task]::WaitAll([Threading.Tasks.Task[]]@($outCopy, $errCopy), 5000)) { throw 'Runner stream close ambiguous' }
    Save-Receipt 'capture.json' @{ stdoutBytes = $stdout.Length; stderrBytes = $stderr.Length }
} finally {
    $stdout.Dispose()
    $stderr.Dispose()
    if ($null -ne $child) { $child.Dispose() }
}
exit $code
