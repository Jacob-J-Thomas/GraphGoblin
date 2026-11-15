param(
  [Parameter(Mandatory=$true)][ValidateSet('move','double')][string]$Stage,
  [Parameter(Mandatory=$true)][ValidateRange(1,2147483647)][int]$BrowserPid,
  [Parameter(Mandatory=$true)][ValidatePattern('^GG207 Owned [a-f0-9]{32}$')][string]$Marker,
  [Parameter(Mandatory=$true)][datetime]$FixtureStartedUtc,
  [Parameter(Mandatory=$true)][string]$FixtureTemp,
  [Parameter(Mandatory=$true)][ValidateRange(0,32767)][int]$ScreenX,
  [Parameter(Mandatory=$true)][ValidateRange(0,32767)][int]$ScreenY,
  [long]$ExpectedHwnd=0,
  [string]$ExpectedBirthUtc=''
)
$ErrorActionPreference='Stop'
if (!$IsWindows) { throw 'The owned OS mouse witness requires Windows' }
$proc=Get-CimInstance Win32_Process -Filter "ProcessId=$BrowserPid"
if (!$proc -or !$proc.ExecutablePath -or [IO.Path]::GetFileName($proc.ExecutablePath) -ine 'msedge.exe' -or
    !$proc.CreationDate -or $proc.CreationDate.ToUniversalTime() -lt $FixtureStartedUtc.ToUniversalTime().AddSeconds(-1)) {
  throw 'Browser process identity is outside this disposable launch'
}
$profileMatch=[regex]::Match($proc.CommandLine,'--user-data-dir(?:=|\s+)(?:"([^"]+)"|([^"\s]+))')
$profileValue=if($profileMatch.Groups[1].Success){$profileMatch.Groups[1].Value}else{$profileMatch.Groups[2].Value}
if(!$profileValue){throw 'No browser profile identity'}
$ownedRoot=[IO.Path]::GetFullPath((Resolve-Path -LiteralPath $FixtureTemp).Path).TrimEnd('\')+'\'
$profile=[IO.Path]::GetFullPath((Resolve-Path -LiteralPath $profileValue).Path)
if(!$profile.StartsWith($ownedRoot,[StringComparison]::OrdinalIgnoreCase)){throw 'Browser profile is outside fixture-owned scratch'}
$start=(Get-Process -Id $BrowserPid).StartTime.ToUniversalTime()
if ([Math]::Abs(($start-$proc.CreationDate.ToUniversalTime()).TotalSeconds) -gt 1) { throw 'Browser PID creation readback differs' }
if ($Stage -eq 'double' -and (!$ExpectedHwnd -or $start.ToString('o') -cne $ExpectedBirthUtc)) {
  throw 'Browser process birth or expected HWND differs from the calibration receipt'
}

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class GG207OwnedClick {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] struct MouseInput {
    public int dx, dy;
    public uint mouseData, flags, time;
    public UIntPtr extraInfo;
  }
  [StructLayout(LayoutKind.Sequential)] struct Input { public uint type; public MouseInput mouse; }
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr hwnd);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT at);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int maximum);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT at);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern uint GetDoubleClickTime();
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
  [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint count, Input[] inputs, int inputSize);

  static void Need(bool condition, string reason) {
    if (!condition) throw new InvalidOperationException(reason);
  }
  static void Own(IntPtr hwnd, int pid, long born, string marker) {
    uint actual;
    Need(hwnd != IntPtr.Zero && GetWindowThreadProcessId(hwnd, out actual) != 0 && actual == (uint)pid, "Browser HWND/PID ownership changed");
    using (var process = Process.GetProcessById(pid))
      Need(process.StartTime.ToUniversalTime().Ticks == born && process.ProcessName.Equals("msedge", StringComparison.OrdinalIgnoreCase), "Browser process birth changed");
    var caption = new StringBuilder(512);
    Need(GetWindowText(hwnd, caption, caption.Capacity) > 0 && caption.ToString().Contains(marker), "Disposable browser title marker is absent");
  }
  static void Guard(IntPtr hwnd, int pid, long born, string marker, POINT point, bool cursor) {
    Own(hwnd, pid, born, marker);
    Need(GetForegroundWindow() == hwnd, "Owned browser is not the current foreground");
    Need(GetAncestor(WindowFromPoint(point), 2) == hwnd, "Point lies outside the owned browser window");
    if (cursor) {
      POINT current;
      Need(GetCursorPos(out current) && current.X == point.X && current.Y == point.Y, "Real cursor changed after verified calibration");
    }
    foreach (var key in new int[] { 1, 2, 4, 0x10, 0x11, 0x12, 0x5b, 0x5c })
      Need((GetAsyncKeyState(key) & 0x8000) == 0, "Another key or mouse button is currently down");
    Need(GetForegroundWindow() == hwnd, "Owned foreground changed during the immediate input check");
  }
  public sealed class PressReceipt {
    public uint requested { get; set; }
    public uint submitted { get; set; }
    public bool cleanupAttempted { get; set; }
    public uint? cleanupSubmitted { get; set; }
    public bool? cleanupAccepted { get; set; }
    public int? cleanupWin32Error { get; set; }
    public string cleanupRefusal { get; set; }
  }
  static void Click(List<PressReceipt> presses) {
    var inputs = new [] {
      new Input { type = 0, mouse = new MouseInput { flags = 0x0002 } },
      new Input { type = 0, mouse = new MouseInput { flags = 0x0004 } },
    };
    var release = new[] { inputs[1] };
    var inputSize = Marshal.SizeOf(typeof(Input));
    var receipt = new PressReceipt { requested = (uint)inputs.Length };
    presses.Add(receipt);
    receipt.submitted = SendInput(receipt.requested, inputs, inputSize);
    if (receipt.submitted == receipt.requested) return;

    // The batch is ordered: exactly one inserted input means only LEFTDOWN was inserted.
    if (receipt.submitted == 1) {
      try {
        // Immediately balance the known inserted LEFTDOWN. The next new press still requires its own guard.
        receipt.cleanupAttempted = true;
        var releaseSubmitted = SendInput(1, release, inputSize);
        if (releaseSubmitted != 1) receipt.cleanupWin32Error = Marshal.GetLastWin32Error();
        receipt.cleanupSubmitted = releaseSubmitted;
        receipt.cleanupAccepted = releaseSubmitted == 1;
        if (receipt.cleanupAccepted != true) receipt.cleanupRefusal = "Windows refused the one-shot LEFTUP cleanup";
      } catch (Exception error) {
        receipt.cleanupRefusal = error.Message;
      }
    }
    throw new InvalidOperationException(receipt.submitted == 1 && receipt.cleanupAccepted != true
      ? "Partial mouse send: LEFTDOWN was inserted and cleanup did not complete"
      : "Incomplete mouse send: the witness stopped without counting this press");
  }

  public static object Run(string stage, int pid, long born, string marker, int x, int y, long expectedHwnd) {
    using (var browser = Process.GetProcessById(pid)) {
      var hwnd = browser.MainWindowHandle;
      if (stage == "double") Need(hwnd.ToInt64() == expectedHwnd, "Calibrated HWND changed");
      Own(hwnd, pid, born, marker);
      Need(SetThreadDpiAwarenessContext(new IntPtr(-4)) != IntPtr.Zero, "Cannot set an exact DPI coordinate space");
      var dpi = GetDpiForWindow(hwnd);
      Need(dpi == 96 && GetSystemMetrics(80) == 1, "Exact 100% single-display calibration is unavailable");
      var point = new POINT { X=x, Y=y };
      Need(x < GetSystemMetrics(0) && y < GetSystemMetrics(1), "Calibrated point lies outside display");
      var clickTime = GetDoubleClickTime();
      var clickWidth = GetSystemMetrics(36);
      var clickHeight = GetSystemMetrics(37);
      Need(clickTime > 0 && clickWidth > 0 && clickHeight > 0, "No valid system click metrics");
      var elapsed = Stopwatch.StartNew();
      var issues = new StringBuilder();
      var presses = new List<PressReceipt>();
      int clicks = 0;
      long secondMs = -1;
      try {
        if (stage == "move") {
          if (GetForegroundWindow() != hwnd) SetForegroundWindow(hwnd);
          Guard(hwnd, pid, born, marker, point, false);
          Need(SetCursorPos(point.X, point.Y), "Windows refused the calibration move");
          Guard(hwnd, pid, born, marker, point, true);
        } else {
          Guard(hwnd, pid, born, marker, point, true);
          Click(presses);
          clicks = 1;
          elapsed.Restart();
          Thread.Sleep(Math.Max(1, (int)Math.Min(60u, clickTime / 4u)));
          Guard(hwnd, pid, born, marker, point, true);
          secondMs = elapsed.ElapsedMilliseconds;
          Need(secondMs < clickTime, "Window check exceeded the actual OS double-click time");
          Click(presses);
          clicks = 2;
        }
      } catch (InvalidOperationException error) {
        issues.Append(error.Message);
      }
      return new {
        stage, pid, hwnd = hwnd.ToString(), x, y, dpi,
        doubleClickTimeMs = clickTime, doubleClickWidth = clickWidth, doubleClickHeight = clickHeight,
        injectedClicks = clicks, presses, secondMs, limited = issues.Length > 0 ? issues.ToString() : null,
      };
    }
  }
}
'@
$result=[GG207OwnedClick]::Run($Stage,$BrowserPid,$start.Ticks,$Marker,$ScreenX,$ScreenY,$ExpectedHwnd)
[ordered]@{processBirthUtc=$start.ToString('o');profile=$profile;recordedUtc=[DateTime]::UtcNow.ToString('o');operation=$result} |
  ConvertTo-Json -Depth 5 -Compress
