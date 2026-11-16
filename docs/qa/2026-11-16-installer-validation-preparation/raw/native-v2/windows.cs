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

        [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
        private class ShellLink { }

        [ComImport, Guid("000214F9-0000-0000-C000-000000000046")]
        [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IShellLinkW
        {
            void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int capacity, IntPtr findData, uint flags);
            void GetIDList(out IntPtr list);
            void SetIDList(IntPtr list);
            void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder description, int capacity);
            void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string description);
            void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder directory, int capacity);
            void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string directory);
            void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder arguments, int capacity);
            void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string arguments);
            void GetHotkey(out ushort hotkey);
            void SetHotkey(ushort hotkey);
            void GetShowCmd(out int show);
            void SetShowCmd(int show);
            void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder icon, int capacity, out int index);
            void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string icon, int index);
            void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string path, uint reserved);
            void Resolve(IntPtr window, uint flags);
            void SetPath([MarshalAs(UnmanagedType.LPWStr)] string path);
        }

        public sealed class LinkData
        {
            public string Target { get; set; }
            public string Arguments { get; set; }
            public string WorkingDirectory { get; set; }
            public string Icon { get; set; }
        }

        public static void SaveLink(string path, string target, string arguments, string workingDirectory, string icon)
        {
            object link = new ShellLink();
            try
            {
                var shell = (IShellLinkW)link;
                shell.SetPath(target);
                shell.SetArguments(arguments);
                shell.SetWorkingDirectory(workingDirectory);
                shell.SetIconLocation(icon, 0);
                ((System.Runtime.InteropServices.ComTypes.IPersistFile)link).Save(path, true);
            }
            finally { Marshal.ReleaseComObject(link); }
        }

        public static LinkData LoadLink(string path)
        {
            object link = new ShellLink();
            try
            {
                ((System.Runtime.InteropServices.ComTypes.IPersistFile)link).Load(path, 0);
                var shell = (IShellLinkW)link;
                var target = new StringBuilder(32768);
                var arguments = new StringBuilder(32768);
                var workingDirectory = new StringBuilder(32768);
                var icon = new StringBuilder(32768);
                int index;
                shell.GetPath(target, target.Capacity, IntPtr.Zero, 0);
                shell.GetArguments(arguments, arguments.Capacity);
                shell.GetWorkingDirectory(workingDirectory, workingDirectory.Capacity);
                shell.GetIconLocation(icon, icon.Capacity, out index);
                return new LinkData {
                    Target = target.ToString(),
                    Arguments = arguments.ToString(),
                    WorkingDirectory = workingDirectory.ToString(),
                    Icon = icon.ToString() + "," + index.ToString(System.Globalization.CultureInfo.InvariantCulture)
                };
            }
            finally { Marshal.ReleaseComObject(link); }
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
