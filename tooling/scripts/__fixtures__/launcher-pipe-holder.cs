// Fixture runtime for the launcher CLI. It answers the read-only helper protocol and leaves a
// descendant that inherits the helper's stdout and stderr handles only.
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

static class LauncherPipeHolder
{
    const uint HandleFlagInherit = 1;
    const int StartfUseStdHandles = 0x100;
    const uint CreateNoWindow = 0x08000000;
    const uint ExtendedStartupInfoPresent = 0x00080000;
    const int ProcThreadAttributeHandleList = 0x00020002;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct StartupInfo
    {
        public int size;
        public string reserved, desktop, title;
        public int x, y, width, height, columns, rows, fill, flags;
        public short show, reservedSize;
        public IntPtr reservedPointer, input, output, error;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct StartupInfoEx
    {
        public StartupInfo startup;
        public IntPtr attributes;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct ProcessInformation
    {
        public IntPtr process, thread;
        public int pid, tid;
    }

    [DllImport("kernel32", SetLastError = true)]
    static extern IntPtr GetStdHandle(int number);

    [DllImport("kernel32", SetLastError = true)]
    static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);

    [DllImport("kernel32")]
    static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32", SetLastError = true)]
    static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);

    [DllImport("kernel32", SetLastError = true)]
    static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr key, IntPtr value,
        IntPtr size, IntPtr previous, IntPtr returned);

    [DllImport("kernel32")]
    static extern void DeleteProcThreadAttributeList(IntPtr list);

    [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool CreateProcess(string app, StringBuilder command, IntPtr processAttributes,
        IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string directory,
        ref StartupInfoEx startup, out ProcessInformation process);

    static void Main(string[] args)
    {
        string marker = Environment.GetEnvironmentVariable("GG_QA_PIPE_MARKER");
        if (args.Length == 1 && args[0] == "--hold")
        {
            File.AppendAllText(marker, "opened " + Process.GetCurrentProcess().Id + "\n");
            Thread.Sleep(int.Parse(Environment.GetEnvironmentVariable("GG_QA_PIPE_HOLD_MS")));
            File.AppendAllText(marker, "closed\n");
            return;
        }

        // The launcher runs "<checkout>\apps\api\dist\instance-identity.js" <mode>.
        StartDescendant();
        byte[] response = Encoding.ASCII.GetBytes(Response(args.Length > 1 ? args[1] : ""));
        using (Stream stdout = Console.OpenStandardOutput())
            stdout.Write(response, 0, response.Length);
    }

    /// <summary>A valid response for the requested mode; the dataDir is the launcher's own input.</summary>
    static string Response(string mode)
    {
        if (mode == "--store-state") return "{\"state\":\"free\"}\n";
        return "{\"version\":\"1\",\"launch\":\"v1:" + new string('c', 64) + "\",\"instance\":\"" +
            new string('a', 64) + "\",\"dataDir\":" + AsciiJson(Environment.GetEnvironmentVariable("GG_DATA_DIR")) +
            ",\"database\":\"non-file\"}\n";
    }

    /// <summary>An ASCII JSON string: quotes, backslashes and every non-printable unit escaped.</summary>
    static string AsciiJson(string value)
    {
        var result = new StringBuilder("\"");
        foreach (char ch in value)
        {
            if (ch == '"' || ch == '\\') result.Append('\\').Append(ch);
            else if (ch < 0x20 || ch > 0x7e) result.Append("\\u").Append(((int)ch).ToString("x4"));
            else result.Append(ch);
        }
        return result.Append('"').ToString();
    }

    static void StartDescendant()
    {
        string executable = Assembly.GetExecutingAssembly().Location;
        IntPtr stdout = GetStdHandle(-11), stderr = GetStdHandle(-12);
        if (!SetHandleInformation(stdout, HandleFlagInherit, HandleFlagInherit) ||
            !SetHandleInformation(stderr, HandleFlagInherit, HandleFlagInherit))
            throw new Win32Exception();

        IntPtr size = IntPtr.Zero;
        InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
        IntPtr attributes = Marshal.AllocHGlobal(size);
        IntPtr handles = Marshal.AllocHGlobal(IntPtr.Size * 2);
        bool initialized = false;
        try
        {
            if (!InitializeProcThreadAttributeList(attributes, 1, 0, ref size))
                throw new Win32Exception();
            initialized = true;
            Marshal.WriteIntPtr(handles, stdout);
            Marshal.WriteIntPtr(handles, IntPtr.Size, stderr);
            if (!UpdateProcThreadAttribute(attributes, 0, new IntPtr(ProcThreadAttributeHandleList),
                handles, new IntPtr(IntPtr.Size * 2), IntPtr.Zero, IntPtr.Zero))
                throw new Win32Exception();

            var info = new StartupInfoEx {
                startup = new StartupInfo {
                    size = Marshal.SizeOf(typeof(StartupInfoEx)),
                    flags = StartfUseStdHandles,
                    output = stdout,
                    error = stderr
                },
                attributes = attributes
            };
            ProcessInformation child;
            if (!CreateProcess(executable, new StringBuilder("\"" + executable + "\" --hold"),
                IntPtr.Zero, IntPtr.Zero, true, CreateNoWindow | ExtendedStartupInfoPresent,
                IntPtr.Zero, null, ref info, out child))
                throw new Win32Exception();
            CloseHandle(child.thread);
            CloseHandle(child.process);
        }
        finally
        {
            if (initialized) DeleteProcThreadAttributeList(attributes);
            Marshal.FreeHGlobal(handles);
            Marshal.FreeHGlobal(attributes);
        }
    }
}
