# WP-F2b QA recipe on a running isolated app (#204)

This checks intentional inference-node harness changes, persistence, validation/publication and the
actual CLI arguments. It does not accept WP-F1 or #205 for the owner. Model/effort are still under
Advanced. Use this worktree, never ports 4747/4748 or the owner's store. All turns below use local
synthetic executables; no subscription or API calls occur. Cross-provider reviewer real turns are
separate evidence (D-005). This branch stacks on WP-F1 (register D-009, D-024).

## Start the disposable app

Use Windows PowerShell 5.1 (`powershell.exe`) from the root of this checkout. Install dependencies first. Keep this
terminal open so `$qaProcess`, `$qaRoot` and `$base` remain available for stopping it.

```powershell
# Run from the root of this checkout.
$env:PATH = "<local>\AppData\Roaming\nvm\v22.14.0;$env:PATH"
node --version                         # must report v22.x
pnpm.cmd install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
pnpm.cmd build
if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
$qaRoot = Join-Path $env:TEMP ('gg-wp-f2b-owner-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $qaRoot | Out-Null
$qaBin = Join-Path $qaRoot 'bin'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tooling/scripts/model-switch-fake-cli.ps1 -Directory $qaBin
if ($LASTEXITCODE -ne 0) { throw 'Fixture build failed.' }
$qaPort = 5831                         # choose an unused port from 5830 through 5839
$base = "http://127.0.0.1:$qaPort"
$env:GG_HOST = '127.0.0.1'
$env:GG_PORT = [string]$qaPort
$env:GG_DATA_DIR = Join-Path $qaRoot 'data'
$env:GG_DEFAULTS = '{"byHarness":{}}'
$env:GG_CODEX_BINARY = Join-Path $qaBin 'codex.exe'
$env:GG_CLAUDE_BINARY = Join-Path $qaBin 'claude.exe'
$qaProcess = Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList 'apps/api/dist/main.js' -WorkingDirectory (Get-Location).Path -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $qaRoot 'api.out.log') -RedirectStandardError (Join-Path $qaRoot 'api.err.log')
$qaProcess.Id
$base
```

Open `$base/app/settings` in Edge. Confirm both harnesses say **Ready** under **Harness preflight**;
use **Retry preflight** if they are checking. If the app fails to bind, inspect the two logs and
choose another free port in the permitted range; do not stop an unknown listener. The native
fixture source is `tooling/fixtures/model-switch-cli.cs`; it records each actual turn's model and
effort in `$qaBin/requests.jsonl`. The same directory contains both binaries.

Seed a connected loop through the public API (run after the app answers):

```powershell
$definition = @{
  schemaVersion = 4; name = 'WP-F2b owner QA'
  settings = @{ defaults = @{ byHarness = @{
    codex = @{ model = 'gpt-6-astra'; effort = 'low' }
    claude = @{ model = 'claude-fable-5-1'; effort = 'low' }
  } } }
  nodes = @(
    @{ id = 'start'; kind = 'trigger'; label = 'Start'; config = @{ type = 'manual' }; ui = @{ x = 0; y = 80 } },
    @{ id = 'infer'; kind = 'inference'; label = 'Infer'; config = @{
      harness = 'claude'; model = 'claude-opus-5-5'; effort = 'high'
      prompt = @{ template = 'Return a short synthetic QA result.' }
      harnessOptions = @{ sandbox = 'read-only'; approval = 'never' }
    }; ui = @{ x = 260; y = 80 } },
    @{ id = 'done'; kind = 'exit'; label = 'Done'; config = @{}; ui = @{ x = 520; y = 80 } }
  )
  edges = @(
    @{ id = 'a'; from = @{ node = 'start'; port = 'out' }; to = @{ node = 'infer' } },
    @{ id = 'b'; from = @{ node = 'infer'; port = 'out' }; to = @{ node = 'done' } }
  )
}
$created = Invoke-RestMethod "$base/loops" -Method Post -ContentType 'application/json' -Body (@{ definition = $definition } | ConvertTo-Json -Depth 30)
$loopId = $created.loop.id
"$base/app/loops/$loopId/edit"
```

## Configured defaults, both directions, save and run

1. In **Settings > Defaults**, set **Default model** (Codex) to **GPT-6.1 Sol**, and **Default effort**
   to **high**. Set **Default model (claude)** to **Claude Opus 5.5** and **Default effort (claude)**
   to **xhigh**. Wait for each Settings save. The seeded loop defaults differ from the ecosystem
   defaults: Codex Astra / low and Claude Fable / low. The switch order is **loop, then Settings,
   then ecosystem**, matching runs (D-023).
2. Open the editor URL printed above. Click **Infer**, expand **Advanced**. The initial model is
   Opus with high effort. Settings and preflight start when the editor mounts. You can switch
   immediately: if the first checks are still running, a loading notice appears under Harness,
   the old harness remains selected, and the requested switch applies when they finish. No second
   click, reload or preflight retry is needed for a successful first check.
3. Choose **codex** first. Expect **Model** `gpt-6-astra`, overriding both Settings Sol and ecosystem
   Luna. **Effort** stays `high`, which Astra supports. The harness radio keeps keyboard focus.
   Set **Effort** to **minimal**, then choose **claude**: expect `claude-fable-5-1` / `low` and
   **Sandbox and approval policy** read-only. The loop's low effort wins over Settings xhigh.
4. Choose **codex** again: expect Astra / low. Choose **claude**: expect Fable / low.
5. Click **Done**, wait for the saved state. Reopen **Infer**, expand **Advanced**, check Fable / low.
   Close, reload the browser, reopen, and check again.
6. Close the dialog and **Publish**. Expect **Published version 1.** with no model/catalog/readiness
   issue. Click **Open in Runs**, then **Start run**. Expect **Succeeded**.
7. Read the actual adapter launch:

   ```powershell
   Get-Content -LiteralPath (Join-Path $qaBin 'requests.jsonl')
   ```

   The last line must contain `"model":"claude-fable-5-1","effort":"low"`. Switch to Codex,
   publish and start another run: expect `gpt-6-astra` / `low` in the last request. These are fake
   CLI requests, not evidence of real entitlement.

## Inheritance, Settings, absent and disabled defaults

Close the editor tab before each API edit below; reopen its printed URL afterwards. Use this
helper to change only this disposable loop's defaults and optional node overrides:

```powershell
function Set-QaDraft($loopDefaults, $inherit = $false) {
  $detail = Invoke-RestMethod "$base/loops/$loopId"
  $draftDefinition = if ($detail.draft) { $detail.draft.definition } else { $detail.current.definition }
  $draftDefinition.settings.defaults = @{ byHarness = $loopDefaults }
  if ($inherit) {
    $inference = $draftDefinition.nodes | Where-Object id -eq 'infer'
    $inference.config.PSObject.Properties.Remove('model')
    $inference.config.PSObject.Properties.Remove('effort')
  }
  Invoke-RestMethod "$base/loops/$loopId/draft" -Method Put -ContentType 'application/json' -Body (@{ definition = $draftDefinition } | ConvertTo-Json -Depth 50) | Out-Null
}
```

1. Run `Set-QaDraft @{} $true`. Reopen Infer/Advanced: both fields show **(loop default)**.
   Switch both directions, even during initial loading: both must remain **(loop default)**.
   Done, save, reload, reopen: both remain unset. Publishing/running resolves the selected harness's
   Settings default, without adding model/effort to the saved node. Also check an effort-only node:
   choose Codex, keep Model at **(loop default)**, select minimal effort, then choose Claude.
   Model stays **(loop default)** and effort becomes Settings xhigh; a failed check keeps the
   authored effort instead. Restore explicit fields by choosing Codex and selecting Luna / minimal
   manually before the remaining checks.
2. With no loop defaults, Settings wins. Switch Codex to Claude: expect Opus / xhigh when replacing
   minimal. Switch to Codex: expect Sol, retaining supported xhigh. Save/reopen as above.
3. Clear **Default effort** to **(server default)** first, then **Default model** for each harness
   in Settings. With the loop defaults still empty, switch to Codex, choose minimal effort, switch
   to Claude: expect ecosystem Opus / high. Switch to Codex: expect ecosystem Luna / high.
4. Configure Claude Settings Fable / xhigh, then disable **Claude Fable 5.1** in **Model catalog**.
   Return to the editor, switch Codex to Claude: expect Opus, preserving a supported current effort.
   Fable's Enabled switch must stay off. With Settings Fable still disabled, you can run
   `Set-QaDraft @{ claude = @{ model = 'claude-opus-5-5'; effort = 'low' } }` and check that an
   explicit switch uses that enabled loop default. Supported old effort still stays.
5. Disable Opus too. A new switch to Claude keeps the authored model/effort with a **No enabled
   compatible ... default** warning directly under Harness and an alert icon. Available validation
   reports the incompatible/disabled choice, preventing publication. Undo clears the switch notice.
   Restore both catalog entries; recovery alone does not change authored fields. Switch explicitly
   again to choose a replacement.

## Failed catalog and loaded incompatible values

For a manual catalog failure, open Edge DevTools → **Network request blocking**, add the exact
`$base/model-catalog` URL, enable blocking, and reload the editor. Open Infer and Advanced, then
switch harness. The old model/effort must remain, with the catalog/readiness problem under the
field and a warning directly under Harness. The editor shows **Validation unavailable** and the draft
cannot be saved while the catalog is unavailable. Turn off blocking, click **Retry model catalog**:
the authored values must still remain. Choose a model manually or switch away and back to author a replacement.
A failed background refetch with cached data follows the same preservation rule.

Normal API writes reject explicit wrong-harness selections, so the separate loaded-incompatible
case uses a controlled GET response in `claude-harness.spec.ts` (both ready and unready Claude).
It verifies a saved Codex ID loaded under Claude is still selected, disabled in the picker and
labelled **Saved model belongs to Codex**, without any harness action. It is not a migration.
The automated native collector covers both directions, configured/absent/disabled/failed defaults,
inheritance, effort-only selection, competing loop/Settings defaults, and an early switch with
delayed first checks:

```powershell
$collectorPort = 5832                 # an unused permitted port, different from $qaPort
$env:GG_SWITCH_PORT = [string]$collectorPort
$env:GG_SWITCH_EXPECT_FIXED = '1'
pnpm.cmd --filter @graphgoblin/web exec tsx --conditions=development e2e/harness-switch-native.mjs
Remove-Item Env:GG_SWITCH_EXPECT_FIXED
Remove-Item Env:GG_SWITCH_PORT
```

The collector uses `$collectorPort`, starts its own independent app/data directory and prints the
`results.json` path under `%TEMP%/gg-wp-f2b-native-*`. It never overwrites the tracked
`native-after.json` or any other repository evidence. It stops its own process on completion,
retains its artifacts, and must not reuse the manual app's data directory.

## Real CLI variation

To use installed CLIs, stop this isolated app first. In a new terminal with the same Node 22 and
fresh `gg-wp-f2b-` data directory, omit both `GG_*_BINARY` fixture overrides (or set them to the real
installed binaries). Keep a permitted isolated port. No-turn readiness can depend on local login,
version and CLI capability; a ready result does not establish model entitlement. Only an explicit
Start run makes a real subscription turn. Keep that bounded and owner initiated. There is no
`requests.jsonl`; inspect the run's model/requested-effort evidence and provider transcript instead.
Claude does not report effective effort. Unready Claude preserves the selection with its readiness
problem; retry then switch explicitly when ready.

## Stop and cleanup

Close this app's browser tab and stop only the process started above. Do not stop another listener.

```powershell
if ($qaProcess -and -not $qaProcess.HasExited) {
  Stop-Process -Id $qaProcess.Id
  $qaProcess.WaitForExit()
}
'GG_HOST','GG_PORT','GG_DATA_DIR','GG_DEFAULTS','GG_CODEX_BINARY','GG_CLAUDE_BINARY' | ForEach-Object {
  Remove-Item -LiteralPath "Env:$_" -ErrorAction SilentlyContinue
}
Get-ChildItem -LiteralPath $qaRoot
$qaRoot
```

Data, binaries, request logs and startup logs are retained in that exact newly created directory
for review. Directory removal is left to the owner after acceptance. No original store is changed.

## Acceptance and implementation evidence

Record each check above as pass/fail and keep the final model/effort request lines. Independent QA records the
result; there is no owner acceptance gate (register D-024). [before.md](before.md) and [native-before.json](native-before.json)
record the reproduced baseline. The delivery report in [report.md](report.md) records gates,
coverage, exact known #205 browser failures and remaining caveats.
[round2-before.json](round2-before.json) and [round2-after.json](round2-after.json) record the
B1/B2/B3 review regressions and corrected built-app behavior; [round1-report.md](round1-report.md)
is retained as historical evidence.
