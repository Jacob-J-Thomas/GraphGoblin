# WP-F2b owner acceptance on a running isolated app (#204)

This checks intentional inference-node harness changes, persistence, validation/publication and the
actual CLI arguments. It does not accept WP-F1 or #205 for the owner. Model/effort are still under
Advanced. Use this worktree, never ports 4747/4748 or the owner's store. All turns below use local
synthetic executables; no subscription or API calls occur. Cross-provider reviewer real turns are
separate evidence (D-005). This branch stacks on pending owner acceptance of WP-F1 (D-009).

## Start the disposable app

Use Windows PowerShell 5.1 (`powershell.exe`). Dependencies must already be present. Keep this
terminal open so `$qaProcess`, `$qaRoot` and `$base` remain available for stopping it.

```powershell
Set-Location 'C:\Users\98jak\source\repos\GraphGoblin\.claude\worktrees\codex-wp-f2b-harness-switch'
$env:PATH = "C:\Users\98jak\AppData\Roaming\nvm\v22.14.0;$env:PATH"
node --version                         # must report v22.x
if (-not (Test-Path node_modules)) { throw 'Dependencies are missing; stop here.' }
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
  settings = @{ defaults = @{ byHarness = @{} } }
  nodes = @(
    @{ id = 'start'; kind = 'trigger'; label = 'Start'; config = @{ type = 'manual' }; ui = @{ x = 0; y = 80 } },
    @{ id = 'infer'; kind = 'inference'; label = 'Infer'; config = @{
      harness = 'codex'; model = 'gpt-6-astra'; effort = 'minimal'
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

1. In **Settings → Defaults**, set **Default model** (Codex) to **GPT-6.1 Sol**, and **Default effort**
   to **high**. Set **Default model (claude)** to **Claude Fable 5.1** and **Default effort (claude)**
   to **xhigh**. Wait for each save to finish. These are the current base's models; this package
   does not add Sonnet/Haiku or change the catalog.
2. Open the editor URL printed above. Click the **Infer** card header. Expand **Advanced**. Confirm
   the initial **Model** is `gpt-6-astra` and **Effort** is `minimal`.
3. Choose **claude** under **Harness**. Expect **Model** `claude-fable-5-1`, **Effort** `xhigh`, and
   **Sandbox and approval policy** read-only. `minimal` is unsupported by Claude, so the Settings
   effort replaces it. The harness radio retains keyboard focus.
4. Choose **codex**. Expect **Model** `gpt-6.1-sol`; **Effort** stays `xhigh`, which Codex supports.
   Choose **claude** once more: model returns to `claude-fable-5-1`, effort stays `xhigh`.
5. Click **Done**. Wait for the editor's saved state. Reopen **Infer**, expand **Advanced** and check
   the same model/effort. Close it, reload the browser, reopen it and check again.
6. Close the node dialog and click **Publish**. Expect **Published version 1.**, with no model,
   catalog or readiness issue. Click **Open in Runs**, then **Start run**. Expect **Succeeded**.
7. Read the actual adapter launch:

   ```powershell
   Get-Content -LiteralPath (Join-Path $qaBin 'requests.jsonl')
   ```

   The last line must contain `"model":"claude-fable-5-1","effort":"xhigh"`. The synthetic
   result is not evidence of real provider entitlement. Switch back to Codex, publish the next
   version and start another run: the last request must name `gpt-6.1-sol` and `xhigh`.

## Absent defaults, disabled defaults, and the loop default

1. Return to Settings. For each harness clear **Default effort** to **(server default)** first, then clear **Default model** to **(server default)**. This avoids an effort-only intermediate default without a model. In the node,
   choose Codex, explicitly choose **minimal** effort, then choose Claude. With no configured
   defaults, expect `claude-opus-5-5` and `high` (the supported ecosystem model and its catalog
   suggested effort). Switch back to Codex: expect `gpt-6-luna` and preserved `high`.
2. Configure the Claude Settings default as Fable / xhigh again. In **Model catalog**, turn off
   **Enabled** on **Claude Fable 5.1**. Return to the editor, switch Codex → Claude: expect Opus,
   never Fable; the disabled catalog switch must stay off. Supported existing effort stays.
3. A loop default is considered after the Settings model is absent or incompatible. To check it
   without editing record controls, close the editor tab, then seed the loop default through the
   same public draft endpoint (the Settings Fable default is still disabled):

   ```powershell
   $detail = Invoke-RestMethod "$base/loops/$loopId"
   $draftDefinition = if ($detail.draft) { $detail.draft.definition } else { $detail.current.definition }
   $draftDefinition.settings.defaults = @{ byHarness = @{ claude = @{ model = 'claude-opus-5-5'; effort = 'low' } } }
   Invoke-RestMethod "$base/loops/$loopId/draft" -Method Put -ContentType 'application/json' -Body (@{ definition = $draftDefinition } | ConvertTo-Json -Depth 50) | Out-Null
   ```

   Reopen the editor and explicitly switch Codex → Claude. Expect Opus. A supported existing
   effort stays; otherwise compatible Settings effort wins, then loop effort, then catalog effort.

4. Disable Opus too, with no enabled configured target. On a new switch to Claude, authored model
   and effort must stay visible with a **No enabled compatible ... default** notice. Validation
   reports the mismatch/disabled choice. Neither disabled entry is enabled automatically. Restore
   Opus and Fable after the check, and switch explicitly again; recovery alone does not author a
   new value.

## Failed catalog and loaded incompatible values

For a manual catalog failure, open Edge DevTools → **Network request blocking**, add the exact
`$base/model-catalog` URL, enable blocking, and reload the editor. Open Infer and Advanced, then
switch harness. The old model/effort must remain, with the catalog/readiness problem under the
field and a switch notice. Turn off blocking, click **Retry model catalog**: the authored values
must still remain. Choose a model manually or switch away and back to author a replacement.
A failed background refetch with cached data follows the same preservation rule.

Normal API writes reject explicit wrong-harness selections, so the separate loaded-incompatible
case uses a controlled GET response in `claude-harness.spec.ts` (both ready and unready Claude).
It verifies a saved Codex ID loaded under Claude is still selected, disabled in the picker and
labelled **Saved model belongs to Codex**, without any harness action. It is not a migration.
The automated native collector covers both switch directions and all four default/failure cases:

```powershell
$env:GG_SWITCH_EXPECT_FIXED = '1'
pnpm.cmd --filter @graphgoblin/web exec tsx --conditions=development e2e/harness-switch-native.mjs
Remove-Item Env:GG_SWITCH_EXPECT_FIXED
```

That collector needs port 5830 free, starts its own independent app/data directory and leaves its
artifacts under `%TEMP%/gg-wp-f2b-native-*`. It must not reuse the manual app's data directory.

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

Record each check above as pass/fail and keep the final model/effort request lines. Owner acceptance
is still required before merge. [before.md](before.md) and [native-before.json](native-before.json)
record the reproduced baseline. The delivery report in [report.md](report.md) records gates,
coverage, exact known #205 browser failures and remaining caveats.
