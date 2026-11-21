// Executable regression checks, compiled with Launcher.cs on Windows CI; never installed.
using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;
using GraphGoblin.Desktop;

public static class NativeChecks
{
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CommandLineToArgvW(string command, out int count);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr value);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    static string[] Parse(string command)
    {
        int count; IntPtr values = CommandLineToArgvW(command, out count);
        if (values == IntPtr.Zero) throw new System.ComponentModel.Win32Exception();
        try { return Enumerable.Range(0, count).Select(i => Marshal.PtrToStringUni(Marshal.ReadIntPtr(values, i * IntPtr.Size))).ToArray(); }
        finally { LocalFree(values); }
    }
    static void Check(bool valid, string message) { if (!valid) throw new Exception(message); }
    static void RunRelaunch(string command)
    {
        string[] route = Parse(command);
        var info = new ProcessStartInfo(route[0], string.Join(" ", route.Skip(1).Select(Program.Quote))) {
            UseShellExecute = false, CreateNoWindow = true, RedirectStandardError = true, RedirectStandardOutput = true
        };
        using (var click = Process.Start(info))
        {
            Check(click.WaitForExit(25000), "Window relaunch route did not let the launcher exit.");
            Check(click.ExitCode == 0, "Window relaunch route failed: " + click.StandardError.ReadToEnd());
        }
    }

    /// <summary>A directory only this user, SYSTEM and Administrators can access.</summary>
    static string PrivateDirectory(string parent, string name)
    {
        string path = Path.Combine(parent, name);
        Directory.CreateDirectory(path);
        var security = new System.Security.AccessControl.DirectorySecurity();
        security.SetAccessRuleProtection(true, false);
        foreach (var sid in new[] { System.Security.Principal.WindowsIdentity.GetCurrent().User,
            new System.Security.Principal.SecurityIdentifier("S-1-5-18"), new System.Security.Principal.SecurityIdentifier("S-1-5-32-544") })
            security.AddAccessRule(new System.Security.AccessControl.FileSystemAccessRule(sid, System.Security.AccessControl.FileSystemRights.FullControl,
                System.Security.AccessControl.InheritanceFlags.ContainerInherit | System.Security.AccessControl.InheritanceFlags.ObjectInherit,
                System.Security.AccessControl.PropagationFlags.None, System.Security.AccessControl.AccessControlType.Allow));
        Directory.SetAccessControl(path, security);
        return path;
    }

    static byte[] Lines(int bytes)
    {
        var result = new byte[bytes];
        for (int i = 0; i < bytes; i++) result[i] = (byte)((i % 100 == 99 || i == bytes - 1) ? '\n' : 's');
        return result;
    }

    static ulong FileIndex(string path)
    {
        using (var handle = NativeFiles.Open(path, NativeFiles.ReadAttributes, 7, NativeFiles.OpenExisting, NativeFiles.OpenReparsePoint))
            return NativeFiles.Describe(handle).Index;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CreateHardLink(string link, string existing, IntPtr security);

    /// <summary>Bounded log, closed outcome and detached stdio regressions (#438).</summary>
    static void BoundedLogChecks(string work, string node)
    {
        // Closed child-exit outcomes: distinct codes, fixed text, exit code retained.
        var codes = new System.Collections.Generic.HashSet<string>();
        foreach (int exit in new[] { 70, 71, 72, 73, 74, 75, 1, -1073741819 })
        {
            var outcome = StartupOutcome.ForChildExit(exit, @"C:\logs");
            Check(outcome.ChildExit == exit && outcome.LogFolder == @"C:\logs", "Child exit was not retained.");
            codes.Add(outcome.Code);
        }
        Check(codes.SetEquals(new[] { "destination-in-use", "destination-unavailable", "import-failed-logged", "import-failed-unlogged", "startup-failed-logged", "startup-failed-unlogged", "unknown-exit" }), "Startup outcomes are not distinct.");
        Check(StartupOutcome.ForChildExit(72, null).Message.Contains("was written") && StartupOutcome.ForChildExit(73, null).Message.Contains("no startup diagnostic could be written"), "Written/unwritten import guidance is ambiguous.");
        Check(StartupOutcome.ForChildExit(74, null).Message.Contains("was written") && StartupOutcome.ForChildExit(75, null).Message.Contains("no startup diagnostic could be written"), "Written/unwritten startup guidance is ambiguous.");
        Check(StartupOutcome.ForChildExit(9, null).Message.Contains("exit code 9") && StartupOutcome.ForChildExit(9, null).Message.Contains("No startup diagnostic can be assumed"), "Unknown exit guidance is not fixed.");
        // A reservation conflict (child 70) and the parent's sharing violation identify no holder:
        // the guidance names neither a gateway nor another owner and makes shutdown conditional.
        foreach (LauncherFailure conflict in new[] { StartupOutcome.ForChildExit(70, @"C:\logs"), StartupOutcome.DestinationInUseFailure(@"C:\logs", 0) })
            Check(conflict.Code == "destination-in-use" && !conflict.Message.Contains("by another GraphGoblin gateway") && conflict.Message.Contains("that process was not identified") && conflict.Message.Contains("If it is a GraphGoblin gateway") && conflict.Message.Contains("once it is released"), "Destination conflict guidance attributes the holder or omits conditional recovery.");

        // Rendered locations: rooted, no control or bidi formatting characters, capped.
        Check(Program.RenderPath(@"C:\a\b") == @"C:\a\b", "A plain path was not rendered.");
        foreach (string unsafePath in new[] { "relative\\x", "C:\\bad\r\nline", "C:\\rtl\u202Etxt.exe", null })
            Check(Program.RenderPath(unsafePath) == "[location not shown]", "An unsafe location was rendered.");
        string longPath = "C:\\" + new string('d', 400) + "\\\uD83D\uDE00end";
        string capped = Program.RenderPath(longPath);
        Check(capped.Length <= Program.MaxRenderedPath && capped.StartsWith("\u2026") && capped.EndsWith("end") && !char.IsLowSurrogate(capped[1]), "A long location was not capped safely.");

        // Presentation and records never carry raw exception text.
        const string canary = "GG_LAUNCHER_RAW_CANARY C:\\secret GG_MASTER_KEY=x";
        string presented = Program.Present(new InvalidOperationException(canary), "gateway", @"C:\cfg\GraphGoblin.exe.json");
        Check(!presented.Contains("CANARY") && presented.Contains("gateway step") && presented.Contains(@"Configuration: C:\cfg\GraphGoblin.exe.json"), "Unexpected launcher errors are not closed.");
        byte[] unexpected = LauncherLog.Build(DateTime.UtcNow, 7, new InvalidOperationException(canary), "gateway", @"C:\cfg\x.json");
        Check(unexpected != null && !Encoding.UTF8.GetString(unexpected).Contains("CANARY"), "A launcher record carried raw exception text.");
        byte[] huge = LauncherLog.Build(DateTime.UtcNow, 7, StartupOutcome.ForChildExit(74, "C:\\" + new string('l', 5000)), "gateway", "C:\\" + new string('c', 5000));
        Check(huge != null && huge.Length <= LauncherLog.RecordBytes && huge[huge.Length - 1] == (byte)'\n', "A launcher record exceeded 4 KiB.");
        var parsed = (System.Collections.Generic.Dictionary<string, object>)new System.Web.Script.Serialization.JavaScriptSerializer().DeserializeObject(new UTF8Encoding(false, true).GetString(huge));
        Check((string)parsed["code"] == "startup-failed-logged" && (int)parsed["childExit"] == 74, "A launcher record is not complete JSON.");
        string[] closed = Gateway.ClosedOwnership("Store ownership could not be verified (malformed or incomplete owner record): " + canary);
        Check(closed[1] == "Store ownership could not be verified (malformed or incomplete owner record)", "Known ownership detail was not closed.");
        Check(!Gateway.ClosedOwnership("Store ownership could not be verified (" + canary + ")")[1].Contains("CANARY"), "Unknown ownership detail leaked.");

        // Built-entry marker: exact bytes within the first 4 KiB only.
        string marker = Configuration.LogProtocolMarker;
        string inside = Path.Combine(work, "inside.js"), straddle = Path.Combine(work, "straddle.js"), other = Path.Combine(work, "other.js");
        File.WriteAllText(inside, new string(' ', 4096 - marker.Length) + marker);
        File.WriteAllText(straddle, new string(' ', 4097 - marker.Length) + marker);
        File.WriteAllText(other, marker.Replace("= 1;", "= 2;"));
        Check(Configuration.HasLogProtocol(inside) && !Configuration.HasLogProtocol(straddle) && !Configuration.HasLogProtocol(other), "Entry marker edges failed.");

        // Private root admission, slot edge, rotation, repair, contention and unsafe names.
        string shared = Path.Combine(work, "shared-root");
        Directory.CreateDirectory(shared);
        var sharedSecurity = Directory.GetAccessControl(shared);
        sharedSecurity.AddAccessRule(new System.Security.AccessControl.FileSystemAccessRule(new System.Security.Principal.SecurityIdentifier("S-1-5-32-545"), System.Security.AccessControl.FileSystemRights.Read, System.Security.AccessControl.AccessControlType.Allow));
        Directory.SetAccessControl(shared, sharedSecurity);
        bool refused = false;
        try { LogRoot.Admit(shared); } catch (IOException) { refused = true; }
        Check(refused, "A root readable by Users was admitted.");

        string rootPath = PrivateDirectory(work, "private-root");
        var root = LogRoot.Admit(rootPath);
        Check(root.LauncherMutex.StartsWith(@"Global\GraphGoblin.LauncherLog.") && root.GatewayPipe.StartsWith(@"\\.\pipe\GraphGoblin.GatewayLog."), "Root keys are malformed.");
        string active = Path.Combine(root.Path, LauncherLog.Active), previous = Path.Combine(root.Path, LauncherLog.Previous);
        byte[] record = LauncherLog.Build(DateTime.UtcNow, 7, StartupOutcome.ForChildExit(70, root.Path), "gateway", @"C:\cfg\x.json");
        File.WriteAllBytes(active, Lines(LauncherLog.SlotBytes - record.Length));
        Check(LauncherLog.Append(root, record) && new FileInfo(active).Length == LauncherLog.SlotBytes && !File.Exists(previous), "The exact 256 KiB slot edge rotated or failed.");
        ulong full = FileIndex(active);
        Check(LauncherLog.Append(root, record) && FileIndex(previous) == full && new FileInfo(previous).Length == LauncherLog.SlotBytes && new FileInfo(active).Length == record.Length, "Rotation did not rename-replace and recreate.");

        File.AppendAllText(active, "{\"partial\":\"\u00e9");
        File.WriteAllBytes(active, File.ReadAllBytes(active).Take((int)new FileInfo(active).Length - 1).ToArray());
        Check(LauncherLog.Append(root, record) && new FileInfo(active).Length == record.Length * 2, "A partial trailing record was not repaired.");

        File.WriteAllBytes(active, Lines(LauncherLog.SlotBytes + 1));
        Check(LauncherLog.Append(root, record) && new FileInfo(active).Length == record.Length, "Oversized launcher history was not replaced.");

        long before = new FileInfo(active).Length;
        using (var holder = new System.Threading.Mutex(false, root.LauncherMutex))
        {
            var held = new System.Threading.ManualResetEvent(false);
            var release = new System.Threading.ManualResetEvent(false);
            var thread = new System.Threading.Thread(() => { holder.WaitOne(); held.Set(); release.WaitOne(); holder.ReleaseMutex(); });
            thread.Start(); held.WaitOne();
            var watch = Stopwatch.StartNew();
            Check(!LauncherLog.Append(root, record), "A contended record was written.");
            Check(watch.ElapsedMilliseconds < 2000, "Contention waited beyond one bounded acquisition.");
            release.Set(); thread.Join();
        }
        Check(new FileInfo(active).Length == before, "A contended append changed the launcher log.");

        string target = Path.Combine(root.Path, "protected-target");
        File.WriteAllText(target, "protected");
        File.Delete(previous);
        Check(CreateHardLink(previous, target, IntPtr.Zero), "Could not create the hard-link fixture.");
        Check(!LauncherLog.Append(root, record), "A hard-linked managed name was written.");
        Check(File.ReadAllText(target) == "protected" && new FileInfo(active).Length == before, "A refused managed target changed.");
        File.Delete(previous);
        File.Delete(target);

        // Detached gateway stdio: readable NUL stdin, writable NUL stdout/stderr, retained handle.
        string report = Path.Combine(work, "stdio.json");
        string script = "const fs=require('fs');const t=[0,1,2].map(f=>fs.fstatSync(f).isCharacterDevice());" +
            "process.stdout.write('x');process.stderr.write('y');" +
            "process.stdin.on('end',()=>{fs.writeFileSync(process.argv[1],JSON.stringify(t));process.exit(73);}).resume();";
        var env = new System.Collections.Generic.SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (System.Collections.DictionaryEntry item in Environment.GetEnvironmentVariables()) env[(string)item.Key] = (string)item.Value;
        using (var child = NativeProcess.Start(node, "-e " + Program.Quote(script) + " " + Program.Quote(report), work, env))
        {
            int code = 0;
            var deadline = DateTime.UtcNow.AddSeconds(20);
            while (!child.TryGetExit(out code)) { Check(DateTime.UtcNow < deadline, "The NUL-stdio child did not exit."); System.Threading.Thread.Sleep(50); }
            Check(code == 73, "The retained process handle did not report the child's exit code.");
        }
        Check(File.ReadAllText(report) == "[true,true,true]", "Detached stdio is not NUL character devices.");
    }

    static void HelperChecks(string work, string node)
    {
        Directory.CreateDirectory(work);
        var env = new System.Collections.Generic.SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (System.Collections.DictionaryEntry item in Environment.GetEnvironmentVariables()) env[(string)item.Key] = (string)item.Value;
        HelperProcess.CheckCapability();
        Func<string, int, string> run = (script, budget) => HelperProcess.Read(node, "-e " + Program.Quote(script), work, env, "identity", budget, text => text == "ok");
        Check(run("process.stdout.write('ok')", 5000) == "ok", "A clean helper did not succeed.");
        var slow = Stopwatch.StartNew();
        Check(run("setTimeout(()=>process.stdout.write('ok'),700)", 3000) == "ok" && slow.ElapsedMilliseconds >= 700, "Slow successful work was not awaited.");
        Check(run("process.stderr.write('PRIVATE_CANARY'.repeat(100000));process.stdout.write('ok')", 5000) == "ok", "An in-budget stderr flood deadlocked.");
        Check(run("const{spawn}=require('child_process');spawn(process.execPath,['-e','setTimeout(()=>{},250)'],{stdio:'ignore'});process.stdout.write('ok')", 5000) == "ok", "An ordinary short-lived member did not quiesce.");
        string[] scripts = {
            "process.stdout.write(Buffer.from([0xff]))",
            "process.stdout.write('x'.repeat(262145))",
            "process.stdout.write('not-the-protocol')",
            "process.exit(17)",
            "setInterval(()=>{process.stdout.write('x'.repeat(8192));process.stderr.write('PRIVATE_CANARY')},1)",
            "setInterval(()=>process.stderr.write('PRIVATE_CANARY'.repeat(1024)),1)",
        };
        string[] codes = { "helper-invalid", "helper-invalid", "helper-invalid", "helper-refused", "helper-invalid", "helper-timeout" };
        for (int i = 0; i < scripts.Length; i++) {
            var clock = Stopwatch.StartNew();
            try { run(scripts[i], 1200); throw new Exception("Invalid helper succeeded."); }
            catch (LauncherFailure refused) {
                Check(refused.Code == codes[i], "Unexpected closed helper outcome at case " + i + ": " + refused.Code);
                Check(!Program.Present(refused, "gateway", @"C:\fixture\launcher.json").Contains("PRIVATE_CANARY"), "Helper output reached presentation.");
                Check(!Encoding.UTF8.GetString(LauncherLog.Build(DateTime.UtcNow, 1, refused, "gateway", @"C:\fixture\launcher.json")).Contains("PRIVATE_CANARY"), "Helper output reached the bounded log.");
                if (i == 3) Check(refused.ChildExit == 17, "Natural nonzero status was lost.");
            }
            Check(clock.ElapsedMilliseconds < 4500, "A helper exceeded work plus shared cleanup allowance.");
        }
        // The same executable survives outside the helper's private job. No PID walk is used.
        using (var sentinel = Process.Start(new ProcessStartInfo(node, "-e " + Program.Quote("setInterval(()=>{},1000)")) { UseShellExecute = false, CreateNoWindow = true }))
        try {
            foreach (string mode in new[] { "both", "stdout", "stderr", "neither" }) {
                string token = Guid.NewGuid().ToString("N"), marker = Path.Combine(work, token), nested = marker + "nested";
                Process member = null, grandchild = null, helperRoot = null; Exception observedError = null;
                var observer = new System.Threading.Thread(() => {
                    try {
                        foreach (string file in new[] { marker, nested }) {
                            var clock = Stopwatch.StartNew();
                            while (!File.Exists(file)) { Check(clock.ElapsedMilliseconds < 7000, "Fixture handshake missing."); System.Threading.Thread.Sleep(2); }
                            int pid = 0;
                            while (pid == 0) {
                                try { int.TryParse(File.ReadAllText(file), out pid); } catch (IOException) { }
                                Check(clock.ElapsedMilliseconds < 7000, "Fixture handshake bytes missing.");
                                if (pid == 0) System.Threading.Thread.Sleep(2);
                            }
                            var exact = Process.GetProcessById(pid); IntPtr handle = exact.Handle;
                            using (var ack = System.Threading.EventWaitHandle.OpenExisting(@"Local\GG.Check." + token + (file == nested ? "n" : ""))) ack.Set();
                            if (file == marker) member = exact; else grandchild = exact;
                        }
                        helperRoot = Process.GetProcessById(int.Parse(File.ReadAllText(marker + ".root")));
                        IntPtr rootHandle = helperRoot.Handle;
                        File.WriteAllText(marker + ".root-ack", "ready");
                    } catch (Exception error) { observedError = error; }
                });
                observer.Start();
                var json = new System.Web.Script.Serialization.JavaScriptSerializer();
                string stdio = mode == "both" ? "['ignore','inherit','inherit']" : mode == "stdout" ? "['ignore','inherit','ignore']" : mode == "stderr" ? "['ignore','ignore','inherit']" : "'ignore'";
                string script = "const fs=require('fs'),{spawn}=require('child_process');fs.writeFileSync(" + json.Serialize(marker + ".root") + ",String(process.pid));" +
                    "spawn(" + json.Serialize(Application.ExecutablePath) + ",[ '--helper-member'," + json.Serialize(token) + "," + json.Serialize(marker) + "," + json.Serialize(nested) + "],{stdio:" + stdio + ",windowsHide:true,detached:true});" +
                    "const t=setInterval(()=>{if(fs.existsSync(" + json.Serialize(nested + ".ready") + ")&&fs.existsSync(" + json.Serialize(marker + ".root-ack") + ")){clearInterval(t);process.stdout.write('ok');process.exit(23)}},5);";
                var elapsed = Stopwatch.StartNew();
                try { run(script, 2500); throw new Exception("A helper with a live descendant succeeded."); }
                catch (LauncherFailure refused) { Check(refused.Code == "helper-timeout", "A live member did not exhaust the work budget: " + refused.Code); }
                observer.Join();
                if (observedError != null) throw observedError;
                using (helperRoot) { Check(helperRoot.WaitForExit(0) && helperRoot.ExitCode == 23, "An exited root lost its natural exit status."); }
                Check(elapsed.ElapsedMilliseconds < 5500, "Nested cleanup exceeded the shared allowance.");
                foreach (Process exact in new[] { member, grandchild }) using (exact) {
                    Check(exact.WaitForExit((int)Math.Max(0, 4500 - elapsed.ElapsedMilliseconds)), "A known descendant survived cleanup.");
                    uint actual; Check(GetExitCodeProcess(exact.Handle, out actual), "Could not query the retained fixture handle.");
                    Check(actual == HelperProcess.TerminationExit, "A descendant was not collected by the owned job: " + actual);
                }
                Check(!sentinel.HasExited, "An unrelated same-executable sentinel was stopped.");
                Check(run("process.stdout.write('ok')", 5000) == "ok", "A separate repeated helper was affected.");
                Console.WriteLine("helper-fixture " + mode + " cleanup-confirmed elapsed-ms=" + elapsed.ElapsedMilliseconds);
            }
        } finally { if (!sentinel.HasExited) { sentinel.Kill(); sentinel.WaitForExit(2000); } }
        // Synthetic latency, deliberately separate from real WMI. Four serial five-second
        // probes cannot fit the preserved initial cap, even if each would eventually succeed.
        var fourProbes = Stopwatch.StartNew();
        try {
            run("let n=0;const t=setInterval(()=>{if(++n===4){clearInterval(t);process.stdout.write('ok')}},5000)", HelperProcess.WorkMilliseconds);
            throw new Exception("Four slow probes escaped the initial work cap.");
        } catch (LauncherFailure refused) { Check(refused.Code == "helper-timeout", "Synthetic four-probe timeout was misclassified."); }
        Check(fourProbes.ElapsedMilliseconds >= 15000 && fourProbes.ElapsedMilliseconds < 18000, "The initial work cap changed.");
    }

    [STAThread]
    public static int Main(string[] args)
    {
        try
        {
            if (args[0] == "--helper-checks")
            {
                HelperChecks(args[1], args[2]);
                Console.WriteLine("Native helper job, pipe and deadline checks passed."); return 0;
            }
            if (args[0] == "--helper-member")
            {
                // A generation-specific handshake keeps this exact fixture alive until its
                // observer has retained its handle. Parent exit and broken stdio are irrelevant.
                string token = args[1];
                using (var ready = new System.Threading.EventWaitHandle(false, System.Threading.EventResetMode.ManualReset, @"Local\GG.Check." + token))
                {
                    File.WriteAllText(args[2], Process.GetCurrentProcess().Id.ToString());
                    if (!ready.WaitOne(10000)) return 91;
                    File.WriteAllText(args[2] + ".ready", "ready");
                    if (args.Length == 4) {
                        var nested = new ProcessStartInfo(Application.ExecutablePath, "--helper-member " + Program.Quote(token + "n") + " " + Program.Quote(args[3])) { UseShellExecute = false, CreateNoWindow = true };
                        using (var child = Process.Start(nested)) { }
                    }
                    System.Threading.Thread.Sleep(System.Threading.Timeout.Infinite);
                }
                return 92;
            }
            if (args[0] == "--bounded-log-checks")
            {
                BoundedLogChecks(args[1], args[2]);
                Console.WriteLine("Native bounded log, closed outcome and NUL stdio checks passed."); return 0;
            }
            if (args[0] == "--window-fixture")
            {
                using (var window = new Form())
                {
                    window.FormClosed += (sender, unused) => Application.ExitThread();
                    File.WriteAllText(args[1], window.Handle.ToInt64().ToString());
                    Application.Run(); // Pump a real HWND without showing an unsolicited window.
                }
                return 0;
            }
            if (args[0] == "--close-window") { PostMessage(new IntPtr(long.Parse(args[1])), 0x10, IntPtr.Zero, IntPtr.Zero); return 0; }
            if (args[0] == "--stamp-window")
            {
                ShellIdentity.StampWindow(new IntPtr(long.Parse(args[1])), "GraphGoblin.NativeChecks", ShellIdentity.RelaunchCommand(args[2], args[3], true), args[2] + ",0");
                return 0;
            }
            if (args[0] == "--relaunch-window")
            {
                IntPtr window = new IntPtr(long.Parse(args[1]));
                Check(ShellIdentity.WindowIdentity(window) == "GraphGoblin.NativeChecks", "Cross-process AppUserModelID was lost after stamper exit.");
                RunRelaunch(ShellIdentity.WindowRelaunchCommand(window));
                Console.WriteLine("Cross-process HWND metadata survived stamper exit and relaunched gateway."); return 0;
            }
            foreach (string value in new[] { "", "space here", "Unicode-α", "quote\"here", "trailing\\", "path space\\", "before\\\"quote" })
                Check(Parse("program " + Program.Quote(value))[1] == value, "Windows command-line round trip failed.");
            Check(Program.ChromeAppId(4747) == "nljkfhhecccnbhfdehkclniddmacgnck", "Chromium manifest app ID known vector failed.");
            Check(Program.ChromeAppId(4831) != Program.ChromeAppId(4747), "PWA origin must include the port.");

            // Real HWND and COM property store: catches ABI/layout errors that mocks cannot.
            using (var window = new Form())
            {
                string command = ShellIdentity.RelaunchCommand(args[0], args[1], true);
                ShellIdentity.StampWindow(window.Handle, "GraphGoblin.NativeChecks", command, args[0] + ",0");
                Check(ShellIdentity.WindowIdentity(window.Handle) == "GraphGoblin.NativeChecks", "Native window AppUserModelID did not persist.");
                string observed = ShellIdentity.WindowRelaunchCommand(window.Handle);
                Check(observed == command, "Native relaunch command did not preserve explicit configuration.");
                // Execute the command read back from the native window, with a cold gateway.
                // This establishes its route; actual Explorer taskbar pinning is separate QA.
                RunRelaunch(observed);
            }
            Console.WriteLine("Native quote/manifest/HWND COM/relaunch route checks passed."); return 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error); return 1; }
    }
}
