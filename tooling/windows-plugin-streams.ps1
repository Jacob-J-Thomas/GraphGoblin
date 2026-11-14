$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = New-Object Text.UTF8Encoding($false, $true)
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false, $true)

# Windows PowerShell 5.1's Get-Item -Stream does not enumerate directory streams.
Microsoft.PowerShell.Utility\Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class GraphGoblinPluginStreams {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct StreamData {
        public long Size;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 296)]
        public string Name;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    private static extern uint GetFileAttributesW(string path);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    private static extern IntPtr FindFirstStreamW(string path, int level, out StreamData data, uint flags);
    [DllImport("kernel32.dll", ExactSpelling = true, SetLastError = true)]
    private static extern bool FindNextStreamW(IntPtr handle, out StreamData data);
    [DllImport("kernel32.dll", ExactSpelling = true)]
    private static extern bool FindClose(IntPtr handle);

    // Zero confirms a clean path, -1 identifies a foreign stream, and positive values are Win32 errors.
    public static int Check(string path, bool directory) {
        const int NoMoreStreams = 38;
        const int InvalidData = 13;
        const uint Directory = 0x10;
        const uint ReparsePoint = 0x400;
        uint attributes = GetFileAttributesW(path);
        if (attributes == UInt32.MaxValue) return LastError();
        if ((attributes & ReparsePoint) != 0 || ((attributes & Directory) != 0) != directory)
            return InvalidData;

        StreamData data;
        IntPtr handle = FindFirstStreamW(path, 0, out data, 0);
        if (handle == new IntPtr(-1)) {
            int error = LastError();
            return directory && error == NoMoreStreams ? 0 : error;
        }

        try {
            if (directory || data.Name != "::$DATA") return -1;
            if (FindNextStreamW(handle, out data)) return -1;
            int error = LastError();
            return error == NoMoreStreams ? 0 : error;
        } finally { FindClose(handle); }
    }

    private static int LastError() {
        int error = Marshal.GetLastWin32Error();
        return error > 0 ? error : 13;
    }
}
'@

for ($batch = 0; $batch -lt 2; $batch++) {
    $line = [Console]::ReadLine()
    if ($null -eq $line) { break }
    $entries = @(Microsoft.PowerShell.Utility\ConvertFrom-Json -InputObject $line)
    # Windows PowerShell emits a JSON array as one object. Unwrap it here.
    if ($entries.Count -eq 1 -and $entries[0] -is [Array]) { $entries = $entries[0] }
    $reply = 'ok'
    for ($index = 0; $index -lt $entries.Count; $index++) {
        $entry = $entries[$index]
        $result = [GraphGoblinPluginStreams]::Check($entry.path, $entry.directory)
        if ($result -ne 0) {
            $reply = if ($result -eq -1) { "foreign:$index" } else { "error:$($index):$result" }
            break
        }
    }
    [Console]::WriteLine($reply)
}
