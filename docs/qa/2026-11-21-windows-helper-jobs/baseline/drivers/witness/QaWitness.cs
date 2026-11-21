// GraphGoblin #459 independent QA: native process-handle witness (C# 5, .NET Framework 4.x).
//
// Opens exact process handles for owned fixture processes while they are alive (each fixture
// blocks in a private handshake until this witness has its handle), reports OS-recorded state,
// and terminates only an exact retained handle when the driver's watchdog asks. It never
// enumerates processes and never opens a PID it was not given by an owned handshake/spawn.
//
// Protocol: one command per stdin line "<seq> <op> [args...]", one JSON reply per stdout line.
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;

public static class QaWitness
{
    const uint Synchronize = 0x00100000, QueryLimited = 0x1000, TerminateRight = 0x0001;
    const uint WaitTimeout = 0x102;

    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr handle, out uint code);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateProcess(IntPtr handle, uint code);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetProcessTimes(IntPtr handle, out long creation, out long exit, out long kernel, out long user);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageNameW(IntPtr handle, int flags, StringBuilder name, ref int size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool result);
    [DllImport("kernel32.dll", SetLastError = true)] static extern int GetProcessId(IntPtr handle);

    [StructLayout(LayoutKind.Sequential)]
    struct BasicInformation { public IntPtr ExitStatus, Peb, Affinity, Priority, UniqueId, ParentId; }
    [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr handle, int infoClass, ref BasicInformation info, int size, out int returned);

    static readonly Dictionary<string, IntPtr> handles = new Dictionary<string, IntPtr>();
    static readonly JavaScriptSerializer json = new JavaScriptSerializer();

    static object UnixMs(long filetime)
    {
        if (filetime == 0) return null;
        return (filetime - 116444736000000000L) / 10000L;
    }

    static void Describe(IntPtr handle, Dictionary<string, object> reply)
    {
        uint wait = WaitForSingleObject(handle, 0);
        bool alive = wait == WaitTimeout;
        reply["alive"] = alive;
        uint code;
        reply["exitCode"] = (!alive && GetExitCodeProcess(handle, out code)) ? (object)code : null;
        long creation, exit, kernel, user;
        if (GetProcessTimes(handle, out creation, out exit, out kernel, out user))
        {
            reply["createdAtMs"] = UnixMs(creation);
            reply["exitedAtMs"] = alive ? null : UnixMs(exit);
        }
        reply["pid"] = GetProcessId(handle);
        var name = new StringBuilder(32768);
        int size = name.Capacity;
        reply["image"] = QueryFullProcessImageNameW(handle, 0, name, ref size) ? Path.GetFileName(name.ToString()) : null;
        bool inJob;
        reply["inAnyJob"] = IsProcessInJob(handle, IntPtr.Zero, out inJob) ? (object)inJob : null;
        var information = new BasicInformation();
        int returned;
        reply["parentPid"] = NtQueryInformationProcess(handle, 0, ref information, Marshal.SizeOf(typeof(BasicInformation)), out returned) == 0
            ? (object)information.ParentId.ToInt64() : null;
    }

    static IntPtr Find(string tag)
    {
        IntPtr handle;
        if (!handles.TryGetValue(tag, out handle)) throw new KeyNotFoundException("unknown tag");
        return handle;
    }

    public static int Main()
    {
        var output = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
        output.AutoFlush = true;
        string line;
        while ((line = Console.In.ReadLine()) != null)
        {
            string[] parts = line.Trim().Split(' ');
            var reply = new Dictionary<string, object>();
            reply["seq"] = parts.Length > 0 ? parts[0] : "";
            try
            {
                string op = parts.Length > 1 ? parts[1] : "";
                reply["op"] = op;
                if (op == "open")
                {
                    string tag = parts[2];
                    int pid = int.Parse(parts[3]);
                    if (handles.ContainsKey(tag)) throw new InvalidOperationException("duplicate tag");
                    IntPtr handle = OpenProcess(Synchronize | QueryLimited | TerminateRight, false, pid);
                    if (handle == IntPtr.Zero)
                    {
                        reply["ok"] = false;
                        reply["win32"] = Marshal.GetLastWin32Error();
                    }
                    else
                    {
                        handles[tag] = handle;
                        reply["ok"] = true;
                        reply["tag"] = tag;
                        Describe(handle, reply);
                    }
                }
                else if (op == "state")
                {
                    reply["ok"] = true;
                    reply["tag"] = parts[2];
                    Describe(Find(parts[2]), reply);
                }
                else if (op == "terminate")
                {
                    // Driver watchdog only: an exact retained handle, never a PID lookup.
                    IntPtr handle = Find(parts[2]);
                    uint code = uint.Parse(parts[3]);
                    reply["tag"] = parts[2];
                    if (WaitForSingleObject(handle, 0) != WaitTimeout)
                    {
                        reply["ok"] = true;
                        reply["alreadyExited"] = true;
                    }
                    else
                    {
                        bool terminated = TerminateProcess(handle, code);
                        reply["terminateCalled"] = terminated;
                        if (!terminated) reply["win32"] = Marshal.GetLastWin32Error();
                        reply["waitResult"] = WaitForSingleObject(handle, 5000);
                        reply["ok"] = terminated;
                        reply["alreadyExited"] = false;
                    }
                    Describe(handle, reply);
                }
                else if (op == "close")
                {
                    IntPtr handle = Find(parts[2]);
                    CloseHandle(handle);
                    handles.Remove(parts[2]);
                    reply["ok"] = true;
                }
                else if (op == "info")
                {
                    reply["ok"] = true;
                    reply["clr"] = Environment.Version.ToString();
                    reply["os"] = Environment.OSVersion.VersionString;
                    reply["is64BitProcess"] = Environment.Is64BitProcess;
                }
                else if (op == "now")
                {
                    reply["ok"] = true;
                    reply["nowMs"] = (DateTime.UtcNow.ToFileTimeUtc() - 116444736000000000L) / 10000L;
                }
                else throw new ArgumentException("unknown op");
            }
            catch (Exception error)
            {
                reply["ok"] = false;
                reply["error"] = error.GetType().Name;
            }
            output.WriteLine(json.Serialize(reply));
        }
        foreach (var handle in handles.Values) CloseHandle(handle);
        return 0;
    }
}
