// Acceptance group A disposable CLI fixture (2026-10-26). No network access and no provider calls.
// Derived from tooling/fixtures/model-switch-cli.cs: the same no-turn probe answers, plus a
// recorded argv/stdin log and an on-disk conversation store so resume requests are observable.
// Build with Windows PowerShell 5.1 (Add-Type -OutputAssembly <dir>\claude.exe), copy to codex.exe.
// Control files beside the executable (all optional):
//   delay-ms.txt     milliseconds to sleep after reading stdin, before answering
//   resume-mode.txt  normal | init-then-missing | different-id (applies only to resume requests)
//   hold.txt         a substring; a prompt containing it initializes, accepts, then never answers
using System;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

public static class SessionCli {
  static string Q(string value) {
    if (value == null) return "null";
    var b = new StringBuilder("\"");
    foreach (var c in value) {
      if (c == '\\') b.Append("\\\\");
      else if (c == '"') b.Append("\\\"");
      else if (c == '\n') b.Append("\\n");
      else if (c == '\r') b.Append("\\r");
      else if (c == '\t') b.Append("\\t");
      else if (c < 0x20) b.Append("\\u" + ((int)c).ToString("x4"));
      else b.Append(c);
    }
    return b.Append('"').ToString();
  }
  static string After(string[] args, string flag) { var i = Array.IndexOf(args, flag); return i >= 0 && i + 1 < args.Length ? args[i + 1] : null; }
  static string Control(string dir, string name) { var p = Path.Combine(dir, name); return File.Exists(p) ? File.ReadAllText(p).Trim() : null; }

  static void Record(string dir, string line) {
    using (var mutex = new Mutex(false, "gg-acc-a-session-cli-log")) {
      mutex.WaitOne();
      try { File.AppendAllText(Path.Combine(dir, "requests.jsonl"), line + "\n", new UTF8Encoding(false)); }
      finally { mutex.ReleaseMutex(); }
    }
  }

  public static int Main(string[] args) {
    var dir = AppDomain.CurrentDomain.BaseDirectory;
    var claude = Path.GetFileNameWithoutExtension(Environment.GetCommandLineArgs()[0]).ToLowerInvariant() == "claude";
    if (Array.IndexOf(args, "--version") >= 0) { Console.WriteLine(claude ? "2.1.287" : "codex-cli 0.160.0"); return 0; }
    if (Array.IndexOf(args, "--help") >= 0) { Console.WriteLine("--safe-mode --restricted --setting-sources --strict-mcp-config --tools --allowedTools --permission-mode --permission-prompts --effort --json-schema --output-format --input-format --model --verbose --print --no-session-persistence --resume --json --sandbox --cd --skip-git-repo-check --output-schema --config"); return 0; }
    if (Array.IndexOf(args, "status") >= 0) { Console.WriteLine(claude ? "{\"authMethod\":\"claude.ai\"}" : "Logged in using ChatGPT"); return 0; }

    var stdin = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
    var prompt = stdin.ReadToEnd();
    var model = After(args, "--model") ?? "";
    var effort = claude ? (After(args, "--effort") ?? "") : "";
    if (!claude) foreach (var arg in args) if (arg.StartsWith("model_reasoning_effort=")) effort = arg.Substring(arg.IndexOf('=') + 1).Trim('"');
    var resumeId = claude ? After(args, "--resume") : After(args, "resume");
    var schemaFile = claude ? null : After(args, "--output-schema");
    var store = Path.Combine(dir, "sessions");
    Directory.CreateDirectory(store);
    var delay = Control(dir, "delay-ms.txt");
    if (!String.IsNullOrEmpty(delay)) Thread.Sleep(Int32.Parse(delay));

    var mode = resumeId == null ? "fresh" : "resume";
    var resumeMode = Control(dir, "resume-mode.txt") ?? "normal";
    var id = resumeId ?? Guid.NewGuid().ToString();
    var exists = resumeId == null || File.Exists(Path.Combine(store, resumeId));
    var outcome = exists ? (resumeId != null && resumeMode != "normal" ? resumeMode : "answered") : "refused-missing";
    if (resumeId != null && exists && resumeMode == "different-id") id = Guid.NewGuid().ToString();
    var argv = new StringBuilder("[");
    for (var i = 0; i < args.Length; i++) argv.Append((i > 0 ? "," : "") + Q(args[i]));
    argv.Append("]");
    var conversationTurn = 0;
    if (outcome == "answered") {
      File.AppendAllText(Path.Combine(store, id), prompt.Replace("\r", " ").Replace("\n", " ") + "\n", new UTF8Encoding(false));
      conversationTurn = File.ReadAllLines(Path.Combine(store, id)).Length;
    }
    Record(dir, "{\"ts\":" + Q(DateTime.UtcNow.ToString("o")) + ",\"harness\":" + Q(claude ? "claude" : "codex") + ",\"pid\":" + System.Diagnostics.Process.GetCurrentProcess().Id
      + ",\"mode\":" + Q(mode) + ",\"outcome\":" + Q(outcome) + ",\"resumeId\":" + Q(resumeId) + ",\"sessionId\":" + Q(outcome == "refused-missing" ? null : id)
      + ",\"conversationTurn\":" + conversationTurn + ",\"model\":" + Q(model) + ",\"effort\":" + Q(effort) + ",\"prompt\":" + Q(prompt) + ",\"argv\":" + argv + "}");

    if (outcome == "refused-missing") {
      if (claude) Console.Error.WriteLine("No conversation found with session ID: " + resumeId);
      else Console.Error.WriteLine("Error: thread not found: " + resumeId);
      return 1;
    }
    var text = "Synthetic reply conversation=" + id + " turn=" + conversationTurn;
    var hold = Control(dir, "hold.txt");
    var holding = !String.IsNullOrEmpty(hold) && prompt.Contains(hold);
    if (schemaFile != null && File.Exists(schemaFile)) {
      var schema = File.ReadAllText(schemaFile);
      var route = Regex.Match(schema, "\"route\"\\s*:\\s*\\{[^}]*?\"enum\"\\s*:\\s*\\[\\s*\"([^\"]+)\"");
      text = route.Success ? "{\"route\":" + Q(route.Groups[1].Value) + ",\"confidence\":0.9,\"reasoning\":\"synthetic\"}" : "{}";
      foreach (var field in new[] { "status", "assessment" }) {
        var choice = Regex.Match(schema, "\\\"" + field + "\\\"\\s*:\\s*\\{[^}]*?\\\"enum\\\"\\s*:\\s*\\[\\s*\\\"([^\\\"]+)\\\"");
        if (!choice.Success) continue;
        text = "{\"" + field + "\":" + Q(choice.Groups[1].Value) + ",\"summary\":\"Synthetic F1 fixture response\"";
        foreach (var array in new[] { "findings", "checks", "evidence" })
          if (schema.Contains("\"" + array + "\"")) text += ",\"" + array + "\":[]";
        text += "}";
      }

    }
    if (claude) {
      Console.WriteLine("{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":" + Q(id) + ",\"model\":" + Q(model) + ",\"tools\":[\"Read\",\"Glob\",\"Grep\"],\"mcp_servers\":[],\"plugins\":[],\"skills\":[],\"permissionMode\":\"dontAsk\",\"apiKeySource\":\"none\",\"claude_code_version\":\"2.1.287\"}");
      Console.Out.Flush();
      if (outcome == "init-then-missing") { Console.Error.WriteLine("No conversation found with session ID: " + resumeId); return 1; }
      if (holding) { Thread.Sleep(600000); return 0; }
      // Keep a live process after a wrong-identity init, as a real CLI turn would be (linger-ms.txt).
      var linger = Control(dir, "linger-ms.txt");
      if (!String.IsNullOrEmpty(linger)) Thread.Sleep(Int32.Parse(linger));
      Console.WriteLine("{\"type\":\"result\",\"subtype\":\"success\",\"session_id\":" + Q(id) + ",\"is_error\":false,\"result\":" + Q(text) + ",\"num_turns\":1,\"usage\":{\"input_tokens\":1,\"output_tokens\":1},\"modelUsage\":{" + Q(model) + ":{\"inputTokens\":1,\"outputTokens\":1}}}");
    } else {
      Console.WriteLine("{\"type\":\"thread.started\",\"thread_id\":" + Q(id) + "}");
      Console.Out.Flush();
      if (outcome == "init-then-missing") { Console.Error.WriteLine("Error: thread not found: " + resumeId); return 1; }
      Console.WriteLine("{\"type\":\"turn.started\"}");
      Console.Out.Flush();
      if (holding) { Thread.Sleep(600000); return 0; }
      Console.WriteLine("{\"type\":\"item.completed\",\"item\":{\"id\":\"qa\",\"type\":\"agent_message\",\"text\":" + Q(text) + "}}");
      Console.WriteLine("{\"type\":\"turn.completed\",\"usage\":{\"input_tokens\":1,\"output_tokens\":1}}");
    }
    return 0;
  }
}
