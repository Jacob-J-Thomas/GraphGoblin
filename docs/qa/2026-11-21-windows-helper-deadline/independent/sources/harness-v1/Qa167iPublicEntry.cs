// QA167I independent D167 public helper-entry harness. Not product code; never installed.
// Compiled separately with /reference to the unmodified compiled launcher assembly (GraphGoblin.exe built
// from apps/windows-launcher/Launcher.cs with the installer's csc flags). It calls only public members:
// HelperProcess.WorkDeadline.Start, HelperProcess.Read, Program.Quote and LauncherFailure fields.
// No internal seam, reflection, Program.Main, GUI, mutex or launcher.log.
//
// Usage: Qa167iPublicEntry.exe <node.exe> <work-directory> <result.json>
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using GraphGoblin.Desktop;

public static class Qa167iPublicEntry
{
    const string MarkScript = "require('fs').writeFileSync(process.argv[1],'started');process.stdout.write('ok')";

    static Dictionary<string, object> Attempt(string node, string work, string marker, HelperProcess.WorkDeadline deadline)
    {
        var env = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (DictionaryEntry item in Environment.GetEnvironmentVariables()) env[(string)item.Key] = (string)item.Value;
        var record = new Dictionary<string, object>();
        int validations = 0;
        var watch = Stopwatch.StartNew();
        try
        {
            string value = HelperProcess.Read(node, "-e " + Program.Quote(MarkScript) + " " + Program.Quote(marker), work, env, "identity", deadline,
                text => { validations++; return text == "ok"; });
            record["code"] = "returned"; record["value"] = value;
        }
        catch (LauncherFailure refused) { record["code"] = refused.Code; record["message"] = refused.Message; }
        catch (Exception unexpected) { record["code"] = "unexpected"; record["exceptionType"] = unexpected.GetType().FullName; }
        record["ms"] = watch.ElapsedMilliseconds;
        Thread.Sleep(1500);
        record["validations"] = validations;
        record["markerExists"] = File.Exists(marker);
        return record;
    }

    public static int Main(string[] args)
    {
        if (args.Length != 3) return 64;
        string node = args[0], work = args[1], resultPath = args[2];
        Directory.CreateDirectory(work);
        var result = new Dictionary<string, object>();
        result["schema"] = "qa167i-public-entry-result/1";
        result["pid"] = Process.GetCurrentProcess().Id;
        result["startUtc"] = DateTime.UtcNow.ToString("o");
        result["expired"] = Attempt(node, work, Path.Combine(work, "N5-expired-entry.marker"), HelperProcess.WorkDeadline.Start(0));
        result["onTime"] = Attempt(node, work, Path.Combine(work, "N5-on-time-entry.marker"), HelperProcess.WorkDeadline.Start(HelperProcess.WorkMilliseconds));
        result["endUtc"] = DateTime.UtcNow.ToString("o");
        File.WriteAllText(resultPath, new JavaScriptSerializer().Serialize(result), new UTF8Encoding(false));
        return 0;
    }
}
