# Read-only native process exit query: a PID can remain allocated to an exited process object.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class F1ProcessNative {
  [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GetExitCodeProcess(IntPtr handle, out uint code);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
}
'@
$f1Closure = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'process-closure.json') -Raw | ConvertFrom-Json
$f1States = @()
foreach ($f1Candidate in $f1Closure.alive) {
  $f1Handle = [F1ProcessNative]::OpenProcess(0x1000, $false, [uint32]$f1Candidate.pid)
  if ($f1Handle -eq [IntPtr]::Zero) {
    $f1States += [pscustomobject]@{ pid=$f1Candidate.pid; opened=$false; error=[Runtime.InteropServices.Marshal]::GetLastWin32Error() }
    continue
  }
  try {
    [uint32]$f1Code = 0
    $f1Queried = [F1ProcessNative]::GetExitCodeProcess($f1Handle, [ref]$f1Code)
    $f1States += [pscustomobject]@{ pid=$f1Candidate.pid; opened=$true; queried=$f1Queried; exitCode=$f1Code; running=($f1Queried -and $f1Code -eq 259) }
  } finally {
    [void][F1ProcessNative]::CloseHandle($f1Handle)
  }
}
ConvertTo-Json -InputObject $f1States -Depth 3 -Compress
