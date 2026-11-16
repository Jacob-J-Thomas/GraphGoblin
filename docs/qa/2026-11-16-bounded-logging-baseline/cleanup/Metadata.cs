using System;
using System.ComponentModel;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using Microsoft.Win32.SafeHandles;

public static class Gg438CleanupMetadata
{
    private const uint Directory = 0x10;
    private const uint ReparsePoint = 0x400;
    private const uint GenericRead = 0x80000000;
    private const uint GenericWrite = 0x40000000;

    [StructLayout(LayoutKind.Sequential)]
    private struct FileTime { public uint Low, High; }

    [StructLayout(LayoutKind.Sequential)]
    private struct FileInformation
    {
        public uint Attributes;
        public FileTime Created, Accessed, Modified;
        public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }

    public sealed class Entry
    {
        public uint Attributes { get; set; }
        public uint Links { get; set; }
        public bool IsDirectory { get; set; }
        public bool IsReparse { get; set; }
        public string Id { get; set; }
        public string Modified { get; set; }
        public ulong Bytes { get; set; }
        public string Sha256 { get; set; }
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    private static extern SafeFileHandle CreateFileW(string path, uint access, uint share,
        IntPtr security, uint disposition, uint flags, IntPtr template);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle handle, out FileInformation info);

    private static SafeFileHandle Open(string path, uint access, uint share)
    {
        // BACKUP_SEMANTICS enables directory metadata. OPEN_REPARSE_POINT opens the link itself.
        SafeFileHandle handle = CreateFileW(path, access, share, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero);
        if (handle.IsInvalid)
        {
            int code = Marshal.GetLastWin32Error();
            handle.Dispose();
            throw new Win32Exception(code, "CreateFileW " + path);
        }
        return handle;
    }

    public static Entry Describe(SafeFileHandle handle)
    {
        FileInformation info;
        if (!GetFileInformationByHandle(handle, out info))
            throw new Win32Exception(Marshal.GetLastWin32Error(), "GetFileInformationByHandle");
        if (info.IndexHigh == 0 && info.IndexLow == 0)
            throw new IOException("Missing file identity");
        return new Entry {
            Attributes = info.Attributes, Links = info.Links,
            IsDirectory = (info.Attributes & Directory) != 0, IsReparse = (info.Attributes & ReparsePoint) != 0,
            Id = info.Volume.ToString("X8") + ":" + info.IndexHigh.ToString("X8") + info.IndexLow.ToString("X8"),
            Modified = (((ulong)info.Modified.High << 32) | info.Modified.Low).ToString(CultureInfo.InvariantCulture),
            Bytes = ((ulong)info.SizeHigh << 32) | info.SizeLow
        };
    }

    public static Entry Inspect(string path, bool hash)
    {
        using (SafeFileHandle handle = Open(path, hash ? GenericRead : 0, 7))
        {
            Entry entry = Describe(handle);
            if (hash)
            {
                RequireOrdinaryFile(entry);
                using (var stream = new FileStream(handle, FileAccess.Read))
                using (var sha = SHA256.Create())
                    entry.Sha256 = BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
            }
            return entry;
        }
    }

    private static void RequireOrdinaryFile(Entry entry)
    {
        if (entry.IsReparse || entry.IsDirectory || entry.Links != 1)
            throw new IOException("Expected a single-link ordinary file");
    }

    public static byte[] Read(string path)
    {
        using (SafeFileHandle handle = Open(path, GenericRead, 1))
        {
            RequireOrdinaryFile(Describe(handle));
            using (var stream = new FileStream(handle, FileAccess.Read))
            using (var buffer = new MemoryStream())
            {
                stream.CopyTo(buffer);
                return buffer.ToArray();
            }
        }
    }

    public static SafeFileHandle OpenExclusive(string path)
    {
        SafeFileHandle handle = Open(path, GenericRead | GenericWrite, 0);
        try
        {
            RequireOrdinaryFile(Describe(handle));
            return handle;
        }
        catch { handle.Dispose(); throw; }
    }
}

