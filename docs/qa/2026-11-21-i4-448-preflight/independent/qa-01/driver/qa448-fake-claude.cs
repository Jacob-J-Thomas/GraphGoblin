// Independent QA #448 fake Claude Code probe CLI. Private synthetic fixture: no network, no
// provider, no credentials. Answers only the readiness probes (version, --help, auth status) and
// refuses every other invocation (a model turn) with exit 86. Every invocation is appended to
// invocations.jsonl beside the executable so the QA driver can prove no turn was attempted.
using System;
using System.IO;
using System.Text;
using System.Threading;

public static class Qa448FakeClaude {
  static string Q(string value) {
    var b = new StringBuilder("\"");
    foreach (var c in value) {
      if (c == '"') b.Append("\\\"");
      else if (c == '\\') b.Append("\\\\");
      else if (c < 32) b.Append("\\u" + ((int)c).ToString("x4"));
      else b.Append(c);
    }
    return b.Append('"').ToString();
  }

  public static int Main(string[] args) {
    var dir = AppDomain.CurrentDomain.BaseDirectory;
    string kind;
    int code = 0;
    if (Array.IndexOf(args, "--version") >= 0) {
      kind = "version";
      Console.WriteLine("2.1.287 (Claude Code)");
    } else if (Array.IndexOf(args, "--help") >= 0) {
      kind = "help";
      Console.WriteLine("Usage: claude [options]\n  --safe-mode --restricted --setting-sources --strict-mcp-config --tools --allowedTools --permission-mode --permission-prompts --effort --json-schema --output-format --input-format --model --verbose --print --no-session-persistence --resume --max-turns");
    } else if (Array.IndexOf(args, "auth") >= 0 && Array.IndexOf(args, "status") >= 0) {
      kind = "auth-status";
      Console.WriteLine("{\"loggedIn\":true,\"authMethod\":\"claude.ai\"}");
    } else {
      kind = "refused-non-probe";
      Console.Error.WriteLine("qa448 fake claude refuses non-probe invocations");
      code = 86;
    }
    var parts = new StringBuilder();
    for (var i = 0; i < args.Length; i++) parts.Append(i == 0 ? "" : ",").Append(Q(args[i]));
    var line = "{\"cli\":\"claude\",\"kind\":" + Q(kind) + ",\"exit\":" + code + ",\"pid\":" +
      System.Diagnostics.Process.GetCurrentProcess().Id + ",\"utc\":" +
      Q(DateTime.UtcNow.ToString("o")) + ",\"cwd\":" + Q(Environment.CurrentDirectory) +
      ",\"args\":[" + parts + "]}" + Environment.NewLine;
    for (var attempt = 0; attempt < 50; attempt++) {
      try { File.AppendAllText(Path.Combine(dir, "invocations.jsonl"), line); break; }
      catch (IOException) { Thread.Sleep(20); }
    }
    return code;
  }
}
