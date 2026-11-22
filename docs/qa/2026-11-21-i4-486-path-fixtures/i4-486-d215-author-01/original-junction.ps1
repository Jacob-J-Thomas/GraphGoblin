. 'G:/ggq/delivery-evidence/2026-11-17-five-intents/i4-486-d215-author-01/verification-environment.ps1' junction
$physical = "$task/junction-physical"
$junction = "$task/junction-temp"
if ((Test-Path -LiteralPath $physical) -or (Test-Path -LiteralPath $junction)) { throw 'Junction control paths are already occupied' }
$null = New-Item -ItemType Directory -Path $physical
$null = New-Item -ItemType Junction -Path $junction -Target $physical
$env:TEMP = $junction
$env:TMP = $junction
$probe = 'const fs = require("node:fs"); const os = require("node:os"); const path = require("node:path"); const root = os.tmpdir(); const real = fs.realpathSync(root); const link = fs.readlinkSync(root); console.log(JSON.stringify({ platform: process.platform, root, real, link, isSymbolicLink: fs.lstatSync(root).isSymbolicLink() })); if (process.platform !== "win32" || path.resolve(root) === real || path.resolve(link) !== real) process.exit(1);'
if ((Invoke-RetainedStep '18-native-junction' 'node' @('-e', $probe)) -ne 0) { throw 'Native junction probe failed' }
$blob = git @gitOptions hash-object $source
$captured = (Get-FileHash -LiteralPath "$evidence/fs.test.before.ts" -Algorithm SHA256).Hash
$onDisk = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
"blob=$blob capturedSha256=$captured checkoutSha256=$onDisk" | Set-Content -LiteralPath "$evidence/19-original-test-binding.log"
if ($blob -ne 'a966e087a00d3b5d8d388860c2f54d6ef9e9b064' -or $onDisk -ne $captured) { throw 'Original source binding failed' }
$negative = Invoke-RetainedStep '20-original-junction-negative' 'pnpm.cmd' ($testArgs + @('--reporter=verbose', '-t', 'uses real temp paths'))
$log = Get-Content -LiteralPath "$evidence/20-original-junction-negative.log" -Raw
if ($negative -eq 0 -or $log -notmatch 'AssertionError: expected .*junction-physical.* to be .*junction-temp.*' -or $log -notmatch '1 failed') { throw "Unexpected negative control result $negative" }
Assert-TestCleanup $physical 6>&1 | Tee-Object -FilePath "$evidence/21-original-junction-cleanup.log"
