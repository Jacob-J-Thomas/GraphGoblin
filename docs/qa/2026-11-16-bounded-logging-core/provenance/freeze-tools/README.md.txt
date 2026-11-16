# #438 one-off candidate freeze tools

Preparation only. These tools were syntax-checked with project Node v22.23.4. No compiler, source capture, build, V4 launch or formal scan ran. Root owns the committed source, exact live identity and each later admission.

The fixed checkout is `C:\Users\98jak\.codex\worktrees\gg-20261116-bounded-logs\GraphGoblin`. The fixed V4 suite is `launcher-438-candidate-qa-preparation`. The one-off tools reuse the unchanged [#410 build and source capture](../launcher-438-candidate-freeze-preparation/README.md) and the final [V4 verifier](../launcher-438-candidate-qa-preparation/binding.mjs). The [private-suite receipt](../launcher-438-candidate-private-fixture-root.json) records its DACL at 2026-11-16T11:22:53.1152259Z. This is a preparation input for V4.

## Build, compile and bind

1. Root records the clean committed candidate HEAD/tree, actual refreshed main/tree, exact index path/hash, verified merged #381 and #436 commits, and project Node digest. Use the candidate build admission from the existing freeze preparation. Verify the selected `C:\Program Files\Git\bin\git.exe` is single-link and first Git on PATH. Re-resolve and hash the exact PowerShell 7 binary named in the plan and verify version 7.6.9. Resolve the Framework64 csc real path and digest. Keep `NODE_OPTIONS` absent.
2. Run the existing build wrapper once. A failure preserves its raw exit and log. After success, fill a new external root plan from [root-freeze-admission.example.json](root-freeze-admission.example.json), with the exact admitted build-admission and successful build-receipt references, merged #436, actual committed `Launcher.cs` hash, and current selected Git, PS7 and compiler pins. Recheck the final V4 manifest and private-suite receipt. Ensure compiler output directory, binding and proposal paths are unused. Set `state` to `root-admitted-freeze` only for the reviewed exact inputs.
3. The compiler creates the external output directory once and compares `Launcher.cs` with its raw HEAD blob before and after. It records actual argv/PID/process exit/close, timeout, both native stream ends, raw stream bytes/hashes, and the compiled GUI AMD64 PE32+ launcher. Use only a successful `receipt.json` with `complete: true`.
4. Run the untouched #410 capture. It compares every tracked file with its raw Git blob and binds the tracked set, index, 13 named output roots and selected dependency files. Then run the adapter. It emits the baseline-shaped candidate source/build binding, calls the sealed V4 readback against the full source and artifacts, and produces a native admission proposal. The proposal has its own non-executable schema. A binding file without a completed proposal has no admission authority.

From PS7, with completed root-authored admissions at the named paths:

```powershell
$qaBatch = 'C:\Users\98jak\graphgoblin-qa\2026-11-13-aidlc-batch'
$qaNode = 'C:\Users\98jak\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64\node.exe'
$qaPrep = Join-Path $qaBatch 'launcher-438-candidate-freeze-preparation'
$qaTools = Join-Path $qaBatch 'launcher-438-candidate-freeze-root-tools'
$env:PATH = "$(Split-Path -Parent $qaNode);C:\Program Files\Git\bin;$env:PATH"
Remove-Item Env:NODE_OPTIONS -ErrorAction SilentlyContinue
function QaHash($p) { (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant() }
if ((Get-Command git.exe -CommandType Application).Source -cne 'C:\Program Files\Git\bin\git.exe') { throw 'Wrong Git on PATH' }

$qaBuildAdmission = Join-Path $qaBatch 'launcher-438-candidate-build-admission-01.json'
& $qaNode "$qaPrep\build.mjs" $qaBuildAdmission (QaHash $qaBuildAdmission)
if ($LASTEXITCODE -ne 0) { throw 'Build failed' }

$qaBuildDir = Join-Path $qaBatch 'runtime-410-build-candidate-438-freeze-01'
$qaBuildReceipt = Join-Path $qaBuildDir 'build-receipt.json'
$qaSourceBuild = Join-Path $qaBuildDir 'source-build.json'
$qaPlan = Join-Path $qaBatch 'launcher-438-candidate-root-freeze-01.json'
$qaCompileReceipt = Join-Path $qaBatch 'launcher-438-candidate-compile-01\receipt.json'
# After filling and reviewing the root freeze plan:
& $qaNode "$qaTools\compile.mjs" $qaPlan (QaHash $qaPlan)
if ($LASTEXITCODE -ne 0) { throw 'Compiler did not complete' }
& $qaNode "$qaPrep\capture-binding.mjs" $qaBuildReceipt (QaHash $qaBuildReceipt) $qaSourceBuild
if ($LASTEXITCODE -ne 0) { throw 'Raw source/build capture failed' }
& $qaNode "$qaTools\bind.mjs" $qaPlan (QaHash $qaPlan) (QaHash $qaSourceBuild) (QaHash $qaCompileReceipt)
if ($LASTEXITCODE -ne 0) { throw 'Candidate binding did not complete' }
```

Do not normalize or rewrite any captured source. The adapter's V4 calls are source/output readback only. The private ACL receipt records the exact preparation; the V4 driver independently checks its actual install directory. The sealed V4 example supplies the fixture shape and pressure limits.

## One admitted native invocation

After root reviews the generated proposal, verifies the final manifest and native prerequisites, and schedules actual Claude QA, make a new `launcher-438-candidate-native-admission-01.json` at the batch root from the proposal. Set `schema` to `intendedSchema` (`gg438-native-candidate-admission/v4`), remove `intendedSchema`, and set `state` to `root-admitted`. Keep its exact binding, PS7, wrapper, suite, stdio and private fixture references. Fill a separate [root invocation plan](root-invocation-admission.example.json) with the resulting admission reference, current Node and exact PS7 hashes, wrapper hash from the reviewed V4 manifest, and an unused output directory. Only after that review set `state` to `root-admitted-invocation`.

```powershell
$qaInvocation = Join-Path $qaBatch 'launcher-438-candidate-root-invocation-01.json'
& $qaNode "$qaTools\invoke-v4.mjs" $qaInvocation (QaHash $qaInvocation)
```

The outer invoker binds the exact PS7, wrapper, admission and unconsumed attempt. It preserves the outer raw streams, their independent EOF/write-close times, actual spawned argv/PID, exit and close. The V4 wrapper supplies its own separate child and workload receipts. The outer invocation uses the existing wrapper's 25-minute deadline. Preserve first failures and partial directories. A completed capture of exit 1 records a failed or incomplete V4 attempt. No automatic retry runs in these tools.

