// QA tooling, not product code: creates a Windows AF_UNIX socket file (a reparse point with tag
// IO_REPARSE_TAG_AF_UNIX) at the given path by binding a socket there, then exits. The socket
// file stays on disk after the process exits, like a Unix socket file. Compiled by
// c10-review-threads.mjs with Windows PowerShell's Add-Type into a disposable temp folder.
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class AfUnixSocketFile {
  [StructLayout(LayoutKind.Sequential)]
  struct WSAData { public short wVersion; public short wHighVersion; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 257)] public string szDescription; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 129)] public string szSystemStatus; public short iMaxSockets; public short iMaxUdpDg; public IntPtr lpVendorInfo; }
  [DllImport("ws2_32.dll")] static extern int WSAStartup(short version, out WSAData data);
  [DllImport("ws2_32.dll", SetLastError = true)] static extern IntPtr socket(int af, int type, int protocol);
  [DllImport("ws2_32.dll", SetLastError = true)] static extern int bind(IntPtr s, byte[] addr, int len);
  [DllImport("ws2_32.dll")] static extern int closesocket(IntPtr s);
  [DllImport("ws2_32.dll")] static extern int WSAGetLastError();

  public static int Main(string[] args) {
    WSAData data;
    if (WSAStartup(0x0202, out data) != 0) { Console.Error.WriteLine("WSAStartup failed"); return 2; }
    IntPtr s = socket(1, 1, 0);
    if (s == new IntPtr(-1)) { Console.Error.WriteLine("socket(AF_UNIX) failed: " + WSAGetLastError()); return 3; }
    byte[] addr = new byte[110];
    addr[0] = 1; // AF_UNIX, little-endian ushort
    byte[] path = Encoding.UTF8.GetBytes(args[0]);
    Array.Copy(path, 0, addr, 2, path.Length);
    if (bind(s, addr, addr.Length) != 0) { Console.Error.WriteLine("bind failed: " + WSAGetLastError()); return 4; }
    closesocket(s);
    Console.WriteLine("created " + args[0]);
    return 0;
  }
}
