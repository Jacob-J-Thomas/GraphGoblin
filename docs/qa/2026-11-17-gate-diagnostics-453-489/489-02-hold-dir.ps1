$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class OwnedDirectoryHold {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern SafeFileHandle CreateFile(string name, uint desiredAccess,
    uint shareMode, IntPtr attrs, uint creation, uint flags, IntPtr template);
}
"@
$handle = [OwnedDirectoryHold]::CreateFile($env:GG_DIAG_489_OWNED_DIR, 0x80, 0x3, [IntPtr]::Zero, 3, 0x02000000, [IntPtr]::Zero)
if ($handle.IsInvalid) {
  $native = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
  throw "CreateFile failed with Win32 error $native"
}
try {
  [Console]::WriteLine("held:$PID")
  if ([Console]::ReadLine() -ne 'release') { throw 'Release handshake was missing' }
} finally {
  $handle.Dispose()
}
[Console]::WriteLine("released:$PID")
