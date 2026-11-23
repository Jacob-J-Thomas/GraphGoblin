// QA167I independent D167 deadline harness. Not product code; never installed.
// Compiled into the same assembly as the unchanged apps/windows-launcher/Launcher.cs (csc /main:Qa167iDeadline)
// so it reaches the intended internal HelperProcess.WorkDeadline seam (constructor, Recheck, Within, Check,
// Remaining, Expired) without reflection and without any substitute timing implementation. Native cases call
// the public HelperProcess.Read with real Node children inside the production private job.
//
// Evidence classes per case:
//   component-deterministic  : production WorkDeadline members driven by a controlled clock; no process.
//   native-deterministic     : production HelperProcess.Read with real Node children; the shared deadline's
//                              clock is advanced only from caller/validator callbacks (no OS scheduling fault).
//   native-real-time         : production HelperProcess.Read with a real Stopwatch clock and real elapsed waits.
// Private Gateway.ReadHelper / StoreHasLiveOwner / Ensure are not called here; the D cases mirror ReadHelper's
// call shape (Within around preparation plus Read with the same deadline). Their actual wiring is source
// integration plus the public native Ensure controls.
//
// Usage: Qa167iDeadline.exe <work-directory> <node.exe> <result.json>
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using GraphGoblin.Desktop;

public static class Qa167iDeadline
{
    sealed class CaseRecord
    {
        public string Id, Name, Evidence;
        public readonly List<Dictionary<string, object>> Assertions = new List<Dictionary<string, object>>();
        public readonly Dictionary<string, object> Observed = new Dictionary<string, object>();
        public string Fault;
    }

    sealed class Outcome
    {
        public string Code, Message, Unexpected;
        public object Value;
        public long Ms;
    }

    static readonly List<CaseRecord> Cases = new List<CaseRecord>();
    static CaseRecord current;
    static string node, work;

    const string TimeoutText = "The read-only ownership check exceeded its work budget. Check PowerShell and Windows Management Instrumentation availability. No gateway was started.";
    const string FreeText = "{\"state\":\"free\"}";
    const string OkScript = "process.stdout.write('ok')";
    const string FreeScript = "process.stdout.write(JSON.stringify({state:'free'}))";
    const string MarkScript = "require('fs').writeFileSync(process.argv[1],'started');process.stdout.write('ok')";
    const string SlowScript = "const fs=require('fs');fs.writeFileSync(process.argv[1]+'.started',String(Date.now()));setTimeout(()=>{fs.writeFileSync(process.argv[1]+'.finished',String(Date.now()));process.stdout.write('ok')},1500)";

    static void Assert(string name, bool pass, object expected, object observed)
    {
        var item = new Dictionary<string, object>();
        item["name"] = name; item["pass"] = pass; item["expected"] = expected; item["observed"] = observed;
        current.Assertions.Add(item);
    }

    static void Observe(string name, object value) { current.Observed[name] = value; }

    static Outcome Run(Func<object> action)
    {
        var watch = Stopwatch.StartNew();
        var outcome = new Outcome();
        try { outcome.Value = action(); outcome.Code = "returned"; }
        catch (LauncherFailure failure) { outcome.Code = failure.Code; outcome.Message = failure.Message; }
        catch (Exception error) { outcome.Code = "unexpected"; outcome.Unexpected = error.GetType().FullName; }
        outcome.Ms = watch.ElapsedMilliseconds;
        return outcome;
    }

    static Dictionary<string, object> Describe(Outcome outcome)
    {
        var item = new Dictionary<string, object>();
        item["code"] = outcome.Code; item["value"] = outcome.Value; item["ms"] = outcome.Ms;
        item["messageMatchesClosedTimeout"] = outcome.Message == TimeoutText;
        if (outcome.Unexpected != null) item["unexpected"] = outcome.Unexpected;
        return item;
    }

    static SortedDictionary<string, string> Environment()
    {
        var env = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (DictionaryEntry item in System.Environment.GetEnvironmentVariables()) env[(string)item.Key] = (string)item.Value;
        return env;
    }

    static string Read(string script, string argument, string stage, HelperProcess.WorkDeadline deadline, Func<string, bool> validate)
    {
        string arguments = "-e " + Program.Quote(script) + (argument == null ? "" : " " + Program.Quote(argument));
        return HelperProcess.Read(node, arguments, work, Environment(), stage, deadline, validate);
    }

    static void Begin(string id, string name, string evidence)
    {
        current = new CaseRecord { Id = id, Name = name, Evidence = evidence };
        Cases.Add(current);
    }

    // ---------------------------------------------------------------- cases

    static void D01()
    {
        Begin("D01", "before / equal / after the absolute cutoff", "component-deterministic");
        long clock = 7750;
        var w = HelperProcess.WorkDeadline.Recheck(() => clock, 10000);
        Assert("retry cutoff = min(7750+15000, 10000-2000): 250 ms remain at admission", w.Remaining == 250, 250L, w.Remaining);
        Assert("not expired at admission", !w.Expired, false, w.Expired);
        clock = 7999;
        Assert("1 ms remains one millisecond before the cutoff", w.Remaining == 1, 1L, w.Remaining);
        var before = Run(() => { w.Check("ownership"); return "checked"; });
        Assert("Check passes one millisecond before the cutoff", before.Code == "returned", "returned", before.Code);
        clock = 8000;
        Assert("0 ms remain at the cutoff", w.Remaining == 0, 0L, w.Remaining);
        Assert("equality is expired", w.Expired, true, w.Expired);
        var equal = Run(() => { w.Check("ownership"); return "checked"; });
        Assert("Check at equality refuses helper-timeout", equal.Code == "helper-timeout", "helper-timeout", equal.Code);
        Assert("closed timeout text names the stage", equal.Message == TimeoutText, TimeoutText, equal.Message);
        clock = 8001;
        Assert("remaining clamps at 0 after the cutoff", w.Remaining == 0, 0L, w.Remaining);
        var after = Run(() => { w.Check("ownership"); return "checked"; });
        Assert("Check after the cutoff refuses helper-timeout", after.Code == "helper-timeout", "helper-timeout", after.Code);
    }

    static void D02()
    {
        Begin("D02", "already-expired admission starts no callback and no native child", "component-deterministic + native-deterministic");
        long clock = 7750;
        var w = HelperProcess.WorkDeadline.Recheck(() => clock, 10000);
        clock = 8000;
        int calls = 0;
        var equal = Run(() => w.Within("ownership", () => { calls++; return "free"; }));
        Assert("Within at equality refuses helper-timeout", equal.Code == "helper-timeout", "helper-timeout", equal.Code);
        Assert("Within at equality ran no operation", calls == 0, 0, calls);
        clock = 8001;
        var after = Run(() => w.Within("ownership", () => { calls++; return "free"; }));
        Assert("Within after the cutoff refuses helper-timeout", after.Code == "helper-timeout", "helper-timeout", after.Code);
        Assert("Within after the cutoff ran no operation", calls == 0, 0, calls);

        long entryClock = 8000;
        var entry = new HelperProcess.WorkDeadline(() => entryClock, 8000);
        string entryMarker = Path.Combine(work, "D02-read-entry-equality.marker");
        int validations = 0;
        var read = Run(() => Read(MarkScript, entryMarker, "ownership", entry, text => { validations++; return text == "ok"; }));
        Thread.Sleep(1500);
        Observe("readAtEquality", Describe(read));
        Assert("public Read entered at equality refuses helper-timeout", read.Code == "helper-timeout", "helper-timeout", read.Code);
        Assert("no helper marker: the native child never ran", !File.Exists(entryMarker), false, File.Exists(entryMarker));
        Assert("validator never called", validations == 0, 0, validations);
        Assert("refusal returned without consuming a cleanup allowance (< 1000 ms)", read.Ms < 1000, "< 1000", read.Ms);

        long shapedClock = 8001;
        var shaped = new HelperProcess.WorkDeadline(() => shapedClock, 8000);
        string shapedMarker = Path.Combine(work, "D02-readhelper-shape-after.marker");
        int prepared = 0;
        var wired = Run(() => shaped.Within("ownership", () => { prepared++; return Read(MarkScript, shapedMarker, "ownership", shaped, text => text == "ok"); }));
        Thread.Sleep(1500);
        Observe("readHelperShapeAfter", Describe(wired));
        Assert("ReadHelper-shaped call after the cutoff refuses helper-timeout", wired.Code == "helper-timeout", "helper-timeout", wired.Code);
        Assert("argument/environment preparation never ran", prepared == 0, 0, prepared);
        Assert("no helper marker for the ReadHelper-shaped call", !File.Exists(shapedMarker), false, File.Exists(shapedMarker));
    }

    static void D03()
    {
        Begin("D03", "audit example: 250 ms admitted, 50 ms preparation, 225 ms helper work", "native-deterministic");
        long clock = 7750;
        var w = HelperProcess.WorkDeadline.Recheck(() => clock, 10000);
        long admitted = w.Remaining;
        Assert("250 ms remain at retry admission", admitted == 250, 250L, admitted);
        Assert("component value fits the 200 ms minimum sample (comparison itself is in private Ensure)", admitted >= Math.Max(200, 200), ">= 200", admitted);
        int prepared = 0, validations = 0;
        var late = Run(() => w.Within("ownership", () => {
            clock += 50; prepared++;
            return Read(FreeScript, null, "ownership", w, text => { validations++; clock += 225; return text == FreeText; });
        }));
        Observe("lateFree", Describe(late));
        Observe("clockAtRefusal", clock);
        Observe("derivedFreshClockWouldAccept", "225 < 250 (audit arithmetic for a clock restarted after preparation; not executed against held source)");
        Assert("valid free result 25 ms into the reserve refuses helper-timeout", late.Code == "helper-timeout", "helper-timeout", late.Code);
        Assert("preparation ran once", prepared == 1, 1, prepared);
        Assert("the real helper ran and its free output was validated once", validations == 1, 1, validations);
        Assert("controlled clock ended 25 ms past the cutoff", clock == 8025, 8025L, clock);
        Assert("no free value was returned to the caller", late.Value == null, null, late.Value);

        long onTime = 7750;
        var control = HelperProcess.WorkDeadline.Recheck(() => onTime, 10000);
        var accepted = Run(() => control.Within("ownership", () => {
            onTime += 50;
            return Read(FreeScript, null, "ownership", control, text => { onTime += 199; return text == FreeText; });
        }));
        Observe("onTimeFree", Describe(accepted));
        Assert("control: 50 + 199 ms (cutoff - 1) returns the free response", accepted.Code == "returned" && (string)accepted.Value == FreeText, FreeText, accepted.Value);
    }

    static void D04()
    {
        Begin("D04", "preparation crossing the cutoff admits no native creation", "native-deterministic");
        long clock = 7750;
        var w = HelperProcess.WorkDeadline.Recheck(() => clock, 10000);
        string marker = Path.Combine(work, "D04-setup-crossed.marker");
        int prepared = 0, validations = 0;
        var crossed = Run(() => w.Within("ownership", () => {
            prepared++; clock = 8000;
            return Read(MarkScript, marker, "ownership", w, text => { validations++; return text == "ok"; });
        }));
        Thread.Sleep(1500);
        Observe("setupCrossed", Describe(crossed));
        Assert("preparation reaching the cutoff refuses helper-timeout", crossed.Code == "helper-timeout", "helper-timeout", crossed.Code);
        Assert("preparation ran once", prepared == 1, 1, prepared);
        Assert("no helper marker: Read refused before native creation", !File.Exists(marker), false, File.Exists(marker));
        Assert("validator never called", validations == 0, 0, validations);

        long onTime = 7750;
        var control = HelperProcess.WorkDeadline.Recheck(() => onTime, 10000);
        string controlMarker = Path.Combine(work, "D04-setup-on-time.marker");
        var accepted = Run(() => control.Within("ownership", () => {
            onTime = 7999;
            return Read(MarkScript, controlMarker, "ownership", control, text => text == "ok");
        }));
        Observe("setupOnTime", Describe(accepted));
        Assert("control: preparation ending at cutoff - 1 runs the helper and returns ok", accepted.Code == "returned" && (string)accepted.Value == "ok", "ok", accepted.Value);
        Assert("control: helper marker present", File.Exists(controlMarker), true, File.Exists(controlMarker));
    }

    static void D05()
    {
        Begin("D05", "validation crossing the cutoff", "native-deterministic");
        var variants = new[] {
            new { Label = "valid-at-equality", SetTo = 8000L, Valid = true, Expected = "helper-timeout" },
            new { Label = "valid-before", SetTo = 7999L, Valid = true, Expected = "returned" },
            new { Label = "invalid-at-equality", SetTo = 8000L, Valid = false, Expected = "helper-timeout" },
            new { Label = "invalid-before", SetTo = 7999L, Valid = false, Expected = "helper-invalid" },
        };
        foreach (var variant in variants)
        {
            long clock = 7750;
            var w = HelperProcess.WorkDeadline.Recheck(() => clock, 10000);
            int validations = 0;
            var v = variant;
            var outcome = Run(() => Read(OkScript, null, "ownership", w, text => { validations++; clock = v.SetTo; return v.Valid && text == "ok"; }));
            Observe(variant.Label, Describe(outcome));
            Assert(variant.Label + ": " + variant.Expected, outcome.Code == variant.Expected, variant.Expected, outcome.Code);
            Assert(variant.Label + ": validator called once", validations == 1, 1, validations);
            if (variant.Expected == "returned") Assert(variant.Label + ": trimmed ok returned", (string)outcome.Value == "ok", "ok", outcome.Value);
        }
    }

    static void D06()
    {
        Begin("D06", "expiry between Read return and caller consumption", "native-deterministic");
        long clock = 7750;
        var w = HelperProcess.WorkDeadline.Recheck(() => clock, 10000);
        string delivered = null; int reads = 0;
        var late = Run(() => {
            delivered = w.Within("ownership", () => {
                string value = Read(OkScript, null, "ownership", w, text => { clock = 7999; return text == "ok"; });
                reads++; clock = 8000;
                return value;
            });
            return delivered;
        });
        Observe("returnCrossed", Describe(late));
        Assert("Within refuses helper-timeout after Read returned at the cutoff", late.Code == "helper-timeout", "helper-timeout", late.Code);
        Assert("Read itself returned once", reads == 1, 1, reads);
        Assert("nothing delivered to the caller", delivered == null, null, delivered);

        long onTime = 7750;
        var control = HelperProcess.WorkDeadline.Recheck(() => onTime, 10000);
        string controlDelivered = null;
        var accepted = Run(() => {
            controlDelivered = control.Within("ownership", () => Read(OkScript, null, "ownership", control, text => { onTime = 7999; return text == "ok"; }));
            return controlDelivered;
        });
        Observe("returnOnTime", Describe(accepted));
        Assert("control: return at cutoff - 1 delivers ok", accepted.Code == "returned" && controlDelivered == "ok", "ok", controlDelivered);
    }

    static void D07()
    {
        Begin("D07", "15-second work cap", "component-deterministic + real-clock construction");
        Assert("WorkMilliseconds is 15000", HelperProcess.WorkMilliseconds == 15000, 15000, HelperProcess.WorkMilliseconds);
        Assert("CleanupMilliseconds is 2000", HelperProcess.CleanupMilliseconds == 2000, 2000, HelperProcess.CleanupMilliseconds);
        long clock = 1000;
        var w = HelperProcess.WorkDeadline.Recheck(() => clock, 300000);
        Assert("long release window: retry capped at admission + 15000", w.Remaining == 15000, 15000L, w.Remaining);
        clock = 15999;
        var before = Run(() => { w.Check("ownership"); return "checked"; });
        Assert("Check passes at admission + 14999", before.Code == "returned", "returned", before.Code);
        clock = 16000;
        var equal = Run(() => { w.Check("ownership"); return "checked"; });
        Assert("Check at admission + 15000 refuses helper-timeout", equal.Code == "helper-timeout", "helper-timeout", equal.Code);
        clock = 100000;
        var late = HelperProcess.WorkDeadline.Recheck(() => clock, 300000);
        Assert("late admission in a long window is still capped at 15000", late.Remaining == 15000, 15000L, late.Remaining);
        var initial = HelperProcess.WorkDeadline.Start(HelperProcess.WorkMilliseconds);
        long remaining = initial.Remaining;
        Observe("initialRemaining", remaining);
        Assert("public Start(WorkMilliseconds) grants at most 15000 ms", remaining <= 15000 && remaining > 14000, "(14000, 15000]", remaining);
        Assert("public Start(WorkMilliseconds) is not expired at creation", !initial.Expired, false, initial.Expired);
    }

    static void D08()
    {
        Begin("D08", "outer release window keeps the 2-second cleanup reserve", "component-deterministic");
        long clock = 5000;
        var w = HelperProcess.WorkDeadline.Recheck(() => clock, 8000);
        Assert("cutoff = release 8000 - 2000: 1000 ms remain at 5000", w.Remaining == 1000, 1000L, w.Remaining);
        clock = 5999;
        var before = Run(() => { w.Check("ownership"); return "checked"; });
        Assert("Check passes at 5999", before.Code == "returned", "returned", before.Code);
        clock = 6000;
        var equal = Run(() => { w.Check("ownership"); return "checked"; });
        Assert("Check at release - 2000 refuses helper-timeout", equal.Code == "helper-timeout", "helper-timeout", equal.Code);
        clock = 5800;
        var boundary = HelperProcess.WorkDeadline.Recheck(() => clock, 8000);
        Assert("admission at 5800 leaves exactly 200 ms", boundary.Remaining == 200, 200L, boundary.Remaining);
        clock = 5801;
        var short1 = HelperProcess.WorkDeadline.Recheck(() => clock, 8000);
        Assert("admission at 5801 leaves 199 ms (below the 200 ms minimum sample)", short1.Remaining == 199, 199L, short1.Remaining);
        clock = 6000;
        var exhausted = HelperProcess.WorkDeadline.Recheck(() => clock, 8000);
        int calls = 0;
        var refused = Run(() => exhausted.Within("ownership", () => { calls++; return "free"; }));
        Assert("admission exactly at release - 2000 is expired", exhausted.Expired && exhausted.Remaining == 0, "expired, 0", exhausted.Remaining);
        Assert("exhausted reserve refuses helper-timeout without work", refused.Code == "helper-timeout" && calls == 0, "helper-timeout, 0 calls", refused.Code + ", " + calls);
        clock = 7000;
        var inside = HelperProcess.WorkDeadline.Recheck(() => clock, 8000);
        Assert("admission inside the reserve grants no work", inside.Expired && inside.Remaining == 0, "expired, 0", inside.Remaining);
    }

    static void D09()
    {
        Begin("D09", "on-time success through the same deadline", "native-real-time");
        var watch = Stopwatch.StartNew();
        var w = HelperProcess.WorkDeadline.Recheck(() => watch.ElapsedMilliseconds, 10000);
        long before = w.Remaining;
        Assert("real-clock retry admission: cutoff at release - 2000 (<= 8000 ms remain)", before <= 8000 && before > 7000, "(7000, 8000]", before);
        var accepted = Run(() => w.Within("ownership", () => Read(FreeScript, null, "ownership", w, text => text == FreeText)));
        long after = w.Remaining;
        Observe("retryShaped", Describe(accepted));
        Observe("remainingBefore", before); Observe("remainingAfter", after);
        Assert("valid free within the cutoff is returned", accepted.Code == "returned" && (string)accepted.Value == FreeText, FreeText, accepted.Value);
        Assert("the same deadline kept running (remaining decreased, no restart)", after < before, "< " + before, after);
        Assert("deadline not expired after on-time success", !w.Expired, false, w.Expired);
        var start = HelperProcess.WorkDeadline.Start(5000);
        var publicStart = Run(() => Read(OkScript, null, "identity", start, text => text == "ok"));
        Observe("publicStart", Describe(publicStart));
        Assert("public Start(5000) admits an on-time identity-shaped helper", publicStart.Code == "returned" && (string)publicStart.Value == "ok", "ok", publicStart.Value);
    }

    static void D10()
    {
        Begin("D10", "real elapsed preparation is charged to the same cutoff", "native-real-time");
        string marker = Path.Combine(work, "D10-slow");
        var watch = Stopwatch.StartNew();
        var w = HelperProcess.WorkDeadline.Recheck(() => watch.ElapsedMilliseconds, 2600);
        long admitted = w.Remaining;
        long preparedAt = -1;
        var outcome = Run(() => w.Within("ownership", () => {
            Thread.Sleep(400);
            preparedAt = watch.ElapsedMilliseconds;
            return Read(SlowScript, marker, "ownership", w, text => text == "ok");
        }));
        long returnedAt = watch.ElapsedMilliseconds;
        Thread.Sleep(2500);
        bool started = File.Exists(marker + ".started"), finished = File.Exists(marker + ".finished");
        Observe("outcome", Describe(outcome));
        Observe("admittedRemaining", admitted); Observe("preparedAtMs", preparedAt); Observe("returnedAtMs", returnedAt);
        Observe("helperStartedMarker", started);
        Assert("premise: cutoff is 600 ms on the real clock", admitted <= 600 && admitted > 500, "(500, 600]", admitted);
        Assert("premise: real preparation ended before the cutoff", preparedAt >= 400 && preparedAt < 600, "[400, 600)", preparedAt);
        Assert("real elapsed preparation + helper crossing the cutoff refuses helper-timeout (cleanup confirmed)", outcome.Code == "helper-timeout", "helper-timeout", outcome.Code);
        Assert("helper never finished: terminated before its 1500 ms timer", !finished, false, finished);
        Assert("refusal returned within cutoff + cleanup allowance + 1500 ms tolerance", returnedAt < 600 + 2000 + 1500, "< 4100", returnedAt);
    }

    static void D11()
    {
        Begin("D11", "one immutable cutoff shared by sequential guarded operations", "component-deterministic");
        long clock = 0;
        var w = HelperProcess.WorkDeadline.Recheck(() => clock, 2600);
        Assert("cutoff 600 at admission 0", w.Remaining == 600, 600L, w.Remaining);
        var first = Run(() => w.Within("ownership", () => { clock = 400; return "first"; }));
        Assert("first guarded operation ending at 400 returns", first.Code == "returned" && (string)first.Value == "first", "first", first.Value);
        Assert("200 ms remain after the first operation", w.Remaining == 200, 200L, w.Remaining);
        var second = Run(() => w.Within("ownership", () => { clock += 250; return "second"; }));
        Assert("second 250 ms operation crosses the same cutoff and refuses (a restarted 600 ms clock would admit it)", second.Code == "helper-timeout", "helper-timeout", second.Code);
        Assert("0 ms remain afterwards", w.Remaining == 0, 0L, w.Remaining);
    }

    public static int Main(string[] args)
    {
        if (args.Length != 3) return 64;
        work = args[0]; node = args[1];
        string resultPath = args[2];
        Directory.CreateDirectory(work);
        var result = new Dictionary<string, object>();
        result["schema"] = "qa167i-deadline-result/1";
        result["pid"] = Process.GetCurrentProcess().Id;
        result["startUtc"] = DateTime.UtcNow.ToString("o");
        var steps = new Action[] { D01, D02, D03, D04, D05, D06, D07, D08, D09, D10, D11 };
        foreach (var step in steps)
        {
            try { step(); }
            catch (Exception error) { current.Fault = error.GetType().FullName + ": " + error.Message; }
        }
        var list = new List<object>();
        int assertions = 0, passed = 0, failedCases = 0, faults = 0;
        foreach (var item in Cases)
        {
            int casePassed = 0;
            foreach (var assertion in item.Assertions) if ((bool)assertion["pass"]) casePassed++;
            assertions += item.Assertions.Count; passed += casePassed;
            bool pass = item.Fault == null && casePassed == item.Assertions.Count && item.Assertions.Count > 0;
            if (!pass) failedCases++;
            if (item.Fault != null) faults++;
            var record = new Dictionary<string, object>();
            record["id"] = item.Id; record["name"] = item.Name; record["evidence"] = item.Evidence;
            record["status"] = pass ? "PASS" : "FAIL"; record["fault"] = item.Fault;
            record["assertions"] = item.Assertions; record["observed"] = item.Observed;
            list.Add(record);
            Console.WriteLine(item.Id + " " + (pass ? "PASS" : "FAIL") + " " + casePassed + "/" + item.Assertions.Count + (item.Fault == null ? "" : " FAULT"));
        }
        var summary = new Dictionary<string, object>();
        summary["cases"] = Cases.Count; summary["casesPassed"] = Cases.Count - failedCases; summary["casesFailed"] = failedCases;
        summary["assertions"] = assertions; summary["assertionsPassed"] = passed; summary["assertionsFailed"] = assertions - passed; summary["faults"] = faults;
        result["cases"] = list; result["summary"] = summary;
        result["endUtc"] = DateTime.UtcNow.ToString("o");
        var serializer = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
        File.WriteAllText(resultPath, serializer.Serialize(result), new UTF8Encoding(false));
        Console.WriteLine("summary " + serializer.Serialize(summary));
        return failedCases == 0 ? 0 : 1;
    }
}
