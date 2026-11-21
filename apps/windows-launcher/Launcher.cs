using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32.SafeHandles;

namespace GraphGoblin.Desktop
{
    sealed class ConfigurationRefusal : Exception
    {
        public ConfigurationRefusal(string message) : base(message) { }
    }

    /// <summary>
    /// A closed launcher outcome: fixed text, a closed cause code and only validated, bounded
    /// operator locations. Raw exceptions, helper output and configuration values never enter it.
    /// </summary>
    public sealed class LauncherFailure : Exception
    {
        public readonly string Code;
        public readonly int ChildExit;
        public readonly string LogFolder;
        public readonly string Lock;
        public LauncherFailure(string code, string text) : this(code, text, null, null, 0) { }
        public LauncherFailure(string code, string text, string logFolder, string lockPath, int childExit) : base(text)
        {
            Code = code; LogFolder = logFolder; Lock = lockPath; ChildExit = childExit;
        }
    }

    public sealed class Configuration
    {
        /// <summary>Exact declaration the built entry carries within its first 4 KiB (#438).</summary>
        public const string LogProtocolMarker = "export const WINDOWS_LAUNCHER_LOG_PROTOCOL = 1;";
        /// <summary>Internal launcher input for the detached gateway only.</summary>
        public const string LogDirectoryVariable = "GG_WINDOWS_LAUNCHER_LOG_DIR";
        public static readonly string[] BuiltFiles = {
            "apps/api/dist/main.js", "apps/api/dist/instance-identity.js",
            "apps/api/dist/windows-log/guard.js", "apps/web/dist/index.html"
        };

        public string Repo { get; set; }
        public string Node { get; set; }
        public string DataDir { get; set; }
        public int Port { get; set; }
        public string ChromeProxy { get; set; }
        public string ChromeProfile { get; set; }
        public string ChromeAppId { get; set; }
        public string IconLocation { get; set; }
        public string PwaAppUserModelId { get; set; }
        public string LauncherAppUserModelId { get; set; }
        public Dictionary<string, string> Environment { get; set; }
        public int StartupTimeoutSeconds { get; set; }
        public int WindowTimeoutSeconds { get; set; }

        public void Validate(bool gatewayOnly)
        {
            if (!Path.IsPathRooted(Repo ?? "") || !Directory.Exists(Repo) ||
                !Path.IsPathRooted(Node ?? "") || !File.Exists(Node) ||
                !Path.IsPathRooted(DataDir ?? "") || Port < 1 || Port > 65535 ||
                StartupTimeoutSeconds < 1 || StartupTimeoutSeconds > 300 ||
                WindowTimeoutSeconds < 1 || WindowTimeoutSeconds > 120)
                throw new ConfigurationRefusal("Invalid launcher paths, port or timeouts. Re-run install-windows-launcher.ps1.");
            foreach (string file in BuiltFiles)
                if (!File.Exists(Path.Combine(Repo, file)))
                    throw new ConfigurationRefusal("The configured checkout is not built: " + file + ". Build it with Node 22 before launching.");
            // A stale entry beside a current guard module still refuses before any spawn.
            if (!HasLogProtocol(Path.Combine(Repo, "apps/api/dist/main.js")))
                throw new ConfigurationRefusal("The configured checkout's built gateway does not match this launcher (apps/api/dist/main.js). Stop any running GraphGoblin gateway, rebuild the checkout with Node 22 and reinstall the launcher.");
            Environment = Environment ?? new Dictionary<string, string>();
            if (Environment.Keys.Any(key => string.Equals(key, "GG_MASTER_KEY", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(key, "GG_JEV_API_KEY", StringComparison.OrdinalIgnoreCase)))
                throw new ConfigurationRefusal("Launcher Environment cannot contain GG_MASTER_KEY or GG_JEV_API_KEY (case-insensitive). Keep credentials in GraphGoblin secret stores; use the data directory master.key for encryption.");
            foreach (var item in Environment)
                if (!item.Key.StartsWith("GG_", StringComparison.Ordinal) || item.Value == null || item.Key.IndexOfAny(new[] { '=', '\0' }) >= 0 || item.Value.Contains("\0"))
                    throw new ConfigurationRefusal("Launcher Environment must contain GG_* string overrides only.");
            foreach (string key in new[] { "GG_HOST", "GG_PORT", "GG_DATA_DIR", "GG_WEB_DIST" })
                if (Environment.ContainsKey(key)) throw new ConfigurationRefusal(key + " is owned by the launcher's explicit configuration fields.");
            if (Environment.Keys.Any(key => string.Equals(key, LogDirectoryVariable, StringComparison.OrdinalIgnoreCase)))
                throw new ConfigurationRefusal(LogDirectoryVariable + " is reserved for the launcher.");
            if (!gatewayOnly && (!File.Exists(ChromeProxy ?? "") || string.IsNullOrWhiteSpace(ChromeProfile) ||
                !System.Text.RegularExpressions.Regex.IsMatch(ChromeAppId ?? "", "^[a-p]{32}$") ||
                string.IsNullOrWhiteSpace(PwaAppUserModelId) || string.IsNullOrWhiteSpace(LauncherAppUserModelId)))
                throw new ConfigurationRefusal("The installed Chrome PWA is not configured. Re-run install-windows-launcher.ps1 with its shortcut.");
            if (!gatewayOnly && ChromeAppId != Program.ChromeAppId(Port))
                throw new ConfigurationRefusal("The installed Chrome PWA belongs to another origin. Install GraphGoblin from http://127.0.0.1:" + Port + "/app/ and configure its shortcut.");
        }

        /// <summary>The exact marker bytes must lie within the first 4 KiB of the built entry.</summary>
        public static bool HasLogProtocol(string entry)
        {
            byte[] marker = Encoding.ASCII.GetBytes(LogProtocolMarker);
            byte[] head = new byte[4096];
            int read = 0;
            using (var stream = new FileStream(entry, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            {
                int count;
                while (read < head.Length && (count = stream.Read(head, read, head.Length - read)) > 0) read += count;
            }
            for (int start = 0; start + marker.Length <= read; start++)
            {
                int index = 0;
                while (index < marker.Length && head[start + index] == marker[index]) index++;
                if (index == marker.Length) return true;
            }
            return false;
        }

        /// <summary>Environment for the read-only identity and ownership helpers. Never the log input.</summary>
        public SortedDictionary<string, string> ChildEnvironment()
        {
            var result = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (DictionaryEntry item in System.Environment.GetEnvironmentVariables())
                if (!((string)item.Key).StartsWith("GG_", StringComparison.OrdinalIgnoreCase)) result[(string)item.Key] = (string)item.Value;
            foreach (var item in Environment) result[item.Key] = item.Value;
            result["GG_HOST"] = "127.0.0.1";
            result["GG_PORT"] = Port.ToString();
            result["GG_DATA_DIR"] = DataDir;
            result["GG_WEB_DIST"] = Path.Combine(Repo, "apps/web/dist");
            result["PATH"] = Path.GetDirectoryName(Node) + ";" + result["PATH"];
            return result;
        }

        /// <summary>The detached gateway alone receives the admitted canonical log root, set last.</summary>
        public SortedDictionary<string, string> GatewayEnvironment(string logRoot)
        {
            var result = ChildEnvironment();
            result[LogDirectoryVariable] = logRoot;
            return result;
        }
    }

    public static class Program
    {
        /// <summary>Longest rendered location; longer paths keep their final characters.</summary>
        public const int MaxRenderedPath = 260;

        [STAThread]
        public static int Main(string[] args)
        {
            // A winexe may have redirected pipes without a console. OutputEncoding tries to
            // change a nonexistent console code page; explicitly encode only our pipe writers.
            Console.SetOut(new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true });
            Console.SetError(new StreamWriter(Console.OpenStandardError(), new UTF8Encoding(false)) { AutoFlush = true });
            if (args.Contains("--validate-install") || args.Contains("--stage-shortcut"))
                return PrepareInstallation(args);
            string configFile = Application.ExecutablePath + ".json";
            bool gatewayOnly = args.Contains("--ensure-gateway");
            bool quiet = gatewayOnly || args.Any(arg => new[] { "--read-shortcut-id", "--inspect-shortcut", "--expected-app-id", "--create-shortcut", "--stamp-shortcut" }.Contains(arg));
            string shortcut = null;
            string createShortcut = null;
            string stage = "arguments";
            try
            {
                if (args.Length == 2 && args[0] == "--read-shortcut-id") { Console.WriteLine(ShellIdentity.ReadShortcut(args[1])); return 0; }
                if (args.Length == 2 && args[0] == "--inspect-shortcut") { Console.WriteLine(new JavaScriptSerializer().Serialize(ShellIdentity.InspectShortcut(args[1]))); return 0; }
                if (args.Length == 2 && args[0] == "--expected-app-id") { Console.WriteLine(ChromeAppId(int.Parse(args[1]))); return 0; }
                for (int i = 0; i < args.Length; i++)
                    if (args[i] == "--config" && i + 1 < args.Length) configFile = args[++i];
                    else if (args[i] == "--stamp-shortcut" && i + 1 < args.Length) shortcut = args[++i];
                    else if (args[i] == "--create-shortcut" && i + 1 < args.Length) createShortcut = args[++i];
                    else if (args[i] != "--ensure-gateway") throw new LauncherFailure("invalid-argument", "Unknown launcher argument. Use --config <file>, optionally with --ensure-gateway.");
                stage = "configuration";
                var config = new JavaScriptSerializer().Deserialize<Configuration>(File.ReadAllText(configFile));
                if (config == null) throw new ConfigurationRefusal("The launcher configuration is empty. Re-run install-windows-launcher.ps1.");
                config.Validate(gatewayOnly);
                if (shortcut != null) { stage = "shortcut"; ShellIdentity.StampShortcut(shortcut, config.LauncherAppUserModelId); return 0; }
                if (createShortcut != null) {
                    stage = "shortcut";
                    ShellIdentity.CreateShortcut(createShortcut, Application.ExecutablePath, "--config " + Program.Quote(Path.GetFullPath(configFile)) + (gatewayOnly ? " --ensure-gateway" : ""), config.IconLocation, config.LauncherAppUserModelId);
                    return 0;
                }
                stage = "launch-lock";
                string mutexName = "Local\\GraphGoblin.Launch." + Hash(config.DataDir.ToUpperInvariant());
                using (var mutex = new Mutex(false, mutexName))
                using (var portMutex = new Mutex(false, "Local\\GraphGoblin.Port." + config.Port))
                {
                    bool owned = false, portOwned = false;
                    try
                    {
                        try { owned = mutex.WaitOne(TimeSpan.FromSeconds(360)); } catch (AbandonedMutexException) { owned = true; }
                        if (!owned) throw new LauncherFailure("launch-busy", "Another GraphGoblin launch is still waiting. Inspect launcher.log before trying again.");
                        try { portOwned = portMutex.WaitOne(TimeSpan.FromSeconds(360)); } catch (AbandonedMutexException) { portOwned = true; }
                        if (!portOwned) throw new LauncherFailure("port-busy", "Another GraphGoblin launcher is still checking port " + config.Port + ".");
                        stage = "gateway";
                        new Gateway(config, Path.GetDirectoryName(Path.GetFullPath(configFile))).Ensure();
                        stage = "window";
                        if (!gatewayOnly) ShellIdentity.OpenPwa(config, configFile);
                    }
                    finally { if (portOwned) portMutex.ReleaseMutex(); if (owned) mutex.ReleaseMutex(); }
                }
                return 0;
            }
            catch (Exception error)
            {
                // Store and port mutexes are already released; the log pair has its own mutex.
                string message = Present(error, stage, configFile);
                LauncherLog.Record(configFile, error, stage);
                Console.Error.WriteLine(message);
                if (!quiet) MessageBox.Show(message, "GraphGoblin could not open", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
        }

        /// <summary>Closed launcher text plus validated, bounded locations. Never raw exception text.</summary>
        public static string Present(Exception error, string stage, string configFile)
        {
            var failure = error as LauncherFailure;
            string text = failure != null || error is ConfigurationRefusal
                ? error.Message
                : "GraphGoblin could not open because of an unexpected launcher error during the " + stage + " step. Check the launcher configuration and try again.";
            var result = new StringBuilder(text);
            if (failure != null && failure.LogFolder != null) result.Append("\r\n\r\nLog folder: ").Append(RenderPath(failure.LogFolder));
            return result.Append("\r\n\r\nConfiguration: ").Append(RenderPath(FullPathOrNull(configFile))).ToString();
        }

        public static string FullPathOrNull(string path)
        {
            try { return string.IsNullOrEmpty(path) ? null : Path.GetFullPath(path); }
            catch (Exception) { return null; }
        }

        /// <summary>A rooted local path without control or formatting characters, capped in length.</summary>
        public static string RenderPath(string path)
        {
            if (string.IsNullOrEmpty(path)) return "[location not shown]";
            // Characters first: .NET Framework path APIs throw on control characters.
            foreach (char ch in path)
            {
                var category = char.GetUnicodeCategory(ch);
                if (char.IsControl(ch) || category == UnicodeCategory.Format || category == UnicodeCategory.LineSeparator || category == UnicodeCategory.ParagraphSeparator)
                    return "[location not shown]";
            }
            bool rooted;
            try { rooted = Path.IsPathRooted(path); }
            catch (ArgumentException) { rooted = false; }
            if (!rooted) return "[location not shown]";
            if (path.Length <= MaxRenderedPath) return path;
            int keep = MaxRenderedPath - 1;
            // Never split a surrogate pair at the cut.
            if (char.IsLowSurrogate(path[path.Length - keep])) keep--;
            return "\u2026" + path.Substring(path.Length - keep);
        }

        static int PrepareInstallation(string[] args)
        {
            try
            {
                bool validate = args.Length == 3 && args[0] == "--validate-install" && args[1] == "--config";
                bool stage = args.Length == 4 && args[0] == "--stage-shortcut";
                if (!validate && !stage) throw new ConfigurationRefusal("Invalid staged launcher arguments.");
                if (!IsFullyQualifiedWindowsPath(args[2])) throw new ConfigurationRefusal("Invalid staged launcher configuration path.");
                var config = new JavaScriptSerializer().Deserialize<Configuration>(File.ReadAllText(args[2]));
                config.Validate(false);
                HelperProcess.CheckCapability();
                if (stage)
                {
                    if (!IsFullyQualifiedWindowsPath(args[1]) || !IsFullyQualifiedWindowsPath(args[3]) ||
                        !string.Equals(Path.GetExtension(args[1]), ".lnk", StringComparison.OrdinalIgnoreCase))
                        throw new ConfigurationRefusal("Invalid staged shortcut or final launcher path.");
                    string finalExe = Path.GetFullPath(args[3]);
                    ShellIdentity.CreateShortcut(args[1], finalExe, "--config " + Quote(finalExe + ".json"),
                        config.IconLocation, config.LauncherAppUserModelId);
                }
                return 0;
            }
            catch (ConfigurationRefusal error) { Console.Error.WriteLine(error.Message); }
            catch (LauncherFailure error) { Console.Error.WriteLine(error.Message); }
            catch (Exception) { Console.Error.WriteLine("The staged launcher configuration or shortcut could not be prepared."); }
            return 1;
        }

        static bool IsFullyQualifiedWindowsPath(string path)
        {
            if (string.IsNullOrEmpty(path)) return false;
            if (path.Length >= 3 &&
                ((path[0] >= 'A' && path[0] <= 'Z') || (path[0] >= 'a' && path[0] <= 'z')) &&
                path[1] == ':' && IsDirectorySeparator(path[2])) return true;

            if (path.Length < 5 || !IsDirectorySeparator(path[0]) || !IsDirectorySeparator(path[1])) return false;
            int serverEnd = path.IndexOfAny(new[] { '\\', '/' }, 2);
            if (serverEnd <= 2) return false;
            int shareStart = serverEnd + 1;
            if (shareStart >= path.Length || IsDirectorySeparator(path[shareStart])) return false;
            int shareEnd = path.IndexOfAny(new[] { '\\', '/' }, shareStart);
            return shareEnd < 0 || shareEnd > shareStart;
        }

        static bool IsDirectorySeparator(char value)
        {
            return value == '\\' || value == '/';
        }

        public static string Hash(string value)
        {
            using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(value))).Replace("-", "").ToLowerInvariant();
        }

        public static string ChromeAppId(int port)
        {
            if (port < 1 || port > 65535) throw new LauncherFailure("invalid-port", "Invalid PWA port.");
            // Chromium hashes the absolute manifest ID twice, takes 16 bytes, then encodes a-p.
            // GraphGoblin's manifest id and start_url are /app/; only IPv4 loopback is supported.
            using (var sha = SHA256.Create())
            {
                byte[] bytes = sha.ComputeHash(sha.ComputeHash(Encoding.UTF8.GetBytes("http://127.0.0.1:" + port + "/app/")));
                var result = new StringBuilder();
                for (int i = 0; i < 16; i++) result.Append((char)('a' + (bytes[i] >> 4))).Append((char)('a' + (bytes[i] & 15)));
                return result.ToString();
            }
        }

        // Windows CommandLineToArgvW / CRT quoting, including trailing slashes and embedded quotes.
        public static string Quote(string value)
        {
            var result = new StringBuilder("\"");
            int slashes = 0;
            foreach (char ch in value)
            {
                if (ch == '\\') { slashes++; continue; }
                if (ch == '"') result.Append('\\', slashes * 2 + 1);
                else result.Append('\\', slashes);
                result.Append(ch); slashes = 0;
            }
            return result.Append('\\', slashes * 2).Append('"').ToString();
        }
    }

    /// <summary>
    /// Internal managed-gateway exits before readiness (#438). The public --ensure-gateway
    /// refusal remains exit 1; these only select closed operator guidance.
    /// </summary>
    public static class StartupOutcome
    {
        public const int DestinationInUse = 70, DestinationUnavailable = 71,
            ImportFailedWritten = 72, ImportFailedUnwritten = 73,
            StartupFailedWritten = 74, StartupFailedUnwritten = 75;

        /// <summary>
        /// Child exit 70 (log reservation unavailable) or the parent's sharing violation on
        /// gateway.log. Neither identifies the holder, so the guidance is conditional.
        /// </summary>
        public static LauncherFailure DestinationInUseFailure(string logFolder, int childExit)
        {
            return new LauncherFailure("destination-in-use",
                "GraphGoblin could not start because its log folder is in use: another process holds the folder's log reservation or has gateway.log open, and that process was not identified. If it is a GraphGoblin gateway, possibly an older version still running, shut it down deliberately; otherwise close the program holding the folder or its log. Launch again once it is released. No process was stopped and no gateway log file was changed.",
                logFolder, null, childExit);
        }

        public static LauncherFailure DestinationUnavailableFailure(string logFolder, int childExit)
        {
            return new LauncherFailure("destination-unavailable",
                "GraphGoblin could not start because its log folder is unsafe or unavailable. Use a local NTFS folder that only your account, SYSTEM and Administrators can access, where gateway.log and gateway.log.1 are ordinary files you own (not links). Refused files were left unchanged.",
                logFolder, null, childExit);
        }

        public static LauncherFailure ForChildExit(int code, string logFolder)
        {
            switch (code)
            {
                case DestinationInUse: return DestinationInUseFailure(logFolder, code);
                case DestinationUnavailable: return DestinationUnavailableFailure(logFolder, code);
                case ImportFailedWritten:
                    return new LauncherFailure("import-failed-logged", "GraphGoblin could not load its application modules. A startup diagnostic was written to gateway.log in the log folder. Rebuild the checkout with Node 22 (pnpm install, then pnpm build) and launch again.", logFolder, null, code);
                case ImportFailedUnwritten:
                    return new LauncherFailure("import-failed-unlogged", "GraphGoblin could not load its application modules, and no startup diagnostic could be written. Rebuild the checkout with Node 22 (pnpm install, then pnpm build) and launch again.", logFolder, null, code);
                case StartupFailedWritten:
                    return new LauncherFailure("startup-failed-logged", "GraphGoblin failed during startup. A startup diagnostic naming the failed stage was written to gateway.log in the log folder. Existing store locks and data were left to the gateway's normal ownership checks.", logFolder, null, code);
                case StartupFailedUnwritten:
                    return new LauncherFailure("startup-failed-unlogged", "GraphGoblin failed during startup, and no startup diagnostic could be written. Run node apps\\api\\dist\\main.js from the checkout in a terminal to see the error. Existing store locks and data were left to the gateway's normal ownership checks.", logFolder, null, code);
                default:
                    return new LauncherFailure("unknown-exit", "GraphGoblin exited during startup with an unrecognized status (exit code " + code.ToString(CultureInfo.InvariantCulture) + "). No startup diagnostic can be assumed. Run node apps\\api\\dist\\main.js from the checkout in a terminal to see the error.", logFolder, null, code);
            }
        }
    }

    /// <summary>Kernel file operations on validated handles. Names are never followed blindly.</summary>
    public static class NativeFiles
    {
        public const uint GenericRead = 0x80000000, GenericWrite = 0x40000000, ReadControl = 0x20000, ReadAttributes = 0x80;
        public const uint ShareRead = 1, ShareWrite = 2, ShareDelete = 4;
        public const uint CreateNew = 1, OpenExisting = 3;
        public const uint BackupSemantics = 0x02000000, OpenReparsePoint = 0x00200000;
        public const int SharingViolation = 32;
        const uint Directory = 0x10, Device = 0x40, ReparsePoint = 0x400;

        [StructLayout(LayoutKind.Sequential)]
        struct FileInformation
        {
            public uint Attributes, CreationLow, CreationHigh, AccessLow, AccessHigh,
                WriteLow, WriteHigh, Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
        }
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern SafeFileHandle CreateFile(string path, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool GetFileInformationByHandle(SafeFileHandle handle, out FileInformation information);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern uint GetFinalPathNameByHandle(SafeFileHandle handle, StringBuilder path, uint size, uint flags);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern uint GetFileAttributes(string path);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern bool MoveFileEx(string from, string to, uint flags);

        /// <summary>Identity and kind of an opened handle.</summary>
        public sealed class Identity
        {
            public uint Volume, Attributes, Links;
            public ulong Index;
            public long Size;
            public bool Same(Identity other) { return other != null && Volume == other.Volume && Index == other.Index; }
            public bool SafeRegular { get { return (Attributes & (Directory | Device | ReparsePoint)) == 0 && Links == 1; } }
        }

        public static SafeFileHandle Open(string path, uint access, uint share, uint disposition, uint flags)
        {
            return CreateFile(path, access, share, IntPtr.Zero, disposition, flags, IntPtr.Zero);
        }

        public static Identity Describe(SafeFileHandle handle)
        {
            FileInformation information;
            if (!GetFileInformationByHandle(handle, out information)) throw new System.ComponentModel.Win32Exception();
            return new Identity {
                Volume = information.Volume, Attributes = information.Attributes, Links = information.Links,
                Index = ((ulong)information.IndexHigh << 32) | information.IndexLow,
                Size = ((long)information.SizeHigh << 32) | information.SizeLow
            };
        }

        public static string FinalPath(SafeFileHandle handle)
        {
            var output = new StringBuilder(32768);
            uint length = GetFinalPathNameByHandle(handle, output, (uint)output.Capacity, 0);
            if (length == 0 || length >= output.Capacity) throw new System.ComponentModel.Win32Exception();
            string resolved = output.ToString();
            if (resolved.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase)) return @"\\" + resolved.Substring(8);
            return resolved.StartsWith(@"\\?\", StringComparison.Ordinal) ? resolved.Substring(4) : resolved;
        }

        /// <summary>Attributes of the name itself, without following a link; null when absent.</summary>
        public static uint? NameAttributes(string path)
        {
            uint attributes = GetFileAttributes(path);
            if (attributes != uint.MaxValue) return attributes;
            int error = Marshal.GetLastWin32Error();
            if (error == 2 || error == 3) return null;
            throw new System.ComponentModel.Win32Exception(error);
        }

        public static bool IsUnsafeName(uint attributes)
        {
            return (attributes & (Directory | Device | ReparsePoint)) != 0;
        }

        public static void ReplaceMove(string from, string to)
        {
            if (!MoveFileEx(from, to, 1)) throw new System.ComponentModel.Win32Exception();
        }
    }

    /// <summary>
    /// A private canonical physical log root: a local NTFS directory owned by and accessible only to
    /// the operator, SYSTEM, Administrators or TrustedInstaller, keyed by its volume and file index.
    /// </summary>
    public sealed class LogRoot
    {
        public string Path;
        public uint Volume;
        public ulong Index;

        static readonly string[] TrustedOwners = { "S-1-5-18", "S-1-5-32-544", "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464" };
        static readonly string[] TrustedPrincipals = { "S-1-5-18", "S-1-5-32-544", "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464", "S-1-3-0", "S-1-3-4" };

        /// <summary>Hex key for a root identity; the gateway pipe and launcher mutex use separate prefixes.</summary>
        public string Key(string purpose)
        {
            return Program.Hash(purpose + "\0dev=" + Volume.ToString(CultureInfo.InvariantCulture) + "\0ino=" + Index.ToString(CultureInfo.InvariantCulture)).Substring(0, 40);
        }

        public string GatewayPipe { get { return @"\\.\pipe\GraphGoblin.GatewayLog." + Key("graphgoblin-gateway-log-root/v1"); } }
        public string LauncherMutex { get { return @"Global\GraphGoblin.LauncherLog." + Key("graphgoblin-launcher-log-root/v1"); } }

        /// <summary>Resolve aliases and validate privacy. Throws for an unsafe or unavailable root.</summary>
        public static LogRoot Admit(string directory)
        {
            var root = new LogRoot();
            using (var handle = NativeFiles.Open(directory, NativeFiles.ReadAttributes, 7, NativeFiles.OpenExisting, NativeFiles.BackupSemantics))
            {
                if (handle.IsInvalid) throw new IOException("log root unavailable");
                var identity = NativeFiles.Describe(handle);
                if ((identity.Attributes & 0x410) != 0x10 || identity.Index == 0) throw new IOException("log root is not a directory");
                root.Path = NativeFiles.FinalPath(handle);
                root.Volume = identity.Volume;
                root.Index = identity.Index;
            }
            if (!System.Text.RegularExpressions.Regex.IsMatch(root.Path, @"^[A-Za-z]:\\") || root.Path.Length > 1024)
                throw new IOException("log root is not local");
            var drive = new DriveInfo(System.IO.Path.GetPathRoot(root.Path));
            if (drive.DriveType != DriveType.Fixed || drive.DriveFormat != "NTFS") throw new IOException("unsupported log volume");
            if (!Private(Directory.GetAccessControl(root.Path))) throw new IOException("log root is not private");
            return root;
        }

        static bool Private(FileSystemSecurity security)
        {
            string user = WindowsIdentity.GetCurrent().User.Value;
            if (security.GetSecurityDescriptorSddlForm(AccessControlSections.Access).Contains("NO_ACCESS_CONTROL")) return false;
            var owner = security.GetOwner(typeof(SecurityIdentifier));
            if (owner == null || (owner.Value != user && !TrustedOwners.Contains(owner.Value))) return false;
            foreach (FileSystemAccessRule rule in security.GetAccessRules(true, true, typeof(SecurityIdentifier)))
                if (rule.AccessControlType == AccessControlType.Allow && rule.IdentityReference.Value != user && !TrustedPrincipals.Contains(rule.IdentityReference.Value))
                    return false;
            return true;
        }

        /// <summary>
        /// Validate one exact managed name without following it. Null when absent. Throws for a
        /// reparse point, directory, device, extra link, foreign or unverifiable entry.
        /// </summary>
        public NativeFiles.Identity Entry(string name)
        {
            string path = System.IO.Path.Combine(Path, name);
            uint? attributes = NativeFiles.NameAttributes(path);
            if (attributes == null) return null;
            if (NativeFiles.IsUnsafeName(attributes.Value)) throw new IOException("unsafe managed name");
            NativeFiles.Identity identity;
            using (var handle = NativeFiles.Open(path, NativeFiles.ReadAttributes | NativeFiles.ReadControl, 7, NativeFiles.OpenExisting, NativeFiles.OpenReparsePoint))
            {
                if (handle.IsInvalid) throw new IOException("managed name unavailable");
                identity = NativeFiles.Describe(handle);
            }
            if (!identity.SafeRegular || identity.Volume != Volume) throw new IOException("unsafe managed name");
            if (!Private(File.GetAccessControl(path))) throw new IOException("foreign managed name");
            return identity;
        }
    }

    /// <summary>
    /// Native launcher.log and launcher.log.1: 256 KiB each, complete UTF-8 records of at most
    /// 4 KiB, written only under one bounded acquisition of a cross-session mutex keyed by the
    /// canonical physical root. Any contention, unsafe entry or I/O fault drops the record;
    /// stderr and the dialog remain the operator's fallback.
    /// </summary>
    public static class LauncherLog
    {
        public const int SlotBytes = 262144, RecordBytes = 4096;
        public const string Active = "launcher.log", Previous = "launcher.log.1";
        public static readonly TimeSpan MutexWait = TimeSpan.FromMilliseconds(250);

        /// <summary>Build one closed JSON record; locations are dropped, then the record, if oversized.</summary>
        public static byte[] Build(DateTime time, int pid, Exception error, string stage, string configFile)
        {
            var failure = error as LauncherFailure;
            string code = failure != null ? failure.Code : error is ConfigurationRefusal ? "configuration-refused" : "unexpected";
            string message = failure != null || error is ConfigurationRefusal ? error.Message : "unexpected launcher error";
            var json = new JavaScriptSerializer();
            for (int detail = 1; detail >= 0; detail--)
            {
                var record = new StringBuilder();
                record.Append("{\"time\":").Append(json.Serialize(time.ToUniversalTime().ToString("o", CultureInfo.InvariantCulture)))
                    .Append(",\"pid\":").Append(pid.ToString(CultureInfo.InvariantCulture))
                    .Append(",\"outcome\":\"refused\",\"stage\":").Append(json.Serialize(stage))
                    .Append(",\"code\":").Append(json.Serialize(code));
                if (failure != null && failure.ChildExit != 0) record.Append(",\"childExit\":").Append(failure.ChildExit.ToString(CultureInfo.InvariantCulture));
                record.Append(",\"message\":").Append(json.Serialize(message));
                if (detail == 1)
                {
                    record.Append(",\"config\":").Append(json.Serialize(Program.RenderPath(Program.FullPathOrNull(configFile))));
                    if (failure != null && failure.LogFolder != null) record.Append(",\"logFolder\":").Append(json.Serialize(Program.RenderPath(failure.LogFolder)));
                    if (failure != null && failure.Lock != null) record.Append(",\"lock\":").Append(json.Serialize(Program.RenderPath(failure.Lock)));
                }
                byte[] bytes = new UTF8Encoding(false).GetBytes(record.Append("}\n").ToString());
                if (bytes.Length <= RecordBytes) return bytes;
            }
            return null;
        }

        /// <summary>Best effort. Never throws and never blocks longer than one bounded mutex wait.</summary>
        public static void Record(string configFile, Exception error, string stage)
        {
            try
            {
                string directory = Path.GetDirectoryName(Path.GetFullPath(configFile));
                byte[] record = Build(DateTime.UtcNow, Process.GetCurrentProcess().Id, error, stage, configFile);
                if (record == null) return;
                Append(LogRoot.Admit(directory), record);
            }
            catch (Exception) { }
        }

        /// <summary>Append one record under the root mutex. Returns false when the record was dropped.</summary>
        public static bool Append(LogRoot root, byte[] record)
        {
            if (record == null || record.Length > RecordBytes || record[record.Length - 1] != (byte)'\n') return false;
            using (var mutex = new Mutex(false, root.LauncherMutex))
            {
                bool owned = false;
                try
                {
                    try { owned = mutex.WaitOne(MutexWait); } catch (AbandonedMutexException) { owned = true; }
                    if (!owned) return false;
                    return AppendOwned(root, record);
                }
                catch (Exception) { return false; }
                finally { if (owned) mutex.ReleaseMutex(); }
            }
        }

        static FileStream OpenSlot(LogRoot root, string name, bool create, NativeFiles.Identity expected)
        {
            string path = Path.Combine(root.Path, name);
            var handle = NativeFiles.Open(path, NativeFiles.GenericRead | NativeFiles.GenericWrite, NativeFiles.ShareRead,
                create ? NativeFiles.CreateNew : NativeFiles.OpenExisting, NativeFiles.OpenReparsePoint);
            if (handle.IsInvalid) throw new IOException("slot unavailable");
            try
            {
                var opened = NativeFiles.Describe(handle);
                if (!opened.SafeRegular || opened.Volume != root.Volume || (expected != null && !opened.Same(expected)) || (create && opened.Size != 0))
                    throw new IOException("slot identity changed");
                return new FileStream(handle, FileAccess.ReadWrite, 1);
            }
            catch { handle.Dispose(); throw; }
        }

        /// <summary>Last complete-record boundary at or before the end, scanning back in 4 KiB chunks.</summary>
        static long CompleteBoundary(FileStream stream)
        {
            long end = stream.Length;
            if (end == 0) return 0;
            var last = new byte[1];
            stream.Seek(end - 1, SeekOrigin.Begin);
            if (stream.Read(last, 0, 1) == 1 && last[0] == (byte)'\n') return end;
            var chunk = new byte[RecordBytes];
            while (end > 0)
            {
                long start = Math.Max(0, end - chunk.Length);
                stream.Seek(start, SeekOrigin.Begin);
                int length = (int)(end - start), read = 0, count;
                while (read < length && (count = stream.Read(chunk, read, length - read)) > 0) read += count;
                for (int index = read - 1; index >= 0; index--) if (chunk[index] == (byte)'\n') return start + index + 1;
                end = start;
            }
            return 0;
        }

        static bool AppendOwned(LogRoot root, byte[] record)
        {
            var activeEntry = root.Entry(Active);
            var previousEntry = root.Entry(Previous);
            if (previousEntry != null && previousEntry.Size > SlotBytes)
                using (var previous = OpenSlot(root, Previous, false, previousEntry)) { previous.SetLength(0); }
            var stream = OpenSlot(root, Active, activeEntry == null, activeEntry);
            try
            {
                long size = stream.Length;
                // Oversized history from the unbounded append-only launcher is replaced, never extended.
                if (size > SlotBytes) { stream.SetLength(0); size = 0; }
                long boundary = CompleteBoundary(stream);
                if (boundary != size) { stream.SetLength(boundary); size = boundary; }
                if (size + record.Length > SlotBytes)
                {
                    var activeIdentity = NativeFiles.Describe(stream.SafeFileHandle);
                    stream.Dispose(); stream = null;
                    var currentPrevious = root.Entry(Previous);
                    if ((previousEntry == null) != (currentPrevious == null) || (previousEntry != null && !previousEntry.Same(currentPrevious)))
                        return false;
                    var currentActive = root.Entry(Active);
                    if (currentActive == null || !currentActive.Same(activeIdentity)) return false;
                    // Close, rename-replace onto previous and recreate at the fixed name. No staging.
                    NativeFiles.ReplaceMove(Path.Combine(root.Path, Active), Path.Combine(root.Path, Previous));
                    stream = OpenSlot(root, Active, true, null);
                    size = 0;
                }
                stream.Seek(size, SeekOrigin.Begin);
                try
                {
                    stream.Write(record, 0, record.Length);
                    stream.Flush();
                }
                catch (IOException)
                {
                    // Roll back to the last complete boundary; a failed rollback leaves the next
                    // writer's tail repair to restore it.
                    try { stream.SetLength(size); } catch (IOException) { }
                    return false;
                }
                return true;
            }
            finally { if (stream != null) stream.Dispose(); }
        }
    }

    /// <summary>
    /// A read-only helper owns a private, non-breakaway job from its first instruction. Neither
    /// a PID from a lock nor the independent gateway ever enters this lifetime boundary.
    /// </summary>
    public static class HelperProcess
    {
        public const int WorkMilliseconds = 15000, CleanupMilliseconds = 2000, OutputBytes = 262144;
        public const uint TerminationExit = 0xE0470459;
        const int Pending = 997, Incomplete = 996, BrokenPipe = 109, PipeConnected = 535;

        [StructLayout(LayoutKind.Sequential)] struct SecurityAttributes { public int size; public IntPtr descriptor; public int inherit; }
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct StartupInfo {
            public int cb; public string reserved, desktop, title; public int x, y, xSize, ySize, xCount, yCount, fill, flags;
            public short show, reservedBytes; public IntPtr reservedPointer, input, output, error;
        }
        [StructLayout(LayoutKind.Sequential)] struct StartupInfoEx { public StartupInfo startup; public IntPtr attributes; }
        [StructLayout(LayoutKind.Sequential)] struct ProcessInformation { public IntPtr process, thread; public int pid, tid; }
        [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
            public long processTime, jobTime; public uint flags; public UIntPtr minimum, maximum; public uint active;
            public UIntPtr affinity; public uint priority, scheduling;
        }
        [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong a, b, c, d, e, f; }
        [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {
            public BasicLimits basic; public IoCounters io; public UIntPtr processMemory, jobMemory, peakProcess, peakJob;
        }
        [StructLayout(LayoutKind.Sequential)] struct Accounting {
            public long a, b, c, d; public uint faults, total, active, terminated;
        }
        [StructLayout(LayoutKind.Sequential)] struct Overlapped {
            public IntPtr internalStatus, transferred; public uint offset, offsetHigh; public IntPtr signal;
        }
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern SafeFileHandle CreateJobObject(IntPtr security, string name);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(SafeFileHandle job, int kind, ref ExtendedLimits limits, uint size);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool QueryInformationJobObject(SafeFileHandle job, int kind, out Accounting accounting, uint size, IntPtr returned);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateJobObject(SafeFileHandle job, uint code);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CreateProcess(string app, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string directory, ref StartupInfoEx startup, out ProcessInformation process);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
        [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetHandleInformation(SafeFileHandle handle, uint mask, uint flags);
        [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern SafeFileHandle CreateNamedPipe(string name, uint open, uint mode, uint instances, uint output, uint input, uint timeout, ref SecurityAttributes security);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool ConnectNamedPipe(SafeFileHandle pipe, IntPtr overlapped);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetNamedPipeClientProcessId(SafeFileHandle pipe, out uint pid);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool ReadFile(SafeFileHandle pipe, IntPtr buffer, uint size, out uint read, IntPtr overlapped);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetOverlappedResult(SafeFileHandle pipe, IntPtr overlapped, out uint read, bool wait);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool CancelIoEx(SafeFileHandle pipe, IntPtr overlapped);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateEvent(IntPtr security, bool manual, bool initial, string name);
        [DllImport("kernel32.dll")] static extern bool ResetEvent(IntPtr signal);
        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(string text, uint revision, out IntPtr descriptor, out uint size);
        [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr value);

        static LauncherFailure Containment() { return new LauncherFailure("helper-containment", "Windows could not start an isolated launcher check. Verify the configured runtime and the host's job policy. Windows 10 or Windows Server 2016 or later with compatible nested jobs is required. No gateway was started."); }
        static LauncherFailure Invalid() { return new LauncherFailure("helper-invalid", "The read-only launcher check returned an invalid or oversized response. No gateway was started."); }
        static SafeFileHandle NewJob()
        {
            SafeFileHandle job = CreateJobObject(IntPtr.Zero, null);
            if (job.IsInvalid) { job.Dispose(); throw Containment(); }
            var limits = new ExtendedLimits { basic = new BasicLimits { flags = 0x2000 } }; // KILL_ON_JOB_CLOSE, no breakaway
            if (!SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimits)))) { job.Dispose(); throw Containment(); }
            return job;
        }
        static bool Empty(SafeFileHandle job)
        {
            Accounting accounting;
            return QueryInformationJobObject(job, 1, out accounting, (uint)Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero) && accounting.active == 0;
        }

        /// <summary>Backing memory must outlive both updates and the one CreateProcess call.</summary>
        sealed class Attributes : IDisposable
        {
            public IntPtr List; IntPtr jobs, handles; bool initialized;
            public Attributes(SafeFileHandle job, SafeFileHandle input, SafeFileHandle output, SafeFileHandle error)
            {
                try {
                    IntPtr size = IntPtr.Zero;
                    InitializeProcThreadAttributeList(IntPtr.Zero, 2, 0, ref size);
                    if (size == IntPtr.Zero) throw Containment();
                    List = Marshal.AllocHGlobal(size);
                    if (!InitializeProcThreadAttributeList(List, 2, 0, ref size)) throw Containment();
                    initialized = true;
                    jobs = Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(jobs, job.DangerousGetHandle());
                    if (!UpdateProcThreadAttribute(List, 0, new IntPtr(0x2000D), jobs, new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero)) throw Containment();
                    if (input != null) {
                        handles = Marshal.AllocHGlobal(IntPtr.Size * 3);
                        var stdio = new[] { input, output, error };
                        for (int i = 0; i < stdio.Length; i++) {
                            if (!SetHandleInformation(stdio[i], 1, 1)) throw Containment();
                            Marshal.WriteIntPtr(handles, i * IntPtr.Size, stdio[i].DangerousGetHandle());
                        }
                        if (!UpdateProcThreadAttribute(List, 0, new IntPtr(0x20002), handles, new IntPtr(IntPtr.Size * 3), IntPtr.Zero, IntPtr.Zero)) throw Containment();
                    }
                } catch { Dispose(); throw; }
            }
            public void Dispose() {
                if (initialized) { DeleteProcThreadAttributeList(List); initialized = false; }
                if (List != IntPtr.Zero) { Marshal.FreeHGlobal(List); List = IntPtr.Zero; }
                if (jobs != IntPtr.Zero) { Marshal.FreeHGlobal(jobs); jobs = IntPtr.Zero; }
                if (handles != IntPtr.Zero) { Marshal.FreeHGlobal(handles); handles = IntPtr.Zero; }
            }
        }

        /// <summary>Installer capability preflight; actual host containment is checked on every click.</summary>
        public static void CheckCapability()
        {
            try { using (var job = NewJob()) using (var attributes = new Attributes(job, null, null, null)) { } }
            catch (EntryPointNotFoundException) { throw Containment(); }
        }

        /// <summary>One unmanaged buffer and one operation. No resource is freed before completion.</summary>
        sealed class Pipe : IDisposable
        {
            const int BufferBytes = 8192;
            SafeFileHandle reader; public SafeFileHandle Writer;
            IntPtr buffer, operation, signal;
            readonly byte[] bytes = new byte[BufferBytes]; GCHandle pin;
            bool pending; public bool Eof;
            public Pipe()
            {
                IntPtr descriptor = IntPtr.Zero;
                try {
                    uint size;
                    string sid;
                    using (var identity = WindowsIdentity.GetCurrent()) sid = identity.User.Value;
                    if (!ConvertStringSecurityDescriptorToSecurityDescriptor("D:P(A;;GA;;;" + sid + ")", 1, out descriptor, out size)) throw Containment();
                    var security = new SecurityAttributes { size = Marshal.SizeOf(typeof(SecurityAttributes)), descriptor = descriptor };
                    string name = @"\\.\pipe\GraphGoblin.Check." + Guid.NewGuid().ToString("N");
                    reader = CreateNamedPipe(name, 0x40080001, 8, 1, BufferBytes, BufferBytes, 0, ref security);
                    if (reader.IsInvalid) throw Containment();
                    signal = CreateEvent(IntPtr.Zero, true, false, null);
                    if (signal == IntPtr.Zero) throw Containment();
                    pin = GCHandle.Alloc(bytes, GCHandleType.Pinned); buffer = pin.AddrOfPinnedObject();
                    operation = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(Overlapped)));
                    ResetOperation();
                    // Our blocking writer connects before the server acknowledges it. A remote
                    // client is rejected, and a local name race is refused by exact client identity.
                    Writer = CreateFile(name, 0x40000000, 0, IntPtr.Zero, 3, 0, IntPtr.Zero);
                    if (Writer.IsInvalid) throw Containment();
                    if (!ConnectNamedPipe(reader, operation)) {
                        int code = Marshal.GetLastWin32Error();
                        if (code == Pending) pending = true;
                        if (code != PipeConnected) throw Containment();
                    }
                    uint pid;
                    if (!GetNamedPipeClientProcessId(reader, out pid) || pid != (uint)Process.GetCurrentProcess().Id) throw Containment();
                } catch {
                    Cancel();
                    if (!Complete()) TransferCompletion(); else Dispose();
                    throw;
                } finally { if (descriptor != IntPtr.Zero) LocalFree(descriptor); }
            }
            void ResetOperation() {
                ResetEvent(signal);
                Marshal.StructureToPtr(new Overlapped { signal = signal }, operation, false);
            }
            public void CloseWriter() { if (Writer != null) { Writer.Dispose(); Writer = null; } }
            public void Drain(MemoryStream retained)
            {
                if (Eof) return;
                uint count;
                bool done;
                if (pending) {
                    done = GetOverlappedResult(reader, operation, out count, false);
                    int code = done ? 0 : Marshal.GetLastWin32Error();
                    if (!done && code == Incomplete) return;
                    pending = false;
                    if (!done) { if (code == BrokenPipe || code == 232) { Eof = true; return; } throw Invalid(); }
                } else {
                    ResetOperation();
                    done = ReadFile(reader, buffer, BufferBytes, out count, operation);
                    if (!done) {
                        int code = Marshal.GetLastWin32Error();
                        if (code == Pending) { pending = true; return; }
                        if (code == BrokenPipe || code == 232) { Eof = true; return; }
                        throw Invalid();
                    }
                }
                if (count == 0) { Eof = true; return; }
                if (retained != null) {
                    if (retained.Length + count > OutputBytes) throw Invalid();
                    retained.Write(bytes, 0, (int)count);
                }
            }
            public void Cancel() { if (pending) CancelIoEx(reader, operation); }
            public bool Complete() {
                if (!pending) return true;
                uint count;
                bool done = GetOverlappedResult(reader, operation, out count, false);
                if (!done && Marshal.GetLastWin32Error() == Incomplete) return false;
                pending = false; return true;
            }
            public void TransferCompletion() {
                // The completion owner retains the SafeHandle, OVERLAPPED, event and buffer.
                // CancelIoEx returning ERROR_NOT_FOUND is never treated as completion proof.
                ThreadPool.QueueUserWorkItem(delegate {
                    uint count; GetOverlappedResult(reader, operation, out count, true);
                    pending = false; Dispose();
                });
            }
            public void Dispose() {
                if (pending) throw new InvalidOperationException("pending pipe operation");
                CloseWriter();
                if (reader != null) { reader.Dispose(); reader = null; }
                if (signal != IntPtr.Zero) { CloseHandle(signal); signal = IntPtr.Zero; }
                if (operation != IntPtr.Zero) { Marshal.FreeHGlobal(operation); operation = IntPtr.Zero; }
                if (pin.IsAllocated) { pin.Free(); buffer = IntPtr.Zero; }
            }
        }

        /// <summary>The validator runs inside the work window, before the already-empty job closes.</summary>
        public static string Read(string executable, string arguments, string directory, SortedDictionary<string, string> environment, string stage, int workMilliseconds, Func<string, bool> validate)
        {
            var clock = Stopwatch.StartNew();
            SafeFileHandle job = null; Pipe output = null, error = null; ChildProcess child = null;
            LauncherFailure failure = null; bool success = false, exited = false; int exitCode = 0; string result = null;
            try {
                job = NewJob(); output = new Pipe(); error = new Pipe();
                using (var input = CreateFile("NUL", 0x80000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero))
                using (var attributes = new Attributes(job, input, output.Writer, error.Writer)) {
                    if (input.IsInvalid) throw Containment();
                    if (clock.ElapsedMilliseconds >= workMilliseconds) throw Timeout(stage);
                    IntPtr block = Marshal.StringToHGlobalUni(string.Join("\0", environment.Select(item => item.Key + "=" + item.Value)) + "\0\0");
                    try {
                        var startup = new StartupInfoEx { attributes = attributes.List, startup = new StartupInfo {
                            cb = Marshal.SizeOf(typeof(StartupInfoEx)), flags = 0x100, input = input.DangerousGetHandle(), output = output.Writer.DangerousGetHandle(), error = error.Writer.DangerousGetHandle() } };
                        ProcessInformation created;
                        if (!CreateProcess(executable, new StringBuilder(Program.Quote(executable) + " " + arguments), IntPtr.Zero, IntPtr.Zero, true, 0x08080400, block, directory, ref startup, out created)) {
                            int code = Marshal.GetLastWin32Error();
                            if (code == 2 || code == 3 || code == 193 || code == 216) throw new LauncherFailure("helper-unavailable", "The configured Node runtime could not be started. Check the Node path in the launcher configuration.");
                            throw Containment();
                        }
                        child = new ChildProcess(created.pid, created.process); CloseHandle(created.thread);
                    } finally { Marshal.FreeHGlobal(block); }
                }
                output.CloseWriter(); error.CloseWriter();
                using (var retained = new MemoryStream()) {
                    while (true) {
                        if (clock.ElapsedMilliseconds >= workMilliseconds) throw Timeout(stage);
                        if (!exited && child.TryGetExit(out exitCode)) { exited = true; child.Dispose(); child = null; }
                        output.Drain(retained);
                        if (clock.ElapsedMilliseconds >= workMilliseconds) throw Timeout(stage);
                        error.Drain(null);
                        if (!exited && child.TryGetExit(out exitCode)) { exited = true; child.Dispose(); child = null; }
                        if (exited && output.Eof && error.Eof && Empty(job)) {
                            if (clock.ElapsedMilliseconds >= workMilliseconds) throw Timeout(stage);
                            if (exitCode != 0) throw Refused(exitCode);
                            try { result = new UTF8Encoding(false, true).GetString(retained.GetBuffer(), 0, (int)retained.Length).Trim(); }
                            catch (DecoderFallbackException) { throw Invalid(); }
                            bool valid;
                            try { valid = validate(result); } catch (Exception) { valid = false; }
                            if (clock.ElapsedMilliseconds >= workMilliseconds) throw Timeout(stage);
                            if (!valid) throw Invalid();
                            success = true; break;
                        }
                        // Fair bounded chunks even under a perpetual flood on either stream.
                        Thread.Sleep(1);
                    }
                }
            }
            catch (LauncherFailure refused) {
                failure = refused;
                if (refused.Code == "helper-invalid") {
                    if (clock.ElapsedMilliseconds >= workMilliseconds) failure = Timeout(stage);
                    else if (exited && exitCode != 0) failure = Refused(exitCode);
                }
            }
            catch (EntryPointNotFoundException) { failure = Containment(); }
            catch (Exception) { failure = Invalid(); }
            finally {
                // This finally finishes before the caller releases mutexes, logs or shows a dialog.
                bool confirmed = true;
                if (!success && job != null) {
                    var cleanup = Stopwatch.StartNew();
                    TerminateJobObject(job, TerminationExit);
                    if (output != null) { output.CloseWriter(); output.Cancel(); }
                    if (error != null) { error.CloseWriter(); error.Cancel(); }
                    while (true) {
                        int ignored;
                        if (child != null && child.TryGetExit(out ignored)) { child.Dispose(); child = null; }
                        bool outputDone = output == null || output.Complete();
                        bool errorDone = error == null || error.Complete();
                        confirmed = child == null && Empty(job) && outputDone && errorDone;
                        if (confirmed || cleanup.ElapsedMilliseconds >= CleanupMilliseconds) break;
                        Thread.Sleep(1);
                    }
                }
                if (job != null) job.Dispose(); // last handle also kills any member on unconfirmed cleanup
                if (child != null) child.Dispose();
                foreach (var pipe in new[] { output, error }) if (pipe != null) {
                    if (pipe.Complete()) pipe.Dispose(); else pipe.TransferCompletion();
                }
                if (!confirmed) failure = new LauncherFailure("helper-cleanup-unconfirmed", "Windows could not confirm that all processes for this launcher check stopped. No gateway was started.");
            }
            if (failure != null) throw failure;
            return result;
        }
        static LauncherFailure Timeout(string stage) { return new LauncherFailure("helper-timeout", "The read-only " + stage + " check exceeded its work budget. Check PowerShell and Windows Management Instrumentation availability. No gateway was started."); }
        static LauncherFailure Refused(int code) { return new LauncherFailure("helper-refused", "The Node 22 runtime, launcher configuration or store ownership could not be checked. Check the configured runtime, GG_* overrides and read permissions on the store's lock files.", null, null, code); }
    }

    public sealed class Gateway
    {
        readonly Configuration config;
        readonly string logDirectory;
        readonly string log;
        readonly string origin;
        string expected;
        int? spawnedPid;
        bool closing;
        public Gateway(Configuration configuration, string directory)
        {
            config = configuration;
            logDirectory = directory;
            log = Path.Combine(directory, "gateway.log");
            origin = "http://127.0.0.1:" + config.Port;
        }

        string ReadHelper(string argument, string stage, int workMilliseconds, Func<string, bool> validate)
        {
            return HelperProcess.Read(config.Node, Program.Quote(Path.Combine(config.Repo, "apps/api/dist/instance-identity.js")) + argument,
                config.Repo, config.ChildEnvironment(), stage, workMilliseconds, validate);
        }

        bool Listening()
        {
            using (var client = new TcpClient(AddressFamily.InterNetwork))
            {
                // Per-socket fast local refusal, where supported. Older Windows falls back to
                // the normal handshake timeout; no machine or TCP stack setting is changed.
                try { client.Client.IOControl(unchecked((int)0x98000011), new byte[] { 255, 255, 254, 0 }, null); }
                catch (SocketException) { }
                catch (NotSupportedException) { }
                try
                {
                    var pending = client.ConnectAsync(IPAddress.Loopback, config.Port);
                    if (!pending.Wait(3500)) throw new LauncherFailure("port-unknown", "Could not establish whether port " + config.Port + " is free. No gateway was started; try again when local networking responds.");
                    if (client.Connected) return true;
                    throw new LauncherFailure("port-unknown", "The local port check had no confirmed outcome. No gateway was started.");
                }
                catch (AggregateException error)
                {
                    var socket = error.GetBaseException() as SocketException;
                    if (socket != null && socket.SocketErrorCode == SocketError.ConnectionRefused) return false;
                    throw new LauncherFailure("port-unknown", "Could not establish whether port " + config.Port + " is free. No gateway was started.");
                }
                catch (SocketException error)
                {
                    if (error.SocketErrorCode == SocketError.ConnectionRefused) return false;
                    throw new LauncherFailure("port-unknown", "Could not establish whether port " + config.Port + " is free. No gateway was started.");
                }
            }
        }

        HttpWebResponse Get(string path)
        {
            var request = (HttpWebRequest)WebRequest.Create(origin + path);
            request.Proxy = null; request.AllowAutoRedirect = false;
            request.KeepAlive = false;
            request.CachePolicy = new System.Net.Cache.RequestCachePolicy(System.Net.Cache.RequestCacheLevel.NoCacheNoStore);
            request.Timeout = 1500; request.ReadWriteTimeout = 1500;
            return (HttpWebResponse)request.GetResponse();
        }

        bool Probe()
        {
            closing = false;
            if (!Listening()) return false;
            try
            {
                using (var response = Get("/healthz"))
                {
                    if (response.StatusCode != HttpStatusCode.OK || response.Headers["X-GraphGoblin-Instance"] != expected)
                        throw new LauncherFailure("foreign-listener", "Port " + config.Port + " belongs to an unrelated or differently configured service (or an older GraphGoblin build). Stop the intended gateway deliberately or correct the launcher configuration. No process was stopped.");
                    int pid;
                    if (!int.TryParse(response.Headers["X-GraphGoblin-Pid"], out pid) || pid < 1 || (spawnedPid.HasValue && spawnedPid.Value != pid))
                        throw new LauncherFailure("foreign-gateway", "The listening gateway does not belong to this startup attempt. No process was stopped.");
                    string phase = response.Headers["X-GraphGoblin-Phase"];
                    if (phase == "ready" || phase == "exiting" || phase == "stopped") { closing = true; return false; }
                    if (!new[] { "running", "draining", "awaiting-choice", "forcing", "force-failed", "drain-failed" }.Contains(phase))
                        throw new LauncherFailure("unknown-phase", "The gateway returned an unrecognized shutdown phase. Inspect it before starting another gateway.");
                }
                using (var response = Get("/app/"))
                    if (response.StatusCode != HttpStatusCode.OK) throw new LauncherFailure("web-unavailable", "The gateway answers but its built web app is unavailable.");
                return true;
            }
            catch (WebException error)
            {
                // Our child may finish binding while an earlier connection attempt is failing.
                // Keep polling its known PID; a transport failure is not a foreign identity.
                if (spawnedPid.HasValue) return false;
                throw new LauncherFailure("listener-not-ready", "Port " + config.Port + " is occupied but the configured GraphGoblin gateway is not ready: " + error.Status + ". Inspect " + Program.RenderPath(log) + ". No process was stopped.");
            }
        }

        /// <summary>
        /// Before a fresh spawn: admit the private physical root and refuse while another handle
        /// denies a read-only probe of an existing validated gateway.log, such as a legacy
        /// gateway's writer on another store and port or another program; the sharing violation
        /// does not identify which. A deliberately stopped gateway keeps its log until process
        /// exit, so a holder is awaited until the existing release deadline. The probe reads
        /// nothing and never writes, truncates or prunes.
        /// </summary>
        LogRoot AdmitLogRoot(Stopwatch releaseClock)
        {
            LogRoot root;
            NativeFiles.Identity active;
            try
            {
                root = LogRoot.Admit(logDirectory);
                root.Entry("gateway.log.1");
                active = root.Entry("gateway.log");
            }
            catch (Exception) { throw StartupOutcome.DestinationUnavailableFailure(logDirectory, 0); }
            while (active != null)
            {
                using (var probe = NativeFiles.Open(Path.Combine(root.Path, "gateway.log"), NativeFiles.GenericRead, NativeFiles.ShareRead, NativeFiles.OpenExisting, NativeFiles.OpenReparsePoint))
                {
                    if (!probe.IsInvalid)
                    {
                        NativeFiles.Identity probed;
                        try { probed = NativeFiles.Describe(probe); }
                        catch (Exception) { throw StartupOutcome.DestinationUnavailableFailure(root.Path, 0); }
                        if (!probed.Same(active) || !probed.SafeRegular) throw StartupOutcome.DestinationUnavailableFailure(root.Path, 0);
                        return root;
                    }
                    if (Marshal.GetLastWin32Error() != NativeFiles.SharingViolation)
                        throw StartupOutcome.DestinationUnavailableFailure(root.Path, 0);
                }
                if (ReleaseRemaining(releaseClock) <= 0) throw StartupOutcome.DestinationInUseFailure(root.Path, 0);
                Thread.Sleep((int)Math.Min(200, ReleaseRemaining(releaseClock)));
            }
            return root;
        }

        public void Ensure()
        {
            expected = ReadHelper("", "identity", HelperProcess.WorkMilliseconds,
                value => System.Text.RegularExpressions.Regex.IsMatch(value, "\\A[a-f0-9]{64}\\z"));
            if (Probe()) return;
            var releaseClock = Stopwatch.StartNew();
            while (closing)
            {
                if (ReleaseRemaining(releaseClock) <= 0) throw new LauncherFailure("still-releasing", "The existing gateway is still releasing its store. Let deliberate shutdown finish and launch again. No process was stopped.");
                Thread.Sleep((int)Math.Min(200, ReleaseRemaining(releaseClock))); if (Probe()) return;
            }
            var sampleClock = Stopwatch.StartNew();
            bool held = StoreHasLiveOwner(HelperProcess.WorkMilliseconds);
            long sampleMilliseconds = sampleClock.ElapsedMilliseconds;
            while (held)
            {
                long work = RecheckWork(releaseClock);
                if (work < Math.Max(200, sampleMilliseconds)) throw HeldFailure(null);
                Thread.Sleep((int)Math.Min(200, Math.Max(0, work)));
                if (Probe()) return;
                work = RecheckWork(releaseClock);
                if (work < Math.Max(200, sampleMilliseconds)) throw HeldFailure(null);
                sampleClock.Restart();
                try { held = StoreHasLiveOwner((int)work); }
                catch (LauncherFailure failure) { throw HeldFailure(failure); }
                sampleMilliseconds = sampleClock.ElapsedMilliseconds;
            }
            LogRoot root = AdmitLogRoot(releaseClock);
            ChildProcess child;
            try { child = NativeProcess.Start(config.Node, Program.Quote(Path.Combine(config.Repo, "apps/api/dist/main.js")), config.Repo, config.GatewayEnvironment(root.Path)); }
            catch (System.ComponentModel.Win32Exception) { throw new LauncherFailure("spawn-failed", "Windows could not start the configured Node runtime for the gateway. Check the Node path and the built checkout. No gateway was started."); }
            using (child)
            {
                spawnedPid = child.Pid;
                var deadline = DateTime.UtcNow.AddSeconds(config.StartupTimeoutSeconds);
                while (DateTime.UtcNow < deadline)
                {
                    if (Probe()) return;
                    int code;
                    if (child.TryGetExit(out code)) throw StartupOutcome.ForChildExit(code, root.Path);
                    Thread.Sleep(200);
                }
            }
            throw new LauncherFailure("startup-timeout", "GraphGoblin did not become ready within " + config.StartupTimeoutSeconds + " seconds. Inspect gateway.log in the log folder. It may still be starting; no process was stopped. Launch again to check readiness.", root.Path, null, 0);
        }

        sealed class Ownership { public string state, path, detail; }
        sealed class OwnershipOutcome { public string Code, Text, Lock; }
        OwnershipOutcome ownership;

        static readonly string[] OwnershipReasons = {
            "malformed or incomplete owner record",
            "reclamation guard is not a physical directory with one valid owner marker",
            "live PID without a verifiable process creation identity",
            "PID liveness probe failed",
            "Windows process identity query timed out",
            "PowerShell process identity query could not start or complete",
            "Windows Management Instrumentation process identity query failed",
            "WMI returned no valid process creation identity",
            "Windows process identity is unavailable on this platform or for this PID",
        };

        /// <summary>Map the helper's ownership result to closed text and a validated lock location.</summary>
        public static string[] ClosedOwnership(string detail)
        {
            if (detail.StartsWith("another GraphGoblin process is acquiring this store", StringComparison.Ordinal))
                return new[] { "store-acquiring", "another GraphGoblin process is acquiring this store; let its startup finish" };
            if (detail.StartsWith("another GraphGoblin process holds this store", StringComparison.Ordinal))
                return new[] { "store-held", "another GraphGoblin process holds this store; check its port/configuration or let startup/shutdown finish" };
            if (detail.StartsWith("Store ownership could not be verified (", StringComparison.Ordinal))
            {
                string reason = detail.Substring("Store ownership could not be verified (".Length);
                foreach (string known in OwnershipReasons)
                    if (reason.StartsWith(known, StringComparison.Ordinal))
                        return new[] { "store-unverified", "Store ownership could not be verified (" + known + ")" };
                return new[] { "store-unverified", "Store ownership could not be verified" };
            }
            return new[] { "store-held", "The store is held or its ownership could not be verified" };
        }

        long ReleaseRemaining(Stopwatch clock) { return Math.Max(0, (long)config.StartupTimeoutSeconds * 1000 - clock.ElapsedMilliseconds); }
        long RecheckWork(Stopwatch clock) { return Math.Min(HelperProcess.WorkMilliseconds, ReleaseRemaining(clock) - HelperProcess.CleanupMilliseconds); }
        LauncherFailure HeldFailure(LauncherFailure inconclusive)
        {
            string guidance = ownership.Text + ". No second gateway was started. Do not stop an unrelated process or delete an unverified lock.";
            if (inconclusive != null && inconclusive.Code == "helper-cleanup-unconfirmed")
                return new LauncherFailure(inconclusive.Code, inconclusive.Message + " " + guidance, null, ownership.Lock, 0);
            return new LauncherFailure(ownership.Code, guidance, null, ownership.Lock, 0);
        }

        static bool ValidOwnership(string text)
        {
            // Validate the complete response inside the helper's budget. Unknown shapes refuse.
            var fields = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(text);
            object state;
            if (fields == null || !fields.TryGetValue("state", out state)) return false;
            if (Equals(state, "free")) return fields.Count == 1;
            object path, detail;
            return Equals(state, "held") && fields.Count == 3 && fields.TryGetValue("path", out path) && path is string &&
                !String.IsNullOrWhiteSpace((string)path) && fields.TryGetValue("detail", out detail) && detail is string && !String.IsNullOrWhiteSpace((string)detail);
        }

        bool StoreHasLiveOwner(int workMilliseconds)
        {
            var owner = new JavaScriptSerializer().Deserialize<Ownership>(ReadHelper(" --store-state", "ownership", workMilliseconds, ValidOwnership));
            if (owner != null && owner.state == "free") return false;
            if (owner == null || owner.state != "held" || String.IsNullOrWhiteSpace(owner.path) || String.IsNullOrWhiteSpace(owner.detail))
                throw new LauncherFailure("helper-invalid", "The ownership helper returned an invalid result. No gateway was started.");
            string[] closed = ClosedOwnership(owner.detail);
            ownership = new OwnershipOutcome { Code = closed[0], Text = closed[1] + ": " + Program.RenderPath(owner.path), Lock = owner.path };
            return true;
        }
    }

    /// <summary>The retained CreateProcess handle of the detached gateway, closed exactly once.</summary>
    public sealed class ChildProcess : IDisposable
    {
        [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr handle, out uint code);
        [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
        IntPtr process;
        public readonly int Pid;
        public ChildProcess(int pid, IntPtr handle) { Pid = pid; process = handle; }

        /// <summary>Whether this exact process has exited, without a PID lookup that could be reused.</summary>
        public bool TryGetExit(out int code)
        {
            code = 0;
            if (process == IntPtr.Zero || WaitForSingleObject(process, 0) != 0) return false;
            uint raw;
            if (!GetExitCodeProcess(process, out raw)) return false;
            code = unchecked((int)raw);
            return true;
        }

        public void Dispose()
        {
            if (process != IntPtr.Zero) { CloseHandle(process); process = IntPtr.Zero; }
        }
    }

    public static class NativeProcess
    {
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct StartupInfo {
            public int cb; public string reserved, desktop, title;
            public int x, y, xSize, ySize, xCount, yCount, fill, flags;
            public short show, reservedBytes; public IntPtr reservedPointer, input, output, error;
        }
        [StructLayout(LayoutKind.Sequential)] struct ProcessInformation { public IntPtr process, thread; public int pid, tid; }
        [StructLayout(LayoutKind.Sequential)] struct StartupInfoEx { public StartupInfo startup; public IntPtr attributes; }
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern bool CreateProcess(string app, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string directory, ref StartupInfoEx startup, out ProcessInformation process);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
        [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
        [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern IntPtr CreateFile(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);

        static IntPtr Nul(uint access)
        {
            IntPtr handle = CreateFile("NUL", access, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
            if (handle == new IntPtr(-1)) throw new System.ComponentModel.Win32Exception();
            return handle;
        }

        /// <summary>
        /// Start the detached gateway with readable NUL stdin and writable NUL stdout/stderr, which
        /// are the only inherited handles. The caller owns and disposes the returned process handle.
        /// </summary>
        public static ChildProcess Start(string executable, string arguments, string directory, SortedDictionary<string, string> environment)
        {
            IntPtr inputHandle = Nul(0x80000000);
            IntPtr outputHandle = IntPtr.Zero;
            try
            {
                outputHandle = Nul(0x40000000);
                var startup = new StartupInfoEx { startup = new StartupInfo { cb = Marshal.SizeOf(typeof(StartupInfoEx)), flags = 0x100, input = inputHandle, output = outputHandle, error = outputHandle } };
                string block = string.Join("\0", environment.Select(item => item.Key + "=" + item.Value)) + "\0\0";
                IntPtr env = Marshal.StringToHGlobalUni(block);
                IntPtr attributeSize = IntPtr.Zero;
                InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref attributeSize);
                IntPtr attributes = Marshal.AllocHGlobal(attributeSize), handles = Marshal.AllocHGlobal(IntPtr.Size * 2);
                bool initialized = false;
                try
                {
                    if (!SetHandleInformation(outputHandle, 1, 1) || !SetHandleInformation(inputHandle, 1, 1)) throw new System.ComponentModel.Win32Exception();
                    if (!InitializeProcThreadAttributeList(attributes, 1, 0, ref attributeSize)) throw new System.ComponentModel.Win32Exception();
                    initialized = true; startup.attributes = attributes;
                    Marshal.WriteIntPtr(handles, outputHandle); Marshal.WriteIntPtr(handles, IntPtr.Size, inputHandle);
                    if (!UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x20002), handles, new IntPtr(IntPtr.Size * 2), IntPtr.Zero, IntPtr.Zero)) throw new System.ComponentModel.Win32Exception();
                    ProcessInformation child;
                    // Only the two NUL handles are inherited. Launcher stdio pipes, mutexes and
                    // other handles must not keep the click process or a caller's pipe alive.
                    if (!CreateProcess(executable, new StringBuilder(Program.Quote(executable) + " " + arguments), IntPtr.Zero, IntPtr.Zero, true, 0x08000200 | 0x400 | 0x80000, env, directory, ref startup, out child))
                        throw new System.ComponentModel.Win32Exception();
                    CloseHandle(child.thread);
                    return new ChildProcess(child.pid, child.process);
                }
                finally {
                    if (initialized) DeleteProcThreadAttributeList(attributes);
                    Marshal.FreeHGlobal(attributes); Marshal.FreeHGlobal(handles);
                    Marshal.FreeHGlobal(env);
                }
            }
            finally
            {
                CloseHandle(inputHandle);
                if (outputHandle != IntPtr.Zero) CloseHandle(outputHandle);
            }
        }
    }

    // Windows per-window identity is also the taskbar pin/relaunch contract. Chrome's default
    // PWA identity alone would pin chrome_proxy and bypass readiness on the next cold start.
    public static class ShellIdentity
    {
        [ComImport, Guid("00021401-0000-0000-C000-000000000046")] class ShellLink { }
        [ComImport, Guid("000214F9-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IShellLinkW {
            void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int max, IntPtr data, uint flags);
            void GetIDList(out IntPtr list); void SetIDList(IntPtr list);
            void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder text, int max);
            void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string text);
            void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int max);
            void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string path);
            void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder text, int max);
            void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string text);
            void GetHotkey(out short value); void SetHotkey(short value);
            void GetShowCmd(out int value); void SetShowCmd(int value);
            void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int max, out int index);
            void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string path, int index);
            void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string path, uint reserved);
            void Resolve(IntPtr window, uint flags); void SetPath([MarshalAs(UnmanagedType.LPWStr)] string path);
        }
        public sealed class ShortcutData { public string TargetPath, Arguments, IconLocation; }
        public static ShortcutData InspectShortcut(string path)
        {
            object link = new ShellLink();
            try {
                ((System.Runtime.InteropServices.ComTypes.IPersistFile)link).Load(path, 0);
                var shell = (IShellLinkW)link;
                var target = new StringBuilder(32768); var arguments = new StringBuilder(32768); var icon = new StringBuilder(32768); int index;
                shell.GetPath(target, target.Capacity, IntPtr.Zero, 0); shell.GetArguments(arguments, arguments.Capacity); shell.GetIconLocation(icon, icon.Capacity, out index);
                return new ShortcutData { TargetPath = target.ToString(), Arguments = arguments.ToString(), IconLocation = icon.ToString() + "," + index };
            } finally { Marshal.ReleaseComObject(link); }
        }
        public static void CreateShortcut(string path, string target, string arguments, string icon, string id)
        {
            object link = new ShellLink();
            try {
                var shell = (IShellLinkW)link; shell.SetPath(target); shell.SetArguments(arguments);
                shell.SetWorkingDirectory(Path.GetDirectoryName(target)); shell.SetDescription("Start GraphGoblin, then open its installed Chrome app");
                if (!string.IsNullOrWhiteSpace(icon)) {
                    int comma = icon.LastIndexOf(','); int index;
                    if (comma >= 0 && int.TryParse(icon.Substring(comma + 1), out index)) shell.SetIconLocation(icon.Substring(0, comma), index);
                    else shell.SetIconLocation(icon, 0);
                }
                ((System.Runtime.InteropServices.ComTypes.IPersistFile)link).Save(path, true);
            } finally { Marshal.ReleaseComObject(link); }
            if (!string.IsNullOrWhiteSpace(id)) StampShortcut(path, id);
        }
        [StructLayout(LayoutKind.Sequential, Pack = 4)] public struct PropertyKey { public Guid format; public uint id; public PropertyKey(uint value) { format = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"); id = value; } }
        // x64 PROPVARIANT is 24 bytes, including its pointer-aligned counted-array union.
        [StructLayout(LayoutKind.Explicit, Size = 24)] struct PropVariant { [FieldOffset(0)] public ushort type; [FieldOffset(8)] public IntPtr text; }
        [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface PropertyStore {
            [PreserveSig] int GetCount(out uint count); [PreserveSig] int GetAt(uint index, out PropertyKey key);
            [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
            [PreserveSig] int SetValue(ref PropertyKey key, ref PropVariant value); [PreserveSig] int Commit();
        }
        static readonly Guid StoreId = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");
        [DllImport("shell32.dll", PreserveSig = false)] static extern void SHGetPropertyStoreForWindow(IntPtr window, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out PropertyStore store);
        [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)] static extern void SHGetPropertyStoreFromParsingName(string path, IntPtr context, uint flags, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out PropertyStore store);
        [DllImport("ole32.dll")] static extern int PropVariantClear(ref PropVariant value);
        delegate bool EnumWindow(IntPtr window, IntPtr value);
        [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindow callback, IntPtr value);
        [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
        [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
        [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window, int command);
        [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern uint GetShortPathName(string path, StringBuilder output, uint length);

        public static string RelaunchCommand(string executable, string configFile, bool gatewayOnly)
        {
            string suffix = gatewayOnly ? " --ensure-gateway" : "";
            if (string.Equals(Path.GetFullPath(configFile), executable + ".json", StringComparison.OrdinalIgnoreCase)) return Program.Quote(executable) + suffix;
            string command = Program.Quote(executable) + " --config " + Program.Quote(Path.GetFullPath(configFile)) + suffix;
            if (command.Length < 260) return command;
            // The window property store limits this command to MAX_PATH, although CreateProcess
            // permits longer arguments. Existing 8.3 aliases preserve the exact file identities.
            var shortExe = new StringBuilder(32768); var shortConfig = new StringBuilder(32768);
            if (GetShortPathName(executable, shortExe, (uint)shortExe.Capacity) > 0 && GetShortPathName(Path.GetFullPath(configFile), shortConfig, (uint)shortConfig.Capacity) > 0) {
                command = Program.Quote(shortExe.ToString()) + " --config " + Program.Quote(shortConfig.ToString()) + suffix;
                if (command.Length < 260) return command;
            }
            throw new LauncherFailure("relaunch-too-long", "Windows cannot store this long taskbar relaunch command. Choose a shorter launcher installation/configuration path.");
        }

        static PropertyStore WindowStore(IntPtr window) { var id = StoreId; PropertyStore store; SHGetPropertyStoreForWindow(window, ref id, out store); return store; }
        static PropertyStore ShortcutStore(string path, uint flags) { var id = StoreId; PropertyStore store; SHGetPropertyStoreFromParsingName(path, IntPtr.Zero, flags, ref id, out store); return store; }
        static string Read(PropertyStore store, uint id)
        {
            var key = new PropertyKey(id); PropVariant value;
            Marshal.ThrowExceptionForHR(store.GetValue(ref key, out value));
            try { return value.type == 31 ? Marshal.PtrToStringUni(value.text) : ""; } finally { PropVariantClear(ref value); }
        }
        static void Write(PropertyStore store, uint id, string text)
        {
            var key = new PropertyKey(id); var value = new PropVariant { type = 31, text = Marshal.StringToCoTaskMemUni(text) };
            try {
                int result = store.SetValue(ref key, ref value);
                if (result < 0) throw new COMException("Windows refused AppUserModel property " + id + " (" + text.Length + " characters).", result);
            } finally { PropVariantClear(ref value); }
        }
        public static string ReadShortcut(string path) { var store = ShortcutStore(path, 0); try { return Read(store, 5); } finally { Marshal.ReleaseComObject(store); } }
        public static void StampShortcut(string path, string id) { var store = ShortcutStore(path, 2); try { Write(store, 5, id); Marshal.ThrowExceptionForHR(store.Commit()); } finally { Marshal.ReleaseComObject(store); } }

        public static void StampWindow(IntPtr window, string id, string relaunch, string icon)
        {
            var store = WindowStore(window);
            try
            {
                // Relaunch properties precede ID as required by the Windows taskbar contract.
                Write(store, 2, relaunch); Write(store, 4, "GraphGoblin");
                Write(store, 3, icon); Write(store, 5, id);
            }
            finally { Marshal.ReleaseComObject(store); }
        }
        public static string WindowIdentity(IntPtr window) { var store = WindowStore(window); try { return Read(store, 5); } finally { Marshal.ReleaseComObject(store); } }
        public static string WindowRelaunchCommand(IntPtr window) { var store = WindowStore(window); try { return Read(store, 2); } finally { Marshal.ReleaseComObject(store); } }

        public static IntPtr FindWindow(Configuration config)
        {
            IntPtr found = IntPtr.Zero;
            EnumWindows((window, unused) => {
                if (!IsWindowVisible(window)) return true;
                try
                {
                    uint pid; GetWindowThreadProcessId(window, out pid);
                    using (var process = Process.GetProcessById((int)pid))
                    {
                        if (!string.Equals(process.ProcessName, "chrome", StringComparison.OrdinalIgnoreCase)) return true;
                        if (!string.Equals(Path.GetDirectoryName(process.MainModule.FileName), Path.GetDirectoryName(config.ChromeProxy), StringComparison.OrdinalIgnoreCase)) return true;
                    }
                    string id = WindowIdentity(window);
                    if (id == config.PwaAppUserModelId || id == config.LauncherAppUserModelId) { found = window; return false; }
                }
                catch (System.ComponentModel.Win32Exception) { }
                catch (ArgumentException) { }
                catch (COMException) { }
                return true;
            }, IntPtr.Zero);
            return found;
        }

        public static void OpenPwa(Configuration config, string configFile)
        {
            IntPtr window = FindWindow(config);
            if (window == IntPtr.Zero)
            {
                Process.Start(new ProcessStartInfo(config.ChromeProxy, "--profile-directory=" + Program.Quote(config.ChromeProfile) + " --app-id=" + config.ChromeAppId) { UseShellExecute = false });
                var deadline = DateTime.UtcNow.AddSeconds(config.WindowTimeoutSeconds);
                while (DateTime.UtcNow < deadline && (window = FindWindow(config)) == IntPtr.Zero) Thread.Sleep(200);
            }
            if (window == IntPtr.Zero) throw new LauncherFailure("window-missing", "The gateway is ready, but the installed Chrome GraphGoblin app did not open. Check its installed PWA/profile and configure the launcher again. The gateway keeps running.");
            string relaunch = RelaunchCommand(Application.ExecutablePath, configFile, false);
            StampWindow(window, config.LauncherAppUserModelId, relaunch, config.IconLocation ?? (Application.ExecutablePath + ",0"));
            ShowWindow(window, 9); SetForegroundWindow(window);
        }
    }
}
