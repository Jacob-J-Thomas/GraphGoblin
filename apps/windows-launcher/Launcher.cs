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
    /// The staged installer's versioned enrollment (#566): the gateway's launch digest and the
    /// canonical store it resolved, bound to the exact gateway inputs it was observed with.
    /// </summary>
    public sealed class Enrollment
    {
        public const int CurrentVersion = 1;
        public int Version { get; set; }
        public string Launch { get; set; }
        public string DataDir { get; set; }
        public string Database { get; set; }
        public string Lookup { get; set; }
        public string Target { get; set; }
        public string Inputs { get; set; }
    }

    public static class EnrollmentText
    {
        public static bool IsLaunchDigest(string value)
        {
            return value != null && System.Text.RegularExpressions.Regex.IsMatch(value, "\\Av1:[a-f0-9]{64}\\z");
        }

        public static bool IsInstanceDigest(string value)
        {
            return value != null && System.Text.RegularExpressions.Regex.IsMatch(value, "\\A[a-f0-9]{64}\\z");
        }

        /// <summary>A bounded rooted path without control characters; never displayed by itself.</summary>
        public static bool IsRootedPath(string value)
        {
            if (string.IsNullOrEmpty(value) || value.Length > 32767 || value.Any(char.IsControl)) return false;
            try { return Path.IsPathRooted(value); }
            catch (ArgumentException) { return false; }
        }
    }

    /// <summary>
    /// The launcher configuration read through one handle: its bytes, their SHA-256 and the file's
    /// volume and index. A click that waited reopens it and refuses any replacement or edit.
    /// </summary>
    public sealed class ConfigurationFile
    {
        public const int MaxBytes = 1048576;
        public string Text { get; private set; }
        public string Digest { get; private set; }
        public uint Volume { get; private set; }
        public ulong Index { get; private set; }

        public static ConfigurationFile Read(string path)
        {
            using (var handle = NativeFiles.Open(path, NativeFiles.GenericRead, NativeFiles.ShareRead | NativeFiles.ShareDelete, NativeFiles.OpenExisting, 0))
            {
                if (handle.IsInvalid) throw new FileNotFoundException("launcher configuration unavailable");
                var identity = NativeFiles.Describe(handle);
                if ((identity.Attributes & 0x50) != 0 || identity.Size > MaxBytes)
                    throw new ConfigurationRefusal("The launcher configuration is not an ordinary file of at most 1 MiB. Re-run install-windows-launcher.ps1.");
                using (var stream = new FileStream(handle, FileAccess.Read, 4096))
                using (var bytes = new MemoryStream())
                {
                    var chunk = new byte[4096];
                    int count;
                    while ((count = stream.Read(chunk, 0, chunk.Length)) > 0)
                    {
                        if (bytes.Length + count > MaxBytes)
                            throw new ConfigurationRefusal("The launcher configuration is not an ordinary file of at most 1 MiB. Re-run install-windows-launcher.ps1.");
                        bytes.Write(chunk, 0, count);
                    }
                    byte[] content = bytes.ToArray();
                    using (var sha = SHA256.Create())
                    using (var reader = new StreamReader(new MemoryStream(content), new UTF8Encoding(false), true))
                        return new ConfigurationFile {
                            Text = reader.ReadToEnd(), Digest = Program.Hex(sha.ComputeHash(content)),
                            Volume = identity.Volume, Index = identity.Index
                        };
                }
            }
        }

        public Configuration Parse()
        {
            var config = new JavaScriptSerializer().Deserialize<Configuration>(Text);
            if (config == null) throw new ConfigurationRefusal("The launcher configuration is empty. Re-run install-windows-launcher.ps1.");
            return config;
        }

        /// <summary>Refuse when the file disappeared, was replaced or its bytes changed.</summary>
        public void Recheck(string path)
        {
            ConfigurationFile current = null;
            try { current = Read(path); }
            catch (Exception) { }
            if (current == null || current.Volume != Volume || current.Index != Index || current.Digest != Digest)
                throw new LauncherFailure("configuration-changed", "The launcher configuration was changed, replaced or removed while this click waited for another launch. Launch again to use the current configuration. No gateway was started.");
        }
    }

    /// <summary>
    /// One flat JSON object of string members, parsed exactly once from the raw decoded helper
    /// output. Framework's JavaScriptSerializer also accepts JavaScript syntax and overwrites
    /// duplicate names. Names are decoded before allowlist and uniqueness checks; the wire is
    /// never normalized with Trim first. Returns null for anything else.
    /// </summary>
    public sealed class FlatStringObject
    {
        readonly string text; int position;
        FlatStringObject(string source) { text = source; }

        public static Dictionary<string, string> Read(string source, ICollection<string> allowed)
        {
            try { return new FlatStringObject(source).Members(allowed); }
            catch (FormatException) { return null; }
        }

        void Whitespace()
        {
            while (position < text.Length && (text[position] == ' ' || text[position] == '\t' || text[position] == '\r' || text[position] == '\n')) position++;
        }
        bool Take(char value)
        {
            Whitespace();
            if (position >= text.Length || text[position] != value) return false;
            position++; return true;
        }
        static int Hex(char value)
        {
            if (value >= '0' && value <= '9') return value - '0';
            if (value >= 'a' && value <= 'f') return value - 'a' + 10;
            if (value >= 'A' && value <= 'F') return value - 'A' + 10;
            throw new FormatException();
        }
        string ReadString()
        {
            if (!Take('"')) throw new FormatException();
            var result = new StringBuilder();
            while (position < text.Length) {
                char value = text[position++];
                if (value == '"') return result.ToString();
                if (value < 0x20) throw new FormatException();
                if (value != '\\') { result.Append(value); continue; }
                if (position >= text.Length) throw new FormatException();
                char escape = text[position++];
                switch (escape) {
                    case '"': case '\\': case '/': result.Append(escape); break;
                    case 'b': result.Append('\b'); break;
                    case 'f': result.Append('\f'); break;
                    case 'n': result.Append('\n'); break;
                    case 'r': result.Append('\r'); break;
                    case 't': result.Append('\t'); break;
                    case 'u':
                        if (text.Length - position < 4) throw new FormatException();
                        int unit = 0;
                        for (int i = 0; i < 4; i++) unit = unit * 16 + Hex(text[position++]);
                        // JSON escapes represent UTF-16 code units; do not canonicalize or
                        // discard legal producer escapes, including escaped surrogate units.
                        result.Append((char)unit); break;
                    default: throw new FormatException();
                }
            }
            throw new FormatException();
        }
        Dictionary<string, string> Members(ICollection<string> allowed)
        {
            if (text == null || !Take('{')) return null;
            var members = new Dictionary<string, string>(StringComparer.Ordinal);
            do {
                string name = ReadString();
                if (!allowed.Contains(name) || members.ContainsKey(name) || !Take(':')) return null;
                members[name] = ReadString();
                if (Take('}')) break;
                if (!Take(',')) return null;
            } while (true);
            Whitespace();
            return position == text.Length ? members : null;
        }
    }

    /// <summary>A fresh contained enrollment observation from the built read-only helper.</summary>
    public sealed class EnrollmentObservation
    {
        static readonly string[] Names = { "version", "launch", "instance", "dataDir", "database", "lookup", "target" };
        public string Launch, Instance, DataDir, Database, Lookup, Target;

        /// <summary>Strict: version 1, both digests, rooted store paths, file lookup/target or non-file only.</summary>
        public static bool TryRead(string text, out EnrollmentObservation observed)
        {
            observed = null;
            var members = FlatStringObject.Read(text, Names);
            if (members == null) return false;
            string version, launch, instance, dataDir, database, lookup = null, target = null;
            if (!members.TryGetValue("version", out version) || version != "1" ||
                !members.TryGetValue("launch", out launch) || !EnrollmentText.IsLaunchDigest(launch) ||
                !members.TryGetValue("instance", out instance) || !EnrollmentText.IsInstanceDigest(instance) ||
                !members.TryGetValue("dataDir", out dataDir) || !EnrollmentText.IsRootedPath(dataDir) ||
                !members.TryGetValue("database", out database))
                return false;
            if (database == "file")
            {
                if (members.Count != 7 || !members.TryGetValue("lookup", out lookup) || !EnrollmentText.IsRootedPath(lookup) ||
                    !members.TryGetValue("target", out target) || !EnrollmentText.IsRootedPath(target))
                    return false;
            }
            else if (database != "non-file" || members.Count != 5) return false;
            observed = new EnrollmentObservation { Launch = launch, Instance = instance, DataDir = dataDir, Database = database, Lookup = lookup, Target = target };
            return true;
        }

        /// <summary>The installer's record of this observation, bound to the exact gateway inputs.</summary>
        public Enrollment ToEnrollment(Configuration config)
        {
            return new Enrollment {
                Version = Enrollment.CurrentVersion, Launch = Launch, DataDir = DataDir, Database = Database,
                Lookup = Lookup, Target = Target, Inputs = config.GatewayInputsDigest()
            };
        }

        /// <summary>Ordinal equality with the installed enrollment's digest and store metadata.</summary>
        public bool Matches(Enrollment enrolled)
        {
            return enrolled != null && Launch == enrolled.Launch && DataDir == enrolled.DataDir &&
                Database == enrolled.Database && (Lookup ?? "") == (enrolled.Lookup ?? "") && (Target ?? "") == (enrolled.Target ?? "");
        }
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
        /// <summary>Written only by the staged installer (#566); never refreshed at runtime.</summary>
        public Enrollment Enrollment { get; set; }

        /// <summary>
        /// Configuration shape and PWA routing metadata only. The runtime, checkout, startup files
        /// and Chrome proxy executable are not consulted: warm reuse needs none of them (#566).
        /// Cold startup and the staged installer check them separately.
        /// </summary>
        public void Validate(bool gatewayOnly)
        {
            if (!Path.IsPathRooted(Repo ?? "") || !Path.IsPathRooted(Node ?? "") ||
                !Path.IsPathRooted(DataDir ?? "") || Port < 1 || Port > 65535 ||
                StartupTimeoutSeconds < 1 || StartupTimeoutSeconds > 300 ||
                WindowTimeoutSeconds < 1 || WindowTimeoutSeconds > 120)
                throw new ConfigurationRefusal("Invalid launcher paths, port or timeouts. Re-run install-windows-launcher.ps1.");
            Environment = Environment ?? new Dictionary<string, string>();
            if (Environment.Keys.Any(key => string.Equals(key, "GG_MASTER_KEY", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(key, "GG_JEV_API_KEY", StringComparison.OrdinalIgnoreCase)))
                throw new ConfigurationRefusal("Launcher Environment cannot contain GG_MASTER_KEY or GG_JEV_API_KEY (case-insensitive). Keep credentials in GraphGoblin secret stores; use the data directory master.key for encryption.");
            foreach (var item in Environment)
                if (!item.Key.StartsWith("GG_", StringComparison.Ordinal) || item.Value == null || item.Key.IndexOfAny(new[] { '=', '\0' }) >= 0 || item.Value.Contains("\0"))
                    throw new ConfigurationRefusal("Launcher Environment must contain GG_* string overrides only.");
            // Windows environment names are case-insensitive: one spelling per name, so the child's
            // value and the enrollment's input digest can never disagree about the winner.
            if (Environment.Keys.GroupBy(key => key, StringComparer.OrdinalIgnoreCase).Any(group => group.Count() > 1))
                throw new ConfigurationRefusal("Launcher Environment repeats a GG_* override with different letter case. Keep one spelling and re-run install-windows-launcher.ps1.");
            foreach (string key in new[] { "GG_HOST", "GG_PORT", "GG_DATA_DIR", "GG_WEB_DIST" })
                if (Environment.ContainsKey(key)) throw new ConfigurationRefusal(key + " is owned by the launcher's explicit configuration fields.");
            if (Environment.Keys.Any(key => string.Equals(key, LogDirectoryVariable, StringComparison.OrdinalIgnoreCase)))
                throw new ConfigurationRefusal(LogDirectoryVariable + " is reserved for the launcher.");
            if (!gatewayOnly && (!Path.IsPathRooted(ChromeProxy ?? "") || string.IsNullOrWhiteSpace(ChromeProfile) ||
                !System.Text.RegularExpressions.Regex.IsMatch(ChromeAppId ?? "", "^[a-p]{32}$") ||
                string.IsNullOrWhiteSpace(PwaAppUserModelId) || string.IsNullOrWhiteSpace(LauncherAppUserModelId)))
                throw new ConfigurationRefusal("The installed Chrome PWA is not configured. Re-run install-windows-launcher.ps1 with its shortcut.");
            if (!gatewayOnly && ChromeAppId != Program.ChromeAppId(Port))
                throw new ConfigurationRefusal("The installed Chrome PWA belongs to another origin. Install GraphGoblin from http://127.0.0.1:" + Port + "/app/ and configure its shortcut.");
        }

        /// <summary>The runtime and built read-only helper that enrollment executes.</summary>
        public void ValidateRuntime()
        {
            if (!Directory.Exists(Repo) || !File.Exists(Node))
                throw new ConfigurationRefusal("The configured checkout or Node runtime is unavailable. Check the Repo and Node paths or re-run install-windows-launcher.ps1. No gateway was started.");
            if (!File.Exists(Path.Combine(Repo, "apps/api/dist/instance-identity.js")))
                throw new ConfigurationRefusal("The configured checkout is not built: apps/api/dist/instance-identity.js. Build it with Node 22 before launching.");
        }

        /// <summary>Cold startup prerequisites: runtime, built checkout and the log protocol.</summary>
        public void ValidateStartup()
        {
            ValidateRuntime();
            foreach (string file in BuiltFiles)
                if (!File.Exists(Path.Combine(Repo, file)))
                    throw new ConfigurationRefusal("The configured checkout is not built: " + file + ". Build it with Node 22 before launching.");
            // A stale entry beside a current guard module still refuses before any spawn.
            if (!HasLogProtocol(Path.Combine(Repo, "apps/api/dist/main.js")))
                throw new ConfigurationRefusal("The configured checkout's built gateway does not match this launcher (apps/api/dist/main.js). Stop any running GraphGoblin gateway, rebuild the checkout with Node 22 and reinstall the launcher.");
        }

        /// <summary>The installer's selected PWA source; the click itself classifies it at handoff.</summary>
        public void ValidatePwaSource()
        {
            if (!File.Exists(ChromeProxy ?? ""))
                throw new ConfigurationRefusal("The installed Chrome PWA is not configured. Re-run install-windows-launcher.ps1 with its shortcut.");
        }

        /// <summary>
        /// The enrollment must be complete, current in format and bound to these exact gateway
        /// inputs. An edited Repo, Node, DataDir, Port or GG_* override needs re-enrollment.
        /// </summary>
        public void ValidateEnrollment()
        {
            var enrolled = Enrollment;
            bool file = enrolled != null && enrolled.Database == "file";
            if (enrolled == null || enrolled.Version != Enrollment.CurrentVersion ||
                !EnrollmentText.IsLaunchDigest(enrolled.Launch) || !EnrollmentText.IsRootedPath(enrolled.DataDir) ||
                !(file ? EnrollmentText.IsRootedPath(enrolled.Lookup) && EnrollmentText.IsRootedPath(enrolled.Target)
                    : enrolled.Database == "non-file" && string.IsNullOrEmpty(enrolled.Lookup) && string.IsNullOrEmpty(enrolled.Target)) ||
                !string.Equals(enrolled.Inputs, GatewayInputsDigest(), StringComparison.Ordinal))
                throw new ConfigurationRefusal("This launcher configuration is not enrolled for its current Repo, Node, DataDir, Port and GG_* overrides. Re-run install-windows-launcher.ps1 to enroll them. No gateway was started.");
        }

        /// <summary>
        /// SHA-256 of the exact gateway inputs: a fixed tag, Repo, Node, DataDir, Port, the override
        /// count and each ordinally sorted name and value, every field length-prefixed (32-bit
        /// big-endian byte count of strict UTF-8). PWA-only fields and startup bytes are excluded.
        /// </summary>
        public string GatewayInputsDigest()
        {
            var encoding = new UTF8Encoding(false, true);
            using (var buffer = new MemoryStream())
            {
                Action<string> field = value =>
                {
                    byte[] bytes = encoding.GetBytes(value ?? "");
                    buffer.Write(new[] { (byte)(bytes.Length >> 24), (byte)(bytes.Length >> 16), (byte)(bytes.Length >> 8), (byte)bytes.Length }, 0, 4);
                    buffer.Write(bytes, 0, bytes.Length);
                };
                var overrides = (Environment ?? new Dictionary<string, string>()).OrderBy(item => item.Key, StringComparer.Ordinal).ToList();
                field("graphgoblin-launcher-gateway-inputs/v1");
                field(Repo); field(Node); field(DataDir);
                field(Port.ToString(CultureInfo.InvariantCulture));
                field(overrides.Count.ToString(CultureInfo.InvariantCulture));
                foreach (var item in overrides) { field(item.Key); field(item.Value); }
                using (var sha = SHA256.Create()) return Program.Hex(sha.ComputeHash(buffer.ToArray()));
            }
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
            if (args.Contains("--validate-install") || args.Contains("--stage-shortcut") || args.Contains("--enroll-install"))
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
                // One handle supplies the bytes, their digest and the file identity (#566).
                var file = ConfigurationFile.Read(configFile);
                var config = file.Parse();
                config.Validate(gatewayOnly);
                if (shortcut != null) { stage = "shortcut"; ShellIdentity.StampShortcut(shortcut, config.LauncherAppUserModelId); return 0; }
                if (createShortcut != null) {
                    stage = "shortcut";
                    ShellIdentity.CreateShortcut(createShortcut, Application.ExecutablePath, "--config " + Program.Quote(Path.GetFullPath(configFile)) + (gatewayOnly ? " --ensure-gateway" : ""), config.IconLocation, config.LauncherAppUserModelId);
                    return 0;
                }
                config.ValidateEnrollment();
                stage = "gateway";
                var gateway = new Gateway(config, Path.GetDirectoryName(Path.GetFullPath(configFile)), configFile, file, next => stage = next);
                // Lock-free warm probe: before startup files, logs, jobs or either startup mutex.
                if (!gateway.Warm())
                {
                    stage = "launch-lock";
                    using (var mutex = new Mutex(false, StoreMutexName(config.DataDir)))
                    using (var portMutex = new Mutex(false, PortMutexName(config.Port)))
                    {
                        bool owned = false, portOwned = false;
                        try
                        {
                            try { owned = mutex.WaitOne(TimeSpan.FromSeconds(360)); } catch (AbandonedMutexException) { owned = true; }
                            if (!owned) throw new LauncherFailure("launch-busy", "Another GraphGoblin launch is still waiting. Inspect launcher.log before trying again.");
                            try { portOwned = portMutex.WaitOne(TimeSpan.FromSeconds(360)); } catch (AbandonedMutexException) { portOwned = true; }
                            if (!portOwned) throw new LauncherFailure("port-busy", "Another GraphGoblin launcher is still checking port " + config.Port + ".");
                            stage = "configuration";
                            file.Recheck(configFile);
                            stage = "gateway";
                            gateway.EnsureLocked();
                        }
                        finally { if (portOwned) portMutex.ReleaseMutex(); if (owned) mutex.ReleaseMutex(); }
                    }
                }
                // Store and port mutexes are released before Chrome opens; the window has its own.
                stage = "window";
                if (!gatewayOnly) ShellIdentity.OpenPwa(config, configFile);
                return 0;
            }
            catch (Exception error)
            {
                // Store, port and window mutexes are already released; the log pair has its own mutex.
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

        public static string StoreMutexName(string dataDir) { return "Local\\GraphGoblin.Launch." + Hash(dataDir.ToUpperInvariant()); }
        public static string PortMutexName(int port) { return "Local\\GraphGoblin.Port." + port.ToString(CultureInfo.InvariantCulture); }

        static int PrepareInstallation(string[] args)
        {
            try
            {
                bool validate = args.Length == 3 && args[0] == "--validate-install" && args[1] == "--config";
                bool enroll = args.Length == 3 && args[0] == "--enroll-install" && args[1] == "--config";
                bool stage = args.Length == 4 && args[0] == "--stage-shortcut";
                if (!validate && !enroll && !stage) throw new ConfigurationRefusal("Invalid staged launcher arguments.");
                if (!IsFullyQualifiedWindowsPath(args[2])) throw new ConfigurationRefusal("Invalid staged launcher configuration path.");
                var config = new JavaScriptSerializer().Deserialize<Configuration>(File.ReadAllText(args[2]));
                if (enroll)
                {
                    // Gateway inputs only: the contained configured runtime observes the cold
                    // launch environment once. The installer embeds this one versioned record.
                    config.Validate(true);
                    config.ValidateRuntime();
                    HelperProcess.CheckCapability();
                    var observed = Gateway.ReadEnrollment(config, HelperProcess.WorkDeadline.Start(HelperProcess.WorkMilliseconds));
                    Console.WriteLine(new JavaScriptSerializer().Serialize(observed.ToEnrollment(config)));
                    return 0;
                }
                config.Validate(false);
                config.ValidateStartup();
                config.ValidatePwaSource();
                config.ValidateEnrollment();
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
            using (var sha = SHA256.Create()) return Hex(sha.ComputeHash(Encoding.UTF8.GetBytes(value)));
        }

        public static string Hex(byte[] bytes)
        {
            return BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant();
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
        /// <summary>FILE_ID_INFO: the 64-bit volume serial, then the 128-bit FILE_ID_128 as two halves.</summary>
        [StructLayout(LayoutKind.Sequential)]
        struct FileIdInformation { public ulong Volume, Low, High; }
        const int FileIdInfo = 18; // FILE_INFO_BY_HANDLE_CLASS
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool GetFileInformationByHandleEx(SafeFileHandle handle, int type, out FileIdInformation information, uint size);
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

        /// <summary>
        /// A full FILE_ID_INFO identity: the 64-bit volume serial and all 128 file ID bits, kept as
        /// the ID's first and last eight bytes. The legacy 64-bit index can collide on ReFS.
        /// </summary>
        public sealed class FileId
        {
            public ulong Volume, Low, High;
            /// <summary>An all-zero or all-one ID identifies nothing.</summary>
            public bool Usable { get { return (Low | High) != 0 && (Low & High) != ulong.MaxValue; } }
            public bool Same(FileId other)
            {
                return other != null && Usable && other.Usable && Volume == other.Volume && Low == other.Low && High == other.High;
            }
        }

        /// <summary>The opened object's full file ID, or null when Windows cannot supply it.</summary>
        public static FileId DescribeId(SafeFileHandle handle)
        {
            FileIdInformation information;
            if (!GetFileInformationByHandleEx(handle, FileIdInfo, out information, (uint)Marshal.SizeOf(typeof(FileIdInformation)))) return null;
            return new FileId { Volume = information.Volume, Low = information.Low, High = information.High };
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

        /// <summary>One caller-admitted cutoff, including preparation; never restart its clock.</summary>
        public sealed class WorkDeadline
        {
            readonly Func<long> elapsedMilliseconds;
            readonly long expiresAt;

            internal WorkDeadline(Func<long> elapsedMilliseconds, long expiresAt)
            {
                this.elapsedMilliseconds = elapsedMilliseconds;
                this.expiresAt = expiresAt;
            }

            public static WorkDeadline Start(int milliseconds)
            {
                var clock = Stopwatch.StartNew();
                return new WorkDeadline(() => clock.ElapsedMilliseconds, milliseconds);
            }

            internal static WorkDeadline Recheck(Func<long> elapsedMilliseconds, long releaseMilliseconds)
            {
                long admittedAt = elapsedMilliseconds();
                return new WorkDeadline(elapsedMilliseconds,
                    Math.Min(admittedAt + WorkMilliseconds, releaseMilliseconds - CleanupMilliseconds));
            }

            internal long Remaining { get { return Math.Max(0, expiresAt - elapsedMilliseconds()); } }
            internal bool Expired { get { return elapsedMilliseconds() >= expiresAt; } }
            internal void Check(string stage) { if (Expired) throw Timeout(stage); }

            internal T Within<T>(string stage, Func<T> operation)
            {
                Check(stage);
                T result = operation();
                Check(stage);
                return result;
            }
        }
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

        /// <summary>Validate raw decoded output inside the work window; return its trimmed form.</summary>
        public static string Read(string executable, string arguments, string directory, SortedDictionary<string, string> environment, string stage, WorkDeadline work, Func<string, bool> validate)
        {
            SafeFileHandle job = null; Pipe output = null, error = null; ChildProcess child = null;
            LauncherFailure failure = null; bool success = false, exited = false; int exitCode = 0; string result = null;
            try {
                work.Check(stage);
                job = NewJob(); output = new Pipe(); error = new Pipe();
                using (var input = CreateFile("NUL", 0x80000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero))
                using (var attributes = new Attributes(job, input, output.Writer, error.Writer)) {
                    if (input.IsInvalid) throw Containment();
                    work.Check(stage);
                    IntPtr block = Marshal.StringToHGlobalUni(string.Join("\0", environment.Select(item => item.Key + "=" + item.Value)) + "\0\0");
                    try {
                        var startup = new StartupInfoEx { attributes = attributes.List, startup = new StartupInfo {
                            cb = Marshal.SizeOf(typeof(StartupInfoEx)), flags = 0x100, input = input.DangerousGetHandle(), output = output.Writer.DangerousGetHandle(), error = error.Writer.DangerousGetHandle() } };
                        var command = new StringBuilder(Program.Quote(executable) + " " + arguments);
                        ProcessInformation created;
                        work.Check(stage);
                        if (!CreateProcess(executable, command, IntPtr.Zero, IntPtr.Zero, true, 0x08080400, block, directory, ref startup, out created)) {
                            int code = Marshal.GetLastWin32Error();
                            if (code == 2 || code == 3 || code == 193 || code == 216) throw new LauncherFailure("helper-unavailable", "The configured Node runtime could not be started. Check the Node path in the launcher configuration.");
                            throw Containment();
                        }
                        child = new ChildProcess(created.pid, created.process); CloseHandle(created.thread);
                        work.Check(stage);
                    } finally { Marshal.FreeHGlobal(block); }
                }
                output.CloseWriter(); error.CloseWriter();
                using (var retained = new MemoryStream()) {
                    while (true) {
                        work.Check(stage);
                        if (!exited && child.TryGetExit(out exitCode)) { exited = true; child.Dispose(); child = null; }
                        output.Drain(retained);
                        work.Check(stage);
                        error.Drain(null);
                        work.Check(stage);
                        if (!exited && child.TryGetExit(out exitCode)) { exited = true; child.Dispose(); child = null; }
                        if (exited && output.Eof && error.Eof && Empty(job)) {
                            work.Check(stage);
                            if (exitCode != 0) throw Refused(exitCode);
                            string decoded;
                            try { decoded = new UTF8Encoding(false, true).GetString(retained.GetBuffer(), 0, (int)retained.Length); }
                            catch (DecoderFallbackException) { throw Invalid(); }
                            work.Check(stage);
                            bool valid;
                            try { valid = validate(decoded); } catch (Exception) { valid = false; }
                            work.Check(stage);
                            if (!valid) throw Invalid();
                            result = decoded.Trim();
                            work.Check(stage);
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
                    if (work.Expired) failure = Timeout(stage);
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
                    confirmed = AwaitCleanup(delegate {
                        int ignored;
                        if (child != null && child.TryGetExit(out ignored)) { child.Dispose(); child = null; }
                        bool outputDone = output == null || output.Complete();
                        bool errorDone = error == null || error.Complete();
                        bool jobEmpty = Empty(job);
                        return child == null && jobEmpty && outputDone && errorDone;
                    }, () => cleanup.ElapsedMilliseconds);
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

        /// <summary>
        /// The complete observation must finish before the deadline. A later successful poll
        /// cannot credit timely collection, even when it now permits safe resource disposal.
        /// Delegates keep this exact production decision deterministic in compiled checks.
        /// </summary>
        internal static bool AwaitCleanup(Func<bool> observe, Func<long> elapsedMilliseconds)
        {
            while (true) {
                bool complete = observe();
                long observedAt = elapsedMilliseconds();
                if (observedAt >= CleanupMilliseconds) return false;
                if (complete) return true;
                Thread.Sleep(1);
            }
        }
        static LauncherFailure Timeout(string stage) { return new LauncherFailure("helper-timeout", "The read-only " + stage + " check exceeded its work budget. Check PowerShell and Windows Management Instrumentation availability. No gateway was started."); }
        static LauncherFailure Refused(int code) { return new LauncherFailure("helper-refused", "The Node 22 runtime, launcher configuration or store ownership could not be checked. Check the configured runtime, GG_* overrides and read permissions on the store's lock files.", null, null, code); }
    }

    public sealed class Gateway
    {
        public const string LaunchHeader = "X-GraphGoblin-Launch-Identity";
        static readonly string[] ObservablePhases = { "running", "draining", "awaiting-choice", "forcing", "force-failed", "drain-failed" };
        static readonly string[] ClosingPhases = { "ready", "exiting", "stopped" };

        /// <summary>One loopback observation. Definitive mismatches throw instead.</summary>
        public enum Seen { Free, Unknown, Closing, Ready }

        readonly Configuration config;
        readonly Enrollment enrollment;
        readonly string logDirectory;
        readonly string log;
        readonly string origin;
        readonly string configFile;
        readonly ConfigurationFile file;
        readonly Action<string> enter;
        // Set only after a fresh contained observation and this click's own spawn.
        string freshInstance;
        int? spawnedPid;
        LauncherFailure unknown;

        public Gateway(Configuration configuration, string directory, string configPath, ConfigurationFile snapshot, Action<string> stage)
        {
            config = configuration;
            enrollment = configuration.Enrollment;
            logDirectory = directory;
            log = Path.Combine(directory, "gateway.log");
            origin = "http://127.0.0.1:" + config.Port;
            configFile = configPath;
            file = snapshot;
            enter = stage ?? new Action<string>(ignored => { });
        }

        static string ReadHelper(Configuration config, string argument, string stage, HelperProcess.WorkDeadline work, Func<string, bool> validate)
        {
            return work.Within(stage, () => HelperProcess.Read(config.Node,
                Program.Quote(Path.Combine(config.Repo, "apps/api/dist/instance-identity.js")) + argument,
                config.Repo, config.ChildEnvironment(), stage, work, validate));
        }

        string ReadHelper(string argument, string stage, HelperProcess.WorkDeadline work, Func<string, bool> validate)
        {
            return ReadHelper(config, argument, stage, work, validate);
        }

        /// <summary>
        /// The contained configured runtime's enrollment with the cold launch environment. The
        /// installer and every cold start use this one strict, bounded helper operation.
        /// </summary>
        public static EnrollmentObservation ReadEnrollment(Configuration config, HelperProcess.WorkDeadline work)
        {
            EnrollmentObservation observed = null;
            ReadHelper(config, " --launch-enrollment", "enrollment", work, value => EnrollmentObservation.TryRead(value, out observed));
            work.Check("enrollment");
            return observed;
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

        /// <summary>
        /// One GET without proxy, redirect or cache. A completed HTTP error status is a response,
        /// returned for the caller to classify and dispose; only transport outcomes throw.
        /// </summary>
        HttpWebResponse Get(string path)
        {
            var request = (HttpWebRequest)WebRequest.Create(origin + path);
            request.Proxy = null; request.AllowAutoRedirect = false;
            request.KeepAlive = false;
            request.CachePolicy = new System.Net.Cache.RequestCachePolicy(System.Net.Cache.RequestCacheLevel.NoCacheNoStore);
            request.Timeout = 1500; request.ReadWriteTimeout = 1500;
            try { return (HttpWebResponse)request.GetResponse(); }
            catch (WebException error)
            {
                var completed = error.Status == WebExceptionStatus.ProtocolError ? error.Response as HttpWebResponse : null;
                if (completed != null) return completed;
                if (error.Response != null) error.Response.Close();
                throw;
            }
        }

        LauncherFailure NotReady(WebExceptionStatus status)
        {
            return new LauncherFailure("listener-not-ready", "Port " + config.Port + " is occupied but the configured GraphGoblin gateway is not ready: " + status + ". Inspect " + Program.RenderPath(log) + ". No process was stopped.");
        }

        /// <summary>
        /// One IPv4 loopback observation without proxy, redirect, cache or shutdown action.
        /// A match needs the enrolled launch digest, a positive PID and a known phase; after this
        /// click's spawn also the fresh full fingerprint and the child's PID. A matching
        /// gateway must still resolve the enrolled store, then serve `/app/`. Identity, store,
        /// phase and web mismatches, including a definite `/app/` 404 or 410, are definitive and
        /// throw before any startup mutex; transport outcomes and other HTTP errors are Unknown.
        /// Every completed response is disposed here.
        /// </summary>
        Seen Observe()
        {
            unknown = null;
            bool listening;
            try { listening = Listening(); }
            catch (LauncherFailure inconclusive) { unknown = inconclusive; return Seen.Unknown; }
            if (!listening) return Seen.Free;
            try
            {
                string phase;
                using (var response = Get("/healthz"))
                {
                    // An HTTP error from the health route keeps its earlier, ambiguous meaning.
                    if ((int)response.StatusCode >= 400) { unknown = NotReady(WebExceptionStatus.ProtocolError); return Seen.Unknown; }
                    if (response.StatusCode != HttpStatusCode.OK || response.Headers[LaunchHeader] != enrollment.Launch ||
                        (freshInstance != null && response.Headers["X-GraphGoblin-Instance"] != freshInstance))
                        throw new LauncherFailure("foreign-listener", "Port " + config.Port + " belongs to an unrelated or differently configured service (or an older GraphGoblin build). Stop the intended gateway deliberately or correct the launcher configuration. No process was stopped.");
                    int pid;
                    if (!int.TryParse(response.Headers["X-GraphGoblin-Pid"], out pid) || pid < 1 || (spawnedPid.HasValue && spawnedPid.Value != pid))
                        throw new LauncherFailure("foreign-gateway", "The listening gateway does not belong to this startup attempt. No process was stopped.");
                    phase = response.Headers["X-GraphGoblin-Phase"];
                }
                bool closing = ClosingPhases.Contains(phase);
                if (!closing && !ObservablePhases.Contains(phase))
                    throw new LauncherFailure("unknown-phase", "The gateway returned an unrecognized shutdown phase. Inspect it before starting another gateway.");
                VerifyStore();
                if (closing) return Seen.Closing;
                using (var response = Get("/app/"))
                {
                    int status = (int)response.StatusCode;
                    // A matching gateway that definitely lacks its shell is refused at once (#566).
                    if (status != 404 && status != 410 && status >= 400) { unknown = NotReady(WebExceptionStatus.ProtocolError); return Seen.Unknown; }
                    if (response.StatusCode != HttpStatusCode.OK) throw new LauncherFailure("web-unavailable", "The gateway answers but its built web app is unavailable.");
                }
                return Seen.Ready;
            }
            catch (WebException error)
            {
                // A transport failure is not a foreign identity. Our child may still be binding;
                // elsewhere the locked re-probe decides, and a persisting one is refused.
                unknown = NotReady(error.Status);
                return Seen.Unknown;
            }
        }

        /// <summary>
        /// The configured data directory and any enrolled database lookup must currently resolve,
        /// through read-attributes handles with full sharing, to the enrolled canonical targets.
        /// </summary>
        void VerifyStore()
        {
            if (!ResolvesTo(config.DataDir, enrollment.DataDir) ||
                (enrollment.Database == "file" && !ResolvesTo(enrollment.Lookup, enrollment.Target)))
                throw new LauncherFailure("store-mismatch", "Port " + config.Port + " has a gateway with this launcher's enrolled settings, but the configured data directory or database no longer resolves to the enrolled store (for example a moved store, a retargeted link or an edited path). Stop that gateway deliberately and re-run install-windows-launcher.ps1 for the intended store. No process was stopped.");
        }

        /// <summary>
        /// One held path: its final name read from the open handle, and a reader of that same
        /// handle's full file ID. Disposing it closes the handle.
        /// </summary>
        public sealed class ResolvedPath : IDisposable
        {
            public string FinalPath;
            /// <summary>Reads the held object's full file ID; null when that proof is unavailable.</summary>
            public Func<NativeFiles.FileId> ReadId;
            /// <summary>The held handle; compiled checks substitute their own scope.</summary>
            public IDisposable Scope;
            public void Dispose() { var scope = Scope; Scope = null; if (scope != null) scope.Dispose(); }
        }

        /// <summary>
        /// Open a path once with read attributes, full sharing and backup semantics and read its final
        /// name from that handle, which stays open until the result is disposed. Null when the path
        /// cannot be opened or named.
        /// </summary>
        public static ResolvedPath Resolve(string path)
        {
            SafeFileHandle handle = null;
            try
            {
                handle = NativeFiles.Open(path, NativeFiles.ReadAttributes, NativeFiles.ShareRead | NativeFiles.ShareWrite | NativeFiles.ShareDelete, NativeFiles.OpenExisting, NativeFiles.BackupSemantics);
                if (handle.IsInvalid) return null;
                var held = handle;
                var opened = new ResolvedPath { FinalPath = NativeFiles.FinalPath(held), ReadId = () => NativeFiles.DescribeId(held), Scope = held };
                handle = null;
                return opened;
            }
            catch (System.ComponentModel.Win32Exception) { return null; }
            catch (ArgumentException) { return null; }
            finally { if (handle != null) handle.Dispose(); }
        }

        public static bool ResolvesTo(string lookup, string target)
        {
            return ResolvesTo(lookup, target, Resolve);
        }

        /// <summary>
        /// The lookup's current final path must be the enrolled canonical target. A case-sensitive
        /// directory can hold distinct objects whose names differ only in case, so a case-only
        /// difference is accepted only when the enrolled target, opened while the lookup's handle is
        /// still held, reports the same full file ID as that handle: the 64-bit volume serial and all
        /// 128 ID bits. An unavailable or unusable ID refuses, and the legacy index is never consulted.
        /// The proof covers this one comparison of two held handles, not a lasting pin of either path.
        /// The resolver is injected only by checks.
        /// </summary>
        internal static bool ResolvesTo(string lookup, string target, Func<string, ResolvedPath> resolve)
        {
            using (var current = resolve(lookup))
            {
                if (current == null || current.FinalPath == null) return false;
                if (string.Equals(current.FinalPath, target, StringComparison.Ordinal)) return true;
                if (!string.Equals(current.FinalPath, target, StringComparison.OrdinalIgnoreCase)) return false;
                using (var enrolled = resolve(target))
                {
                    if (enrolled == null) return false;
                    var held = HeldId(current);
                    return held != null && held.Same(HeldId(enrolled));
                }
            }
        }

        static NativeFiles.FileId HeldId(ResolvedPath opened) { return opened.ReadId == null ? null : opened.ReadId(); }

        /// <summary>Lock-free warm reuse. Only a ready match succeeds; anything else takes the locks.</summary>
        public bool Warm()
        {
            return Observe() == Seen.Ready;
        }

        /// <summary>Under both startup mutexes, a still ambiguous endpoint is refused, never free.</summary>
        Seen ObserveLocked()
        {
            var seen = Observe();
            if (seen == Seen.Unknown) throw unknown;
            return seen;
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

        /// <summary>
        /// Cold or release progression under the store and port mutexes, after the caller
        /// rechecked the configuration file. A matching ready gateway still succeeds with no
        /// helper; closing gateways get the existing release bounds; only a confirmed free port
        /// reaches cold prerequisites, the fresh contained enrollment and ownership checks.
        /// </summary>
        public void EnsureLocked()
        {
            var seen = ObserveLocked();
            if (seen == Seen.Ready) return;
            var releaseClock = Stopwatch.StartNew();
            while (seen == Seen.Closing)
            {
                if (ReleaseRemaining(releaseClock) <= 0) throw new LauncherFailure("still-releasing", "The existing gateway is still releasing its store. Let deliberate shutdown finish and launch again. No process was stopped.");
                Thread.Sleep((int)Math.Min(200, ReleaseRemaining(releaseClock)));
                seen = ObserveLocked();
                if (seen == Seen.Ready) return;
            }
            enter("configuration");
            config.ValidateStartup();
            enter("gateway");
            var fresh = ReadEnrollment(config, HelperProcess.WorkDeadline.Start(HelperProcess.WorkMilliseconds));
            if (!fresh.Matches(enrollment))
                throw new LauncherFailure("settings-drift", "GraphGoblin's current effective gateway settings differ from this launcher's enrollment (for example a changed default, serving root, store target or protocol). Re-run install-windows-launcher.ps1 to enroll the current settings deliberately. No gateway was started.");
            var sampleClock = Stopwatch.StartNew();
            var ownershipWork = HelperProcess.WorkDeadline.Start(HelperProcess.WorkMilliseconds);
            bool held = StoreHasLiveOwner(ownershipWork);
            long sampleMilliseconds = sampleClock.ElapsedMilliseconds;
            while (held)
            {
                long work = RecheckWork(releaseClock);
                if (work < Math.Max(200, sampleMilliseconds)) throw HeldFailure(null);
                Thread.Sleep((int)Math.Min(200, Math.Max(0, work)));
                if (ObserveLocked() == Seen.Ready) return;
                var retryWork = HelperProcess.WorkDeadline.Recheck(() => releaseClock.ElapsedMilliseconds,
                    (long)config.StartupTimeoutSeconds * 1000);
                if (retryWork.Remaining < Math.Max(200, sampleMilliseconds)) throw HeldFailure(null);
                sampleClock.Restart();
                try { held = StoreHasLiveOwner(retryWork); }
                catch (LauncherFailure failure) { throw HeldFailure(failure); }
                sampleMilliseconds = sampleClock.ElapsedMilliseconds;
            }
            LogRoot root = AdmitLogRoot(releaseClock);
            enter("configuration");
            file.Recheck(configFile);
            enter("gateway");
            ChildProcess child;
            try { child = NativeProcess.Start(config.Node, Program.Quote(Path.Combine(config.Repo, "apps/api/dist/main.js")), config.Repo, config.GatewayEnvironment(root.Path)); }
            catch (System.ComponentModel.Win32Exception) { throw new LauncherFailure("spawn-failed", "Windows could not start the configured Node runtime for the gateway. Check the Node path and the built checkout. No gateway was started."); }
            using (child)
            {
                // Readiness needs the fresh full fingerprint, the enrolled launch digest and this
                // exact child PID. A mismatch is refused; no process is ever stopped.
                freshInstance = fresh.Instance;
                spawnedPid = child.Pid;
                var deadline = DateTime.UtcNow.AddSeconds(config.StartupTimeoutSeconds);
                while (DateTime.UtcNow < deadline)
                {
                    if (Observe() == Seen.Ready) return;
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

        static readonly string[] OwnershipNames = { "state", "path", "detail" };

        /// <summary>
        /// Only the ownership wire shape, through the shared strict flat-object reader: exactly
        /// free, or held with a nonblank path and detail. The protocol itself is unchanged.
        /// </summary>
        public static bool TryReadOwnership(string text, out string state)
        {
            Ownership owner;
            bool valid = TryReadOwnership(text, out owner);
            state = valid ? owner.state : null;
            return valid;
        }

        static bool TryReadOwnership(string text, out Ownership owner)
        {
            owner = null;
            var members = FlatStringObject.Read(text, OwnershipNames);
            if (members == null) return false;
            string state, path, detail;
            members.TryGetValue("state", out state);
            members.TryGetValue("path", out path);
            members.TryGetValue("detail", out detail);
            if (state == "free" ? members.Count == 1
                : state == "held" && members.Count == 3 && !String.IsNullOrWhiteSpace(path) && !String.IsNullOrWhiteSpace(detail))
                owner = new Ownership { state = state, path = path, detail = detail };
            return owner != null;
        }

        bool StoreHasLiveOwner(HelperProcess.WorkDeadline work)
        {
            Ownership owner = null;
            ReadHelper(" --store-state", "ownership", work, value => TryReadOwnership(value, out owner));
            work.Check("ownership");
            if (owner.state == "free") return false;
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
                // The identity is written in memory before the only Save. Reopening the saved link
                // for a file-backed Commit failed with 0x80070497 (#536).
                if (!string.IsNullOrWhiteSpace(id)) { var store = (PropertyStore)link; Write(store, 5, id); Marshal.ThrowExceptionForHR(store.Commit()); }
                ((System.Runtime.InteropServices.ComTypes.IPersistFile)link).Save(path, true);
            } finally { Marshal.ReleaseComObject(link); }
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

        /// <summary>
        /// Session-local, PWA-only: keyed to the selected Chrome installation directory, profile
        /// and app ID, upper-cased like the ordinal case-insensitive window selection. It never
        /// covers gateway readiness or startup.
        /// </summary>
        public static string WindowMutexName(Configuration config)
        {
            string proxyDirectory = (Path.GetDirectoryName(config.ChromeProxy) ?? "").ToUpperInvariant();
            return "Local\\GraphGoblin.Window." + Program.Hash("graphgoblin-pwa-window/v1\0" + proxyDirectory + "\0" +
                (config.ChromeProfile ?? "").ToUpperInvariant() + "\0" + (config.ChromeAppId ?? ""));
        }

        static string Address(Configuration config) { return "http://127.0.0.1:" + config.Port.ToString(CultureInfo.InvariantCulture) + "/app/"; }

        public static LauncherFailure BrowserUnavailable(Configuration config)
        {
            return new LauncherFailure("browser-unavailable", "The verified GraphGoblin gateway is already running at " + Address(config) + ", but Windows could not start the installed Chrome app (its chrome_proxy.exe is missing or was refused). Open that address in Chrome, or reinstall the GraphGoblin Chrome app and configure the launcher again. The gateway keeps running.");
        }

        static LauncherFailure WindowBusy(Configuration config)
        {
            return new LauncherFailure("window-busy", "The verified GraphGoblin gateway is already running at " + Address(config) + ", but another GraphGoblin click is still opening its Chrome app window. Try again in a moment. The gateway keeps running.");
        }

        /// <summary>A Chrome start needs time left for at least one window poll after it.</summary>
        public const int WindowPollMilliseconds = 200;

        /// <summary>
        /// The native control points of one window handoff, read against one clock. The click binds
        /// window discovery, the PWA mutex, the Chrome start preparation, the start itself,
        /// activation and sleep; compiled checks bind deterministic ones to the same decision.
        /// </summary>
        internal sealed class WindowHandoff
        {
            public Func<long> Elapsed;
            public Func<IntPtr> Discover;
            public Func<long, bool> Acquire;
            public Action Release;
            public Func<ProcessStartInfo> Prepare;
            public Action<ProcessStartInfo> Start;
            public Action<IntPtr> Activate;
            public Action<int> Sleep;
        }

        /// <summary>
        /// After gateway readiness and with the startup mutexes released. One window budget starts
        /// before the first discovery and covers the PWA mutex, a rediscovery under it, the Chrome
        /// start and the wait for its window.
        /// </summary>
        public static void OpenPwa(Configuration config, string configFile)
        {
            var budget = Stopwatch.StartNew();
            using (var mutex = new Mutex(false, WindowMutexName(config)))
                Handoff(config, new WindowHandoff {
                    Elapsed = () => budget.ElapsedMilliseconds,
                    Discover = () => FindWindow(config),
                    Acquire = wait => {
                        try { return mutex.WaitOne(TimeSpan.FromMilliseconds(wait)); }
                        catch (AbandonedMutexException) { return true; }
                    },
                    Release = () => mutex.ReleaseMutex(),
                    Prepare = () => PrepareChrome(config),
                    Start = start => StartChrome(config, start),
                    Activate = window => Activate(window, config, configFile),
                    Sleep = Thread.Sleep,
                });
        }

        /// <summary>
        /// An existing window is activated directly. Otherwise the click waits for the PWA mutex
        /// within the remaining budget and rediscovers under it. A click with less than one poll
        /// interval left refuses at once; otherwise the proxy path check, arguments and start
        /// information are prepared first, and the final remaining-time sample is taken directly
        /// before the start is issued. Chrome starts only when at least one poll interval remains at
        /// that sample, so a near-expired click never opens a late window even when preparation used
        /// the margin; every sleep is capped to the remainder. The mutex is released after
        /// activation or refusal.
        /// </summary>
        internal static void Handoff(Configuration config, WindowHandoff native)
        {
            long limit = config.WindowTimeoutSeconds * 1000L;
            IntPtr window = native.Discover();
            if (window != IntPtr.Zero) { native.Activate(window); return; }
            if (!native.Acquire(Math.Max(0, limit - native.Elapsed()))) throw WindowBusy(config);
            try
            {
                window = native.Discover();
                if (window == IntPtr.Zero)
                {
                    if (limit - native.Elapsed() < WindowPollMilliseconds) throw WindowBusy(config);
                    var start = native.Prepare();
                    // The final admission sample: only the prepared start itself follows it.
                    if (limit - native.Elapsed() < WindowPollMilliseconds) throw WindowBusy(config);
                    native.Start(start);
                    while ((window = native.Discover()) == IntPtr.Zero)
                    {
                        long remaining = limit - native.Elapsed();
                        if (remaining <= 0) break;
                        native.Sleep((int)Math.Min(WindowPollMilliseconds, remaining));
                    }
                }
                if (window == IntPtr.Zero) throw new LauncherFailure("window-missing", "The verified GraphGoblin gateway is already running at " + Address(config) + ", but the installed Chrome GraphGoblin app did not open within " + config.WindowTimeoutSeconds.ToString(CultureInfo.InvariantCulture) + " seconds. Check its installed PWA/profile and configure the launcher again. The gateway keeps running.");
                native.Activate(window);
            }
            finally { native.Release(); }
        }

        /// <summary>The proxy path check, arguments and start information, before the final sample.</summary>
        static ProcessStartInfo PrepareChrome(Configuration config)
        {
            if (!File.Exists(config.ChromeProxy)) throw BrowserUnavailable(config);
            return new ProcessStartInfo(config.ChromeProxy, "--profile-directory=" + Program.Quote(config.ChromeProfile) + " --app-id=" + config.ChromeAppId) { UseShellExecute = false };
        }

        /// <summary>Only the prepared process start; a refused start is the handoff's browser failure.</summary>
        static void StartChrome(Configuration config, ProcessStartInfo start)
        {
            try { using (Process.Start(start)) { } }
            catch (System.ComponentModel.Win32Exception) { throw BrowserUnavailable(config); }
        }

        static void Activate(IntPtr window, Configuration config, string configFile)
        {
            string relaunch = RelaunchCommand(Application.ExecutablePath, configFile, false);
            StampWindow(window, config.LauncherAppUserModelId, relaunch, config.IconLocation ?? (Application.ExecutablePath + ",0"));
            ShowWindow(window, 9); SetForegroundWindow(window);
        }
    }
}
