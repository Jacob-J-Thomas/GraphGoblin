using System;
using System.ComponentModel;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;
using Microsoft.Win32.SafeHandles;

internal static class StdioFixtureHost
{
    private const uint GenericRead = 0x80000000;
    private const uint GenericWrite = 0x40000000;
    private const uint FileShareReadWrite = 3;
    private const uint OpenExisting = 3;
    private const uint NormalFile = 0x80;
    private const uint HandleInherit = 1;
    private const uint StartupUseStdHandles = 0x100;
    private const uint CreateNoWindow = 0x08000000;
    private const uint ExtendedStartupInfo = 0x00080000;
    private const int AttributeHandleList = 0x00020002;
    private const string Script = "setTimeout(() => {}, 30000)";

    [StructLayout(LayoutKind.Sequential)]
    private struct SecurityAttributes
    {
        public uint Length;
        public IntPtr SecurityDescriptor;
        [MarshalAs(UnmanagedType.Bool)] public bool Inherit;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct StartupInfo
    {
        public uint Size;
        public IntPtr Reserved, Desktop, Title;
        public uint X, Y, XSize, YSize, XCount, YCount, FillAttribute, Flags;
        public ushort ShowWindow, ReservedBytes;
        public IntPtr ReservedData, Stdin, Stdout, Stderr;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct StartupInfoEx
    {
        public StartupInfo Startup;
        public IntPtr Attributes;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInfo
    {
        public IntPtr Process, Thread;
        public uint Pid, Tid;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct FileTime
    {
        public uint Low, High;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    private static extern SafeFileHandle CreateFileW(string name, uint access, uint share,
        ref SecurityAttributes security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CreatePipe(out SafeFileHandle read, out SafeFileHandle write,
        ref SecurityAttributes security, uint capacity);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetHandleInformation(SafeFileHandle handle, uint mask, uint flags);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, uint flags, ref IntPtr bytes);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute,
        IntPtr value, UIntPtr bytes, IntPtr previous, IntPtr returned);
    [DllImport("kernel32.dll")]
    private static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    private static extern bool CreateProcessW(string application, StringBuilder commandLine, IntPtr processSecurity,
        IntPtr threadSecurity, bool inherit, uint flags, IntPtr environment, string cwd,
        ref StartupInfoEx startup, out ProcessInfo child);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetProcessTimes(SafeFileHandle process,
        out FileTime creation, out FileTime exit, out FileTime kernel, out FileTime user);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(SafeFileHandle process, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetExitCodeProcess(SafeFileHandle process, out uint code);

    private static void Win32(bool succeeded, string operation)
    {
        if (!succeeded) throw new Win32Exception(Marshal.GetLastWin32Error(), operation);
    }

    private static SafeFileHandle OpenNull(uint access, ref SecurityAttributes security)
    {
        SafeFileHandle handle = CreateFileW("NUL", access, FileShareReadWrite, ref security,
            OpenExisting, NormalFile, IntPtr.Zero);
        if (handle.IsInvalid)
        {
            int error = Marshal.GetLastWin32Error();
            handle.Dispose();
            throw new Win32Exception(error, "CreateFileW NUL");
        }
        return handle;
    }

    private static string Hex(uint value)
    {
        return "0x" + value.ToString("X8", CultureInfo.InvariantCulture);
    }

    private static ProcessInfo Spawn(string node, string command, string cwd, IntPtr input, IntPtr output,
        IntPtr error, IntPtr[] handles)
    {
        IntPtr bytes = IntPtr.Zero;
        bool sizeSucceeded = InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref bytes);
        if (sizeSucceeded || Marshal.GetLastWin32Error() != 122 || bytes.ToInt64() <= 0 || bytes.ToInt64() > 65536)
            throw new InvalidOperationException("Unexpected startup attribute list size");
        IntPtr list = Marshal.AllocHGlobal(bytes);
        IntPtr handleList = IntPtr.Zero;
        bool initialized = false;
        try
        {
            Win32(InitializeProcThreadAttributeList(list, 1, 0, ref bytes),
                "InitializeProcThreadAttributeList");
            initialized = true;
            int handleBytes = handles.Length * IntPtr.Size;
            handleList = Marshal.AllocHGlobal(handleBytes);
            for (int index = 0; index < handles.Length; index++)
                Marshal.WriteIntPtr(handleList, index * IntPtr.Size, handles[index]);
            Win32(UpdateProcThreadAttribute(list, 0, new IntPtr(AttributeHandleList), handleList,
                new UIntPtr((uint)handleBytes), IntPtr.Zero, IntPtr.Zero), "UpdateProcThreadAttribute handle list");
            var startup = new StartupInfoEx {
                Startup = new StartupInfo {
                    Size = (uint)Marshal.SizeOf(typeof(StartupInfoEx)),
                    Flags = StartupUseStdHandles, Stdin = input, Stdout = output, Stderr = error
                },
                Attributes = list
            };
            ProcessInfo child;
            Win32(CreateProcessW(node, new StringBuilder(command), IntPtr.Zero, IntPtr.Zero,
                true, CreateNoWindow | ExtendedStartupInfo, IntPtr.Zero, cwd, ref startup, out child),
                "CreateProcessW fixture Node");
            return child;
        }
        finally
        {
            if (initialized) DeleteProcThreadAttributeList(list);
            if (handleList != IntPtr.Zero) Marshal.FreeHGlobal(handleList);
            Marshal.FreeHGlobal(list);
        }
    }

    private static void Write(JavaScriptSerializer json, object value)
    {
        Console.WriteLine(json.Serialize(value));
        Console.Out.Flush();
    }

    private static int Run(string mapping, string node, JavaScriptSerializer json)
    {
        const string schema = "gg438-stdio-fixture/v1";
        var security = new SecurityAttributes {
            Length = (uint)Marshal.SizeOf(typeof(SecurityAttributes)), Inherit = true
        };
        string command = "\"" + node + "\" -e \"" + Script + "\"";
        string cwd = Directory.GetCurrentDirectory();
        bool wrongDirection = mapping == "wrong-direction";
        bool wrongDestination = mapping == "wrong-destination";
        SafeFileHandle pipeRead = null;
        SafeFileHandle pipeWrite = null;
        ProcessInfo child;
        try
        {
            using (SafeFileHandle input = OpenNull(GenericRead, ref security))
            using (SafeFileHandle output = OpenNull(GenericWrite, ref security))
            {
                if (wrongDestination)
                {
                    Win32(CreatePipe(out pipeRead, out pipeWrite, ref security, 0), "CreatePipe");
                    Win32(SetHandleInformation(pipeRead, HandleInherit, 0), "Clear fixture pipe reader inheritance");
                }

                IntPtr inputRaw = input.DangerousGetHandle();
                IntPtr outputRaw = output.DangerousGetHandle();
                IntPtr stdout = wrongDestination ? pipeWrite.DangerousGetHandle() :
                    wrongDirection ? inputRaw : outputRaw;
                IntPtr[] list = wrongDestination ? new[] { inputRaw, outputRaw, stdout } :
                    new[] { inputRaw, outputRaw };
                child = Spawn(node, command, cwd, inputRaw, stdout, outputRaw, list);
            }
        }
        catch
        {
            if (pipeRead != null) pipeRead.Dispose();
            throw;
        }
        finally { if (pipeWrite != null) pipeWrite.Dispose(); }

        using (pipeRead)
        using (var process = new SafeFileHandle(child.Process, true))
        {
            uint exitCode;
            try
            {
                using (var thread = new SafeFileHandle(child.Thread, true)) { }
                FileTime creation, exit, kernel, user;
                Win32(GetProcessTimes(process, out creation, out exit, out kernel, out user), "GetProcessTimes");
                ulong birth = ((ulong)creation.High << 32) | creation.Low;
                Write(json, new {
                    schema = schema, outcome = "spawned", mapping = mapping, pid = child.Pid,
                    birthFileTime = birth.ToString(CultureInfo.InvariantCulture), executable = node,
                    arguments = new[] { "-e", Script }, commandLine = command, cwd = cwd,
                    startupFlags = Hex(StartupUseStdHandles), creationFlags = Hex(CreateNoWindow | ExtendedStartupInfo),
                    inheritHandles = true, handleListAttribute = Hex(AttributeHandleList),
                    inheritedHandleRoles = wrongDestination ?
                        new[] { "nul-read", "nul-write", "pipe-write" } : new[] { "nul-read", "nul-write" },
                    nul = new { name = "NUL", shareMode = Hex(FileShareReadWrite), disposition = Hex(OpenExisting),
                        flags = Hex(NormalFile), readAccess = Hex(GenericRead), writeAccess = Hex(GenericWrite) },
                    slots = new[] { "nul-read", wrongDirection ? "nul-read" :
                        wrongDestination ? "pipe-write" : "nul-write", "nul-write" }
                });
            }
            finally
            {
                Win32(WaitForSingleObject(process, uint.MaxValue) == 0, "WaitForSingleObject fixture");
                Win32(GetExitCodeProcess(process, out exitCode), "GetExitCodeProcess fixture");
                Write(json, new { schema = schema, outcome = "natural-exit", mapping = mapping,
                    pid = child.Pid, exitCode = exitCode });
            }
            return exitCode == 0 ? 0 : 1;
        }
    }

    private static int Main(string[] args)
    {
        var json = new JavaScriptSerializer();
        try
        {
            if (args.Length != 2 || (args[0] != "positive" && args[0] != "wrong-direction" &&
                args[0] != "wrong-destination") || IntPtr.Size != 8)
                throw new ArgumentException("Usage: StdioFixtureHost.exe MAPPING ABSOLUTE_PROJECT_NODE");
            string expectedNode = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,
                "..", "..", "..", "..", ".claude", "codex-runs", "GraphGoblin", "runtime",
                "node-v22.23.4-win-x64", "node.exe"));
            if (!string.Equals(args[1], expectedNode, StringComparison.OrdinalIgnoreCase))
                throw new ArgumentException("Expected the project-scoped Node executable");
            return Run(args[0], expectedNode, json);
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(json.Serialize(new { schema = "gg438-stdio-fixture/v1",
                outcome = "incomplete", reason = error.Message }));
            return 2;
        }
    }
}

