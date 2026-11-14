param([string]$Out)
$ErrorActionPreference='Continue'
$o = @()
$o += "observedAt: " + (Get-Date).ToUniversalTime().ToString('o')
$o += "== listeners (TCP Listen) with owning process =="
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Sort-Object LocalPort | ForEach-Object {
  $p = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
  $o += ("{0}:{1} pid={2} {3}" -f $_.LocalAddress,$_.LocalPort,$_.OwningProcess,$p.ProcessName)
}
$o += "== node/msedge/chrome/playwright/tsx/turbo/vite processes =="
Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(node|msedge|chrome|chromium|msedgewebview2)\.exe$' } | ForEach-Object {
  $cl = $_.CommandLine; if ($cl -and $cl.Length -gt 220) { $cl = $cl.Substring(0,220) + '...' }
  $o += ("pid={0} ppid={1} {2} :: {3}" -f $_.ProcessId,$_.ParentProcessId,$_.Name,$cl)
}
$o | Set-Content -Path $Out -Encoding utf8
