// Owner QA tooling; build with Windows PowerShell 5.1 only.
// Disposable no-turn executable for owner QA. It cannot accept a model turn.
using System;
using System.IO;
using System.Threading;
public static class ReadinessCli {
  public static int Main(string[] args) {
    var dir = AppDomain.CurrentDomain.BaseDirectory;
    var harness = File.ReadAllText(Path.Combine(dir, "harness.txt")).Trim();
    var scenario = File.ReadAllText(Path.Combine(dir, "scenario.txt")).Trim();
    File.WriteAllText(Path.Combine(dir, "probe-" + System.Diagnostics.Process.GetCurrentProcess().Id + ".log"), DateTime.UtcNow.ToString("o") + " " + String.Join(" ", args));
    var stage = Array.IndexOf(args, "--version") >= 0 ? "version" : Array.IndexOf(args, "--help") >= 0 ? "help" : Array.IndexOf(args, "status") >= 0 ? "auth" : "turn";
    var profile = Path.Combine(dir, stage + ".txt");
    if(stage != "turn" && File.Exists(profile)) {
      var lines = File.ReadAllLines(profile);
      Thread.Sleep(Int32.Parse(lines[1]));
      Console.Out.Write(System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(lines[2])));
      Console.Out.Flush();
      Console.Error.Write(System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(lines[3])));
      Console.Error.Flush();
      Thread.Sleep(Int32.Parse(lines[4]));
      return Int32.Parse(lines[0]);
    }
    if (Array.IndexOf(args, "--version") >= 0) {
      Console.WriteLine(harness == "claude" ? (scenario == "old" ? "2.1.284" : "2.1.287") : (scenario == "old" ? "codex-cli 0.100.0" : "codex-cli 0.160.0"));
      return 0;
    }
    if (Array.IndexOf(args, "--help") >= 0) {
      var flags = harness == "claude" ? "--safe-mode --restricted --setting-sources --strict-mcp-config --tools --allowedTools --permission-mode --permission-prompts --effort --json-schema --output-format --input-format --model --verbose --print --no-session-persistence --resume" : "--json --model --sandbox --cd --skip-git-repo-check --output-schema --config";
      if (scenario == "missing-model") flags = flags.Replace("--model", "");
      if (scenario == "missing-effort") flags = flags.Replace(harness == "claude" ? "--effort" : "--config", "");
      Console.WriteLine(flags);
      return 0;
    }
    if (Array.IndexOf(args, "status") >= 0 && (Array.IndexOf(args, "auth") >= 0 || Array.IndexOf(args, "login") >= 0)) {
      if (scenario == "hang") Thread.Sleep(Timeout.Infinite);
      if (scenario == "auth" && harness == "claude") { Console.WriteLine("{\"loggedIn\":false,\"authMethod\":\"none\"}"); return 1; }
      var failure = scenario == "auth" ? "Not logged in" : scenario == "quota" ? "Usage limit reached: quota exhausted" : scenario == "transport" ? "Network connection failed: ECONNRESET" : scenario == "unknown" ? "Unrecognized diagnostic" : null;
      if (failure != null) { Console.Error.WriteLine(failure); return 1; }
      Console.WriteLine(harness == "claude" ? "{\"authMethod\":\"claude.ai\"}" : "Logged in using ChatGPT");
      return 0;
    }
    Console.Error.WriteLine("Readiness fixture refuses model turns");
    return 2;
  }
}

