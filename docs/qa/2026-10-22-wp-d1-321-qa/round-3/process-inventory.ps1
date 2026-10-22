$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class QaRound3Process {
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr handle,int info,IntPtr data,int size,out int length);
  public static string Command(int pid) {
    IntPtr handle=OpenProcess(0x1000,false,pid);if(handle==IntPtr.Zero)return "";
    try {int length;NtQueryInformationProcess(handle,60,IntPtr.Zero,0,out length);if(length<=0||length>1048576)return "";
      IntPtr data=Marshal.AllocHGlobal(length);try {if(NtQueryInformationProcess(handle,60,data,length,out length)!=0)return "";return Marshal.PtrToStringUni(Marshal.ReadIntPtr(data,IntPtr.Size),Marshal.ReadInt16(data)/2)??"";}finally{Marshal.FreeHGlobal(data);}
    }finally{CloseHandle(handle);}
  }
}
'@
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../..')).TrimEnd('\')
$owned = @(Get-Process -Name node -ErrorAction SilentlyContinue | ForEach-Object {
  $command=[QaRound3Process]::Command($_.Id).Replace('/','\')
  if ($command.IndexOf($repo,[StringComparison]::OrdinalIgnoreCase) -ge 0 -or $command.Contains('gg-qa-321-r3-')) {
    [ordered]@{pid=$_.Id;started=$_.StartTime.ToString('o');role=$(if($command.Contains('dist\main.js')){'API'}elseif($command.Contains('uncertain-script-marker')){'marker'}elseif($command.Contains('forks.js')){'Vitest fork'}else{'QA node process'});maxWorkers2Flag=$command.Contains('--maxWorkers=2')}
  }
})
$owned | ConvertTo-Json -Depth 4
