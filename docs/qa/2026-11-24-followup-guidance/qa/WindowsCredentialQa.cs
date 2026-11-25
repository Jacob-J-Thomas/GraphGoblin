// GraphGoblin independent QA driver for #535: Windows launcher credential propagation and
// persisted-override validation. The runner compiles the exact shipped
// apps/windows-launcher/Launcher.cs together with this file using /main:WindowsCredentialQa,
// so the launcher's own Program.Main is deliberately not the entry point.
//
// Usage:
//   WindowsCredentialQa inherit|removed <disposable fixture path> <approved node executable>
//   WindowsCredentialQa probe-inherit|probe-removed      (internal hidden child mode only)
//
// Legacy .NET Framework 4 C# only: no tuples, interpolated strings, null-conditional operators
// or nullable reference annotations. The launcher's namespace is not assumed; its public
// Configuration surface is located by reflection inside this same compiled assembly and invoked
// unchanged (Validate(true), ChildEnvironment(), GatewayEnvironment(logRoot)).
//
// Safety: writes only beneath the supplied fixture path; never executes Node, never opens a
// socket, never starts a gateway, browser or terminal window, never reads a credential store,
// never prints or forwards an environment value. The probe child receives only its expectation
// mode as an argument. Stdout of the main mode is exactly one JSON object of boolean receipts.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

public static class WindowsCredentialQa
{
    const string SyntheticJev = "GG-INDEPENDENT-QA-SYNTHETIC-JEV-20261124";
    const string JevName = "JEV_API_KEY";
    const string MasterName = "GG_MASTER_KEY";
    const string GgJevName = "GG_JEV_API_KEY";
    const string ProbePrefix = "probe-";
    const string Inherit = "inherit";
    const string Removed = "removed";
    const string AdmittedName = "GG_LOG_LEVEL";
    const string AdmittedValue = "warn";
    const string LoopbackHost = "127.0.0.1";
    const string CredentialRefusal =
        "Launcher Environment cannot contain GG_MASTER_KEY or GG_JEV_API_KEY (case-insensitive). " +
        "Keep credentials in GraphGoblin secret stores; use the data directory master.key for encryption.";
    const int FixturePort = 47963;
    const int ProbeDeadlineMilliseconds = 20000;
    const int DrainDeadlineMilliseconds = 5000;
    const int BitJev = 1;
    const int BitStripped = 2;
    const int BitProjected = 4;
    const BindingFlags PublicStatic = BindingFlags.Public | BindingFlags.Static;

    static readonly Encoding Utf8 = new UTF8Encoding(false);
    static readonly string[] LauncherOwnedNames = { "GG_HOST", "GG_PORT", "GG_DATA_DIR", "GG_WEB_DIST", AdmittedName };
    static readonly string[] ReceiptKeys = {
        "validConfigAccepts",
        "processJevMatchesScenario",
        "childEnvironmentJevMatchesScenario",
        "gatewayEnvironmentJevMatchesScenario",
        "gatewayProcessJevMatchesScenario",
        "bothMapsStripInheritedGgCredentialNames",
        "gatewayProcessStripsInheritedGgCredentialNames",
        "persistedMasterCanonicalEmptyRefused",
        "persistedMasterMixedCaseEmptyRefused",
        "persistedJevCanonicalEmptyRefused",
        "persistedJevMixedCaseEmptyRefused"
    };

    // Reflection handles and owned fixture paths for one scenario run.
    static Type configType;
    static Type refusalType;
    static MethodInfo validateMethod;
    static PropertyInfo environmentProperty;
    static JavaScriptSerializer serializer;
    static string repoPath;
    static string nodePath;
    static string dataPath;
    static string configPath;
    static string chromeProxyPath;
    static string iconPath;

    public static int Main(string[] args)
    {
        try
        {
            if (args.Length == 1 && args[0].StartsWith(ProbePrefix, StringComparison.Ordinal))
                return Probe(args[0].Substring(ProbePrefix.Length));
            if (args.Length != 3 || (args[0] != Inherit && args[0] != Removed))
            {
                Console.Error.WriteLine("usage: WindowsCredentialQa inherit|removed <fixture> <node>");
                return 64;
            }
            return Run(args[0] == Inherit, args[1], args[2]);
        }
        catch (Exception error)
        {
            // Safe type detail only; never a message that could echo a path or value.
            Exception shown = error;
            while (shown is TargetInvocationException && shown.InnerException != null) shown = shown.InnerException;
            Console.Error.WriteLine(shown.GetType().FullName);
            return 70;
        }
    }

    static int Run(bool inherit, string fixtureArgument, string node)
    {
        if (!Path.IsPathRooted(fixtureArgument) || !Path.IsPathRooted(node) || !File.Exists(node))
            throw new ArgumentException("fixture or node");
        string fixture = Path.GetFullPath(fixtureArgument);
        if (string.Equals(Path.GetPathRoot(fixture).TrimEnd('\\', '/'), fixture.TrimEnd('\\', '/'), StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("fixture");

        configType = LauncherType("Configuration", "GatewayEnvironment");
        refusalType = LauncherType("ConfigurationRefusal", null);
        if (!typeof(Exception).IsAssignableFrom(refusalType)) throw new InvalidOperationException("refusal type");
        validateMethod = configType.GetMethod("Validate", new Type[] { typeof(bool) });
        MethodInfo childMethod = configType.GetMethod("ChildEnvironment", Type.EmptyTypes);
        MethodInfo gatewayMethod = configType.GetMethod("GatewayEnvironment", new Type[] { typeof(string) });
        environmentProperty = configType.GetProperty("Environment");
        if (validateMethod == null || childMethod == null || gatewayMethod == null || environmentProperty == null)
            throw new InvalidOperationException("launcher surface");
        string logVariable = Constant<string>(configType, "LogDirectoryVariable");
        string marker = Constant<string>(configType, "LogProtocolMarker");
        string[] builtFiles = Constant<string[]>(configType, "BuiltFiles");
        serializer = new JavaScriptSerializer();

        // A valid gateway-only configuration built entirely inside the disposable fixture.
        string root = Path.Combine(fixture, inherit ? Inherit : Removed);
        repoPath = Path.Combine(root, "repo");
        dataPath = Path.Combine(root, "data");
        configPath = Path.Combine(root, "config");
        string mockPath = Path.Combine(root, "mock");
        string logRoot = Path.Combine(root, "logs");
        foreach (string directory in new string[] { repoPath, dataPath, configPath, mockPath, logRoot })
            Directory.CreateDirectory(directory);
        foreach (string relative in builtFiles)
        {
            string file = Path.Combine(repoPath, relative.Replace('/', Path.DirectorySeparatorChar));
            Directory.CreateDirectory(Path.GetDirectoryName(file));
            File.WriteAllText(file, "independent QA placeholder; never executed\n", Utf8);
        }
        File.WriteAllText(Path.Combine(repoPath, "apps", "api", "dist", "main.js"), marker + "\n", Utf8);
        chromeProxyPath = Path.Combine(mockPath, "chrome-proxy.placeholder");
        iconPath = Path.Combine(mockPath, "icon.placeholder");
        File.WriteAllText(chromeProxyPath, "", Utf8);
        File.WriteAllText(iconPath, "", Utf8);
        nodePath = node;

        // validConfigAccepts: the JSON round trip keeps the one admitted GG_* override, and the
        // shipped Validate(true) returns normally for it.
        Dictionary<string, string> admitted = new Dictionary<string, string>(StringComparer.Ordinal);
        admitted[AdmittedName] = AdmittedValue;
        string validJson;
        object valid = RoundTrip(ConfigMap(admitted), "valid.json", out validJson);
        IDictionary<string, string> validEnvironment = (IDictionary<string, string>)environmentProperty.GetValue(valid, null);
        bool validConfigAccepts = validJson.Length > 0 && validEnvironment != null && validEnvironment.Count == 1 &&
            ValueIs(validEnvironment, AdmittedName, AdmittedValue) && TryValidate(valid) == null;

        // This process: the wrapper's scenario, plus both fake inherited GG_ credential names.
        List<string> processNames = Names(System.Environment.GetEnvironmentVariables());
        bool processJevMatches = JevMatches(inherit, System.Environment.GetEnvironmentVariable(JevName), Count(processNames, JevName));
        bool inheritedCredentials = Count(processNames, MasterName) == 1 && Count(processNames, GgJevName) == 1 &&
            System.Environment.GetEnvironmentVariable(MasterName) != null &&
            System.Environment.GetEnvironmentVariable(GgJevName) != null;

        // The shipped maps: helper input and the real detached-gateway input.
        IDictionary<string, string> child = (IDictionary<string, string>)childMethod.Invoke(valid, null);
        IDictionary<string, string> gateway = (IDictionary<string, string>)gatewayMethod.Invoke(valid, new object[] { logRoot });
        bool childJev = JevMatches(inherit, Value(child, JevName), Count(child.Keys, JevName));
        bool gatewayJev = JevMatches(inherit, Value(gateway, JevName), Count(gateway.Keys, JevName)) &&
            ValueIs(gateway, logVariable, logRoot);
        bool mapsStrip = inheritedCredentials &&
            Count(child.Keys, MasterName) == 0 && Count(child.Keys, GgJevName) == 0 &&
            Count(gateway.Keys, MasterName) == 0 && Count(gateway.Keys, GgJevName) == 0 &&
            OnlyLauncherGgNames(child.Keys, logVariable, false) && OnlyLauncherGgNames(gateway.Keys, logVariable, true) &&
            ValueIs(child, AdmittedName, AdmittedValue) && ValueIs(gateway, AdmittedName, AdmittedValue);

        // A real hidden Windows child whose whole environment is GatewayEnvironment(logRoot).
        int mask = SpawnProbe(inherit, gateway, root);
        bool probeProjected = mask >= 0 && (mask & BitProjected) != 0;
        bool gatewayProcessJev = probeProjected && (mask & BitJev) != 0;
        bool gatewayProcessStrips = inheritedCredentials && probeProjected && (mask & BitStripped) != 0;

        // Persisted overrides with an empty value, refused by the credential-specific branch.
        bool masterCanonical = RefusedByCredentialBranch(MasterName, "master-canonical-empty.json");
        bool masterMixed = RefusedByCredentialBranch("GG_Master_Key", "master-mixed-empty.json") &&
            RefusedByCredentialBranch("Gg_master_KEY", "master-mixed-prefix-empty.json");
        bool jevCanonical = RefusedByCredentialBranch(GgJevName, "jev-canonical-empty.json");
        bool jevMixed = RefusedByCredentialBranch("GG_Jev_Api_Key", "jev-mixed-empty.json") &&
            RefusedByCredentialBranch("gG_jev_API_key", "jev-mixed-prefix-empty.json");

        bool[] receipts = {
            validConfigAccepts, processJevMatches, childJev, gatewayJev, gatewayProcessJev, mapsStrip,
            gatewayProcessStrips, masterCanonical, masterMixed, jevCanonical, jevMixed
        };
        StringBuilder json = new StringBuilder("{");
        bool all = true;
        for (int index = 0; index < ReceiptKeys.Length; index++)
        {
            if (index > 0) json.Append(',');
            json.Append('"').Append(ReceiptKeys[index]).Append("\":").Append(receipts[index] ? "true" : "false");
            all &= receipts[index];
        }
        json.Append('}');
        Console.Out.Write(json.ToString());
        Console.Out.Flush();
        return all ? 0 : 1;
    }

    /// <summary>Hidden child mode: inspects only its own environment and prints a 3-bit mask.</summary>
    static int Probe(string expectation)
    {
        bool inherit;
        if (expectation == Inherit) inherit = true;
        else if (expectation == Removed) inherit = false;
        else return 64;
        string logVariable = Constant<string>(LauncherType("Configuration", "GatewayEnvironment"), "LogDirectoryVariable");
        List<string> names = Names(System.Environment.GetEnvironmentVariables());
        int mask = 0;
        if (JevMatches(inherit, System.Environment.GetEnvironmentVariable(JevName), Count(names, JevName))) mask |= BitJev;
        if (Count(names, MasterName) == 0 && Count(names, GgJevName) == 0 &&
            System.Environment.GetEnvironmentVariable(MasterName) == null &&
            System.Environment.GetEnvironmentVariable(GgJevName) == null &&
            OnlyLauncherGgNames(names, logVariable, true)) mask |= BitStripped;
        if (Count(names, logVariable) == 1 && !string.IsNullOrEmpty(System.Environment.GetEnvironmentVariable(logVariable)) &&
            string.Equals(System.Environment.GetEnvironmentVariable("GG_HOST"), LoopbackHost, StringComparison.Ordinal))
            mask |= BitProjected;
        Console.Out.Write(mask.ToString(CultureInfo.InvariantCulture));
        Console.Out.Flush();
        return 0;
    }

    static int SpawnProbe(bool inherit, IDictionary<string, string> gateway, string workingDirectory)
    {
        ProcessStartInfo start = new ProcessStartInfo(Assembly.GetExecutingAssembly().Location,
            ProbePrefix + (inherit ? Inherit : Removed));
        start.UseShellExecute = false;
        start.CreateNoWindow = true;
        start.WindowStyle = ProcessWindowStyle.Hidden;
        start.ErrorDialog = false;
        start.RedirectStandardInput = true;
        start.RedirectStandardOutput = true;
        start.RedirectStandardError = true;
        start.WorkingDirectory = workingDirectory;
        // The child's entire environment is the launcher's gateway input and nothing else.
        start.EnvironmentVariables.Clear();
        foreach (KeyValuePair<string, string> item in gateway) start.EnvironmentVariables[item.Key] = item.Value;
        using (Process process = Process.Start(start))
        {
            if (process == null) return -1;
            process.StandardInput.Close();
            string[] output = new string[1];
            Thread stdout = new Thread(() =>
            {
                try { output[0] = process.StandardOutput.ReadToEnd(); }
                catch (Exception) { output[0] = null; }
            });
            Thread stderr = new Thread(() =>
            {
                try { process.StandardError.ReadToEnd(); }
                catch (Exception) { }
            });
            stdout.IsBackground = true;
            stderr.IsBackground = true;
            stdout.Start();
            stderr.Start();
            if (!process.WaitForExit(ProbeDeadlineMilliseconds))
            {
                try { process.Kill(); process.WaitForExit(DrainDeadlineMilliseconds); }
                catch (Exception) { }
                return -1;
            }
            if (!stdout.Join(DrainDeadlineMilliseconds) || !stderr.Join(DrainDeadlineMilliseconds)) return -1;
            if (process.ExitCode != 0) return -1;
            string text = output[0] == null ? "" : output[0].Trim();
            int mask;
            if (text.Length != 1 || !int.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out mask)) return -1;
            return mask >= 0 && mask <= 7 ? mask : -1;
        }
    }

    /// <summary>
    /// The JSON fixture really persists the credential name with an empty value; the shipped
    /// Validate(true) throws ConfigurationRefusal with the credential-specific message; and the
    /// same deserialized object, with only that key removed, is then accepted (control).
    /// </summary>
    static bool RefusedByCredentialBranch(string name, string file)
    {
        Dictionary<string, string> persisted = new Dictionary<string, string>(StringComparer.Ordinal);
        persisted[AdmittedName] = AdmittedValue;
        persisted[name] = "";
        string json;
        object config = RoundTrip(ConfigMap(persisted), file, out json);
        if (json.IndexOf("\"" + name + "\":\"\"", StringComparison.Ordinal) < 0) return false;
        IDictionary<string, string> environment = (IDictionary<string, string>)environmentProperty.GetValue(config, null);
        string value;
        if (environment == null || environment.Count != 2 || !environment.TryGetValue(name, out value) || value != "") return false;
        Exception refusal = TryValidate(config);
        if (refusal == null || refusal.GetType() != refusalType || refusal.Message == null ||
            refusal.Message.IndexOf(CredentialRefusal, StringComparison.Ordinal) < 0) return false;
        if (!environment.Remove(name)) return false;
        return TryValidate(config) == null;
    }

    static Dictionary<string, object> ConfigMap(Dictionary<string, string> environment)
    {
        Dictionary<string, object> map = new Dictionary<string, object>(StringComparer.Ordinal);
        map["Repo"] = repoPath;
        map["Node"] = nodePath;
        map["DataDir"] = dataPath;
        map["Port"] = FixturePort;
        map["ChromeProxy"] = chromeProxyPath;
        map["ChromeProfile"] = "Independent QA";
        map["ChromeAppId"] = new string('a', 32);
        map["IconLocation"] = iconPath;
        map["PwaAppUserModelId"] = "GraphGoblin.IndependentQa.Pwa";
        map["LauncherAppUserModelId"] = "GraphGoblin.IndependentQa.Launcher";
        map["Environment"] = environment;
        map["StartupTimeoutSeconds"] = 30;
        map["WindowTimeoutSeconds"] = 20;
        return map;
    }

    /// <summary>Serialize, persist, reread and deserialize with the launcher's JavaScriptSerializer.</summary>
    static object RoundTrip(Dictionary<string, object> map, string file, out string json)
    {
        string path = Path.Combine(configPath, file);
        File.WriteAllText(path, serializer.Serialize(map), Utf8);
        json = File.ReadAllText(path, Utf8);
        return serializer.Deserialize(json, configType);
    }

    static Exception TryValidate(object config)
    {
        try
        {
            validateMethod.Invoke(config, new object[] { true });
            return null;
        }
        catch (TargetInvocationException error)
        {
            return error.InnerException ?? error;
        }
    }

    static bool JevMatches(bool inherit, string value, int count)
    {
        return inherit
            ? count == 1 && string.Equals(value, SyntheticJev, StringComparison.Ordinal)
            : count == 0 && value == null;
    }

    /// <summary>Every GG_* name is launcher-owned or the admitted override; the log input only for the gateway.</summary>
    static bool OnlyLauncherGgNames(IEnumerable<string> names, string logVariable, bool gateway)
    {
        int logEntries = 0;
        foreach (string name in names)
        {
            if (!name.StartsWith("GG_", StringComparison.OrdinalIgnoreCase)) continue;
            if (string.Equals(name, logVariable, StringComparison.OrdinalIgnoreCase)) { logEntries++; continue; }
            if (Count(LauncherOwnedNames, name) != 1) return false;
        }
        return logEntries == (gateway ? 1 : 0);
    }

    static List<string> Names(IDictionary variables)
    {
        List<string> names = new List<string>();
        foreach (DictionaryEntry item in variables) names.Add((string)item.Key);
        return names;
    }

    static int Count(IEnumerable<string> names, string name)
    {
        int count = 0;
        foreach (string candidate in names)
            if (string.Equals(candidate, name, StringComparison.OrdinalIgnoreCase)) count++;
        return count;
    }

    static string Value(IDictionary<string, string> map, string name)
    {
        string found = null;
        foreach (KeyValuePair<string, string> item in map)
            if (string.Equals(item.Key, name, StringComparison.OrdinalIgnoreCase)) found = item.Value;
        return found;
    }

    static bool ValueIs(IDictionary<string, string> map, string name, string expected)
    {
        return Count(map.Keys, name) == 1 && string.Equals(Value(map, name), expected, StringComparison.Ordinal);
    }

    static T Constant<T>(Type type, string name)
    {
        FieldInfo field = type.GetField(name, PublicStatic);
        if (field == null) throw new MissingFieldException();
        return (T)field.GetValue(null);
    }

    /// <summary>The single launcher type with this simple name (and public instance member, if given).</summary>
    static Type LauncherType(string name, string member)
    {
        Type[] types;
        try { types = typeof(WindowsCredentialQa).Assembly.GetTypes(); }
        catch (ReflectionTypeLoadException error) { types = error.Types; }
        Type found = null;
        foreach (Type type in types)
        {
            if (type == null || type == typeof(WindowsCredentialQa) || type.Name != name) continue;
            if (member != null && type.GetMember(member, BindingFlags.Public | BindingFlags.Instance).Length == 0) continue;
            if (found != null) throw new InvalidOperationException("ambiguous launcher type");
            found = type;
        }
        if (found == null) throw new InvalidOperationException("missing launcher type");
        return found;
    }
}
