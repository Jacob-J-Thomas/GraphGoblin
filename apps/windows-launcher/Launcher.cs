using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace GraphGoblin.Desktop
{
    public sealed class Configuration
    {
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
                throw new Exception("Invalid launcher paths, port or timeouts. Re-run install-windows-launcher.ps1.");
            foreach (string file in new[] { "apps/api/dist/main.js", "apps/api/dist/instance-identity.js", "apps/web/dist/index.html" })
                if (!File.Exists(Path.Combine(Repo, file)))
                    throw new Exception("The configured checkout is not built: " + file + ". Build it with Node 22 before launching.");
            Environment = Environment ?? new Dictionary<string, string>();
            foreach (var item in Environment)
                if (!item.Key.StartsWith("GG_", StringComparison.Ordinal) || item.Value == null || item.Key.IndexOfAny(new[] { '=', '\0' }) >= 0 || item.Value.Contains("\0"))
                    throw new Exception("Launcher Environment must contain GG_* string overrides only.");
            foreach (string key in new[] { "GG_HOST", "GG_PORT", "GG_DATA_DIR", "GG_WEB_DIST" })
                if (Environment.ContainsKey(key)) throw new Exception(key + " is owned by the launcher's explicit configuration fields.");
            if (!gatewayOnly && (!File.Exists(ChromeProxy ?? "") || string.IsNullOrWhiteSpace(ChromeProfile) ||
                !System.Text.RegularExpressions.Regex.IsMatch(ChromeAppId ?? "", "^[a-p]{32}$") ||
                string.IsNullOrWhiteSpace(PwaAppUserModelId) || string.IsNullOrWhiteSpace(LauncherAppUserModelId)))
                throw new Exception("The installed Chrome PWA is not configured. Re-run install-windows-launcher.ps1 with its shortcut.");
            if (!gatewayOnly && ChromeAppId != Program.ChromeAppId(Port))
                throw new Exception("The installed Chrome PWA belongs to another origin. Install GraphGoblin from http://127.0.0.1:" + Port + "/app/ and configure its shortcut.");
        }

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
    }

    public static class Program
    {
        [STAThread]
        public static int Main(string[] args)
        {
            // A winexe may have redirected pipes without a console. OutputEncoding tries to
            // change a nonexistent console code page; explicitly encode only our pipe writers.
            Console.SetOut(new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true });
            Console.SetError(new StreamWriter(Console.OpenStandardError(), new UTF8Encoding(false)) { AutoFlush = true });
            string configFile = Application.ExecutablePath + ".json";
            bool gatewayOnly = args.Contains("--ensure-gateway");
            bool quiet = gatewayOnly || args.Any(arg => new[] { "--read-shortcut-id", "--inspect-shortcut", "--expected-app-id", "--create-shortcut", "--stamp-shortcut" }.Contains(arg));
            string shortcut = null;
            string createShortcut = null;
            try
            {
                if (args.Length == 2 && args[0] == "--read-shortcut-id") { Console.WriteLine(ShellIdentity.ReadShortcut(args[1])); return 0; }
                if (args.Length == 2 && args[0] == "--inspect-shortcut") { Console.WriteLine(new JavaScriptSerializer().Serialize(ShellIdentity.InspectShortcut(args[1]))); return 0; }
                if (args.Length == 2 && args[0] == "--expected-app-id") { Console.WriteLine(ChromeAppId(int.Parse(args[1]))); return 0; }
                for (int i = 0; i < args.Length; i++)
                    if (args[i] == "--config" && i + 1 < args.Length) configFile = args[++i];
                    else if (args[i] == "--stamp-shortcut" && i + 1 < args.Length) shortcut = args[++i];
                    else if (args[i] == "--create-shortcut" && i + 1 < args.Length) createShortcut = args[++i];
                    else if (args[i] != "--ensure-gateway") throw new Exception("Unknown launcher argument: " + args[i]);
                var config = new JavaScriptSerializer().Deserialize<Configuration>(File.ReadAllText(configFile));
                config.Validate(gatewayOnly);
                if (shortcut != null) { ShellIdentity.StampShortcut(shortcut, config.LauncherAppUserModelId); return 0; }
                if (createShortcut != null) {
                    ShellIdentity.CreateShortcut(createShortcut, Application.ExecutablePath, "--config " + Program.Quote(Path.GetFullPath(configFile)) + (gatewayOnly ? " --ensure-gateway" : ""), config.IconLocation, config.LauncherAppUserModelId);
                    return 0;
                }
                string mutexName = "Local\\GraphGoblin.Launch." + Hash(config.DataDir.ToUpperInvariant());
                using (var mutex = new Mutex(false, mutexName))
                using (var portMutex = new Mutex(false, "Local\\GraphGoblin.Port." + config.Port))
                {
                    bool owned = false, portOwned = false;
                    try
                    {
                        try { owned = mutex.WaitOne(TimeSpan.FromSeconds(360)); } catch (AbandonedMutexException) { owned = true; }
                        if (!owned) throw new Exception("Another GraphGoblin launch is still waiting. Inspect launcher.log before trying again.");
                        try { portOwned = portMutex.WaitOne(TimeSpan.FromSeconds(360)); } catch (AbandonedMutexException) { portOwned = true; }
                        if (!portOwned) throw new Exception("Another GraphGoblin launcher is still checking port " + config.Port + ".");
                        new Gateway(config, Path.GetDirectoryName(Path.GetFullPath(configFile))).Ensure();
                        if (!gatewayOnly) ShellIdentity.OpenPwa(config, configFile);
                    }
                    finally { if (portOwned) portMutex.ReleaseMutex(); if (owned) mutex.ReleaseMutex(); }
                }
                return 0;
            }
            catch (Exception error)
            {
                string message = error.Message + "\r\n\r\nConfiguration: " + configFile;
                try { File.AppendAllText(Path.Combine(Path.GetDirectoryName(Path.GetFullPath(configFile)), "launcher.log"), DateTime.UtcNow.ToString("o") + " " + message + "\r\n"); } catch { }
                Console.Error.WriteLine(message);
                if (!quiet) MessageBox.Show(message, "GraphGoblin could not open", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
        }

        public static string Hash(string value)
        {
            using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(value))).Replace("-", "").ToLowerInvariant();
        }

        public static string ChromeAppId(int port)
        {
            if (port < 1 || port > 65535) throw new Exception("Invalid PWA port.");
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

    public sealed class Gateway
    {
        readonly Configuration config;
        readonly string log;
        readonly string launcherLog;
        readonly string origin;
        string expected;
        int? spawnedPid;
        bool closing;
        public Gateway(Configuration configuration, string logDirectory)
        {
            config = configuration;
            log = Path.Combine(logDirectory, "gateway.log");
            launcherLog = Path.Combine(logDirectory, "launcher.log");
            origin = "http://127.0.0.1:" + config.Port;
        }

        // Read chunks rather than lines: a diagnostic without a newline must not allocate
        // without bound. Only protocol stdout is retained; stderr may contain private values.
        sealed class HelperPipe
        {
            const int Limit = 262144;
            readonly MemoryStream captured = new MemoryStream();
            long count;
            public bool Failed { get; private set; }
            public long Count { get { return Interlocked.Read(ref count); } }
            public bool Oversized { get { return Count > Limit; } }
            public string Text { get { return new UTF8Encoding(false, true).GetString(captured.ToArray()); } }

            public async Task Drain(Stream stream, bool capture)
            {
                var buffer = new byte[4096];
                try {
                    int read;
                    while ((read = await stream.ReadAsync(buffer, 0, buffer.Length).ConfigureAwait(false)) != 0) {
                        Interlocked.Add(ref count, read);
                        if (capture && captured.Length < Limit)
                            captured.Write(buffer, 0, Math.Min(read, Limit - (int)captured.Length));
                    }
                }
                catch (IOException) { Failed = true; }
                catch (ObjectDisposedException) { Failed = true; }
                finally { stream.Dispose(); }
            }
        }

        static int Remaining(Stopwatch elapsed, int budget)
        {
            return (int)Math.Max(0, budget - elapsed.ElapsedMilliseconds);
        }

        string ReadHelper(string argument, string validOutput, string stage, int budget)
        {
            var info = new ProcessStartInfo(config.Node, Program.Quote(Path.Combine(config.Repo, "apps/api/dist/instance-identity.js")) + argument) {
                WorkingDirectory = config.Repo, UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardOutput = true, RedirectStandardError = true
            };
            info.EnvironmentVariables.Clear();
            foreach (var item in config.ChildEnvironment()) info.EnvironmentVariables[item.Key] = item.Value;
            // Charge process creation too, without pretending Windows CreateProcess itself
            // can be cancelled by a managed wait timeout.
            var elapsed = Stopwatch.StartNew();
            Process child;
            try { child = Process.Start(info); }
            catch (System.ComponentModel.Win32Exception error) {
                throw new Exception("The launcher " + stage + " check could not start Node (Windows error " + error.NativeErrorCode + "). Check the configured runtime and its execution permissions.");
            }
            using (var process = child)
            {
                var stdout = new HelperPipe(); var stderr = new HelperPipe();
                var reads = new[] { stdout.Drain(process.StandardOutput.BaseStream, true), stderr.Drain(process.StandardError.BaseStream, false) };
                bool exited = process.WaitForExit(Remaining(elapsed, budget));
                // Process exit does not establish EOF: a descendant may hold either pipe.
                bool drained = exited && Task.WaitAll(reads, Remaining(elapsed, budget));
                string observation = " after " + elapsed.ElapsedMilliseconds + " ms (budget " + budget + " ms; stdout " + stdout.Count + " bytes, stderr " + stderr.Count + " bytes)";
                if (!exited || !drained) {
                    // This is our read-only helper, never the gateway or an unrelated process.
                    string cleanup = "";
                    if (!exited) {
                        try { process.Kill(); if (!process.WaitForExit(2000)) cleanup = " Read-only helper exit could not be confirmed within the 2000 ms cleanup allowance."; }
                        catch (InvalidOperationException) { }
                        catch (System.ComponentModel.Win32Exception error) { cleanup = " Read-only helper cleanup could not be confirmed (Windows error " + error.NativeErrorCode + ")."; }
                    }
                    throw new Exception("The launcher " + stage + " check timed out" + observation + " while waiting for " + (exited ? "output closure" : "process exit") + ". No gateway was started by this attempt. Check the configured runtime and system load" + (stage == "ownership" ? ", including PowerShell and Windows Management Instrumentation availability" : "") + "." + cleanup);
                }
                if (process.ExitCode != 0)
                    throw new Exception("The launcher " + stage + " check exited with code " + process.ExitCode + observation + ". Check the Node 22 runtime, GG_* configuration and store read permissions. Helper output is not logged.");
                string output = "";
                try { if (!stdout.Oversized && !stdout.Failed && !stderr.Failed) output = stdout.Text.Trim(); }
                catch (DecoderFallbackException) { }
                if (!System.Text.RegularExpressions.Regex.IsMatch(output, validOutput))
                    throw new Exception("The launcher " + stage + " check returned invalid, oversized or unreadable output" + observation + ". Check the configured checkout and runtime. Helper output is not logged.");
                if (elapsed.ElapsedMilliseconds >= 5000) {
                    try { File.AppendAllText(launcherLog, DateTime.UtcNow.ToString("o") + " Slow launcher " + stage + " check completed" + observation + ".\r\n"); } catch { }
                }
                return output;
            }
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
                    if (!pending.Wait(3500)) throw new Exception("Could not establish whether port " + config.Port + " is free. No gateway was started; try again when local networking responds.");
                    if (client.Connected) return true;
                    throw new Exception("The local port check had no confirmed outcome. No gateway was started.");
                }
                catch (AggregateException error)
                {
                    var socket = error.GetBaseException() as SocketException;
                    if (socket != null && socket.SocketErrorCode == SocketError.ConnectionRefused) return false;
                    throw new Exception("Could not establish whether port " + config.Port + " is free. No gateway was started.", error);
                }
                catch (SocketException error)
                {
                    if (error.SocketErrorCode == SocketError.ConnectionRefused) return false;
                    throw new Exception("Could not establish whether port " + config.Port + " is free. No gateway was started.", error);
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
                        throw new Exception("Port " + config.Port + " belongs to an unrelated or differently configured service (or an older GraphGoblin build). Stop the intended gateway deliberately or correct the launcher configuration. No process was stopped.");
                    int pid;
                    if (!int.TryParse(response.Headers["X-GraphGoblin-Pid"], out pid) || pid < 1 || (spawnedPid.HasValue && spawnedPid.Value != pid))
                        throw new Exception("The listening gateway does not belong to this startup attempt. No process was stopped.");
                    string phase = response.Headers["X-GraphGoblin-Phase"];
                    if (phase == "ready" || phase == "exiting" || phase == "stopped") { closing = true; return false; }
                    if (!new[] { "running", "draining", "awaiting-choice", "forcing", "force-failed", "drain-failed" }.Contains(phase))
                        throw new Exception("The gateway returned an unrecognized shutdown phase. Inspect it before starting another gateway.");
                }
                using (var response = Get("/app/"))
                    if (response.StatusCode != HttpStatusCode.OK) throw new Exception("The gateway answers but its built web app is unavailable.");
                return true;
            }
            catch (WebException error)
            {
                // Our child may finish binding while an earlier connection attempt is failing.
                // Keep polling its known PID; a transport failure is not a foreign identity.
                if (spawnedPid.HasValue) return false;
                throw new Exception("Port " + config.Port + " is occupied but the configured GraphGoblin gateway is not ready: " + error.Status + ". Inspect " + log + ". No process was stopped.");
            }
        }

        public void Ensure()
        {
            // Keep short readiness/release waits usable with the existing helper allowance.
            // The default configuration gives cold helpers 60 seconds instead of 15.
            int helperBudget = Math.Max(15000, config.StartupTimeoutSeconds * 1000);
            expected = ReadHelper("", "^[a-f0-9]{64}$", "identity", helperBudget);
            if (Probe()) return;
            int releaseBudget = config.StartupTimeoutSeconds * 1000;
            var releaseElapsed = Stopwatch.StartNew();
            while (closing)
            {
                if (Remaining(releaseElapsed, releaseBudget) == 0) throw new Exception("The existing gateway is still releasing its store. Let deliberate shutdown finish and launch again. No process was stopped.");
                Thread.Sleep(200); if (Probe()) return;
            }
            bool owned = StoreHasLiveOwner(helperBudget);
            if (owned)
            {
                while (Remaining(releaseElapsed, releaseBudget) > 0)
                {
                    Thread.Sleep(Math.Min(200, Remaining(releaseElapsed, releaseBudget))); if (Probe()) return;
                    int remaining = Remaining(releaseElapsed, releaseBudget);
                    if (remaining == 0) break;
                    // Polls share the release budget; a last full-duration helper would
                    // otherwise extend it and replace a useful previously held diagnosis.
                    try { owned = StoreHasLiveOwner(remaining); }
                    catch (Exception error) { throw new Exception(ownershipDetail + ". " + error.Message); }
                    if (!owned) break;
                }
                if (owned) throw new Exception(ownershipDetail + ". No second gateway was started. Do not stop an unrelated process or delete an unverified lock.");
            }
            int pid = NativeProcess.Start(config.Node, Program.Quote(Path.Combine(config.Repo, "apps/api/dist/main.js")), config.Repo, config.ChildEnvironment(), log);
            spawnedPid = pid;
            var deadline = DateTime.UtcNow.AddSeconds(config.StartupTimeoutSeconds);
            Process started;
            try { started = Process.GetProcessById(pid); }
            catch (ArgumentException) { throw new Exception("GraphGoblin exited immediately during startup. Inspect " + log + "."); }
            using (var process = started)
            {
                while (DateTime.UtcNow < deadline)
                {
                    if (Probe()) return;
                    if (process.HasExited) throw new Exception("GraphGoblin exited during startup. Inspect " + log + ". Existing store locks and data were left to the gateway's normal ownership checks.");
                    Thread.Sleep(200);
                }
            }
            throw new Exception("GraphGoblin did not become ready within " + config.StartupTimeoutSeconds + " seconds. Inspect " + log + ". It may still be starting; no process was stopped. Launch again to check readiness.");
        }

        string ownershipDetail;
        sealed class Ownership { public string state, path, detail; }

        bool StoreHasLiveOwner(int budget)
        {
            string output = ReadHelper(" --store-state", "^[{].*[}]$", "ownership", budget);
            Ownership owner;
            try { owner = new JavaScriptSerializer().Deserialize<Ownership>(output); }
            catch (Exception) { throw new Exception("The launcher ownership check returned invalid output. No gateway was started. Helper output is not logged."); }
            if (owner != null && owner.state == "free") return false;
            if (owner == null || owner.state != "held" || String.IsNullOrWhiteSpace(owner.path) || String.IsNullOrWhiteSpace(owner.detail))
                throw new Exception("The launcher ownership check returned invalid output. No gateway was started. Helper output is not logged.");
            ownershipDetail = owner.detail + ": " + owner.path;
            return true;
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

        public static int Start(string executable, string arguments, string directory, SortedDictionary<string, string> environment, string log)
        {
            // FILE_APPEND_DATA makes each native write append atomically even when a failed
            // contender logs while an existing gateway still has this same log open.
            IntPtr outputHandle = CreateFile(log, 4, 3, IntPtr.Zero, 4, 0, IntPtr.Zero);
            if (outputHandle == new IntPtr(-1)) throw new System.ComponentModel.Win32Exception();
            try
            {
                IntPtr inputHandle = CreateFile("NUL", 0x80000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
                if (inputHandle == new IntPtr(-1)) throw new System.ComponentModel.Win32Exception();
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
                    // Only the NUL input and durable log are inherited. Launcher stdio pipes,
                    // mutexes and other handles must not keep the click process alive.
                    if (!CreateProcess(executable, new StringBuilder(Program.Quote(executable) + " " + arguments), IntPtr.Zero, IntPtr.Zero, true, 0x08000200 | 0x400 | 0x80000, env, directory, ref startup, out child))
                        throw new System.ComponentModel.Win32Exception();
                    CloseHandle(child.thread); CloseHandle(child.process); return child.pid;
                }
                finally {
                    if (initialized) DeleteProcThreadAttributeList(attributes);
                    Marshal.FreeHGlobal(attributes); Marshal.FreeHGlobal(handles);
                    Marshal.FreeHGlobal(env); CloseHandle(inputHandle);
                }
            }
            finally { CloseHandle(outputHandle); }
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
            throw new Exception("Windows cannot store this long taskbar relaunch command. Choose a shorter launcher installation/configuration path.");
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
            if (window == IntPtr.Zero) throw new Exception("The gateway is ready, but the installed Chrome GraphGoblin app did not open. Check its installed PWA/profile and configure the launcher again. The gateway keeps running.");
            string relaunch = RelaunchCommand(Application.ExecutablePath, configFile, false);
            StampWindow(window, config.LauncherAppUserModelId, relaunch, config.IconLocation ?? (Application.ExecutablePath + ",0"));
            ShowWindow(window, 9); SetForegroundWindow(window);
        }
    }
}
