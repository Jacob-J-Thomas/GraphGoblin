using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

namespace GraphGoblin.Qa436
{
    public sealed class ProcessTrace
    {
        private const uint ProcessEvents = 0x00000001;
        private const uint SequentialFile = 0x00000001;
        private const uint SystemLogger = 0x02000000;
        private const uint TracedGuid = 0x00020000;
        private const int StringBytes = 2 * 1025;
        private const uint QueryCode = 0;
        private const uint StopCode = 1;
        private readonly ulong handle;
        private bool stopAttempted;

        [StructLayout(LayoutKind.Sequential)]
        private struct WnodeHeader
        {
            public uint BufferSize, ProviderId;
            public ulong HistoricalContext;
            public long TimeStamp;
            public Guid Guid;
            public uint ClientContext, Flags;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct TraceProperties
        {
            public WnodeHeader Header;
            public uint BufferSize, MinimumBuffers, MaximumBuffers, MaximumFileSize, LogFileMode, FlushTimer, EnableFlags;
            public int AgeLimit;
            public uint NumberOfBuffers, FreeBuffers, EventsLost, BuffersWritten, LogBuffersLost, RealTimeBuffersLost;
            public IntPtr LoggerThreadId;
            public uint LogFileNameOffset, LoggerNameOffset;
        }

        [DllImport("advapi32.dll", EntryPoint = "StartTraceW", CharSet = CharSet.Unicode, ExactSpelling = true)]
        private static extern uint StartTrace(out ulong traceId, string name, IntPtr properties);

        [DllImport("advapi32.dll", EntryPoint = "ControlTraceW", CharSet = CharSet.Unicode, ExactSpelling = true)]
        private static extern uint ControlTrace(ulong traceId, string name, IntPtr properties, uint controlCode);

        [DllImport("shell32.dll", EntryPoint = "CommandLineToArgvW", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
        private static extern IntPtr CommandLineToArgv(string input, out int count);

        [DllImport("kernel32.dll", ExactSpelling = true)]
        private static extern IntPtr LocalFree(IntPtr memory);

        public sealed class Disposition
        {
            public uint Status, EventsLost, BuffersWritten, LogBuffersLost, RealTimeBuffersLost, Mode, EnabledFlags;
            public string Name, File;
            public string SessionGuid;
        }

        private ProcessTrace(ulong identity) { handle = identity; }

        private static IntPtr Allocate(string path)
        {
            int size = Marshal.SizeOf(typeof(TraceProperties));
            if (IntPtr.Size != 8 || size != 120)
                throw new InvalidOperationException("Unexpected x64 ETW structure layout.");
            if (path != null && path.Length >= StringBytes / 2 - 1)
                throw new ArgumentException("The trace path exceeds the owned ETW string buffer.");
            int total = size + 2 * StringBytes;
            IntPtr buffer = Marshal.AllocHGlobal(total);
            try
            {
                Marshal.Copy(new byte[total], 0, buffer, total);
                TraceProperties properties = new TraceProperties();
                properties.Header.BufferSize = (uint)total;
                properties.Header.ClientContext = 1; // QPC timestamps.
                properties.Header.Flags = TracedGuid;
                properties.LoggerNameOffset = (uint)size;
                properties.LogFileNameOffset = (uint)(size + StringBytes);
                if (path != null)
                {
                    properties.BufferSize = 64;
                    properties.MinimumBuffers = 16;
                    properties.MaximumBuffers = 64;
                    properties.MaximumFileSize = 32; // MB; sequential trace stops at its cap.
                    properties.LogFileMode = SequentialFile | SystemLogger;
                    properties.FlushTimer = 1;
                    properties.EnableFlags = ProcessEvents;
                    char[] text = (path + "\0").ToCharArray();
                    Marshal.Copy(text, 0, IntPtr.Add(buffer, (int)properties.LogFileNameOffset), text.Length);
                }
                Marshal.StructureToPtr(properties, buffer, false);
                return buffer;
            }
            catch
            {
                Marshal.FreeHGlobal(buffer);
                throw;
            }
        }

        public static ProcessTrace Start(string name, string file)
        {
            IntPtr buffer = Allocate(file);
            try
            {
                ulong identity;
                uint result = StartTrace(out identity, name, buffer);
                if (result != 0) throw new Win32Exception((int)result, "StartTraceW failed for the requested QA system logger.");
                if (identity == 0) throw new InvalidOperationException("StartTraceW returned an empty handle.");
                return new ProcessTrace(identity);
            }
            finally { Marshal.FreeHGlobal(buffer); }
        }

        private static string ReadTraceString(IntPtr buffer, uint offset)
        {
            if (offset == 0) return String.Empty;
            int first = Marshal.SizeOf(typeof(TraceProperties));
            if (offset != (uint)first && offset != (uint)(first + StringBytes))
                throw new InvalidOperationException("Unexpected ETW string offset.");
            return Marshal.PtrToStringUni(IntPtr.Add(buffer, (int)offset));
        }

        private Disposition Control(uint code)
        {
            IntPtr buffer = Allocate(null);
            try
            {
                uint result = ControlTrace(handle, null, buffer, code);
                Disposition disposition = new Disposition();
                disposition.Status = result;
                if (result == 0)
                {
                    TraceProperties value = (TraceProperties)Marshal.PtrToStructure(buffer, typeof(TraceProperties));
                    disposition.EventsLost = value.EventsLost;
                    disposition.BuffersWritten = value.BuffersWritten;
                    disposition.LogBuffersLost = value.LogBuffersLost;
                    disposition.RealTimeBuffersLost = value.RealTimeBuffersLost;
                    disposition.Mode = value.LogFileMode;
                    disposition.EnabledFlags = value.EnableFlags;
                    disposition.SessionGuid = value.Header.Guid.ToString();
                    disposition.Name = ReadTraceString(buffer, value.LoggerNameOffset);
                    disposition.File = ReadTraceString(buffer, value.LogFileNameOffset);
                }
                return disposition;
            }
            finally { Marshal.FreeHGlobal(buffer); }
        }

        public Disposition Query() { return Control(QueryCode); }

        public Disposition Stop()
        {
            if (stopAttempted) throw new InvalidOperationException("The owned trace stop has already been attempted.");
            stopAttempted = true;
            return Control(StopCode);
        }

        public static string[] SplitArguments(string commandLine)
        {
            if (String.IsNullOrWhiteSpace(commandLine))
                throw new ArgumentException("Expected a recorded Windows command line.");
            int count;
            IntPtr memory = CommandLineToArgv(commandLine, out count);
            if (memory == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
            try
            {
                string[] result = new string[count];
                for (int i = 0; i < count; ++i)
                    result[i] = Marshal.PtrToStringUni(Marshal.ReadIntPtr(memory, i * IntPtr.Size));
                return result;
            }
            finally { LocalFree(memory); }
        }
    }
}
