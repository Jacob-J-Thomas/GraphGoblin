// Executable regression checks, compiled with Launcher.cs on Windows CI; never installed.
using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using GraphGoblin.Desktop;

public static class NativeChecks
{
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CommandLineToArgvW(string command, out int count);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr value);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
    static string[] Parse(string command)
    {
        int count; IntPtr values = CommandLineToArgvW(command, out count);
        if (values == IntPtr.Zero) throw new System.ComponentModel.Win32Exception();
        try { return Enumerable.Range(0, count).Select(i => Marshal.PtrToStringUni(Marshal.ReadIntPtr(values, i * IntPtr.Size))).ToArray(); }
        finally { LocalFree(values); }
    }
    static void Check(bool valid, string message) { if (!valid) throw new Exception(message); }
    static void RunRelaunch(string command)
    {
        string[] route = Parse(command);
        var info = new ProcessStartInfo(route[0], string.Join(" ", route.Skip(1).Select(Program.Quote))) {
            UseShellExecute = false, CreateNoWindow = true, RedirectStandardError = true, RedirectStandardOutput = true
        };
        using (var click = Process.Start(info))
        {
            Check(click.WaitForExit(25000), "Window relaunch route did not let the launcher exit.");
            Check(click.ExitCode == 0, "Window relaunch route failed: " + click.StandardError.ReadToEnd());
        }
    }

    [STAThread]
    public static int Main(string[] args)
    {
        try
        {
            if (args[0] == "--window-fixture")
            {
                using (var window = new Form())
                {
                    window.FormClosed += (sender, unused) => Application.ExitThread();
                    File.WriteAllText(args[1], window.Handle.ToInt64().ToString());
                    Application.Run(); // Pump a real HWND without showing an unsolicited window.
                }
                return 0;
            }
            if (args[0] == "--close-window") { PostMessage(new IntPtr(long.Parse(args[1])), 0x10, IntPtr.Zero, IntPtr.Zero); return 0; }
            if (args[0] == "--stamp-window")
            {
                ShellIdentity.StampWindow(new IntPtr(long.Parse(args[1])), "GraphGoblin.NativeChecks", ShellIdentity.RelaunchCommand(args[2], args[3], true), args[2] + ",0");
                return 0;
            }
            if (args[0] == "--relaunch-window")
            {
                IntPtr window = new IntPtr(long.Parse(args[1]));
                Check(ShellIdentity.WindowIdentity(window) == "GraphGoblin.NativeChecks", "Cross-process AppUserModelID was lost after stamper exit.");
                RunRelaunch(ShellIdentity.WindowRelaunchCommand(window));
                Console.WriteLine("Cross-process HWND metadata survived stamper exit and relaunched gateway."); return 0;
            }
            foreach (string value in new[] { "", "space here", "Unicode-α", "quote\"here", "trailing\\", "path space\\", "before\\\"quote" })
                Check(Parse("program " + Program.Quote(value))[1] == value, "Windows command-line round trip failed.");
            Check(Program.ChromeAppId(4747) == "nljkfhhecccnbhfdehkclniddmacgnck", "Chromium manifest app ID known vector failed.");
            Check(Program.ChromeAppId(4831) != Program.ChromeAppId(4747), "PWA origin must include the port.");

            // Real HWND and COM property store: catches ABI/layout errors that mocks cannot.
            using (var window = new Form())
            {
                string command = ShellIdentity.RelaunchCommand(args[0], args[1], true);
                ShellIdentity.StampWindow(window.Handle, "GraphGoblin.NativeChecks", command, args[0] + ",0");
                Check(ShellIdentity.WindowIdentity(window.Handle) == "GraphGoblin.NativeChecks", "Native window AppUserModelID did not persist.");
                string observed = ShellIdentity.WindowRelaunchCommand(window.Handle);
                Check(observed == command, "Native relaunch command did not preserve explicit configuration.");
                // Execute the command read back from the native window, with a cold gateway.
                // This establishes its route; actual Explorer taskbar pinning is separate QA.
                RunRelaunch(observed);
            }
            Console.WriteLine("Native quote/manifest/HWND COM/relaunch route checks passed."); return 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error); return 1; }
    }
}
