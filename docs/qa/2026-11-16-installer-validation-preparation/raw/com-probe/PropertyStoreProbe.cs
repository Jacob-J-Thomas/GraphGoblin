using System;
using System.Runtime.InteropServices;

namespace InstallerQa
{
    // Same IPropertyStore ABI, property key, variant and flags as the sealed fixture.
    public static class PropertyStoreProbe
    {
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

        [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
        private static extern int SHGetPropertyStoreFromParsingName(
            string path, IntPtr context, uint flags, ref Guid iid,
            [MarshalAs(UnmanagedType.Interface)] out IPropertyStore store);

        [DllImport("ole32.dll")]
        private static extern int PropVariantClear(ref PropertyValue value);

        private static PropertyKey AppIdKey()
        {
            return new PropertyKey { Format = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), Id = 5 };
        }

        public static bool Write(string shortcut, string id, Action<string, int> record)
        {
            Guid iid = typeof(IPropertyStore).GUID;
            IPropertyStore store;
            int open = SHGetPropertyStoreFromParsingName(shortcut, IntPtr.Zero, 2, ref iid, out store);
            try
            {
                record("write-open", open);
                if (open < 0) return false;
                if (store == null) throw new InvalidOperationException("Write open returned no property store.");
                PropertyKey key = AppIdKey();
                var value = new PropertyValue { Type = 31, Text = Marshal.StringToCoTaskMemUni(id) };
                int set;
                try
                {
                    set = store.SetValue(ref key, ref value);
                    record("write-set", set);
                }
                finally { record("write-clear", PropVariantClear(ref value)); }
                if (set < 0) return false;
                int commit = store.Commit();
                record("write-commit", commit);
                return commit >= 0;
            }
            finally
            {
                if (store != null) Marshal.ReleaseComObject(store);
            }
        }

        public sealed class ReadResult
        {
            public ushort VariantType { get; set; }
            public string Value { get; set; }
        }

        public static ReadResult Read(string shortcut, Action<string, int> record)
        {
            Guid iid = typeof(IPropertyStore).GUID;
            IPropertyStore store;
            int open = SHGetPropertyStoreFromParsingName(shortcut, IntPtr.Zero, 0, ref iid, out store);
            try
            {
                record("read-open", open);
                if (open < 0) return null;
                if (store == null) throw new InvalidOperationException("Read open returned no property store.");
                PropertyKey key = AppIdKey();
                PropertyValue value;
                int get = store.GetValue(ref key, out value);
                record("read-get", get);
                if (get < 0) return null;
                try
                {
                    return new ReadResult {
                        VariantType = value.Type,
                        Value = value.Type == 31 ? Marshal.PtrToStringUni(value.Text) : ""
                    };
                }
                finally { record("read-clear", PropVariantClear(ref value)); }
            }
            finally
            {
                if (store != null) Marshal.ReleaseComObject(store);
            }
        }
    }
}
