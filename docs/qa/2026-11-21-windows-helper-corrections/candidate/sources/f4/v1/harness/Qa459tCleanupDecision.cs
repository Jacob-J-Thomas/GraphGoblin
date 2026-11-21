// QA459T independent #459 D166 F4 candidate timing-decision harness. Not product code.
// Compiled in ONE csc invocation together with the candidate's unmodified committed
// apps/windows-launcher/Launcher.cs and selected with /main:Qa459tCleanupDecision, so the intended
// shared internal seam GraphGoblin.Desktop.HelperProcess.AwaitCleanup is reached by ordinary
// same-assembly internal access. No reflection, no private member, no product edit and no substitute
// decision implementation: every decision below is the product method's own return value.
//
// Each case supplies deterministic observe/elapsed delegates and records the returned bool, the
// exact delegate call order (O = observe, E = elapsed sample) and every elapsed value the seam read.
// These are shared-decision observations only. They do not reproduce OS cleanup, a kernel race, the
// production exception mapping, retained held guidance, pending-I/O ownership or disposal order.
//
// Usage: Qa459tCleanupDecision.exe <resultJson>
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using GraphGoblin.Desktop;

public static class Qa459tCleanupDecision
{
    sealed class Probe
    {
        public long Clock;
        public int Observations;
        public readonly StringBuilder Trace = new StringBuilder();
        public readonly List<long> Samples = new List<long>();
    }

    static readonly List<Dictionary<string, object>> Results = new List<Dictionary<string, object>>();

    static string Utc() { return DateTime.UtcNow.ToString("o", System.Globalization.CultureInfo.InvariantCulture); }

    /// <summary>Runs one case through the product seam and records the exact observation.</summary>
    static void Case(string id, string name, string purpose, long startClock, Func<Probe, bool> observe, Func<Probe, long> elapsed,
        bool expected, string expectedTrace, long[] expectedSamples, long minimumLastSample)
    {
        var probe = new Probe { Clock = startClock };
        Func<bool> observeDelegate = delegate { probe.Observations++; probe.Trace.Append('O'); return observe(probe); };
        Func<long> elapsedDelegate = delegate { long value = elapsed(probe); probe.Samples.Add(value); probe.Trace.Append('E'); return value; };
        var wall = Stopwatch.StartNew();
        bool actual = false;
        string fault = null;
        try { actual = HelperProcess.AwaitCleanup(observeDelegate, elapsedDelegate); }
        catch (Exception error) { fault = error.GetType().FullName; }
        long wallMs = wall.ElapsedMilliseconds;

        var checks = new List<Dictionary<string, object>>();
        Action<string, bool, object, object> check = delegate (string label, bool pass, object want, object got) {
            var item = new Dictionary<string, object>();
            item["name"] = label; item["pass"] = pass; item["expected"] = want; item["observed"] = got;
            checks.Add(item);
        };
        check("no exception from the product seam", fault == null, null, fault);
        check("returned bool", actual == expected, expected, actual);
        check("delegate call order", probe.Trace.ToString() == expectedTrace, expectedTrace, probe.Trace.ToString());
        if (expectedSamples != null)
            check("elapsed samples read by the seam", string.Join(",", probe.Samples) == string.Join(",", expectedSamples),
                string.Join(",", expectedSamples), string.Join(",", probe.Samples));
        if (minimumLastSample >= 0)
            check("last elapsed sample at or after", probe.Samples.Count > 0 && probe.Samples[probe.Samples.Count - 1] >= minimumLastSample,
                minimumLastSample, probe.Samples.Count > 0 ? (object)probe.Samples[probe.Samples.Count - 1] : null);

        bool all = true;
        foreach (var item in checks) if (!(bool)item["pass"]) all = false;
        var record = new Dictionary<string, object>();
        record["id"] = id; record["name"] = name; record["purpose"] = purpose;
        record["startClock"] = startClock; record["expectedResult"] = expected; record["actualResult"] = actual;
        record["observations"] = probe.Observations; record["trace"] = probe.Trace.ToString();
        record["samples"] = probe.Samples; record["wallMs"] = wallMs; record["fault"] = fault;
        record["checks"] = checks; record["verdict"] = all ? "PASS" : "FAIL";
        Results.Add(record);
    }

    public static int Main(string[] args)
    {
        if (args.Length != 1) return 64;
        var output = new Dictionary<string, object>();
        output["schema"] = "qa459t-f4-result/1";
        output["startUtc"] = Utc();
        output["seam"] = "GraphGoblin.Desktop.HelperProcess.AwaitCleanup(Func<bool>, Func<long>) : bool (internal)";
        output["cleanupMilliseconds"] = HelperProcess.CleanupMilliseconds;
        output["processId"] = Process.GetCurrentProcess().Id;

        Case("T1", "complete-at-1999", "A complete observation sampled at 1,999 ms (strictly below the deadline) is credited.",
            0, p => true, p => 1999, true, "OE", new long[] { 1999 }, -1);
        Case("T2", "complete-at-2000-equality", "A complete observation sampled exactly at 2,000 ms is not credited.",
            0, p => true, p => 2000, false, "OE", new long[] { 2000 }, -1);
        Case("T3", "complete-at-2001", "A complete observation sampled at 2,001 ms is not credited.",
            0, p => true, p => 2001, false, "OE", new long[] { 2001 }, -1);
        Case("T4", "poll-crosses-deadline-within-one-observation",
            "The clock reads 1,999 ms when the observation pass starts; the pass itself advances it to 2,001 ms and completes. The sample must be taken after the full pass, so the late completion is not credited.",
            1999, p => { p.Clock = 2001; return true; }, p => p.Clock, false, "OE", new long[] { 2001 }, -1);
        Case("T5", "incomplete-then-complete-after-deadline",
            "First pass incomplete at 1,999 ms; the next pass completes but is sampled at 2,001 ms. Eventual completion does not credit timely confirmation.",
            0, p => p.Observations == 2, p => p.Observations == 1 ? 1999 : 2001, false, "OEOE", new long[] { 1999, 2001 }, -1);
        Case("T6", "incomplete-then-complete-in-budget",
            "First pass incomplete at 1,998 ms; the next pass completes sampled at 1,999 ms and is credited.",
            0, p => p.Observations == 2, p => p.Observations == 1 ? 1998 : 1999, true, "OEOE", new long[] { 1998, 1999 }, -1);
        Case("T7", "incomplete-at-deadline-stops-polling",
            "An incomplete pass sampled at 2,000 ms returns false without starting another observation pass.",
            0, p => false, p => 2000, false, "OE", new long[] { 2000 }, -1);
        // T8: the same seam with a real monotonic Stopwatch started immediately before the case, as
        // production starts its cleanup Stopwatch before the first observation pass. The pass completes
        // only after sleeping 2,050 ms, so any real sample is at or after 2,000 ms.
        var monotonic = Stopwatch.StartNew();
        Case("T8", "real-monotonic-stopwatch-late-pass",
            "With a real Stopwatch, a complete observation pass that takes at least 2,050 ms is sampled at or after 2,000 ms and is not credited.",
            0, p => { Thread.Sleep(2050); return true; }, p => monotonic.ElapsedMilliseconds, false, "OE", null, 2000);

        output["cases"] = Results;
        int failed = 0;
        foreach (var item in Results) if ((string)item["verdict"] != "PASS") failed++;
        output["summary"] = new Dictionary<string, object> { { "cases", Results.Count }, { "passed", Results.Count - failed }, { "failed", failed } };
        output["endUtc"] = Utc();
        File.WriteAllText(args[0], new JavaScriptSerializer().Serialize(output), new UTF8Encoding(false));
        Console.WriteLine("QA459T F4 cases=" + Results.Count + " passed=" + (Results.Count - failed) + " failed=" + failed);
        return failed == 0 ? 0 : 1;
    }
}
