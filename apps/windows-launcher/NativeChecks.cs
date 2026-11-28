// Executable regression checks, compiled with Launcher.cs on Windows CI; never installed.
using System;
using System.Collections.Generic;
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
        // Slow-success note (ADR-0092): closed check names, fixed text and integers only.
        byte[] slow = LauncherLog.BuildSlowCheck(DateTime.UtcNow, 7, "ownership", 16012, 25000, 17, 300000);
        var note = (System.Collections.Generic.Dictionary<string, object>)new System.Web.Script.Serialization.JavaScriptSerializer().DeserializeObject(new UTF8Encoding(false, true).GetString(slow));
        Check(slow.Length <= LauncherLog.RecordBytes && slow[slow.Length - 1] == (byte)'\n' && note.Count == 10 &&
            (string)note["outcome"] == "slow-check" && (string)note["stage"] == "gateway" && (string)note["check"] == "ownership" &&
            (int)note["pid"] == 7 && (int)note["elapsedMs"] == 16012 && (int)note["allowanceMs"] == 25000 &&
            (int)note["stdoutBytes"] == 17 && (int)note["stderrBytes"] == 300000 &&
            (string)note["message"] == "The read-only ownership check succeeded slowly.", "A slow-check note is not the closed record.");
        Check(LauncherLog.BuildSlowCheck(DateTime.UtcNow, 7, "enrollment", 5000, 15000, 0, 0) != null && LauncherLog.BuildSlowCheck(DateTime.UtcNow, 7, canary, 5000, 15000, 0, 0) == null, "A slow-check note accepted an open check name.");
        LauncherLog.RecordSlowCheck(null, "ownership", 5000, 15000, 0, 0); // a dropped note never throws
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
        LauncherLog.RecordSlowCheck(Path.Combine(shared, "GraphGoblin.exe.json"), "ownership", 5000, 15000, 0, 0);
        Check(!File.Exists(Path.Combine(shared, LauncherLog.Active)), "A slow-check note was written to an unsafe root.");

        string rootPath = PrivateDirectory(work, "private-root");
        var root = LogRoot.Admit(rootPath);
        Check(root.LauncherMutex.StartsWith(@"Global\GraphGoblin.LauncherLog.") && root.GatewayPipe.StartsWith(@"\\.\pipe\GraphGoblin.GatewayLog."), "Root keys are malformed.");
        string active = Path.Combine(root.Path, LauncherLog.Active), previous = Path.Combine(root.Path, LauncherLog.Previous);
        LauncherLog.RecordSlowCheck(Path.Combine(rootPath, "GraphGoblin.exe.json"), "enrollment", 5000, 15000, 0, 0);
        Check(LauncherLog.Append(root, slow) && File.ReadAllLines(active).Length == 2 && File.ReadAllText(active).EndsWith(Encoding.UTF8.GetString(slow)), "Slow-check notes did not use the bounded launcher pair.");
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
        Func<string, int, string> run = (script, budget) => {
            var deadline = HelperProcess.WorkDeadline.Start(budget);
            return HelperProcess.Read(node, "-e " + Program.Quote(script), work, env, "identity", deadline, text => text.Trim() == "ok");
        };
        Check(run("process.stdout.write('ok')", 5000) == "ok", "A clean helper did not succeed.");
        string expiredMarker = Path.Combine(work, "expired-helper-must-not-start");
        try {
            var expired = HelperProcess.WorkDeadline.Start(0);
            HelperProcess.Read(node, "-e " + Program.Quote("require('fs').writeFileSync(process.argv[1],'started')") + " " + Program.Quote(expiredMarker),
                work, env, "identity", expired, text => true);
            throw new Exception("An expired caller deadline admitted a helper.");
        }
        catch (LauncherFailure refused) { Check(refused.Code == "helper-timeout" && !File.Exists(expiredMarker), "Expired work started a helper or changed its refusal."); }
        long validationClock = 0;
        try {
            HelperProcess.Read(node, "-e " + Program.Quote("process.stdout.write('ok')"), work, env, "identity",
                new HelperProcess.WorkDeadline(() => validationClock, 5000), text => { validationClock = 5000; return text == "ok"; });
            throw new Exception("Validation at the caller deadline succeeded.");
        }
        catch (LauncherFailure refused) { Check(refused.Code == "helper-timeout", "Late validation changed the closed refusal."); }
        string raw = null;
        var paddedWork = HelperProcess.WorkDeadline.Start(5000);
        Check(HelperProcess.Read(node, "-e " + Program.Quote("process.stdout.write(' \\tok\\n')"), work, env, "identity", paddedWork,
            text => { raw = text; return text == " \tok\n"; }) == "ok" && raw == " \tok\n", "The validator did not receive the untrimmed decoded response.");
        Check(run("process.stdout.write('ok'+' '.repeat(262142))", 5000) == "ok", "The exact byte-cap identity padding behavior changed.");
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
        // Measured diagnostics (ADR-0092): stage, fixed outcome, launcher-measured integers only.
        const string invalidOutcome = "returned invalid or oversized output";
        string[] outcomes = { invalidOutcome, invalidOutcome, invalidOutcome, "exited with code 17", invalidOutcome, "timed out" };
        long[] stdoutCounts = { 1, 262145, 16, 0, -1, 0 }; // -1: anything beyond the 256 KiB cap
        for (int i = 0; i < scripts.Length; i++) {
            var clock = Stopwatch.StartNew();
            try { run(scripts[i], 1200); throw new Exception("Invalid helper succeeded."); }
            catch (LauncherFailure refused) {
                Check(refused.Code == codes[i], "Unexpected closed helper outcome at case " + i + ": " + refused.Code);
                Check(!Program.Present(refused, "gateway", @"C:\fixture\launcher.json").Contains("PRIVATE_CANARY"), "Helper output reached presentation.");
                Check(!Encoding.UTF8.GetString(LauncherLog.Build(DateTime.UtcNow, 1, refused, "gateway", @"C:\fixture\launcher.json")).Contains("PRIVATE_CANARY"), "Helper output reached the bounded log.");
                if (i == 3) Check(refused.ChildExit == 17, "Natural nonzero status was lost.");
                var seen = System.Text.RegularExpressions.Regex.Match(refused.Observation ?? "",
                    @"\A\(identity check (.+) after (\d+) ms of its 1200 ms allowance; stdout (\d+) bytes, stderr (\d+) bytes\)\z");
                Check(seen.Success && refused.Message.Contains(refused.Observation) && seen.Groups[1].Value == outcomes[i],
                    "A helper failure lacks its measured stage, outcome or allowance at case " + i + ".");
                long elapsed = long.Parse(seen.Groups[2].Value), stdoutBytes = long.Parse(seen.Groups[3].Value), stderrBytes = long.Parse(seen.Groups[4].Value);
                Check(stdoutCounts[i] >= 0 ? stdoutBytes == stdoutCounts[i] : stdoutBytes > HelperProcess.OutputBytes, "The stdout byte count is wrong at case " + i + ": " + stdoutBytes);
                if (i == 5) Check(elapsed >= 1200 && stderrBytes > 0, "A timeout lost its elapsed time or stderr count.");
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
        // Synthetic latency, deliberately separate from real WMI. At the 15-second floor (the
        // installer's enrollment allowance, and a cold click whose StartupTimeoutSeconds is 15 or
        // less) four serial five-second probes still cannot fit, even if each would succeed.
        // Larger configured allowances are driven through the public CLI (ADR-0092).
        var fourProbes = Stopwatch.StartNew();
        try {
            run("let n=0;const t=setInterval(()=>{if(++n===4){clearInterval(t);process.stdout.write('ok')}},5000)", HelperProcess.WorkMilliseconds);
            throw new Exception("Four slow probes escaped the 15-second work floor.");
        } catch (LauncherFailure refused) { Check(refused.Code == "helper-timeout", "Synthetic four-probe timeout was misclassified."); }
        Check(fourProbes.ElapsedMilliseconds >= 15000 && fourProbes.ElapsedMilliseconds < 18000, "The 15-second work floor changed.");
    }

    /// <summary>The same immutable cutoff and operation guard used by caller preparation.</summary>
    static void WorkDeadlineChecks()
    {
        Action<Action> timeout = operation => {
            try { operation(); throw new Exception("Expired work was accepted."); }
            catch (LauncherFailure refused) { Check(refused.Code == "helper-timeout", "The work cutoff changed its closed refusal."); }
        };
        // ADR-0092: a cold click's allowance is max(15, StartupTimeoutSeconds) seconds; the
        // installer's enrollment keeps the 15-second floor.
        Check(HelperProcess.ConfiguredAllowance(1) == 15000 && HelperProcess.ConfiguredAllowance(15) == 15000 &&
            HelperProcess.ConfiguredAllowance(16) == 16000 && HelperProcess.ConfiguredAllowance(25) == 25000 &&
            HelperProcess.ConfiguredAllowance(60) == 60000 && HelperProcess.ConfiguredAllowance(300) == 300000 &&
            HelperProcess.WorkMilliseconds == 15000, "The configured helper allowance is not max(15, StartupTimeoutSeconds) seconds.");
        long floor = HelperProcess.ConfiguredAllowance(1);
        foreach (long finishedAt in new long[] { 249, 250, 251 }) {
            long clock = 0;
            var work = HelperProcess.WorkDeadline.Recheck(() => clock, 2250, floor);
            Check(work.Remaining == 250, "A retry did not preserve the two-second cleanup reserve.");
            Func<string> read = () => work.Within("ownership", () => { clock = finishedAt; return "free"; });
            if (finishedAt < 250) Check(read() == "free", "On-time free work was refused.");
            else timeout(() => read());
        }
        foreach (long enteredAt in new long[] { 250, 251 }) {
            long clock = 0; int calls = 0;
            var work = HelperProcess.WorkDeadline.Recheck(() => clock, 2250, floor);
            clock = enteredAt;
            timeout(() => work.Within("ownership", () => { calls++; return "free"; }));
            Check(calls == 0, "Expired admission ran preparation or helper work.");
        }
        long now = 0; int creations = 0;
        var setup = HelperProcess.WorkDeadline.Recheck(() => now, 2250, floor);
        timeout(() => setup.Within("ownership", () => { now = 250; setup.Check("ownership"); creations++; return "free"; }));
        Check(creations == 0, "Preparation crossing expiry admitted native creation.");
        now = 0;
        var omittedSetup = HelperProcess.WorkDeadline.Recheck(() => now, 2250, floor);
        now = 50;
        Check(omittedSetup.Remaining == 200, "Preparation was rebased out of the work cutoff.");
        timeout(() => omittedSetup.Within("ownership", () => { now += 225; return "free"; }));
        now = 0;
        var returnedLate = HelperProcess.WorkDeadline.Recheck(() => now, 2250, floor);
        timeout(() => returnedLate.Within("ownership", () => { now = 249; returnedLate.Check("ownership"); now = 250; return "free"; }));
        // A 40-second startup timeout: the configured 40-second cap cannot outlast the shared
        // release window, so the retry ends at the window's end less the cleanup reserve.
        now = 1000;
        var configured = HelperProcess.WorkDeadline.Recheck(() => now, 40000, HelperProcess.ConfiguredAllowance(40));
        Check(configured.Remaining == 37000 && configured.Allowance == 37000, "A configured retry did not end at the release window less the cleanup reserve.");
        now = 37999; configured.Check("ownership");
        now = 38000; timeout(() => configured.Check("ownership"));
        // The cap still binds whenever it is the earlier cutoff.
        now = 1000;
        var capped = HelperProcess.WorkDeadline.Recheck(() => now, 40000, floor);
        Check(capped.Remaining == 15000, "A retry exceeded its allowance cap.");
        now = 15999; capped.Check("ownership");
        now = 16000; timeout(() => capped.Check("ownership"));
        var initial = HelperProcess.WorkDeadline.Start(HelperProcess.ConfiguredAllowance(25));
        Check(initial.Allowance == 25000 && initial.Remaining > 15000 && initial.Remaining <= 25000, "The initial deadline did not follow the configured allowance.");
        var installer = HelperProcess.WorkDeadline.Start(HelperProcess.WorkMilliseconds);
        Check(installer.Allowance == 15000 && installer.Remaining <= 15000, "The installer enrollment deadline exceeded 15 seconds.");
        now = 250;
        var noReserve = HelperProcess.WorkDeadline.Recheck(() => now, 2000, floor);
        Check(noReserve.Remaining == 0 && noReserve.Expired, "An exhausted cleanup reserve granted new work.");
        // Measured diagnostics count from the check's own admission, not the release clock's origin.
        now = 1000;
        var measured = HelperProcess.WorkDeadline.Recheck(() => now, 9000, floor);
        measured.StdoutBytes = 64; measured.StderrBytes = 300000;
        now = 6999; measured.Check("ownership");
        now = 8000;
        try { measured.Check("ownership"); throw new Exception("An expired measured check was accepted."); }
        catch (LauncherFailure refused) {
            const string observation = "(ownership check timed out after 7000 ms of its 6000 ms allowance; stdout 64 bytes, stderr 300000 bytes)";
            Check(refused.Code == "helper-timeout" && refused.Observation == observation &&
                refused.Message == "The read-only ownership check exceeded its work budget " + observation + ". Check PowerShell and Windows Management Instrumentation availability. No gateway was started.",
                "A timeout lost its closed measured text.");
        }
    }

    /// <summary>Deterministic decision evidence, not a delayed-kernel-cleanup experiment.</summary>
    static void CleanupDeadlineChecks()
    {
        int observations = 0;
        Check(!HelperProcess.AwaitCleanup(() => { observations++; return observations == 2; },
            () => observations == 1 ? 1999 : 2001) && observations == 2,
            "A first completion after the deadline was credited.");
        Check(!HelperProcess.AwaitCleanup(() => true, () => 2000), "Equality at the cleanup deadline was credited.");
        Check(HelperProcess.AwaitCleanup(() => true, () => 1999), "In-budget completion was refused.");
        long clock = 1999;
        Check(!HelperProcess.AwaitCleanup(() => { clock = 2001; return true; }, () => clock),
            "The deadline was sampled before a poll that crossed it.");
        observations = 0;
        Check(!HelperProcess.AwaitCleanup(() => { observations++; return false; }, () => 2000) && observations == 1,
            "An expired incomplete observation started another poll.");
        observations = 0;
        Check(HelperProcess.AwaitCleanup(() => ++observations == 2, () => observations == 1 ? 1998 : 1999) && observations == 2,
            "A later in-budget completion was refused.");
    }

    static void Refuses(Action action, string code, string message)
    {
        try { action(); }
        catch (LauncherFailure refused) { Check(refused.Code == code, message + " (" + refused.Code + ")"); return; }
        catch (Exception error) { Check(code == "configuration" && error.GetType().Name == "ConfigurationRefusal", message + " (" + error.GetType().Name + ")"); return; }
        throw new Exception(message + " (accepted)");
    }

    static Configuration GatewayConfig(string work)
    {
        return new Configuration {
            Repo = @"C:\gg\checkout", Node = @"C:\gg\node\node.exe", DataDir = Path.Combine(work, "store"), Port = 4831,
            StartupTimeoutSeconds = 15, WindowTimeoutSeconds = 2,
            Environment = new System.Collections.Generic.Dictionary<string, string> { { "GG_LOG_LEVEL", "info" }, { "GG_OLLAMA_ENABLED", "false" } }
        };
    }

    /// <summary>Enrollment record, input binding, strict helper parser and configuration snapshot (#566).</summary>
    static void EnrollmentChecks(string work)
    {
        Directory.CreateDirectory(work);
        var config = GatewayConfig(work);
        config.Validate(true);
        string digest = config.GatewayInputsDigest();
        Check(System.Text.RegularExpressions.Regex.IsMatch(digest, "\\A[a-f0-9]{64}\\z") && config.GatewayInputsDigest() == digest, "The input digest is not a stable SHA-256.");
        var reordered = GatewayConfig(work);
        reordered.Environment = new System.Collections.Generic.Dictionary<string, string> { { "GG_OLLAMA_ENABLED", "false" }, { "GG_LOG_LEVEL", "info" } };
        Check(reordered.GatewayInputsDigest() == digest, "Override insertion order changed the input digest.");
        var seen = new System.Collections.Generic.HashSet<string> { digest };
        foreach (Action<Configuration> change in new Action<Configuration>[] {
            c => c.Repo = @"C:\gg\other", c => c.Node = @"C:\gg\node\other.exe", c => c.DataDir += "x", c => c.Port = 4832,
            c => c.Environment["GG_LOG_LEVEL"] = "debug", c => c.Environment.Remove("GG_LOG_LEVEL"),
            c => c.Environment["GG_REQUIRE_API_KEY"] = "true",
            // Length prefixes keep field boundaries unambiguous.
            c => { c.Repo = @"C:\gg\checkoutC:\gg\node"; c.Node = @"\node.exe"; },
            c => { c.Environment.Remove("GG_LOG_LEVEL"); c.Environment["GG_LOG_LEVELinfo"] = ""; },
        })
        {
            var other = GatewayConfig(work); change(other);
            Check(seen.Add(other.GatewayInputsDigest()), "A gateway input change kept an earlier input digest.");
        }
        var pwa = GatewayConfig(work);
        pwa.ChromeProxy = @"C:\elsewhere\chrome_proxy.exe"; pwa.ChromeProfile = "Profile 9"; pwa.IconLocation = @"C:\icon.ico,0";
        Check(pwa.GatewayInputsDigest() == digest, "PWA-only fields entered the input digest.");
        var duplicate = GatewayConfig(work);
        duplicate.Environment["GG_Log_Level"] = "debug";
        Refuses(() => duplicate.Validate(true), "configuration", "Case-insensitive duplicate overrides were admitted.");

        // The installed record: complete, current, rooted and bound to these exact inputs.
        string launch = "v1:" + new string('a', 64);
        Func<Enrollment> valid = () => new Enrollment { Version = 1, Launch = launch, DataDir = config.DataDir, Database = "file",
            Lookup = Path.Combine(work, "alias", "graphgoblin.db"), Target = Path.Combine(config.DataDir, "graphgoblin.db"), Inputs = digest };
        config.Enrollment = valid(); config.ValidateEnrollment();
        config.Enrollment = new Enrollment { Version = 1, Launch = launch, DataDir = config.DataDir, Database = "non-file", Inputs = digest };
        config.ValidateEnrollment();
        foreach (Action<Enrollment> damage in new Action<Enrollment>[] {
            e => e.Version = 2, e => e.Launch = "v2:" + new string('a', 64), e => e.Launch = "v1:" + new string('A', 64),
            e => e.Launch = new string('a', 64), e => e.DataDir = "relative", e => e.DataDir = null, e => e.Database = "memory",
            e => e.Target = null, e => e.Lookup = "relative.db", e => e.Inputs = new string('0', 64), e => e.Inputs = null,
            e => { e.Database = "non-file"; },
        })
        {
            var damaged = valid(); damage(damaged); config.Enrollment = damaged;
            Refuses(() => config.ValidateEnrollment(), "configuration", "A damaged or unbound enrollment was admitted.");
        }
        config.Enrollment = null;
        Refuses(() => config.ValidateEnrollment(), "configuration", "A configuration without enrollment was admitted.");
        var edited = GatewayConfig(work); edited.Validate(true); edited.Enrollment = valid(); edited.DataDir += "-edited";
        Refuses(() => edited.ValidateEnrollment(), "configuration", "An edited DataDir kept its enrollment.");

        // Strict helper record: one flat object of strings with exact shapes.
        var json = new System.Web.Script.Serialization.JavaScriptSerializer();
        string dir = json.Serialize(config.DataDir), lookup = json.Serialize(Path.Combine(work, "alias", "graphgoblin.db")),
            target = json.Serialize(Path.Combine(config.DataDir, "graphgoblin.db")), instance = new string('b', 64);
        string fileRecord = "{\"version\":\"1\",\"launch\":\"" + launch + "\",\"instance\":\"" + instance + "\",\"dataDir\":" + dir +
            ",\"database\":\"file\",\"lookup\":" + lookup + ",\"target\":" + target + "}\n";
        string nonFileRecord = "{\"version\":\"1\",\"launch\":\"" + launch + "\",\"instance\":\"" + instance + "\",\"dataDir\":" + dir + ",\"database\":\"non-file\"}\n";
        EnrollmentObservation observed;
        Check(EnrollmentObservation.TryRead(fileRecord, out observed) && observed.Instance == instance && observed.Target == Path.Combine(config.DataDir, "graphgoblin.db"), "A valid file enrollment was refused.");
        Check(observed.Matches(valid()) && observed.ToEnrollment(config).Inputs == digest, "A file observation did not match its own record.");
        var moved = valid(); moved.Target += "x";
        Check(!observed.Matches(moved), "A different store target matched.");
        Check(EnrollmentObservation.TryRead(nonFileRecord, out observed) && observed.Database == "non-file" && observed.Lookup == null, "A valid non-file enrollment was refused.");
        Check(EnrollmentObservation.TryRead(" \t{ \"v\\u0065rsion\" : \"1\" ," + nonFileRecord.Substring(15), out observed), "Legal JSON whitespace and escapes were refused.");
        foreach (string invalid in new[] {
            nonFileRecord.Replace("\"version\":\"1\"", "\"version\":\"2\""),
            nonFileRecord.Replace("\"version\":\"1\"", "\"version\":1"),
            nonFileRecord.Replace("\"version\":\"1\",", "\"version\":\"1\",\"vers\\u0069on\":\"1\","),
            nonFileRecord.Replace("}", ",\"extra\":\"x\"}"),
            nonFileRecord.Replace(launch, launch.ToUpperInvariant().Replace("V1:", "v1:")),
            nonFileRecord.Replace(launch, launch.Substring(3)),
            nonFileRecord.Replace(instance, instance.Substring(1)),
            nonFileRecord.Replace(dir, "\"relative\\\\store\""),
            nonFileRecord.Replace(dir, "\"C:\\\\store\\u0001\""),
            nonFileRecord.Replace("}", ",\"lookup\":" + lookup + "}"),
            fileRecord.Replace(",\"target\":" + target, ""),
            fileRecord.Replace("\"database\":\"file\"", "\"database\":\"memory\""),
            nonFileRecord.TrimEnd('\n') + "{}",
            nonFileRecord.Replace("\"version\"", "version"),
            "\u00a0" + nonFileRecord,
            "",
        })
            Check(!EnrollmentObservation.TryRead(invalid, out observed), "An invalid enrollment record was admitted: " + invalid.Length);

        // The ownership protocol keeps its exact accepted shapes through the shared reader.
        string state;
        Check(Gateway.TryReadOwnership("{\"state\":\"free\"}\n", out state) && state == "free", "Producer free ownership was refused.");
        Check(Gateway.TryReadOwnership("{\"detail\":\"d\",\"p\\u0061th\":\"C:\\\\x\",\"state\":\"held\"}", out state) && state == "held", "Reordered escaped held ownership was refused.");
        foreach (string invalid in new[] { "{\"state\":\"held\",\"\\u0073tate\":\"free\"}", "{\"state\":\"free\",\"path\":\"x\",\"detail\":\"x\"}",
            "{\"state\":\"held\",\"path\":\" \",\"detail\":\"x\"}", "{state:'free'}", "{}", "{\"state\":\"free\"}{\"state\":\"free\"}" })
            Check(!Gateway.TryReadOwnership(invalid, out state), "An invalid ownership record was admitted.");

        // One-handle configuration snapshot: unchanged passes; edit, replacement or removal refuses.
        string path = Path.Combine(work, "launcher.json");
        File.WriteAllText(path, json.Serialize(GatewayConfig(work)));
        var snapshot = ConfigurationFile.Read(path);
        Check(snapshot.Parse().Port == 4831 && snapshot.Digest.Length == 64, "The configuration snapshot did not parse.");
        snapshot.Recheck(path);
        File.AppendAllText(path, " ");
        Refuses(() => snapshot.Recheck(path), "configuration-changed", "An edited configuration passed its recheck.");
        snapshot = ConfigurationFile.Read(path);
        byte[] same = File.ReadAllBytes(path);
        File.Delete(path); File.WriteAllBytes(path, same);
        Refuses(() => snapshot.Recheck(path), "configuration-changed", "A replaced configuration with equal bytes passed its recheck.");
        snapshot = ConfigurationFile.Read(path);
        File.Delete(path);
        Refuses(() => snapshot.Recheck(path), "configuration-changed", "A removed configuration passed its recheck.");

        StoreIdentityChecks(work);
    }

    /// <summary>Stands in for a held store handle and reports its release.</summary>
    sealed class HeldScope : IDisposable
    {
        readonly Action release;
        public HeldScope(Action release) { this.release = release; }
        public void Dispose() { release(); }
    }

    /// <summary>
    /// A controlled store resolver: named objects with injected full file IDs. It counts opens and
    /// ID reads, records how many handles were held at each read, and requires every one released.
    /// </summary>
    sealed class HeldPaths
    {
        public int Opens, Held, Reads;
        public readonly List<int> HeldAtRead = new List<int>();
        readonly Dictionary<string, KeyValuePair<string, Func<NativeFiles.FileId>>> table =
            new Dictionary<string, KeyValuePair<string, Func<NativeFiles.FileId>>>(StringComparer.Ordinal);

        public static Func<NativeFiles.FileId> Id(ulong volume, ulong low, ulong high)
        {
            return () => new NativeFiles.FileId { Volume = volume, Low = low, High = high };
        }
        public HeldPaths Add(string path, string finalPath, Func<NativeFiles.FileId> id)
        {
            table[path] = new KeyValuePair<string, Func<NativeFiles.FileId>>(finalPath, id);
            return this;
        }
        public HeldPaths Add(string path, ulong volume, ulong low, ulong high) { return Add(path, path, Id(volume, low, high)); }

        public bool Resolves(string lookup, string target)
        {
            Opens = 0; Reads = 0; HeldAtRead.Clear();
            bool resolved = Gateway.ResolvesTo(lookup, target, Open);
            Check(Held == 0, "A held store handle was not released.");
            return resolved;
        }

        Gateway.ResolvedPath Open(string path)
        {
            Opens++;
            KeyValuePair<string, Func<NativeFiles.FileId>> entry;
            if (!table.TryGetValue(path, out entry)) return null;
            Held++;
            var read = entry.Value;
            return new Gateway.ResolvedPath {
                FinalPath = entry.Key,
                ReadId = () => { Reads++; HeldAtRead.Add(Held); return read(); },
                Scope = new HeldScope(() => Held--),
            };
        }
    }

    /// <summary>
    /// Store resolution (#566): the canonical target must match, and a case-only difference is
    /// accepted only when both held handles report the same full FILE_ID_INFO identity. Real handles
    /// cover a case-insensitive alias of one directory. Distinct case-only objects, IDs equal only in
    /// their low 64 bits, another volume and unavailable or unusable IDs use a controlled comparison,
    /// because this check never changes directory case sensitivity, privileges or volume settings
    /// and observes no ReFS collision.
    /// </summary>
    static void StoreIdentityChecks(string work)
    {
        string store = Directory.CreateDirectory(Path.Combine(work, "Store Target")).FullName;
        string canonical;
        using (var handle = NativeFiles.Open(store, NativeFiles.ReadAttributes, 7, NativeFiles.OpenExisting, NativeFiles.BackupSemantics))
            canonical = NativeFiles.FinalPath(handle);
        Check(Gateway.ResolvesTo(store.ToUpperInvariant(), canonical) && Gateway.ResolvesTo(store, canonical.ToLowerInvariant()), "A case-only path spelling changed the resolved store.");
        Check(!Gateway.ResolvesTo(store + "-missing", canonical + "-missing") && !Gateway.ResolvesTo(work, canonical), "A missing or different store resolved as enrolled.");
        // Real held handles: one directory through two spellings has one usable full ID; another differs.
        using (var opened = Gateway.Resolve(store))
        using (var alias = Gateway.Resolve(canonical.ToLowerInvariant()))
        using (var different = Gateway.Resolve(work))
        {
            Check(opened != null && opened.FinalPath == canonical && alias != null && different != null, "A real store handle did not report its final path.");
            var id = opened.ReadId();
            Check(id != null && id.Usable && id.Same(alias.ReadId()) && !id.Same(different.ReadId()), "Real held handles did not report one full file ID per object.");
        }

        // Controlled comparison: Store and store on one volume, as a case-sensitive directory holds them.
        string lower = @"C:\gg\stores\store", upper = @"C:\gg\stores\Store", other = @"C:\gg\stores\other";
        var distinct = new HeldPaths().Add(lower, 7, 11, 0).Add(upper, 7, 12, 0);
        Check(!distinct.Resolves(lower, upper) && distinct.Opens == 2 && distinct.HeldAtRead.SequenceEqual(new[] { 2, 2 }), "Distinct case-only objects resolved as the enrolled store.");
        Check(distinct.Resolves(lower, lower) && distinct.Opens == 1 && distinct.Reads == 0, "An exact canonical target was reopened, identified or refused.");
        Check(!distinct.Resolves(lower, other) && distinct.Opens == 1 && distinct.Reads == 0, "A different canonical target was compared by identity.");
        // ReFS-shaped IDs whose low 64 bits are equal and whose high 64 bits differ.
        var equalLow = new HeldPaths().Add(lower, 7, 11, 1).Add(upper, 7, 11, 2);
        Check(!equalLow.Resolves(lower, upper) && equalLow.HeldAtRead.SequenceEqual(new[] { 2, 2 }), "Equal low file ID bits with different high bits matched.");
        // A case-insensitive alias: the target opens to the lookup's object, with one full ID.
        var sameObject = new HeldPaths().Add(lower, 7, 11, 5).Add(upper, lower, HeldPaths.Id(7, 11, 5));
        Check(sameObject.Resolves(lower, upper) && sameObject.Opens == 2 && sameObject.HeldAtRead.SequenceEqual(new[] { 2, 2 }), "Two equal full file IDs were refused or read without both handles held.");
        Check(!new HeldPaths().Add(lower, 7, 11, 5).Add(upper, 8, 11, 5).Resolves(lower, upper), "Another volume's equal file ID matched.");
        Check(!new HeldPaths().Add(lower, 0x100000007UL, 11, 5).Add(upper, 7, 11, 5).Resolves(lower, upper), "A volume serial equal only in its low 32 bits matched.");
        Check(!new HeldPaths().Add(lower, 7, 11, 5).Resolves(lower, upper), "An unopenable enrolled target was accepted.");
        Check(!new HeldPaths().Add(lower, lower, () => null).Add(upper, upper, () => null).Resolves(lower, upper), "Unavailable file IDs were accepted.");
        Check(!new HeldPaths().Add(lower, 7, 11, 5).Add(upper, upper, () => null).Resolves(lower, upper), "An unavailable enrolled file ID was accepted.");
        Check(!new HeldPaths().Add(lower, lower, () => null).Add(upper, 7, 11, 5).Resolves(lower, upper), "An unavailable lookup file ID was accepted.");
        Check(!new HeldPaths().Add(lower, 7, 0, 0).Add(upper, 7, 0, 0).Resolves(lower, upper), "An all-zero file ID was accepted.");
        Check(!new HeldPaths().Add(lower, 7, ulong.MaxValue, ulong.MaxValue).Add(upper, 7, ulong.MaxValue, ulong.MaxValue).Resolves(lower, upper), "An all-one file ID was accepted.");
        var unopenable = new HeldPaths().Add(lower, 7, 11, 5);
        Check(!unopenable.Resolves(upper, upper) && unopenable.Opens == 1, "An unopenable lookup was accepted.");
        Console.WriteLine("store-identity controlled-comparison distinct-object=refused equal-low-different-high=refused equal-full-id=accepted other-volume=refused unavailable-id=refused; real-handle case-alias=accepted different-object=refused");
    }

    /// <summary>Browser handoff classification and the PWA-only window mutex, without Chrome.</summary>
    static void HandoffChecks(string work)
    {
        Directory.CreateDirectory(work);
        Func<string, Configuration> pwa = proxy => {
            var config = GatewayConfig(work);
            config.Port = 4747; config.ChromeProxy = proxy; config.ChromeProfile = "Default";
            config.ChromeAppId = Program.ChromeAppId(4747);
            config.PwaAppUserModelId = "GraphGoblin.Checks." + Guid.NewGuid().ToString("N");
            config.LauncherAppUserModelId = "GraphGoblin.Checks." + Guid.NewGuid().ToString("N");
            config.WindowTimeoutSeconds = 1;
            config.Validate(false);
            return config;
        };
        // The lock-free probe's PWA validation is metadata only: a missing proxy is admitted.
        string missing = Path.Combine(work, "missing", "chrome_proxy.exe");
        var absent = pwa(missing);
        string inert = Path.Combine(work, "inert", "chrome_proxy.exe");
        Directory.CreateDirectory(Path.GetDirectoryName(inert));
        File.WriteAllText(inert, "not an executable");
        foreach (var config in new[] { absent, pwa(inert) })
        {
            try { ShellIdentity.OpenPwa(config, Path.Combine(work, "launcher.json")); throw new Exception("A refused browser start opened a window."); }
            catch (LauncherFailure refused)
            {
                Check(refused.Code == "browser-unavailable" && refused.Message.Contains("already running at http://127.0.0.1:4747/app/") &&
                    !refused.Message.Contains("could not start because") && !refused.Message.Contains("No gateway was started"), "Browser refusal was not classified at handoff: " + refused.Code);
            }
            using (var mutex = new System.Threading.Mutex(false, ShellIdentity.WindowMutexName(config)))
            {
                Check(mutex.WaitOne(0), "The window mutex outlived a refused handoff.");
                mutex.ReleaseMutex();
            }
        }
        var upper = pwa(inert.ToUpperInvariant()); upper.ChromeProfile = "DEFAULT";
        Check(ShellIdentity.WindowMutexName(upper) == ShellIdentity.WindowMutexName(pwa(inert)), "Window mutex normalization differs from window selection.");
        var otherProfile = pwa(inert); otherProfile.ChromeProfile = "Profile 2";
        Check(ShellIdentity.WindowMutexName(otherProfile) != ShellIdentity.WindowMutexName(pwa(inert)), "Another profile shared the window mutex.");
        Check(ShellIdentity.WindowMutexName(pwa(inert)).StartsWith(@"Local\GraphGoblin.Window."), "The window mutex is not session-local.");

        // A held window mutex consumes the one bounded window budget, then refuses with the address.
        var busy = pwa(inert);
        using (var holder = new System.Threading.Mutex(false, ShellIdentity.WindowMutexName(busy)))
        {
            var held = new System.Threading.ManualResetEvent(false);
            var release = new System.Threading.ManualResetEvent(false);
            var thread = new System.Threading.Thread(() => { holder.WaitOne(); held.Set(); release.WaitOne(); holder.ReleaseMutex(); });
            thread.Start(); held.WaitOne();
            var clock = Stopwatch.StartNew();
            try { ShellIdentity.OpenPwa(busy, Path.Combine(work, "launcher.json")); throw new Exception("A busy window mutex was bypassed."); }
            catch (LauncherFailure refused) { Check(refused.Code == "window-busy" && refused.Message.Contains("http://127.0.0.1:4747/app/"), "A busy window mutex was misclassified: " + refused.Code); }
            Check(clock.ElapsedMilliseconds >= 900 && clock.ElapsedMilliseconds < 5000, "The window budget was not bounded.");
            release.Set(); thread.Join();
        }
        WindowDeadlineChecks(work, pwa);
    }

    /// <summary>
    /// Deterministic native control points for one window handoff, on a 1000 ms budget. Preparation
    /// charges its cost to the clock; `Spawns` counts calls of the actual start seam, which must
    /// receive the prepared start information.
    /// </summary>
    sealed class Handoff
    {
        public long Now, AcquireCost, PrepareCost;
        public bool Acquired = true;
        public int Discoveries, Acquires, Releases, Prepares, Spawns, Activations;
        public readonly List<long> Waits = new List<long>(), SpawnedAt = new List<long>();
        public readonly List<int> Sleeps = new List<int>();
        public Func<int, long> DiscoveryCost = n => 0;
        public Func<int, IntPtr> Window = n => IntPtr.Zero;
        ProcessStartInfo prepared;

        public string Run(Configuration config)
        {
            try
            {
                ShellIdentity.Handoff(config, new ShellIdentity.WindowHandoff {
                    Elapsed = () => Now,
                    Discover = () => { Discoveries++; Now += DiscoveryCost(Discoveries); return Window(Discoveries); },
                    Acquire = wait => { Acquires++; Waits.Add(wait); Now += AcquireCost; return Acquired; },
                    Release = () => Releases++,
                    Prepare = () => { Prepares++; Now += PrepareCost; prepared = new ProcessStartInfo("chrome_proxy.exe"); return prepared; },
                    Start = start => {
                        Check(start != null && ReferenceEquals(start, prepared), "The start seam did not receive the prepared start.");
                        Spawns++; SpawnedAt.Add(Now);
                    },
                    Activate = window => Activations++,
                    Sleep = milliseconds => { Sleeps.Add(milliseconds); Now += milliseconds; },
                });
                return "activated";
            }
            catch (LauncherFailure refused) { return refused.Code; }
        }
    }

    static int SpawnCount(string log)
    {
        try { return File.ReadAllLines(log).Count(line => line.Length > 0); }
        catch (FileNotFoundException) { return 0; }
    }

    /// <summary>
    /// The shared window deadline (#566): its clock starts before the first discovery, a click that
    /// acquires the PWA mutex near expiry rediscovers and refuses without a Chrome start, start
    /// preparation that itself crosses the last admissible threshold refuses with no start seam
    /// call, and sleeps never pass the deadline. Existing-window activation, reopening under the
    /// mutex, an ordinary prepared spawn and a still-admissible boundary start keep their behavior.
    /// A fake proxy only counts its starts; no Chrome runs.
    /// </summary>
    static void WindowDeadlineChecks(string work, Func<string, Configuration> pwa)
    {
        var config = pwa(Path.Combine(work, "deadline", "chrome_proxy.exe"));
        Check(config.WindowTimeoutSeconds == 1, "The deterministic window budget changed.");
        var existing = new Handoff { Window = n => new IntPtr(7) };
        Check(existing.Run(config) == "activated" && existing.Acquires == 0 && existing.Prepares == 0 && existing.Spawns == 0 && existing.Releases == 0, "An existing window was not activated directly.");
        var reopened = new Handoff { Window = n => n == 2 ? new IntPtr(7) : IntPtr.Zero };
        Check(reopened.Run(config) == "activated" && reopened.Prepares == 0 && reopened.Spawns == 0 && reopened.Activations == 1 && reopened.Releases == 1, "A window found under the mutex was not reused.");
        var spawned = new Handoff { Window = n => n == 4 ? new IntPtr(7) : IntPtr.Zero };
        Check(spawned.Run(config) == "activated" && spawned.Prepares == 1 && spawned.Spawns == 1 && spawned.Sleeps.SequenceEqual(new[] { 200 }) && spawned.Releases == 1, "An ordinary spawn changed its behavior.");
        // The clock starts before the first discovery: its cost is charged to the mutex wait.
        var slowFirst = new Handoff { DiscoveryCost = n => n == 1 ? 300 : 0, Acquired = false };
        Check(slowFirst.Run(config) == "window-busy" && slowFirst.Waits.SequenceEqual(new long[] { 700 }) && slowFirst.Releases == 0 && slowFirst.Spawns == 0, "The first discovery was outside the window budget.");
        foreach (long acquiredAt in new long[] { 801, 850, 999, 1000, 1200 })
        {
            var late = new Handoff { AcquireCost = acquiredAt };
            Check(late.Run(config) == "window-busy" && late.Prepares == 0 && late.Spawns == 0 && late.Discoveries == 2 && late.Releases == 1 && late.Sleeps.Count == 0, "A near-expired click started Chrome at " + acquiredAt + " ms.");
        }
        // A rediscovery that crosses the threshold under the mutex also refuses.
        var slowRediscovery = new Handoff { AcquireCost = 500, DiscoveryCost = n => n == 2 ? 400 : 0 };
        Check(slowRediscovery.Run(config) == "window-busy" && slowRediscovery.Prepares == 0 && slowRediscovery.Spawns == 0, "A rediscovery past the threshold still started Chrome.");
        // Preparation that itself crosses the last admissible threshold refuses at the final sample.
        int slowPreparationSpawns = 0;
        foreach (long[] costs in new[] { new long[] { 800, 1 }, new long[] { 700, 101 }, new long[] { 500, 450 } })
        {
            var slowPreparation = new Handoff { AcquireCost = costs[0], PrepareCost = costs[1] };
            Check(slowPreparation.Run(config) == "window-busy" && slowPreparation.Prepares == 1 && slowPreparation.Spawns == 0 && slowPreparation.Releases == 1 && slowPreparation.Sleeps.Count == 0, "Preparation past the threshold still started Chrome (" + costs[0] + " + " + costs[1] + " ms).");
            slowPreparationSpawns += slowPreparation.Spawns;
        }
        // Preparation that leaves exactly one poll still starts, at the final sample's time.
        var preparedBoundary = new Handoff { AcquireCost = 700, PrepareCost = 100 };
        Check(preparedBoundary.Run(config) == "window-missing" && preparedBoundary.Prepares == 1 && preparedBoundary.Spawns == 1 && preparedBoundary.SpawnedAt.SequenceEqual(new long[] { 800 }) && preparedBoundary.Sleeps.SequenceEqual(new[] { 200 }) && preparedBoundary.Now == 1000, "A still-admissible prepared start was refused or overran.");
        var boundary = new Handoff { AcquireCost = 800 };
        Check(boundary.Run(config) == "window-missing" && boundary.Prepares == 1 && boundary.Spawns == 1 && boundary.SpawnedAt.SequenceEqual(new long[] { 800 }) && boundary.Sleeps.SequenceEqual(new[] { 200 }) && boundary.Now == 1000, "The last admissible spawn was refused or overran.");
        var capped = new Handoff { AcquireCost = 750 };
        Check(capped.Run(config) == "window-missing" && capped.Spawns == 1 && capped.Sleeps.SequenceEqual(new[] { 200, 50 }) && capped.Now == 1000 && capped.Releases == 1, "A window poll slept past the deadline.");

        // Real controls: a copy of this executable stands in for chrome_proxy.exe and only records starts.
        string proxy = Path.Combine(work, "fake proxy", "chrome_proxy.exe");
        Directory.CreateDirectory(Path.GetDirectoryName(proxy));
        File.Copy(Application.ExecutablePath, proxy, true);
        string log = Path.Combine(Path.GetDirectoryName(proxy), "spawns.log");
        var fake = pwa(proxy);
        var ordinary = Stopwatch.StartNew();
        Refuses(() => ShellIdentity.OpenPwa(fake, Path.Combine(work, "launcher.json")), "window-missing", "An ordinary windowless spawn was misclassified.");
        Check(ordinary.ElapsedMilliseconds >= 900 && ordinary.ElapsedMilliseconds < 5000, "The ordinary window wait was not bounded.");
        var started = Stopwatch.StartNew();
        while (SpawnCount(log) == 0 && started.ElapsedMilliseconds < 5000) System.Threading.Thread.Sleep(20);
        Check(SpawnCount(log) == 1, "The ordinary handoff did not start the proxy exactly once.");
        int ordinarySpawns = SpawnCount(log);
        using (var holder = new System.Threading.Mutex(false, ShellIdentity.WindowMutexName(fake)))
        {
            var held = new System.Threading.ManualResetEvent(false);
            var go = new System.Threading.ManualResetEvent(false);
            var click = new Stopwatch();
            // Released 950 ms into the click's budget: acquired with less than one poll left.
            var thread = new System.Threading.Thread(() => {
                holder.WaitOne(); held.Set(); go.WaitOne();
                while (click.ElapsedMilliseconds < 950) System.Threading.Thread.Sleep(5);
                holder.ReleaseMutex();
            });
            thread.Start(); held.WaitOne();
            click.Start(); go.Set();
            Refuses(() => ShellIdentity.OpenPwa(fake, Path.Combine(work, "launcher.json")), "window-busy", "A near-expired real handoff was misclassified.");
            thread.Join();
        }
        System.Threading.Thread.Sleep(1000);
        Check(SpawnCount(log) == 1, "A near-expired real handoff started the proxy.");
        Console.WriteLine("window-deadline injected near-expiry-spawns=0 slow-preparation-spawns=" + slowPreparationSpawns + " boundary-spawns=1 sleeps-capped; real ordinary-spawns=" + ordinarySpawns + " near-expiry-spawns=0");
    }

    const int HolderAcquireMilliseconds = 30000, HolderMaximumMilliseconds = 120000;

    /// <summary>
    /// Hold this click session's store and port startup mutexes until stdin closes (a release, or
    /// the test process ending). Both the acquisition and the hold are bounded, so a fixture whose
    /// test was cancelled before its cleanup can never keep the mutexes or its parent alive.
    /// </summary>
    static int HoldLaunchMutexes(string dataDir, int port)
    {
        using (var store = new System.Threading.Mutex(false, Program.StoreMutexName(dataDir)))
        using (var portMutex = new System.Threading.Mutex(false, Program.PortMutexName(port)))
        {
            bool storeOwned = false, portOwned = false;
            try
            {
                try { storeOwned = store.WaitOne(HolderAcquireMilliseconds); } catch (System.Threading.AbandonedMutexException) { storeOwned = true; }
                if (storeOwned)
                    try { portOwned = portMutex.WaitOne(HolderAcquireMilliseconds); } catch (System.Threading.AbandonedMutexException) { portOwned = true; }
                if (!portOwned) { Console.Error.WriteLine("busy"); return 3; }
                Console.WriteLine("held");
                var released = System.Threading.Tasks.Task.Run(() => Console.In.ReadToEnd());
                return released.Wait(HolderMaximumMilliseconds) ? 0 : 4;
            }
            finally
            {
                if (portOwned) portMutex.ReleaseMutex();
                if (storeOwned) store.ReleaseMutex();
            }
        }
    }

    [StructLayout(LayoutKind.Sequential)] struct JobBasicLimits {
        public long processTime, jobTime; public uint flags; public UIntPtr minimum, maximum; public uint active;
        public UIntPtr affinity; public uint priority, scheduling;
    }
    [StructLayout(LayoutKind.Sequential)] struct JobIoCounters { public ulong a, b, c, d, e, f; }
    [StructLayout(LayoutKind.Sequential)] struct JobExtendedLimits {
        public JobBasicLimits basic; public JobIoCounters io; public UIntPtr processMemory, jobMemory, peakProcess, peakJob;
    }
    [StructLayout(LayoutKind.Sequential)] struct JobCompletionPort { public IntPtr key, port; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct SiblingStartup {
        public int cb; public string reserved, desktop, title; public int x, y, xSize, ySize, xCount, yCount, fill, flags;
        public short show, reservedBytes; public IntPtr reservedPointer, input, output, error;
    }
    [StructLayout(LayoutKind.Sequential)] struct SiblingProcess { public IntPtr process, thread; public int pid, tid; }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateJobObject(IntPtr security, string name);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int kind, ref JobExtendedLimits limits, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int kind, ref JobCompletionPort port, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateIoCompletionPort(IntPtr file, IntPtr existing, UIntPtr key, uint threads);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetQueuedCompletionStatus(IntPtr port, out uint message, out UIntPtr key, out IntPtr detail, uint milliseconds);
    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CreateProcess(string app, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string directory, ref SiblingStartup startup, out SiblingProcess process);
    [StructLayout(LayoutKind.Sequential)] struct ProbeStartup { public SiblingStartup startup; public IntPtr attributes; }
    [StructLayout(LayoutKind.Sequential)] struct JobAccounting {
        public long userTime, kernelTime, periodUserTime, periodKernelTime; public uint faults, total, active, terminated;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CreateProcess(string app, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string directory, ref ProbeStartup startup, out SiblingProcess process);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool QueryInformationJobObject(IntPtr job, int kind, out JobExtendedLimits limits, uint size, IntPtr returned);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool QueryInformationJobObject(IntPtr job, int kind, out JobAccounting accounting, uint size, IntPtr returned);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool QueryInformationJobObject(IntPtr job, int kind, IntPtr buffer, uint size, IntPtr returned);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool PostQueuedCompletionStatus(IntPtr port, uint message, UIntPtr key, IntPtr detail);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
    [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);

    const uint ActiveProcessLimitMessage = 3, NewProcessMessage = 6, ExitProcessMessage = 7, AbnormalExitMessage = 8;
    const uint FenceMessage = 0x46454E43, WaitTimeout = 258, StillActive = 0x102;
    const int LaunchMilliseconds = 60000, SettleMilliseconds = 5000, FenceMilliseconds = 5000,
        QuietMilliseconds = 250, MaxPolls = 4096, MaxRawMessages = 64, MaxText = 512;
    static readonly UIntPtr JobKey = new UIntPtr(544), FenceKey = new UIntPtr(0x5440F);
    static long fences;

    /// <summary>The job's actual limit flags and active-process limit, read back from the job.</summary>
    static Dictionary<string, object> Readback(IntPtr job)
    {
        var result = new Dictionary<string, object>();
        JobExtendedLimits limits;
        if (!QueryInformationJobObject(job, 9, out limits, (uint)Marshal.SizeOf(typeof(JobExtendedLimits)), IntPtr.Zero))
            result["error"] = Marshal.GetLastWin32Error();
        else
        {
            result["flags"] = (long)limits.basic.flags;
            result["activeLimit"] = (long)limits.basic.active;
        }
        return result;
    }

    /// <summary>Basic accounting and the exact member PIDs, read back from the job itself.</summary>
    static Dictionary<string, object> Accounting(IntPtr job)
    {
        var result = new Dictionary<string, object>();
        JobAccounting accounting;
        if (!QueryInformationJobObject(job, 1, out accounting, (uint)Marshal.SizeOf(typeof(JobAccounting)), IntPtr.Zero))
            result["error"] = Marshal.GetLastWin32Error();
        else
        {
            result["active"] = (int)accounting.active;
            result["total"] = (int)accounting.total;
            result["terminated"] = (int)accounting.terminated;
        }
        const int capacity = 64;
        int bytes = 8 + capacity * IntPtr.Size;
        IntPtr buffer = Marshal.AllocHGlobal(bytes);
        try
        {
            // JOBOBJECT_BASIC_PROCESS_ID_LIST: two DWORD counts, then pointer-sized PIDs.
            if (!QueryInformationJobObject(job, 3, buffer, (uint)bytes, IntPtr.Zero)) result["pidsError"] = Marshal.GetLastWin32Error();
            else
            {
                int listed = Marshal.ReadInt32(buffer, 4);
                result["pids"] = Enumerable.Range(0, listed).Select(index => Marshal.ReadIntPtr(buffer, 8 + index * IntPtr.Size).ToInt32()).OrderBy(pid => pid).ToArray();
            }
        }
        finally { Marshal.FreeHGlobal(buffer); }
        return result;
    }

    static int ActiveMembers(IntPtr job)
    {
        JobAccounting accounting;
        return QueryInformationJobObject(job, 1, out accounting, (uint)Marshal.SizeOf(typeof(JobAccounting)), IntPtr.Zero) ? (int)accounting.active : -1;
    }

    static bool AwaitActive(IntPtr job, int expected)
    {
        var clock = Stopwatch.StartNew();
        while (ActiveMembers(job) != expected)
        {
            if (clock.ElapsedMilliseconds >= SettleMilliseconds) return false;
            System.Threading.Thread.Sleep(20);
        }
        return true;
    }

    static string Bounded(string text)
    {
        return text == null || text.Length <= MaxText ? text : text.Substring(0, MaxText);
    }

    /// <summary>
    /// One event window: every job message queued before this call, then any straggler until a
    /// quiet poll. A fence packet posted to the same FIFO completion port bounds the window, so
    /// each message the kernel queued for this window's creations precedes it. Only a quiet poll
    /// after the fence ends a window normally ("fenced-quiet"); a fence that never returns, a
    /// queue error or a flood is an observer failure and never a quiet result.
    /// </summary>
    static Dictionary<string, object> Window(IntPtr port)
    {
        long fence = ++fences;
        var admitted = new List<int>();
        var exited = new List<int>();
        var raw = new List<string>();
        int denied = 0, other = 0, late = 0, polls = 0;
        string observer = null;
        if (!PostQueuedCompletionStatus(port, FenceMessage, FenceKey, new IntPtr(fence)))
            observer = "fence-post-failed:" + Marshal.GetLastWin32Error();
        bool fenced = false;
        while (observer == null)
        {
            if (++polls > MaxPolls) { observer = "flooded"; break; }
            uint message; UIntPtr key; IntPtr detail;
            if (!GetQueuedCompletionStatus(port, out message, out key, out detail, fenced ? (uint)QuietMilliseconds : (uint)FenceMilliseconds))
            {
                int code = Marshal.GetLastWin32Error();
                if (detail != IntPtr.Zero) observer = "failed-packet:" + code;
                else if (code == WaitTimeout) observer = fenced ? "fenced-quiet" : "fence-timeout";
                else observer = "queue-error:" + code;
                break;
            }
            if (key == FenceKey)
            {
                if (detail.ToInt64() == fence) fenced = true; else other++;
                continue;
            }
            if (key != JobKey) { other++; continue; }
            if (fenced) late++;
            if (raw.Count < MaxRawMessages) raw.Add(message + ":" + detail.ToInt64());
            if (message == ActiveProcessLimitMessage) denied++;
            else if (message == NewProcessMessage) admitted.Add(detail.ToInt32());
            else if (message == ExitProcessMessage || message == AbnormalExitMessage) exited.Add(detail.ToInt32());
            else other++;
        }
        return new Dictionary<string, object> {
            { "observer", observer }, { "denied", denied }, { "admitted", admitted.ToArray() },
            { "exited", exited.ToArray() }, { "other", other }, { "late", late }, { "raw", raw.ToArray() },
        };
    }

    /// <summary>A suspended, detached copy of this executable that never runs fixture code.</summary>
    static bool SpawnProbe(bool jobList, out SiblingProcess created, out int error)
    {
        const uint Suspended = 0x4, Detached = 0x8, Extended = 0x80000;
        var command = new StringBuilder(Program.Quote(Application.ExecutablePath) + " --probe-child");
        error = 0;
        if (!jobList)
        {
            var plain = new SiblingStartup { cb = Marshal.SizeOf(typeof(SiblingStartup)) };
            if (CreateProcess(Application.ExecutablePath, command, IntPtr.Zero, IntPtr.Zero, false, Suspended | Detached, IntPtr.Zero, null, ref plain, out created))
            {
                CloseHandle(created.thread);
                return true;
            }
            error = Marshal.GetLastWin32Error();
            return false;
        }
        // The helper's own shape: a fresh private kill-on-close job named by PROC_THREAD_ATTRIBUTE_JOB_LIST.
        IntPtr privateJob = CreateJobObject(IntPtr.Zero, null);
        IntPtr jobs = Marshal.AllocHGlobal(IntPtr.Size), list = IntPtr.Zero, size = IntPtr.Zero;
        bool initialized = false;
        try
        {
            Check(privateJob != IntPtr.Zero, "Could not create the private probe job.");
            var kill = new JobExtendedLimits { basic = new JobBasicLimits { flags = 0x2000 } };
            Check(SetInformationJobObject(privateJob, 9, ref kill, (uint)Marshal.SizeOf(typeof(JobExtendedLimits))), "Could not configure the private probe job.");
            InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
            Check(size != IntPtr.Zero, "Could not size the probe attribute list.");
            list = Marshal.AllocHGlobal(size);
            Check(InitializeProcThreadAttributeList(list, 1, 0, ref size), "Could not initialize the probe attribute list.");
            initialized = true;
            Marshal.WriteIntPtr(jobs, privateJob);
            Check(UpdateProcThreadAttribute(list, 0, new IntPtr(0x2000D), jobs, new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero), "Could not name the private probe job.");
            var extended = new ProbeStartup { startup = new SiblingStartup { cb = Marshal.SizeOf(typeof(ProbeStartup)) }, attributes = list };
            if (CreateProcess(Application.ExecutablePath, command, IntPtr.Zero, IntPtr.Zero, false, Suspended | Detached | Extended, IntPtr.Zero, null, ref extended, out created))
            {
                CloseHandle(created.thread);
                return true;
            }
            error = Marshal.GetLastWin32Error();
            return false;
        }
        finally
        {
            if (initialized) DeleteProcThreadAttributeList(list);
            if (list != IntPtr.Zero) Marshal.FreeHGlobal(list);
            Marshal.FreeHGlobal(jobs);
            // Kill-on-close: an unexpectedly admitted probe cannot outlive its private job.
            if (privateJob != IntPtr.Zero) CloseHandle(privateJob);
        }
    }

    /// <summary>
    /// The native in-job creation probe on the verified free slot. A suspended plain child fills
    /// the slot; a plain creation and a JOB_LIST creation (the helper's shape) must then be refused.
    /// The filler is stopped through its exact retained handle and the slot's release is read back.
    /// These events form their own window and never count toward the launcher's calibration.
    /// </summary>
    static Dictionary<string, object> SlotProbe(IntPtr job, IntPtr port, int members)
    {
        var probe = new Dictionary<string, object>();
        probe["before"] = Accounting(job);
        SiblingProcess filler;
        int error;
        bool filled = SpawnProbe(false, out filler, out error);
        probe["filler"] = filled ? "admitted" : "refused:" + error;
        try
        {
            if (filled)
            {
                probe["fillerPid"] = filler.pid;
                probe["full"] = Accounting(job);
                foreach (bool jobList in new[] { false, true })
                {
                    SiblingProcess extra;
                    bool admitted = SpawnProbe(jobList, out extra, out error);
                    if (admitted)
                    {
                        TerminateProcess(extra.process, 1);
                        WaitForSingleObject(extra.process, SettleMilliseconds);
                        CloseHandle(extra.process);
                    }
                    probe[jobList ? "jobList" : "plain"] = admitted ? "admitted" : "refused:" + error;
                }
            }
        }
        finally
        {
            if (filled)
            {
                TerminateProcess(filler.process, 1);
                probe["fillerSettled"] = WaitForSingleObject(filler.process, SettleMilliseconds) == 0;
                CloseHandle(filler.process);
            }
        }
        probe["released"] = AwaitActive(job, members);
        probe["after"] = Accounting(job);
        probe["window"] = Window(port);
        return probe;
    }

    /// <summary>
    /// One public launcher click under the outer job, in its own fenced window. On timeout only the
    /// exact retained launcher handle is terminated here; a gateway it may have started stays a
    /// member of this fixture's kill-on-close job, drained by the caller as a verified owner or
    /// settled when the job closes.
    /// </summary>
    static Dictionary<string, object> LaunchPhase(IntPtr job, IntPtr port, string launcher, string config, int? members)
    {
        var phase = new Dictionary<string, object>();
        phase["before"] = Accounting(job);
        var info = new ProcessStartInfo(launcher, "--config " + Program.Quote(config) + " --ensure-gateway") {
            UseShellExecute = false, CreateNoWindow = true, RedirectStandardError = true, RedirectStandardOutput = true
        };
        Process click = null;
        try { click = Process.Start(info); }
        catch (System.ComponentModel.Win32Exception refused) { phase["admission"] = "refused:" + refused.NativeErrorCode; }
        if (click != null)
            using (click)
            {
                phase["launcherPid"] = click.Id;
                var stdout = click.StandardOutput.ReadToEndAsync();
                var stderr = click.StandardError.ReadToEndAsync();
                if (!click.WaitForExit(LaunchMilliseconds))
                {
                    phase["timedOut"] = true;
                    try { click.Kill(); }
                    catch (InvalidOperationException) { }
                    catch (System.ComponentModel.Win32Exception) { }
                }
                bool settled = click.WaitForExit(SettleMilliseconds);
                phase["settled"] = settled;
                if (settled) phase["exit"] = click.ExitCode;
                phase["stdout"] = stdout.Wait(SettleMilliseconds) ? Bounded(stdout.Result) : null;
                string error = stderr.Wait(SettleMilliseconds) ? stderr.Result : null;
                phase["stderr"] = error == null ? null : Bounded(error.Split(new[] { "\r\n", "\n" }, StringSplitOptions.None)[0]);
            }
        if (members.HasValue) phase["released"] = AwaitActive(job, members.Value);
        phase["after"] = Accounting(job);
        phase["window"] = Window(port);
        return phase;
    }

    const int OwnerMaximumMilliseconds = 150000;

    static void Emit(Dictionary<string, object> report)
    {
        Console.WriteLine(new System.Web.Script.Serialization.JavaScriptSerializer().Serialize(report));
        Console.Out.Flush();
    }

    /// <summary>
    /// #544 fixture. This process joins a fresh outer job whose completion port is the native
    /// denied-admission observer: JOB_OBJECT_MSG_ACTIVE_PROCESS_LIMIT (3) reports a refused
    /// creation and NEW_PROCESS (6) names each admitted member. The actual limit is read back,
    /// one unrelated detached sibling is started, and a native creation probe verifies the one free
    /// slot. The public launcher then runs with --ensure-gateway once per configuration, each click
    /// in its own fenced window on this same observer, and a final probe shows the observer still
    /// reporting refusals. Windows does not guarantee job message delivery, so the caller trusts a
    /// quiet warm window only after the cold click's actual helper refusal was observed here.
    /// Every outer job is kill-on-close and this process holds its only handle: the launcher, its
    /// contained helpers, a gateway it starts and their descendants cannot outlive this owner,
    /// whether it exits, times out or is terminated by its caller. With `hold` (the unlimited
    /// compatible control), the first report line follows the clicks and the job stays open until
    /// the caller closes stdin (its explicit release) or the bound passes; the release line then
    /// reports the sibling and the remaining members before any teardown.
    /// </summary>
    static int JobLaunch(string limit, string launcher, string[] configs, bool hold)
    {
        bool limited = limit != "none";
        const int members = 2; // this fixture and its sibling
        var report = new Dictionary<string, object>();
        var final = report;
        report["limit"] = limit;
        report["selfPid"] = Process.GetCurrentProcess().Id;
        IntPtr job = CreateJobObject(IntPtr.Zero, null);
        IntPtr port = CreateIoCompletionPort(new IntPtr(-1), IntPtr.Zero, UIntPtr.Zero, 1);
        var sibling = new SiblingProcess();
        bool siblingStarted = false;
        try
        {
            Check(job != IntPtr.Zero && port != IntPtr.Zero, "Could not create the outer job witness.");
            var association = new JobCompletionPort { key = new IntPtr(544), port = port };
            Check(SetInformationJobObject(job, 7, ref association, (uint)Marshal.SizeOf(typeof(JobCompletionPort))), "Could not associate the outer job witness.");
            var limits = new JobExtendedLimits { basic = new JobBasicLimits { flags = limited ? 0x8u | 0x2000u : 0x2000u, active = limited ? uint.Parse(limit) : 0u } };
            Check(SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(JobExtendedLimits))), "Could not set the outer job limits.");
            report["readback"] = Readback(job);
            Check(AssignProcessToJobObject(job, GetCurrentProcess()), "Could not enter the outer job.");
            // A detached console sibling has no console host, so it alone uses one active slot.
            var startup = new SiblingStartup { cb = Marshal.SizeOf(typeof(SiblingStartup)) };
            string arguments = " --sibling " + Process.GetCurrentProcess().Id + " 300";
            Check(CreateProcess(Application.ExecutablePath, new StringBuilder(Program.Quote(Application.ExecutablePath) + arguments), IntPtr.Zero, IntPtr.Zero, false, 0x8, IntPtr.Zero, null, ref startup, out sibling), "Could not start the unrelated sibling.");
            siblingStarted = true;
            CloseHandle(sibling.thread);
            report["siblingPid"] = sibling.pid;
            report["setup"] = Accounting(job);
            report["setupWindow"] = Window(port);
            if (limited) report["probe"] = SlotProbe(job, port, members);
            var phases = new List<object>();
            foreach (string config in configs) phases.Add(LaunchPhase(job, port, launcher, config, limited ? (int?)members : null));
            report["phases"] = phases.ToArray();
            if (limited) report["postProbe"] = SlotProbe(job, port, members);
            if (hold)
            {
                report["holding"] = true;
                Emit(report);
                final = new Dictionary<string, object>();
                var released = System.Threading.Tasks.Task.Run(() => Console.In.ReadToEnd());
                final["released"] = released.Wait(OwnerMaximumMilliseconds) ? "explicit" : "bounded";
            }
            // Observed before any teardown, through the exact retained handle.
            final["siblingAlive"] = WaitForSingleObject(sibling.process, 0) == StillActive;
            final["final"] = Accounting(job);
        }
        catch (Exception error) { final["fixtureFailure"] = Bounded(error.Message); }
        finally
        {
            if (siblingStarted)
            {
                TerminateProcess(sibling.process, 1);
                final["siblingSettled"] = WaitForSingleObject(sibling.process, SettleMilliseconds) == 0;
                CloseHandle(sibling.process);
            }
            if (port != IntPtr.Zero) CloseHandle(port);
            // The job handle closes with this process. Closing it here would let the kill-on-close
            // job end this fixture before it reports; its exit then settles any remaining member.
        }
        Emit(final);
        return final.ContainsKey("fixtureFailure") ? 2 : 0;
    }

    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetProcessTimes(IntPtr process, out long creation, out long exit, out long kernel, out long user);

    static int[] Pids(string list)
    {
        return list.Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries).Select(value => int.Parse(value)).ToArray();
    }

    /// <summary>
    /// Exact-handle settlement witness (#544). Each PID is opened once while the caller knows it is
    /// alive and its creation time is reported; after the caller's go signal (stdin EOF) every
    /// expected exit is awaited on its retained handle within one bound, and each survivor must
    /// still be running. A PID is never looked up again by number, and nothing is terminated here.
    /// </summary>
    static int AwaitExits(int bound, int[] exits, int[] survivors)
    {
        var pids = exits.Concat(survivors).ToArray();
        var handles = new IntPtr[pids.Length];
        try
        {
            var held = new List<object>();
            for (int i = 0; i < pids.Length; i++)
            {
                handles[i] = OpenProcess(0x00100000 | 0x1000, false, pids[i]); // SYNCHRONIZE | QUERY_LIMITED_INFORMATION
                long created = 0, exited, kernel, user;
                bool alive = handles[i] != IntPtr.Zero && WaitForSingleObject(handles[i], 0) == WaitTimeout &&
                    GetProcessTimes(handles[i], out created, out exited, out kernel, out user);
                held.Add(new Dictionary<string, object> { { "pid", pids[i] }, { "alive", alive }, { "created", created.ToString(System.Globalization.CultureInfo.InvariantCulture) } });
            }
            Emit(new Dictionary<string, object> { { "held", held.ToArray() } });
            bool go = System.Threading.Tasks.Task.Run(() => Console.In.ReadToEnd()).Wait(HolderMaximumMilliseconds);
            var clock = Stopwatch.StartNew();
            var results = new List<object>();
            for (int i = 0; i < pids.Length; i++)
            {
                bool expectExit = i < exits.Length;
                var result = new Dictionary<string, object> { { "pid", pids[i] }, { "expected", expectExit ? "exit" : "survive" } };
                if (handles[i] != IntPtr.Zero)
                {
                    uint wait = WaitForSingleObject(handles[i], expectExit ? (uint)Math.Max(0, bound - clock.ElapsedMilliseconds) : 0);
                    result["exited"] = wait == 0;
                    result["elapsedMs"] = clock.ElapsedMilliseconds;
                    uint code;
                    if (wait == 0 && GetExitCodeProcess(handles[i], out code)) result["exitCode"] = (long)code;
                }
                results.Add(result);
            }
            Emit(new Dictionary<string, object> { { "go", go }, { "results", results.ToArray() } });
            return 0;
        }
        finally { foreach (IntPtr handle in handles) if (handle != IntPtr.Zero) CloseHandle(handle); }
    }

    [STAThread]
    public static int Main(string[] args)
    {
        try
        {
            if (args.Length == 2 && args[0].StartsWith("--profile-directory=", StringComparison.Ordinal) && args[1].StartsWith("--app-id=", StringComparison.Ordinal))
            {
                // A copy of this executable as a fake chrome_proxy.exe: record the start beside it, open nothing.
                File.AppendAllText(Path.Combine(Path.GetDirectoryName(Application.ExecutablePath), "spawns.log"), Process.GetCurrentProcess().Id + "\n");
                return 0;
            }
            if (args[0] == "--enrollment-checks")
            {
                EnrollmentChecks(args[1]);
                Console.WriteLine("Native enrollment, input binding, strict record and configuration snapshot checks passed."); return 0;
            }
            if (args[0] == "--handoff-checks")
            {
                HandoffChecks(args[1]);
                Console.WriteLine("Native browser handoff and window mutex checks passed."); return 0;
            }
            if (args[0] == "--hold-launch-mutexes") return HoldLaunchMutexes(args[1], int.Parse(args[2]));
            if (args[0] == "--job-launch")
            {
                Check(args[1] != "none", "A limited job launch needs a numeric active-process limit.");
                return JobLaunch(args[1], args[2], args.Skip(3).ToArray(), false);
            }
            if (args[0] == "--job-owner") return JobLaunch("none", args[1], args.Skip(2).ToArray(), true);
            if (args[0] == "--await-exits") return AwaitExits(int.Parse(args[1]), Pids(args[2]), args.Length > 3 ? Pids(args[3]) : new int[0]);
            if (args[0] == "--sibling")
            {
                // An unrelated owned member: it lives while its fixture lives, never beyond the bound.
                IntPtr parent = OpenProcess(0x00100000, false, int.Parse(args[1]));
                if (parent != IntPtr.Zero)
                {
                    WaitForSingleObject(parent, uint.Parse(args[2]) * 1000);
                    CloseHandle(parent);
                }
                return 0;
            }
            if (args[0] == "--probe-child") return 0; // created suspended and stopped; never expected to run
            if (args[0] == "--work-deadline-checks")
            {
                WorkDeadlineChecks();
                Console.WriteLine("Deterministic caller work deadline checks passed (no scheduling fault injected)."); return 0;
            }
            if (args[0] == "--cleanup-deadline-checks")
            {
                CleanupDeadlineChecks();
                Console.WriteLine("Deterministic cleanup decision checks passed (no kernel fault injected)."); return 0;
            }
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
