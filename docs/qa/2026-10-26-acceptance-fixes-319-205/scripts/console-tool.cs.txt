using System;
using System.Runtime.InteropServices;
using System.Threading;

// Windows console helper for the terminal Ctrl+C reproduction (#319 D-1).
//   host <cwd> <command line>  Own a console like a terminal window: re-enable Ctrl+C processing
//                              for the command, start it attached to this console with this
//                              process's standard handles, ignore Ctrl+C here, and exit with the
//                              command's exit code.
//   ctrlc <pid>                Deliver one real CTRL_C_EVENT to every process attached to the
//                              console of <pid>, as one keypress in that window would.
//   list <pid>                 Print the processes attached to the console of <pid>.
public static class ConsoleTool {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct STARTUPINFO {
    public int cb; public string lpReserved; public string lpDesktop; public string lpTitle;
    public int dwX; public int dwY; public int dwXSize; public int dwYSize;
    public int dwXCountChars; public int dwYCountChars; public int dwFillAttribute; public int dwFlags;
    public short wShowWindow; public short cbReserved2; public IntPtr lpReserved2;
    public IntPtr hStdInput; public IntPtr hStdOutput; public IntPtr hStdError;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct PROCESS_INFORMATION { public IntPtr hProcess; public IntPtr hThread; public int dwProcessId; public int dwThreadId; }

  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool CreateProcess(string app, string cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags,
    IntPtr env, string cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr GetStdHandle(int which);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetHandleInformation(IntPtr h, uint mask, uint flags);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetConsoleCtrlHandler(IntPtr handler, bool add);
  [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr h, uint ms);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr h, out uint code);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool FreeConsole();
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool AttachConsole(uint pid);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool GenerateConsoleCtrlEvent(uint ev, uint group);
  [DllImport("kernel32.dll", SetLastError = true)] static extern uint GetConsoleProcessList(uint[] list, uint count);

  public static int Main(string[] args) {
    if (args.Length == 3 && args[0] == "host") return Host(args[1], args[2]);
    if (args.Length == 2 && args[0] == "ctrlc") return CtrlC(uint.Parse(args[1]));
    if (args.Length == 2 && args[0] == "list") return List(uint.Parse(args[1]));
    Console.Error.WriteLine("usage: host <cwd> <command line> | ctrlc <pid> | list <pid>");
    return 2;
  }

  static int Host(string cwd, string command) {
    IntPtr input = GetStdHandle(-10), output = GetStdHandle(-11), error = GetStdHandle(-12);
    foreach (IntPtr h in new[] { input, output, error }) SetHandleInformation(h, 1, 1);
    // A terminal window processes Ctrl+C; the command inherits that state from this process.
    SetConsoleCtrlHandler(IntPtr.Zero, false);
    var si = new STARTUPINFO();
    si.cb = Marshal.SizeOf(typeof(STARTUPINFO));
    si.dwFlags = 0x100; // STARTF_USESTDHANDLES
    si.hStdInput = input; si.hStdOutput = output; si.hStdError = error;
    PROCESS_INFORMATION pi;
    // CREATE_UNICODE_ENVIRONMENT only: same console, same process group, Ctrl+C enabled.
    if (!CreateProcess(null, command, IntPtr.Zero, IntPtr.Zero, true, 0x400, IntPtr.Zero, cwd, ref si, out pi)) {
      Console.Error.WriteLine("CreateProcess failed " + Marshal.GetLastWin32Error());
      return 3;
    }
    // The host stands in for the terminal, not for the command: it ignores the keypress itself.
    SetConsoleCtrlHandler(IntPtr.Zero, true);
    Console.Error.WriteLine("console-host child " + pi.dwProcessId);
    WaitForSingleObject(pi.hProcess, 0xFFFFFFFF);
    uint code;
    GetExitCodeProcess(pi.hProcess, out code);
    return (int)code;
  }

  static int CtrlC(uint pid) {
    FreeConsole();
    if (!AttachConsole(pid)) { Console.Error.WriteLine("AttachConsole failed " + Marshal.GetLastWin32Error()); return 4; }
    SetConsoleCtrlHandler(IntPtr.Zero, true);
    if (!GenerateConsoleCtrlEvent(0, 0)) { Console.Error.WriteLine("GenerateConsoleCtrlEvent failed " + Marshal.GetLastWin32Error()); return 5; }
    Thread.Sleep(300);
    FreeConsole();
    return 0;
  }

  static int List(uint pid) {
    FreeConsole();
    if (!AttachConsole(pid)) return 4;
    var list = new uint[256];
    uint n = GetConsoleProcessList(list, 256);
    var parts = new System.Collections.Generic.List<string>();
    for (int i = 0; i < n && i < 256; i++) parts.Add(list[i].ToString());
    FreeConsole();
    // The console is gone after FreeConsole; write the answer where the caller can read it.
    System.IO.File.WriteAllText(Environment.GetEnvironmentVariable("CONSOLE_TOOL_OUT"), string.Join(",", parts.ToArray()));
    return 0;
  }
}
