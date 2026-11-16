using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace InstallerQa
{
    public static class Windows
    {
        [StructLayout(LayoutKind.Sequential)]
        private struct FileIdInfo
        {
            public ulong Volume;
            public ulong IdLow;
            public ulong IdHigh;
        }

        public sealed class FileIdentity
        {
            public string Path { get; set; }
            public string Volume { get; set; }
            public string FileId { get; set; }
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
        private static extern SafeFileHandle CreateFileW(string path, uint access, uint share,
            IntPtr security, uint disposition, uint flags, IntPtr template);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
        private static extern uint GetFinalPathNameByHandleW(SafeFileHandle file,
            StringBuilder path, uint capacity, uint flags);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GetFileInformationByHandleEx(SafeFileHandle file,
            int informationClass, out FileIdInfo info, uint size);

        public static FileIdentity Identify(string path)
        {
            const uint openExisting = 3;
            const uint backupSemantics = 0x02000000;
            const uint fileReadAttributes = 0x80;
            const uint shareReadWriteDelete = 7;
            using (SafeFileHandle handle = CreateFileW(path, fileReadAttributes, shareReadWriteDelete, IntPtr.Zero, openExisting,
                backupSemantics, IntPtr.Zero))
            {
                if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
                var target = new StringBuilder(32768);
                uint length = GetFinalPathNameByHandleW(handle, target, (uint)target.Capacity, 0);
                if (length == 0 || length >= target.Capacity)
                    throw new Win32Exception(Marshal.GetLastWin32Error());
                const int fileIdInfoClass = 18;
                FileIdInfo identity;
                if (!GetFileInformationByHandleEx(handle, fileIdInfoClass, out identity,
                    (uint)Marshal.SizeOf(typeof(FileIdInfo))))
                    throw new Win32Exception(Marshal.GetLastWin32Error());
                string canonical = target.ToString();
                if (canonical.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase))
                    canonical = @"\\" + canonical.Substring(8);
                else if (canonical.StartsWith(@"\\?\", StringComparison.Ordinal))
                    canonical = canonical.Substring(4);
                return new FileIdentity {
                    Path = canonical,
                    Volume = identity.Volume.ToString("x16"),
                    FileId = identity.IdHigh.ToString("x16") + identity.IdLow.ToString("x16")
                };
            }
        }

        [StructLayout(LayoutKind.Sequential, Pack = 4)]
        private struct PropertyKey
        {
            public Guid Format;
            public uint Id;
        }

        [StructLayout(LayoutKind.Explicit, Size = 24)]
        private struct PropertyValue
        {
            [FieldOffset(0)] public ushort Type;
            [FieldOffset(8)] public IntPtr Text;
        }

        [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
        [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IPropertyStore
        {
            [PreserveSig] int GetCount(out uint value);
            [PreserveSig] int GetAt(uint index, out PropertyKey key);
            [PreserveSig] int GetValue(ref PropertyKey key, out PropertyValue value);
            [PreserveSig] int SetValue(ref PropertyKey key, ref PropertyValue value);
            [PreserveSig] int Commit();
        }

        [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
        private static extern void SHGetPropertyStoreFromParsingName(
            string path, IntPtr context, uint flags, ref Guid iid,
            [MarshalAs(UnmanagedType.Interface)] out IPropertyStore store);

        [DllImport("ole32.dll")]
        private static extern int PropVariantClear(ref PropertyValue value);

        private static PropertyKey AppIdKey()
        {
            return new PropertyKey { Format = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), Id = 5 };
        }

        public static string ReadAppId(string shortcut)
        {
            Guid iid = typeof(IPropertyStore).GUID;
            IPropertyStore store;
            SHGetPropertyStoreFromParsingName(shortcut, IntPtr.Zero, 0, ref iid, out store);
            try
            {
                PropertyKey key = AppIdKey();
                PropertyValue value;
                Marshal.ThrowExceptionForHR(store.GetValue(ref key, out value));
                try { return value.Type == 31 ? Marshal.PtrToStringUni(value.Text) : ""; }
                finally { PropVariantClear(ref value); }
            }
            finally { Marshal.ReleaseComObject(store); }
        }

        public static void WriteAppId(string shortcut, string id)
        {
            Guid iid = typeof(IPropertyStore).GUID;
            IPropertyStore store;
            const uint readWrite = 2;
            SHGetPropertyStoreFromParsingName(shortcut, IntPtr.Zero, readWrite, ref iid, out store);
            try
            {
                PropertyKey key = AppIdKey();
                var value = new PropertyValue { Type = 31, Text = Marshal.StringToCoTaskMemUni(id) };
                try { Marshal.ThrowExceptionForHR(store.SetValue(ref key, ref value)); }
                finally { PropVariantClear(ref value); }
                Marshal.ThrowExceptionForHR(store.Commit());
            }
            finally { Marshal.ReleaseComObject(store); }
        }

        [DllImport("shell32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
        private static extern IntPtr CommandLineToArgvW(string commandLine, out int argc);

        [DllImport("kernel32.dll")]
        private static extern IntPtr LocalFree(IntPtr memory);

        public static string[] SplitArguments(string arguments)
        {
            int argc;
            IntPtr argv = CommandLineToArgvW("qa.exe " + arguments, out argc);
            if (argv == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
            try
            {
                var result = new string[argc - 1];
                for (int index = 1; index < argc; index++)
                    result[index - 1] = Marshal.PtrToStringUni(Marshal.ReadIntPtr(argv, index * IntPtr.Size));
                return result;
            }
            finally { LocalFree(argv); }
        }

        public static bool IsX64WindowsImage(string path)
        {
            using (var input = new BinaryReader(File.OpenRead(path)))
            {
                if (input.BaseStream.Length < 64 || input.ReadUInt16() != 0x5A4D) return false;
                input.BaseStream.Position = 0x3c;
                int peOffset = input.ReadInt32();
                if (peOffset < 64 || peOffset > input.BaseStream.Length - 6) return false;
                input.BaseStream.Position = peOffset;
                return input.ReadUInt32() == 0x00004550 && input.ReadUInt16() == 0x8664;
            }
        }
    }
}
