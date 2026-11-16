#Requires -Version 7.0
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$qaRoot = 'C:\Users\98jak\graphgoblin-qa\2026-11-13-aidlc-batch'
$qaLog = Join-Path $qaRoot 'launcher-438-implementation\logs\025-heavy-windows-launcher-acceptance-1.log'
$qaReceipt = Join-Path $qaRoot 'launcher-438-implementation\root-acceptance-01-unblock-v2.jsonl'
$qaStream = [IO.File]::Open($qaReceipt,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
$qaWriter = [IO.StreamWriter]::new($qaStream,[Text.UTF8Encoding]::new($false))
$qaWriter.AutoFlush = $true
function Record($stage,$data) { $qaWriter.WriteLine((@{at=[DateTime]::UtcNow.ToString('o');stage=$stage;data=$data}|ConvertTo-Json -Depth 15 -Compress)) }
function Require($condition,$message) { if (!$condition) { throw $message } }
try {
  $qaLogStream = [IO.File]::Open($qaLog,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
  try {
    $qaBuffer = [IO.MemoryStream]::new()
    try { $qaLogStream.CopyTo($qaBuffer); $qaLogBytes = $qaBuffer.ToArray() } finally { $qaBuffer.Dispose() }
  } finally { $qaLogStream.Dispose() }
  $qaText = [Text.UTF8Encoding]::new($false,$true).GetString($qaLogBytes)
  $qaLogHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($qaLogBytes)).ToLowerInvariant()
  Require ($qaText.Contains('No disposable Windows launcher test port is available.') -and $qaText.Contains('3 subtests failed')) 'Expected completed test failure not present'
  $qaChain = @()
  $qaCurrentPid = 47724
  foreach ($qaExpected in @(
    @(47724,23684,'134392992023644420'),
    @(23684,41068,'134392990096785250'),
    @(41068,37344,'134392990096218750'),
    @(37344,46020,'134392990096040660'),
    @(46020,54716,'134392990095448490'),
    @(54716,26296,'134392990095196210'),
    @(26296,26576,'134392990094863150')
  )) {
    $qaRow = Get-CimInstance Win32_Process -Filter "ProcessId = $qaCurrentPid" -OperationTimeoutSec 6
    Require ($qaRow -and $qaRow.ProcessId -eq $qaExpected[0] -and $qaRow.ParentProcessId -eq $qaExpected[1] -and $qaRow.CreationDate.ToFileTimeUtc().ToString() -ceq $qaExpected[2]) 'Recorded test ancestry changed'
    $qaChain += @{pid=$qaRow.ProcessId;parent=$qaRow.ParentProcessId;filetime=$qaExpected[2];image=$qaRow.ExecutablePath;command=$qaRow.CommandLine}
    $qaCurrentPid = [uint32]$qaRow.ParentProcessId
  }
  Require ($qaChain[0].image -ieq 'C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe') 'Wrong holder image'
  Require ($qaChain[0].command.Contains('$env:GG_TEST_HELD') -and $qaChain[0].command.Contains('[void][Console]::In.ReadToEnd(); $f.Dispose()')) 'Wrong holder command'
  Require ($qaChain[1].command.EndsWith('tooling\scripts\windows-launcher.acceptance.mjs')) 'Wrong test parent'
  Require ($qaChain[-1].command.Contains('launcher-438-implementation/run-receipt.sh heavy-windows-launcher-acceptance-1 C:/Users/98jak/.codex/worktrees/gg-20261116-bounded-logs/GraphGoblin pnpm.cmd test:windows-launcher')) 'Wrong run ancestry'
  Record 'owned-failure' @{chain=$qaChain;logSnapshotSha256=$qaLogHash;priorReadFailureOnly='root-acceptance-01-unblock.jsonl';reason='The fixed20port allocator exhausted. configuration() threw after holdLegacyAppend.ready and before its try/finally, leaving this test-only holder blocked on stdin. Preserve failure; terminate only its retained exact native process handle.'}
  Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;
public static class Gg438OwnedHolder {
  [StructLayout(LayoutKind.Sequential)] public struct FT { public uint low, high; }
  [DllImport("kernel32.dll",SetLastError=true)] public static extern SafeProcessHandle OpenProcess(uint rights,bool inherit,uint pid);
  [DllImport("kernel32.dll",SetLastError=true)] public static extern bool GetProcessTimes(SafeProcessHandle h,out FT c,out FT e,out FT k,out FT u);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] public static extern bool QueryFullProcessImageName(SafeProcessHandle h,uint flags,StringBuilder s,ref uint length);
  [DllImport("kernel32.dll",SetLastError=true)] public static extern bool TerminateProcess(SafeProcessHandle h,uint code);
  [DllImport("kernel32.dll",SetLastError=true)] public static extern uint WaitForSingleObject(SafeProcessHandle h,uint ms);
  [DllImport("kernel32.dll",SetLastError=true)] public static extern bool GetExitCodeProcess(SafeProcessHandle h,out uint code);
  public static ulong Born(SafeProcessHandle h) { FT c,e,k,u; if(!GetProcessTimes(h,out c,out e,out k,out u)) throw new Win32Exception(); return ((ulong)c.high<<32)|c.low; }
  public static string Image(SafeProcessHandle h) { var s=new StringBuilder(32768); uint n=32768; if(!QueryFullProcessImageName(h,0,s,ref n)) throw new Win32Exception(); return s.ToString(); }
}
'@
  $qaHandle = [Gg438OwnedHolder]::OpenProcess(0x00101001,$false,47724)
  try {
    Require (!$qaHandle.IsInvalid) 'Cannot hold exact test process handle'
    $qaBorn = [Gg438OwnedHolder]::Born($qaHandle)
    # CIM exposes microseconds; the retained native handle supplies the exact 100ns value.
    Require ($qaBorn -ge [uint64]134392992023644420 -and $qaBorn -le [uint64]134392992023644429) 'Holder birth changed'
    Require ([Gg438OwnedHolder]::Image($qaHandle) -ieq $qaChain[0].image) 'Retained holder image differs'
    Record 'terminate-requested' @{pid=47724;nativeFileTime=$qaBorn.ToString();exitCode=99;processHandleRetained=$true;recursive=$false}
    Require ([Gg438OwnedHolder]::TerminateProcess($qaHandle,99)) 'Exact holder termination failed'
    Require ([Gg438OwnedHolder]::WaitForSingleObject($qaHandle,5000) -eq 0) 'Holder exit not observed'
    [uint32]$qaExit=0
    Require ([Gg438OwnedHolder]::GetExitCodeProcess($qaHandle,[ref]$qaExit) -and $qaExit -eq 99) 'Unexpected holder exit'
    Record 'exact-holder-released' @{pid=47724;nativeFileTime=$qaBorn.ToString();exitCode=$qaExit;productProcessesTerminated=0;filesDeleted=0;scope='Only failed test fixture holder; first acceptance remains failed. Port allocation and holder try/finally must be fixed before any rerun.'}
  } finally { $qaHandle.Dispose() }
} catch { Record 'first-failure' @{message=$_.Exception.Message;stack=$_.ScriptStackTrace}; throw }
finally { $qaWriter.Dispose(); $qaStream.Dispose() }
