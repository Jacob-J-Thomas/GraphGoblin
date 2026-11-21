// QA459I independent #459 correction baseline QA harness. Not product code.
// Compiled separately and referencing the unmodified compiled launcher assembly (GraphGoblin.exe,
// built from apps/windows-launcher/Launcher.cs with the installer's csc flags). It calls only public
// members: Configuration (setters, Validate), LogRoot.Admit, Gateway (constructor, Ensure),
// LauncherFailure fields, Program.Present and LauncherLog.Build. No reflection, no Program.Main,
// no private member, no GUI, no launcher mutex and no launcher.log write.
//
// Usage: Qa459iHarness.exe --preflight|--ensure <repo> <node> <dataDir> <port> <startupSeconds>
//        <logDir> <configPathForPresentation> <resultJson>
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Web.Script.Serialization;
using GraphGoblin.Desktop;

public static class Qa459iHarness
{
    static readonly Dictionary<string, object> Result = new Dictionary<string, object>();

    /// <summary>A directory only this user, SYSTEM and Administrators can access.</summary>
    static void PrivateDirectory(string path)
    {
        Directory.CreateDirectory(path);
        var security = new DirectorySecurity();
        security.SetAccessRuleProtection(true, false);
        foreach (var sid in new[] { WindowsIdentity.GetCurrent().User, new SecurityIdentifier("S-1-5-18"), new SecurityIdentifier("S-1-5-32-544") })
            security.AddAccessRule(new FileSystemAccessRule(sid, FileSystemRights.FullControl,
                InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
        Directory.SetAccessControl(path, security);
    }

    static string Utc() { return DateTime.UtcNow.ToString("o", System.Globalization.CultureInfo.InvariantCulture); }

    static int Write(string resultPath, int code)
    {
        Result["harnessExitCode"] = code;
        Result["endUtc"] = Utc();
        File.WriteAllText(resultPath, new JavaScriptSerializer().Serialize(Result), new UTF8Encoding(false));
        return code;
    }

    public static int Main(string[] args)
    {
        if (args.Length != 9 || (args[0] != "--preflight" && args[0] != "--ensure")) return 64;
        string mode = args[0], repo = args[1], node = args[2], dataDir = args[3], logDir = args[6], configPath = args[7], resultPath = args[8];
        int port = int.Parse(args[4], System.Globalization.CultureInfo.InvariantCulture);
        int startupSeconds = int.Parse(args[5], System.Globalization.CultureInfo.InvariantCulture);
        Result["schema"] = "qa459i-harness-result/1";
        Result["mode"] = mode;
        Result["harnessPid"] = Process.GetCurrentProcess().Id;
        Result["startUtc"] = Utc();
        var config = new Configuration {
            Repo = repo, Node = node, DataDir = dataDir, Port = port,
            StartupTimeoutSeconds = startupSeconds, WindowTimeoutSeconds = 2,
            Environment = new Dictionary<string, string>()
        };
        try
        {
            PrivateDirectory(logDir);
            config.Validate(true);
            LogRoot root = LogRoot.Admit(logDir);
            Result["setup"] = "ok";
            Result["logRootAdmitted"] = root != null;
        }
        catch (Exception error)
        {
            Result["setup"] = "fault";
            Result["setupFaultType"] = error.GetType().FullName;
            Result["setupFaultMessage"] = error.Message;
            return Write(resultPath, 2);
        }
        if (mode == "--preflight") return Write(resultPath, 0);

        Exception failure = null;
        var clock = Stopwatch.StartNew();
        Result["ensureStartUtc"] = Utc();
        try
        {
            new Gateway(config, logDir).Ensure();
            Result["outcome"] = "returned";
        }
        catch (LauncherFailure refused) { failure = refused; Result["outcome"] = "launcher-failure"; }
        catch (Exception unexpected) { failure = unexpected; Result["outcome"] = "unexpected-exception"; Result["exceptionType"] = unexpected.GetType().FullName; }
        Result["ensureElapsedMs"] = clock.ElapsedMilliseconds;
        Result["ensureEndUtc"] = Utc();
        var closed = failure as LauncherFailure;
        if (closed != null)
        {
            Result["code"] = closed.Code;
            Result["childExit"] = closed.ChildExit;
            Result["lock"] = closed.Lock;
            Result["logFolder"] = closed.LogFolder;
            Result["message"] = closed.Message;
        }
        if (failure != null)
        {
            Result["presented"] = Program.Present(failure, "gateway", configPath);
            byte[] record = LauncherLog.Build(DateTime.UtcNow, Process.GetCurrentProcess().Id, failure, "gateway", configPath);
            Result["logRecord"] = record == null ? null : new UTF8Encoding(false, true).GetString(record);
        }
        return Write(resultPath, 0);
    }
}
