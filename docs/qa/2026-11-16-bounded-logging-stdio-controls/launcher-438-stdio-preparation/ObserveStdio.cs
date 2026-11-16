using System;
using System.ComponentModel;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Web.Script.Serialization;
using Microsoft.Win32.SafeHandles;

internal static class ObserveStdio
{
    private const uint ProcessQueryInformation = 0x0400;
    private const uint ProcessVmRead = 0x0010;
    private const uint ProcessDupHandle = 0x0040;
    private const uint Synchronize = 0x00100000;
    private const uint TokenQuery = 0x0008;
    private const int TokenUser = 1;
    private const uint SameAccess = 0x0002;
    private const uint WaitTimeout = 258;
    private const ushort Amd64 = 0x8664;
    private const uint FileTypeDisk = 1;
    private const uint FileTypeChar = 2;
    private const uint FileTypePipe = 3;
    private const uint FileReadData = 0x0001;
    private const uint FileWriteData = 0x0002;
    private const int PebProcessParameters = 0x20;
    private const int ParametersPrefixBytes = 16 + 10 * 8;
    private const int ObjectBasicInformation = 0;
    private const int ObjectNameInformation = 1;
    private const int ObjectTypeInformation = 2;
    private const string NullDevice = @"\Device\Null";

    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessBasicInformation
    {
        public int ExitStatus;
        public IntPtr PebAddress;
        public UIntPtr Affinity;
        public int BasePriority;
        public UIntPtr Pid;
        public UIntPtr ParentPid;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct FileTime
    {
        public uint Low;
        public uint High;
    }

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    private delegate int QueryProcess(
        IntPtr process, int informationClass, out ProcessBasicInformation data,
        uint dataBytes, out uint returnedBytes);

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    private delegate int QueryObject(
        IntPtr handle, int informationClass, IntPtr data, uint dataBytes, out uint returnedBytes);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern SafeFileHandle OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll")]
    private static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint GetProcessId(IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool IsWow64Process2(IntPtr process, out ushort processMachine, out ushort nativeMachine);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetProcessTimes(
        IntPtr process, out FileTime creation, out FileTime exit, out FileTime kernel, out FileTime user);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    private static extern bool QueryFullProcessImageNameW(
        IntPtr process, uint flags, StringBuilder image, ref uint capacity);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool ReadProcessMemory(
        IntPtr process, IntPtr address, [Out] byte[] bytes, UIntPtr count, out UIntPtr read);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool DuplicateHandle(
        IntPtr sourceProcess, IntPtr sourceHandle, IntPtr targetProcess, out SafeFileHandle target,
        uint access, bool inherit, uint options);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GetStdHandle(int standardHandle);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint GetFileType(IntPtr handle);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    private static extern uint QueryDosDeviceW(string device, [Out] char[] targets, uint capacity);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    private static extern IntPtr GetModuleHandleW(string name);
    [DllImport("kernel32.dll", CharSet = CharSet.Ansi, ExactSpelling = true, SetLastError = true)]
    private static extern IntPtr GetProcAddress(IntPtr module, string name);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool OpenProcessToken(IntPtr process, uint access, out SafeFileHandle token);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetTokenInformation(
        SafeFileHandle token, int informationClass, IntPtr data, uint size, out uint needed);

    private static void Require(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }

    private static void Win32(bool succeeded, string operation)
    {
        if (!succeeded) throw new Win32Exception(Marshal.GetLastWin32Error(), operation);
    }

    private static void NtStatus(int status, string operation)
    {
        if (status < 0)
            throw new InvalidOperationException(operation + ": NTSTATUS 0x" + status.ToString("X8"));
    }

    private static IntPtr Export(IntPtr module, string name)
    {
        IntPtr address = GetProcAddress(module, name);
        Win32(address != IntPtr.Zero, "GetProcAddress " + name);
        return address;
    }

    private static void RequireAmd64(IntPtr process)
    {
        ushort processMachine, nativeMachine;
        Win32(IsWow64Process2(process, out processMachine, out nativeMachine), "IsWow64Process2");
        Require(processMachine == 0 && nativeMachine == Amd64, "Native AMD64 required");
    }

    private static string ImagePath(IntPtr process)
    {
        var path = new StringBuilder(32768);
        uint capacity = (uint)path.Capacity;
        Win32(QueryFullProcessImageNameW(process, 0, path, ref capacity), "QueryFullProcessImageNameW");
        return path.ToString();
    }

    private static ulong ConfirmIdentity(IntPtr process, uint pid, ulong expectedBirth, string image)
    {
        // A zero-time wait on the same process handle detects an observed exit without signaling it.
        uint wait = WaitForSingleObject(process, 0);
        Win32(wait != uint.MaxValue, "WaitForSingleObject");
        Require(wait == WaitTimeout && GetProcessId(process) == pid, "Target process identity unavailable");

        FileTime creation, exit, kernel, user;
        Win32(GetProcessTimes(process, out creation, out exit, out kernel, out user), "GetProcessTimes");
        ulong birth = ((ulong)creation.High << 32) | creation.Low;
        Require(birth == expectedBirth, "Target creation FILETIME mismatch");
        Require(string.Equals(ImagePath(process), image, StringComparison.OrdinalIgnoreCase),
            "Target executable mismatch");
        return birth;
    }

    private static SecurityIdentifier ProcessSid(IntPtr process)
    {
        SafeFileHandle token;
        bool opened = OpenProcessToken(process, TokenQuery, out token);
        using (token)
        {
            Win32(opened, "OpenProcessToken");
            uint bytes;
            bool sizeSupplied = GetTokenInformation(token, TokenUser, IntPtr.Zero, 0, out bytes);
            int sizeError = Marshal.GetLastWin32Error();
            Require(!sizeSupplied && sizeError == 122 && bytes >= 16 && bytes <= 65536,
                "Unexpected TOKEN_USER buffer size");
            IntPtr buffer = Marshal.AllocHGlobal((int)bytes);
            try
            {
                uint used;
                Win32(GetTokenInformation(token, TokenUser, buffer, bytes, out used), "GetTokenInformation TOKEN_USER");
                Require(used >= 16 && used <= bytes, "Unexpected TOKEN_USER length");
                return new SecurityIdentifier(Marshal.ReadIntPtr(buffer));
            }
            finally { Marshal.FreeHGlobal(buffer); }
        }
    }

    private static byte[] ReadBytes(IntPtr process, IntPtr address, int size)
    {
        Require(address.ToInt64() > 0 && (address.ToInt64() & 7) == 0, "Invalid process address");
        byte[] data = new byte[size];
        UIntPtr read;
        Win32(ReadProcessMemory(process, address, data, new UIntPtr((uint)size), out read),
            "ReadProcessMemory");
        Require(read.ToUInt64() == (ulong)size, "Incomplete process memory read");
        return data;
    }

    private static IntPtr ParametersAddress(QueryProcess query, IntPtr process, uint pid)
    {
        ProcessBasicInformation data;
        uint returned;
        uint expected = (uint)Marshal.SizeOf(typeof(ProcessBasicInformation));
        NtStatus(query(process, 0, out data, expected, out returned), "NtQueryInformationProcess");
        Require(returned == expected && data.Pid.ToUInt64() == pid, "Unexpected PEB query result");
        return new IntPtr(BitConverter.ToInt64(
            ReadBytes(process, IntPtr.Add(data.PebAddress, PebProcessParameters), 8), 0));
    }

    private static bool OrdinaryHandle(long value)
    {
        // Exclude null, pseudohandles and unexpected tag bits before attempting duplication.
        return value > 0 && value <= int.MaxValue && (value & 3) == 0;
    }

    private static int LocateLocalSlots(QueryProcess query, IntPtr local)
    {
        IntPtr[] handles = { GetStdHandle(-10), GetStdHandle(-11), GetStdHandle(-12) };
        long[] values = handles.Select(h => h.ToInt64()).ToArray();
        Require(values.All(OrdinaryHandle) && values.Distinct().Count() == 3 &&
            handles.All(h => GetFileType(h) == FileTypePipe),
            "Launch this helper with three distinct redirected pipe handles");

        IntPtr parameters = ParametersAddress(query, local, GetProcessId(local));
        byte[] prefix = ReadBytes(local, parameters, ParametersPrefixBytes);
        int match = -1;
        for (int offset = 16; offset + 24 <= prefix.Length; offset += 8)
        {
            if (values[0] != BitConverter.ToInt64(prefix, offset) ||
                values[1] != BitConverter.ToInt64(prefix, offset + 8) ||
                values[2] != BitConverter.ToInt64(prefix, offset + 16)) continue;
            Require(match < 0, "Ambiguous local stdio slot offsets");
            match = offset;
        }
        Require(match >= 0, "Local stdio slot offsets could not be verified");
        return match;
    }

    private static long[] RemoteSlots(IntPtr target, IntPtr parameters, int offset)
    {
        byte[] slots = ReadBytes(target, IntPtr.Add(parameters, offset), 24);
        long[] values = { BitConverter.ToInt64(slots, 0), BitConverter.ToInt64(slots, 8),
            BitConverter.ToInt64(slots, 16) };
        Require(values.All(OrdinaryHandle), "Target standard handle value is unavailable or unexpected");
        return values;
    }

    private static bool MapsToNullDevice()
    {
        var mappings = new char[4096];
        uint used = QueryDosDeviceW("NUL", mappings, (uint)mappings.Length);
        Win32(used != 0, "QueryDosDeviceW NUL");
        Require(used <= mappings.Length, "Unexpected NUL mapping length");
        int end = Array.IndexOf(mappings, '\0', 0, (int)used);
        Require(end > 0, "NUL mapping has no current target");
        return string.Equals(new string(mappings, 0, end), NullDevice, StringComparison.OrdinalIgnoreCase);
    }

    private static string QueryCountedString(QueryObject query, IntPtr handle, int informationClass)
    {
        const int capacity = 4096;
        IntPtr buffer = Marshal.AllocHGlobal(capacity);
        try
        {
            uint bytes;
            NtStatus(query(handle, informationClass, buffer, capacity, out bytes), "NtQueryObject class " + informationClass);
            Require(bytes >= 16 && bytes <= capacity, "Unexpected object information length");
            ushort length = (ushort)Marshal.ReadInt16(buffer, 0);
            ushort maximum = (ushort)Marshal.ReadInt16(buffer, 2);
            if (length == 0) return null;
            long address = Marshal.ReadIntPtr(buffer, 8).ToInt64();
            long first = buffer.ToInt64();
            Require((length & 1) == 0 && length <= maximum && address >= first + 16 &&
                address <= first + bytes - length, "Unexpected object name buffer range");
            return Marshal.PtrToStringUni(new IntPtr(address), length / 2);
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }

    private static uint GrantedAccess(QueryObject query, IntPtr handle)
    {
        const int size = 56;
        IntPtr buffer = Marshal.AllocHGlobal(size);
        try
        {
            uint bytes;
            NtStatus(query(handle, ObjectBasicInformation, buffer, size, out bytes), "NtQueryObject basic");
            Require(bytes == size, "Unexpected object basic information length");
            return unchecked((uint)Marshal.ReadInt32(buffer, 4));
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }

    private sealed class Observation
    {
        public string slot { get; set; }
        public string remoteHandle { get; set; }
        public string objectType { get; set; }
        public uint? win32FileType { get; set; }
        public string objectName { get; set; }
        public string nameStatus { get; set; }
        public string grantedAccess { get; set; }
        public bool readData { get; set; }
        public bool writeData { get; set; }
        public bool matches { get; set; }
    }

    private static Observation Observe(QueryObject query, IntPtr target, IntPtr local, long value, int index)
    {
        SafeFileHandle copy;
        bool duplicated = DuplicateHandle(target, new IntPtr(value), local, out copy, 0, false, SameAccess);
        using (copy)
        {
            Win32(duplicated, "DuplicateHandle");
            Require(!copy.IsInvalid, "Invalid duplicate handle");
            IntPtr handle = copy.DangerousGetHandle();
            string objectType = QueryCountedString(query, handle, ObjectTypeInformation);
            Require(!string.IsNullOrEmpty(objectType), "Unknown kernel object type");
            uint access = GrantedAccess(query, handle);
            uint? fileType = objectType == "File" ? (uint?)GetFileType(handle) : null;
            Require(!fileType.HasValue || fileType == FileTypeDisk || fileType == FileTypeChar ||
                fileType == FileTypePipe, "Unrecognized Win32 file type");
            // Class 1 is an internal query. Only use it for the expected class of device.
            string name = fileType == FileTypeChar ? QueryCountedString(query, handle, ObjectNameInformation) : null;
            Require(fileType != FileTypeChar || !string.IsNullOrEmpty(name), "Character-device name unavailable");
            bool read = (access & FileReadData) != 0;
            bool write = (access & FileWriteData) != 0;
            return new Observation {
                slot = index == 0 ? "stdin" : index == 1 ? "stdout" : "stderr",
                remoteHandle = "0x" + value.ToString("X"),
                objectType = objectType,
                win32FileType = fileType,
                objectName = name,
                nameStatus = fileType == FileTypeChar ? "observed" : "outside-character-device-probe",
                grantedAccess = "0x" + access.ToString("X8"),
                readData = objectType == "File" && read,
                writeData = objectType == "File" && write,
                matches = fileType == FileTypeChar && string.Equals(name, NullDevice,
                    StringComparison.OrdinalIgnoreCase) && (index == 0 ? read : write)
            };
        }
    }

    private static int Main(string[] args)
    {
        var json = new JavaScriptSerializer();
        try
        {
            uint pid;
            ulong expectedBirth;
            if (args.Length != 3 ||
                !uint.TryParse(args[0], NumberStyles.None, CultureInfo.InvariantCulture, out pid) || pid == 0 ||
                !ulong.TryParse(args[1], NumberStyles.None, CultureInfo.InvariantCulture, out expectedBirth) ||
                expectedBirth == 0)
                throw new ArgumentException("Usage: ObserveStdio.exe PID CREATION_FILETIME ABSOLUTE_EXE");
            string image = args[2];
            Require(image.Length >= 4 && char.IsLetter(image[0]) && image[1] == ':' && image[2] == '\\' &&
                string.Equals(Path.GetFullPath(image), image, StringComparison.OrdinalIgnoreCase),
                "Expected a canonical local executable path");
            Require(IntPtr.Size == 8, "64-bit helper required");
            IntPtr local = GetCurrentProcess();
            Require(pid != GetProcessId(local), "Target must be the separately owned process");
            RequireAmd64(local);

            const uint access = ProcessQueryInformation | ProcessVmRead | ProcessDupHandle | Synchronize;
            using (SafeFileHandle process = OpenProcess(access, false, pid))
            {
                Win32(!process.IsInvalid, "OpenProcess");
                IntPtr target = process.DangerousGetHandle();
                ulong birth = ConfirmIdentity(target, pid, expectedBirth, image);
                RequireAmd64(target);
                Require(ProcessSid(local).Equals(ProcessSid(target)), "Target process user SID mismatch");
                Require(MapsToNullDevice(), "Unexpected NUL device mapping");

                // Ntdll is already loaded into this helper. The borrowed module handle stays open.
                IntPtr ntdll = GetModuleHandleW("ntdll.dll");
                Win32(ntdll != IntPtr.Zero, "GetModuleHandleW ntdll.dll");
                var queryProcess = (QueryProcess)Marshal.GetDelegateForFunctionPointer(
                    Export(ntdll, "NtQueryInformationProcess"), typeof(QueryProcess));
                var queryObject = (QueryObject)Marshal.GetDelegateForFunctionPointer(
                    Export(ntdll, "NtQueryObject"), typeof(QueryObject));

                int slotOffset = LocateLocalSlots(queryProcess, local);
                IntPtr parameters = ParametersAddress(queryProcess, target, pid);
                long[] values = RemoteSlots(target, parameters, slotOffset);
                var observations = new Observation[3];
                for (int index = 0; index < observations.Length; index++)
                    observations[index] = Observe(queryObject, target, local, values[index], index);
                Require(ParametersAddress(queryProcess, target, pid) == parameters &&
                    values.SequenceEqual(RemoteSlots(target, parameters, slotOffset)),
                    "Target standard handle slots changed during observation");
                ConfirmIdentity(target, pid, expectedBirth, image);
                bool matched = observations.All(o => o.matches);
                Console.WriteLine(json.Serialize(new {
                    schema = "gg438-stdio-observation/v1", status = matched ? "matched" : "nonconforming",
                    pid = pid, birthFileTime = birth.ToString(CultureInfo.InvariantCulture), image = image,
                    machine = "native-amd64", localStdHandleOffsets = new[] { slotOffset, slotOffset + 8, slotOffset + 16 },
                    dosNullCurrentTarget = NullDevice, slots = observations
                }));
                return matched ? 0 : 1;
            }
        }
        catch (Exception error)
        {
            var nativeError = error as Win32Exception;
            Console.Error.WriteLine(json.Serialize(new {
                schema = "gg438-stdio-observation/v1", status = "inconclusive", reason = error.Message,
                win32 = nativeError == null ? (int?)null : nativeError.NativeErrorCode
            }));
            return 2;
        }
    }
}

