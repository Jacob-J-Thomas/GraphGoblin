// Disposable owner QA fixture. No network access or provider calls.
using System;
using System.IO;
public static class ModelSwitchCli {
  static string Q(string value) { return "\"" + value.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n") + "\""; }
  static string After(string[] args, string flag) { var i = Array.IndexOf(args, flag); return i >= 0 && i + 1 < args.Length ? args[i + 1] : ""; }
  public static int Main(string[] args) {
    var dir = AppDomain.CurrentDomain.BaseDirectory;
    var claude = Path.GetFileNameWithoutExtension(Environment.GetCommandLineArgs()[0]) == "claude";
    if (Array.IndexOf(args, "--version") >= 0) { Console.WriteLine(claude ? "2.1.287" : "codex-cli 0.160.0"); return 0; }
    if (Array.IndexOf(args, "--help") >= 0) { Console.WriteLine("--safe-mode --restricted --setting-sources --strict-mcp-config --tools --allowedTools --permission-mode --permission-prompts --effort --json-schema --output-format --input-format --model --verbose --print --no-session-persistence --resume --json --sandbox --cd --skip-git-repo-check --output-schema --config"); return 0; }
    if (!claude && Array.IndexOf(args, "mcp") >= 0 && Array.IndexOf(args, "list") >= 0) { Console.WriteLine("[]"); return 0; }
    if (Array.IndexOf(args, "status") >= 0) { Console.WriteLine(claude ? "{\"authMethod\":\"claude.ai\"}" : "Logged in using ChatGPT"); return 0; }
    var model = After(args, "--model");
    var effort = After(args, "--effort");
    if (!claude) foreach (var arg in args) if (arg.StartsWith("model_reasoning_effort=")) effort = arg.Substring(arg.IndexOf('=') + 1).Trim('"');
    File.AppendAllText(Path.Combine(dir, "requests.jsonl"), "{\"model\":" + Q(model) + ",\"effort\":" + Q(effort) + "}" + Environment.NewLine);
    var session = Guid.NewGuid().ToString();
    if (claude) {
      Console.WriteLine("{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":" + Q(session) + ",\"model\":" + Q(model) + ",\"tools\":[\"Read\",\"Glob\",\"Grep\"],\"mcp_servers\":[],\"plugins\":[],\"skills\":[],\"permissionMode\":\"dontAsk\",\"apiKeySource\":\"none\",\"claude_code_version\":\"2.1.287\"}");
      Console.WriteLine("{\"type\":\"result\",\"subtype\":\"success\",\"session_id\":" + Q(session) + ",\"is_error\":false,\"result\":\"Synthetic model switch result\",\"num_turns\":1,\"usage\":{\"input_tokens\":1,\"output_tokens\":1},\"modelUsage\":{" + Q(model) + ":{\"inputTokens\":1,\"outputTokens\":1}}}");
    } else {
      Console.WriteLine("{\"type\":\"thread.started\",\"thread_id\":" + Q(session) + "}");
      Console.WriteLine("{\"type\":\"turn.started\"}");
      Console.WriteLine("{\"type\":\"item.completed\",\"item\":{\"id\":\"qa\",\"type\":\"agent_message\",\"text\":\"Synthetic model switch result\"}}");
      Console.WriteLine("{\"type\":\"turn.completed\",\"usage\":{\"input_tokens\":1,\"output_tokens\":1}}");
    }
    return 0;
  }
}
