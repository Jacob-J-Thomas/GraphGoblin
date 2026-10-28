// Disposable native protocol fixture. It cannot invoke a model/provider.
using System;
using System.IO;
using System.Diagnostics;
using System.Threading;
public static class UnlimitedCodexFixture {
  public static int Main(string[] args) {
    if (Array.IndexOf(args, "--version") >= 0) { Console.WriteLine("codex-cli 0.160.0"); return 0; }
    if (Array.IndexOf(args, "--help") >= 0) { Console.WriteLine("--json --model --sandbox --cd --skip-git-repo-check --output-schema --config"); return 0; }
    if (Array.IndexOf(args, "login") >= 0 && Array.IndexOf(args, "status") >= 0) { Console.WriteLine("Logged in using ChatGPT"); return 0; }
    // The MCP listing before each turn (ADR-0063): no servers configured.
    if (args.Length >= 2 && args[0] == "mcp" && args[1] == "list") { Console.WriteLine("[]"); return 0; }
    if (args.Length == 0 || args[0] != "exec") { Console.Error.WriteLine("Fixture refuses unknown commands"); return 2; }
    var pidFile = Environment.GetEnvironmentVariable("GG_WP_F3_PID_FILE");
    if (!String.IsNullOrEmpty(pidFile)) File.WriteAllText(pidFile, Process.GetCurrentProcess().Id.ToString());
    Console.In.ReadToEnd();
    Console.WriteLine("{\"type\":\"thread.started\",\"thread_id\":\"" + Guid.NewGuid().ToString() + "\"}");
    Console.WriteLine("{\"type\":\"turn.started\"}");
    var mode = Environment.GetEnvironmentVariable("GG_WP_F3_SCENARIO") ?? "success";
    if (mode == "stall") { Thread.Sleep(Timeout.Infinite); return 0; }
    if (mode == "quota" || mode == "transport" || mode == "unknown") {
      var message = mode == "quota" ? "Usage limit reached: quota exhausted" : mode == "transport" ? "Stream disconnected: ECONNRESET" : "Controlled unknown failure";
      Console.WriteLine("{\"type\":\"turn.failed\",\"error\":{\"message\":\"" + message + "\"}}"); return 0;
    }
    Console.WriteLine("{\"type\":\"item.completed\",\"item\":{\"id\":\"answer\",\"type\":\"agent_message\",\"text\":\"Controlled fake result\"}}");
    Console.WriteLine("{\"type\":\"turn.completed\",\"usage\":{\"input_tokens\":0,\"output_tokens\":0}}"); return 0;
  }
}
