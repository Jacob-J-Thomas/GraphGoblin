# Native installer malformed-locale reproduction

One direct invocation of the frozen native executable GraphGoblinLauncherInstaller from build d75d293f66da44ffb60198a07d8fa2e2 at head 4341d1f8882f4b69651bfb0b5988345b7f074339, tree a5f8fa3e13fb297cbcdb386ae445cb8159156617. The payload verifies the private build inode, exact native installer and launcher artifacts, and the four implicated source files before creating a fresh scope. Pins come from macos-owner-acceptance-execution-03/binding-readback.json and build04's retained source-freeze.json.

This is the native process reached by the public install script's final invocation. The probe supplies its four-argument envelope and normal installer flags directly and measures the native process's signal. It skips the public shell's Swift rebuild. The substrate starts with an explicit environment, valid LANG=en_US.UTF-8 and malformed LC_ALL=ggcanary17544768eaef. The other values mirror ordinary installer needs. The isolated case uses GraphGoblin Installer Locale QA 9ce7bf46.app, a fresh data path under the packet's private cache token, alternate port 62243, and disabled Ollama.

Read both helpers and verify SHA256SUMS.txt before any admission. In this directory with project Node 22 selected, save and examine the fixed SSH preview.

```powershell
node .\run-installer-locale-probe.mjs --preview | Set-Content -Encoding utf8NoBOM .\root-preview.json
$installerPreview = Get-Content -Raw .\root-preview.json | ConvertFrom-Json
$installerPreview | Select-Object commandSha256,probeSha256,timeoutMs,maxBuffer,automaticRetries
```

Once the operator admits the exact digest, execute once.

```powershell
node .\run-installer-locale-probe.mjs --run $installerPreview.commandSha256
```

The wrapper retains actual SSH status and both raw SSH streams. The payload records the native PID, timestamps, exit or signal and both stream EOFs. A stopped or incomplete native process remains unverified. The process deadline is 75 seconds and the overall SSH deadline is 120 seconds. The watchdog can stop only the exact native installer process that it spawns. There is no automatic retry, gateway launch, application launch, or cleanup by this probe. The installer's own read-only staged validation can run on a normal path.

Review receipt/summary.json and the native raw streams. Readback compares the exact fresh target, data path, port, Applications and receipt roots, and staged fixture bundle. It records the staged plist's installation ID when present and checks only the corresponding private receipt path. Unbound new directory and receipt names are counted without identifying them. A SIGSEGV with both EOFs establishes a crash in the real frozen native installer. A staged executable and plist with absent configuration, final bundle and fixture receipt locate its last observed progress before configuration publication. A crash report would identify the throwing stack. An ordinary refusal or probe-admission failure does not reproduce the crash. Leave all staged artifacts for the operator.
