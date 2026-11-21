using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;

class IndependentClaude364 {
  static JavaScriptSerializer json = new JavaScriptSerializer();
  static void Emit(object value) { Console.WriteLine(json.Serialize(value)); }
  static int Main(string[] args) {
    string executable = Process.GetCurrentProcess().MainModule.FileName;
    string kind = args.Contains("--version") ? "version" : args.Contains("--help") ? "help" : args.Contains("auth") ? "auth" : "turn";
    string input = kind == "turn" ? Console.In.ReadToEnd() : "";
    string digest; using (SHA256 hash = SHA256.Create()) { digest = BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(input))).Replace("-", "").ToLowerInvariant(); }
    File.AppendAllText(executable + ".starts.jsonl", json.Serialize(new { at = DateTime.UtcNow.ToString("o"), pid = Process.GetCurrentProcess().Id, kind, cwd = Directory.GetCurrentDirectory(), argv = args, stdinBytes = Encoding.UTF8.GetByteCount(input), stdinSha256 = digest, home = Environment.GetEnvironmentVariable("HOME"), userprofile = Environment.GetEnvironmentVariable("USERPROFILE") }) + "\n");
    if (kind == "version") { Console.WriteLine("2.1.308 (independent harmless fixture)"); return 0; }
    if (kind == "help") { Console.WriteLine("--safe-mode --restricted --setting-sources --strict-mcp-config --tools --allowedTools --permission-mode --permission-prompts --effort --json-schema --output-format --input-format --model --verbose --print --no-session-persistence --resume"); return 0; }
    if (kind == "auth") { var deadline = DateTime.UtcNow.AddSeconds(10); while (File.Exists(executable + ".gate-auth") && DateTime.UtcNow < deadline) System.Threading.Thread.Sleep(20); Emit(new { authMethod = "claude.ai", loggedIn = true }); return 0; }
    int index = Array.IndexOf(args, "--model");
    string model = index >= 0 ? args[index + 1] : "claude-opus-5-5";
    string session = "f3640000-1111-4222-8333-444444444444";
    Emit(new { type = "system", subtype = "init", session_id = session, model, permissionMode = "dontAsk", apiKeySource = "none", tools = new string[] { "Read", "Glob", "Grep" }, plugins = new object[0], skills = new string[0], mcp_servers = new object[0] });
    var usage = new { input_tokens = 1, output_tokens = 1 };
    var modelUsage = new Dictionary<string, object>(); modelUsage.Add(model, new { inputTokens = 1, outputTokens = 1 });
    Emit(new { type = "result", subtype = "success", is_error = false, session_id = session, result = "independent-harmless-success", usage, modelUsage });
    return 0;
  }
}

