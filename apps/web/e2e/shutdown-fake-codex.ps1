param([Parameter(Mandatory=$true)][string]$Directory)
$source = @'
using System;
using System.IO;
using System.Threading;
public static class ShutdownFakeCodex {
  public static void Main(string[] args) {
    if (Array.IndexOf(args, "--version") >= 0) { Console.WriteLine("codex-cli 0.160.0"); return; }
    if (Array.IndexOf(args, "--help") >= 0) { Console.WriteLine("--json --model --sandbox --cd --skip-git-repo-check --output-schema --config"); return; }
    if (Array.IndexOf(args, "login") >= 0) { Console.WriteLine("Logged in using ChatGPT"); return; }
    if (Array.IndexOf(args, "mcp") >= 0 && Array.IndexOf(args, "list") >= 0) { Console.WriteLine("[]"); return; }
    File.WriteAllText(Environment.GetEnvironmentVariable("SHUTDOWN_FAKE_PID"), System.Diagnostics.Process.GetCurrentProcess().Id.ToString());
    Console.WriteLine("{\"type\":\"thread.started\",\"thread_id\":\"shutdown-controlled-session\"}");
    Console.WriteLine("{\"type\":\"turn.started\"}");
    Console.Out.Flush();
    Thread.Sleep(180000);
  }
}
'@
Add-Type -TypeDefinition $source -OutputAssembly (Join-Path $Directory 'shutdown-codex.exe') -OutputType ConsoleApplication
