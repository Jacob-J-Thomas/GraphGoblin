// GraphGoblin #459 independent QA: native process-handle witness (C# 5, .NET Framework 4.x).
//
// Opens exact process handles for owned fixture processes while they are alive (each fixture
// blocks in a private handshake until this witness has its handle), reports OS-recorded state,
// and terminates only an exact retained handle when the driver's watchdog asks. It never
// enumerates processes and never opens a PID it was not given by an owned handshake/spawn.
//
// Extension (qa459 ext, candidate native acceptance): disposable harness jobs it creates itself
// (job, jobspawn, jobquery, injob, jobclose, stdio). A harness job's process-ID list only covers
// processes inside that disposable job. `--nest-probe <file>` runs this executable as an in-job
// probe that reports its own job's effective UI restrictions and whether nesting works.
//
// Protocol: one command per stdin line "<seq> <op> [args...]", one JSON reply per stdout line.
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using Microsoft.Win32.SafeHandles;

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

    // ---- extension: disposable harness jobs and in-job creation
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr CreateJobObjectW(IntPtr security, string name);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int kind, IntPtr info, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool QueryInformationJobObject(IntPtr job, int kind, IntPtr info, uint size, out uint returned);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool CreatePipe(out IntPtr read, out IntPtr write, ref SecurityAttributes security, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr CreateFileW(string name, uint access, uint share, ref SecurityAttributes security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
    [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool CreateProcessW(string app, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string directory, ref StartupInfoEx startup, out ProcessInformation information);

    [StructLayout(LayoutKind.Sequential)] struct SecurityAttributes { public int size; public IntPtr descriptor; public int inherit; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct StartupInfo {
        public int cb; public string reserved, desktop, title; public int x, y, xSize, ySize, xCount, yCount, fill, flags;
        public short show, reservedBytes; public IntPtr reservedPointer, input, output, error;
    }
    [StructLayout(LayoutKind.Sequential)] struct StartupInfoEx { public StartupInfo startup; public IntPtr attributes; }
    [StructLayout(LayoutKind.Sequential)] struct ProcessInformation { public IntPtr process, thread; public int pid, tid; }

    [StructLayout(LayoutKind.Sequential)]
    struct BasicInformation { public IntPtr ExitStatus, Peb, Affinity, Priority, UniqueId, ParentId; }
    [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr handle, int infoClass, ref BasicInformation info, int size, out int returned);

    const int JobBasicAccounting = 1, JobBasicProcessIdList = 3, JobBasicUiRestrictions = 4, JobExtendedLimits = 9;
    const int ExtendedLimitsSize = 144, LimitFlagsOffset = 16, ActiveProcessLimitOffset = 40; // x64 JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    const uint CreateSuspended = 0x4, UnicodeEnvironment = 0x400, ExtendedStartup = 0x80000, NoWindow = 0x08000000;
    const int UseStdHandles = 0x100;
    const uint NeverRanCode = 0xA45E; // a suspended probe or refused assignment that never resumed
    static readonly IntPtr HandleListAttribute = new IntPtr(0x20002), JobListAttribute = new IntPtr(0x2000D);

    static readonly Dictionary<string, IntPtr> handles = new Dictionary<string, IntPtr>();
    static readonly Dictionary<string, IntPtr> jobs = new Dictionary<string, IntPtr>();
    static readonly Dictionary<string, StdioCapture> captures = new Dictionary<string, StdioCapture>();
    static readonly JavaScriptSerializer json = new JavaScriptSerializer();

    static object UnixMs(long filetime)
    {
        if (filetime == 0) return null;
        return (filetime - 116444736000000000L) / 10000L;
    }
    static long NowMs() { return (DateTime.UtcNow.ToFileTimeUtc() - 116444736000000000L) / 10000L; }

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
    static IntPtr FindJob(string tag)
    {
        IntPtr job;
        if (!jobs.TryGetValue(tag, out job)) throw new KeyNotFoundException("unknown job");
        return job;
    }

    /// <summary>Drains one captured pipe into a private file and records the EOF time.</summary>
    sealed class StdioCapture
    {
        public long Bytes; public object EofAtMs; public string Error;
        public StdioCapture(IntPtr read, string path)
        {
            var handle = new SafeFileHandle(read, true);
            var thread = new Thread(() => {
                try {
                    using (var input = new FileStream(handle, FileAccess.Read, 4096, false))
                    using (var output = new FileStream(path, FileMode.CreateNew, FileAccess.Write))
                    {
                        var buffer = new byte[8192];
                        int count;
                        while ((count = input.Read(buffer, 0, buffer.Length)) > 0) { output.Write(buffer, 0, count); output.Flush(); Interlocked.Add(ref Bytes, count); }
                    }
                } catch (IOException error) { Error = error.GetType().Name; }
                EofAtMs = NowMs();
            });
            thread.IsBackground = true;
            thread.Start();
        }
    }

    static Dictionary<string, object> JobLimits(IntPtr job)
    {
        var result = new Dictionary<string, object>();
        IntPtr buffer = Marshal.AllocHGlobal(ExtendedLimitsSize);
        try {
            for (int i = 0; i < ExtendedLimitsSize; i++) Marshal.WriteByte(buffer, i, 0);
            uint returned;
            bool limits = QueryInformationJobObject(job, JobExtendedLimits, buffer, ExtendedLimitsSize, out returned);
            result["limitFlags"] = limits ? (object)(uint)Marshal.ReadInt32(buffer, LimitFlagsOffset) : null;
            result["activeProcessLimit"] = limits ? (object)Marshal.ReadInt32(buffer, ActiveProcessLimitOffset) : null;
            Marshal.WriteInt32(buffer, 0, 0);
            result["uiRestrictions"] = QueryInformationJobObject(job, JobBasicUiRestrictions, buffer, 4, out returned) ? (object)(uint)Marshal.ReadInt32(buffer, 0) : null;
        } finally { Marshal.FreeHGlobal(buffer); }
        return result;
    }

    static Dictionary<string, object> JobAccounting(IntPtr job)
    {
        var result = new Dictionary<string, object>();
        result["atMs"] = NowMs();
        IntPtr buffer = Marshal.AllocHGlobal(48);
        try {
            uint returned;
            if (QueryInformationJobObject(job, JobBasicAccounting, buffer, 48, out returned))
            {
                result["totalProcesses"] = (uint)Marshal.ReadInt32(buffer, 36);
                result["activeProcesses"] = (uint)Marshal.ReadInt32(buffer, 40);
                result["totalTerminatedProcesses"] = (uint)Marshal.ReadInt32(buffer, 44);
            }
            else result["accountingError"] = Marshal.GetLastWin32Error();
        } finally { Marshal.FreeHGlobal(buffer); }
        const int listCapacity = 128;
        IntPtr list = Marshal.AllocHGlobal(8 + 8 * listCapacity);
        try {
            uint returned;
            if (QueryInformationJobObject(job, JobBasicProcessIdList, list, (uint)(8 + 8 * listCapacity), out returned))
            {
                int listed = Marshal.ReadInt32(list, 4);
                var pids = new List<long>();
                for (int i = 0; i < listed; i++) pids.Add(Marshal.ReadInt64(list, 8 + 8 * i));
                result["assignedProcesses"] = Marshal.ReadInt32(list, 0);
                result["activePids"] = pids;
            }
            else result["pidListError"] = Marshal.GetLastWin32Error();
        } finally { Marshal.FreeHGlobal(list); }
        return result;
    }

    static IntPtr NewJob(uint limitFlags, uint uiFlags, int activeLimit = 0)
    {
        IntPtr job = CreateJobObjectW(IntPtr.Zero, null);
        if (job == IntPtr.Zero) throw new InvalidOperationException("CreateJobObject " + Marshal.GetLastWin32Error());
        if (limitFlags != 0)
        {
            IntPtr buffer = Marshal.AllocHGlobal(ExtendedLimitsSize);
            try {
                for (int i = 0; i < ExtendedLimitsSize; i++) Marshal.WriteByte(buffer, i, 0);
                Marshal.WriteInt32(buffer, LimitFlagsOffset, unchecked((int)limitFlags));
                Marshal.WriteInt32(buffer, ActiveProcessLimitOffset, activeLimit);
                if (!SetInformationJobObject(job, JobExtendedLimits, buffer, ExtendedLimitsSize)) throw new InvalidOperationException("limits " + Marshal.GetLastWin32Error());
            } finally { Marshal.FreeHGlobal(buffer); }
        }
        if (uiFlags != 0)
        {
            IntPtr buffer = Marshal.AllocHGlobal(4);
            try {
                Marshal.WriteInt32(buffer, 0, unchecked((int)uiFlags));
                if (!SetInformationJobObject(job, JobBasicUiRestrictions, buffer, 4)) throw new InvalidOperationException("ui " + Marshal.GetLastWin32Error());
            } finally { Marshal.FreeHGlobal(buffer); }
        }
        return job;
    }

    static string Quote(string value) { return "\"" + value + "\""; }

    /// <summary>
    /// Creates a process suspended with exactly NUL stdin and two private capture pipes as its
    /// only inherited handles, assigns it to the harness job, then resumes it.
    /// </summary>
    static void JobSpawn(string tag, string jobTag, string encoded, Dictionary<string, object> reply)
    {
        if (handles.ContainsKey(tag)) throw new InvalidOperationException("duplicate tag");
        var spec = json.Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(Convert.FromBase64String(encoded)));
        string app = (string)spec["app"];
        var command = new StringBuilder(Quote(app));
        foreach (object item in (System.Collections.ArrayList)spec["args"]) command.Append(' ').Append(Quote((string)item));
        var environment = (Dictionary<string, object>)spec["env"];
        var keys = new List<string>(environment.Keys);
        keys.Sort(StringComparer.OrdinalIgnoreCase);
        var block = new StringBuilder();
        foreach (string key in keys) block.Append(key).Append('=').Append((string)environment[key]).Append('\0');
        block.Append('\0');
        IntPtr job = jobTag == "-" ? IntPtr.Zero : FindJob(jobTag);

        var inherit = new SecurityAttributes { size = Marshal.SizeOf(typeof(SecurityAttributes)), inherit = 1 };
        IntPtr input = CreateFileW("NUL", 0x80000000, 3, ref inherit, 3, 0, IntPtr.Zero);
        if (input == new IntPtr(-1)) throw new InvalidOperationException("NUL " + Marshal.GetLastWin32Error());
        IntPtr outRead, outWrite, errRead, errWrite;
        if (!CreatePipe(out outRead, out outWrite, ref inherit, 0)) throw new InvalidOperationException("CreatePipe " + Marshal.GetLastWin32Error());
        if (!CreatePipe(out errRead, out errWrite, ref inherit, 0)) throw new InvalidOperationException("CreatePipe " + Marshal.GetLastWin32Error());
        SetHandleInformation(outRead, 1, 0);
        SetHandleInformation(errRead, 1, 0);
        IntPtr size = IntPtr.Zero, list = IntPtr.Zero, values = IntPtr.Zero, env = IntPtr.Zero;
        var created = new ProcessInformation();
        bool ok = false, listReady = false;
        int createError = 0;
        try {
            InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
            list = Marshal.AllocHGlobal(size);
            if (!InitializeProcThreadAttributeList(list, 1, 0, ref size)) throw new InvalidOperationException("attributes " + Marshal.GetLastWin32Error());
            listReady = true;
            values = Marshal.AllocHGlobal(IntPtr.Size * 3);
            Marshal.WriteIntPtr(values, 0, input);
            Marshal.WriteIntPtr(values, IntPtr.Size, outWrite);
            Marshal.WriteIntPtr(values, IntPtr.Size * 2, errWrite);
            if (!UpdateProcThreadAttribute(list, 0, HandleListAttribute, values, new IntPtr(IntPtr.Size * 3), IntPtr.Zero, IntPtr.Zero))
                throw new InvalidOperationException("handle list " + Marshal.GetLastWin32Error());
            env = Marshal.StringToHGlobalUni(block.ToString());
            var startup = new StartupInfoEx { attributes = list, startup = new StartupInfo {
                cb = Marshal.SizeOf(typeof(StartupInfoEx)), flags = UseStdHandles, input = input, output = outWrite, error = errWrite } };
            ok = CreateProcessW(app, command, IntPtr.Zero, IntPtr.Zero, true, CreateSuspended | UnicodeEnvironment | ExtendedStartup | NoWindow,
                env, (string)spec["cwd"], ref startup, out created);
            if (!ok) createError = Marshal.GetLastWin32Error();
        } finally {
            if (listReady) DeleteProcThreadAttributeList(list);
            if (list != IntPtr.Zero) Marshal.FreeHGlobal(list);
            if (values != IntPtr.Zero) Marshal.FreeHGlobal(values);
            if (env != IntPtr.Zero) Marshal.FreeHGlobal(env);
            CloseHandle(input); CloseHandle(outWrite); CloseHandle(errWrite);
        }
        if (!ok)
        {
            CloseHandle(outRead); CloseHandle(errRead);
            reply["ok"] = false; reply["createError"] = createError;
            return;
        }
        bool preAssignInAnyJob;
        reply["preAssignInAnyJob"] = IsProcessInJob(created.process, IntPtr.Zero, out preAssignInAnyJob) ? (object)preAssignInAnyJob : null;
        if (job != IntPtr.Zero)
        {
            bool assigned = AssignProcessToJobObject(job, created.process);
            reply["assigned"] = assigned;
            if (!assigned)
            {
                reply["assignError"] = Marshal.GetLastWin32Error();
                TerminateProcess(created.process, NeverRanCode);
                WaitForSingleObject(created.process, 5000);
                CloseHandle(created.thread); CloseHandle(created.process);
                CloseHandle(outRead); CloseHandle(errRead);
                reply["ok"] = false;
                return;
            }
            bool inHarness;
            reply["inHarnessJob"] = IsProcessInJob(created.process, job, out inHarness) ? (object)inHarness : null;
        }
        handles[tag] = created.process;
        captures[tag] = new StdioCapture(outRead, (string)spec["stdoutPath"]);
        captures[tag + "#err"] = new StdioCapture(errRead, (string)spec["stderrPath"]);
        reply["resumedAtMs"] = NowMs();
        reply["resume"] = ResumeThread(created.thread);
        CloseHandle(created.thread);
        reply["ok"] = true;
        reply["tag"] = tag;
        Describe(created.process, reply);
    }

    /// <summary>In-job probe: effective UI restrictions of its own job and actual nesting attempts.</summary>
    static int NestProbe(string output, uint innerUi)
    {
        var report = new Dictionary<string, object>();
        report["innerUiRestrictions"] = innerUi;
        bool inJob;
        IntPtr self = System.Diagnostics.Process.GetCurrentProcess().Handle;
        report["selfInAnyJob"] = IsProcessInJob(self, IntPtr.Zero, out inJob) ? (object)inJob : null;
        IntPtr ui = Marshal.AllocHGlobal(4);
        try {
            Marshal.WriteInt32(ui, 0, 0);
            uint returned;
            // A NULL job handle queries the job that contains the calling process.
            bool read = QueryInformationJobObject(IntPtr.Zero, JobBasicUiRestrictions, ui, 4, out returned);
            report["ownJobUiRestrictions"] = read ? (object)(uint)Marshal.ReadInt32(ui, 0) : null;
            if (!read) report["ownJobUiRestrictionsError"] = Marshal.GetLastWin32Error();
        } finally { Marshal.FreeHGlobal(ui); }
        string exe = System.Reflection.Assembly.GetExecutingAssembly().Location;
        // 1. The candidate's creation shape: one CreateProcess with PROC_THREAD_ATTRIBUTE_JOB_LIST.
        IntPtr nested = innerUi == 0 ? CreateJobObjectW(IntPtr.Zero, null) : NewJob(0, innerUi);
        report["nestedJobCreated"] = nested != IntPtr.Zero;
        IntPtr size = IntPtr.Zero;
        InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
        IntPtr list = Marshal.AllocHGlobal(size), value = Marshal.AllocHGlobal(IntPtr.Size);
        try {
            InitializeProcThreadAttributeList(list, 1, 0, ref size);
            Marshal.WriteIntPtr(value, nested);
            report["jobListAttributeSet"] = UpdateProcThreadAttribute(list, 0, JobListAttribute, value, new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero);
            var startup = new StartupInfoEx { attributes = list, startup = new StartupInfo { cb = Marshal.SizeOf(typeof(StartupInfoEx)) } };
            ProcessInformation created;
            bool ok = CreateProcessW(exe, new StringBuilder(Quote(exe) + " --noop"), IntPtr.Zero, IntPtr.Zero, false,
                CreateSuspended | ExtendedStartup | NoWindow, IntPtr.Zero, null, ref startup, out created);
            report["jobListCreateProcess"] = ok;
            if (!ok) report["jobListCreateProcessError"] = Marshal.GetLastWin32Error();
            else
            {
                bool member;
                report["jobListChildInNestedJob"] = IsProcessInJob(created.process, nested, out member) ? (object)member : null;
                TerminateProcess(created.process, NeverRanCode); WaitForSingleObject(created.process, 5000);
                CloseHandle(created.thread); CloseHandle(created.process);
            }
        } finally { DeleteProcThreadAttributeList(list); Marshal.FreeHGlobal(list); Marshal.FreeHGlobal(value); }
        // 2. Suspended creation followed by AssignProcessToJobObject into a fresh job.
        IntPtr second = CreateJobObjectW(IntPtr.Zero, null);
        var plain = new StartupInfoEx { startup = new StartupInfo { cb = Marshal.SizeOf(typeof(StartupInfoEx)) } };
        ProcessInformation suspended;
        if (CreateProcessW(exe, new StringBuilder(Quote(exe) + " --noop"), IntPtr.Zero, IntPtr.Zero, false, CreateSuspended | ExtendedStartup | NoWindow,
            IntPtr.Zero, null, ref plain, out suspended))
        {
            bool assigned = AssignProcessToJobObject(second, suspended.process);
            report["assignToFreshJob"] = assigned;
            if (!assigned) report["assignToFreshJobError"] = Marshal.GetLastWin32Error();
            TerminateProcess(suspended.process, NeverRanCode); WaitForSingleObject(suspended.process, 5000);
            CloseHandle(suspended.thread); CloseHandle(suspended.process);
        }
        else report["plainCreateProcessError"] = Marshal.GetLastWin32Error();
        if (nested != IntPtr.Zero) CloseHandle(nested);
        if (second != IntPtr.Zero) CloseHandle(second);
        File.WriteAllText(output, json.Serialize(report));
        return 0;
    }

    public static int Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "--noop") return 0;
        if (args.Length >= 2 && args[0] == "--nest-probe") return NestProbe(args[1], args.Length > 2 ? uint.Parse(args[2]) : 0);
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
                    // Driver watchdog or creator-death boundary: an exact retained handle, never a PID lookup.
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
                        reply["terminateAtMs"] = NowMs();
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
                    reply["nowMs"] = NowMs();
                }
                else if (op == "job")
                {
                    // job <jobTag> <limitFlags> <uiFlags>: a disposable harness job, read back after setting.
                    string tag = parts[2];
                    if (jobs.ContainsKey(tag)) throw new InvalidOperationException("duplicate job");
                    IntPtr job = NewJob(uint.Parse(parts[3]), uint.Parse(parts[4]), parts.Length > 5 ? int.Parse(parts[5]) : 0);
                    jobs[tag] = job;
                    reply["ok"] = true;
                    reply["job"] = tag;
                    reply["readBack"] = JobLimits(job);
                }
                else if (op == "joblimit")
                {
                    // joblimit <jobTag> <limitFlags> <activeLimit>: tighten an existing harness job, read back.
                    IntPtr job = FindJob(parts[2]);
                    IntPtr buffer = Marshal.AllocHGlobal(ExtendedLimitsSize);
                    try {
                        for (int i = 0; i < ExtendedLimitsSize; i++) Marshal.WriteByte(buffer, i, 0);
                        Marshal.WriteInt32(buffer, LimitFlagsOffset, unchecked((int)uint.Parse(parts[3])));
                        Marshal.WriteInt32(buffer, ActiveProcessLimitOffset, int.Parse(parts[4]));
                        reply["ok"] = SetInformationJobObject(job, JobExtendedLimits, buffer, ExtendedLimitsSize);
                        if (!(bool)reply["ok"]) reply["win32"] = Marshal.GetLastWin32Error();
                    } finally { Marshal.FreeHGlobal(buffer); }
                    reply["readBack"] = JobLimits(job);
                }
                else if (op == "jobspawn") JobSpawn(parts[2], parts[3], parts[4], reply);
                else if (op == "jobquery")
                {
                    reply["ok"] = true;
                    reply["job"] = parts[2];
                    reply["accounting"] = JobAccounting(FindJob(parts[2]));
                }
                else if (op == "injob")
                {
                    bool member;
                    reply["ok"] = IsProcessInJob(Find(parts[2]), FindJob(parts[3]), out member);
                    reply["inJob"] = member;
                }
                else if (op == "jobclose")
                {
                    IntPtr job = FindJob(parts[2]);
                    reply["closedAtMs"] = NowMs();
                    reply["ok"] = CloseHandle(job);
                    jobs.Remove(parts[2]);
                }
                else if (op == "stdio")
                {
                    StdioCapture captured;
                    bool found = captures.TryGetValue(parts[2], out captured);
                    if (found) { reply["stdoutBytes"] = Interlocked.Read(ref captured.Bytes); reply["stdoutEofAtMs"] = captured.EofAtMs; reply["stdoutError"] = captured.Error; }
                    if (captures.TryGetValue(parts[2] + "#err", out captured)) { reply["stderrBytes"] = Interlocked.Read(ref captured.Bytes); reply["stderrEofAtMs"] = captured.EofAtMs; reply["stderrError"] = captured.Error; }
                    else found = false;
                    reply["ok"] = found;
                }
                else throw new ArgumentException("unknown op");
            }
            catch (Exception error)
            {
                reply["ok"] = false;
                reply["error"] = error.GetType().Name;
                reply["message"] = error.Message;
            }
            output.WriteLine(json.Serialize(reply));
        }
        foreach (var handle in handles.Values) CloseHandle(handle);
        foreach (var job in jobs.Values) CloseHandle(job);
        return 0;
    }
}
