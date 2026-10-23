# Owner QA recipe: #243 visible defaults and unlimited mode

Use this worktree, isolated data and fake CLIs only. Never use ports 4747/4748 or the
owner store. This recipe does not authorize paid provider turns. Independent review
and QA follow implementation; owner acceptance is not a merge gate under the latest dispatch.

## Build and start in PowerShell

Use a fresh PowerShell session; these environment overrides are session-local.

```powershell
$env:PATH = "$env:APPDATA\nvm\v22.14.0;$env:PATH"
node --version # must be v22.x
pnpm.cmd build
$qaRoot = Join-Path $env:TEMP ('gg-wp-f3-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $qaRoot | Out-Null
$env:GG_DATA_DIR = $qaRoot
$env:GG_DB_URL = 'file:' + (Join-Path $qaRoot 'graphgoblin.db').Replace('\', '/')
$env:GG_PORT = '5909' # use an unused port in 5900-5909
$env:GG_HOST = '127.0.0.1'
$env:GG_REQUIRE_API_KEY = 'false'
New-Item -ItemType Directory -Path (Join-Path $qaRoot 'cli') | Out-Null
Add-Type -Path (Resolve-Path 'tooling/fixtures/unlimited-codex.cs').Path -OutputAssembly (Join-Path $qaRoot 'cli\codex.exe') -OutputType ConsoleApplication
$env:GG_CODEX_BINARY = Join-Path $qaRoot 'cli\codex.exe'
$env:GG_WP_F3_SCENARIO = 'success'
$env:GG_WEB_DIST = (Resolve-Path 'apps/web/dist').Path
$qaNode = (Get-Command node.exe).Source
$qaProcess = Start-Process -FilePath $qaNode -ArgumentList 'apps/api/dist/main.js' -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $qaRoot 'api.log') -RedirectStandardError (Join-Path $qaRoot 'api-error.log')
$qaApi = 'http://127.0.0.1:' + $env:GG_PORT
$qaReadyBy = (Get-Date).AddSeconds(30)
do {
  try { $qaHealth = Invoke-RestMethod "$qaApi/healthz" -TimeoutSec 2; break }
  catch {
    if ($qaProcess.HasExited -or (Get-Date) -ge $qaReadyBy) { throw }
    Start-Sleep -Milliseconds 250
  }
} while ($true)
$qaHealth
```

The fake supports version/help/login checks and deterministic turn protocol. It cannot
call a provider. Before starting the API, choose scenario `success`, `stall`, `quota`,
`transport` or `unknown`. Stall stays alive until cancellation. Do not substitute a real CLI.

## Check defaults, unlimited and execution

Open `/app/settings` at this isolated URL. Execution defaults must show maximum node
visits 10 and No run deadline unless the loop sets one. A new loop's Loop tab must show
10 visits and No run deadline before a run exists, with neutral help: No deadline; set one
to stop a forgotten run. Choose Limited to add a deadline; it suggests 3600 seconds, which
is not the default. Clear the suggested number and enter 5; the numeric field must stay
editable and save/reload must show 5. Then choose No run deadline again. Select Unlimited for visits;
the numeric field disappears and a plain warning appears. Limited restores the default.
Save/reload must retain Unlimited visits and No run deadline. A repeat decision's Maximum passes also supports
Unlimited. Its optional time check and node timeouts remain independent authored choices.

Create a manual-trigger, inference, decision, exit graph. Use the fake inference prompt
`Controlled fake task`; set its transcript/messages output to none. Give the expression
decision source `"again"`, routes Again (`again`, repeat marked) and Done (`done`), and
Maximum passes Unlimited. Connect Start to Work, Work to Decision, Again to Work, and
both Done and Limit reached to Exit. Set visits Unlimited and leave No run deadline. Save and run the draft.
This loops beyond the former ten-visit limit without any real provider turn.

Open the run inspector. Execution limits must show Unlimited for visits and Run deadline: none;
decision evidence must show null maxPasses and increasing passes. Wait for over 20 visits,
then Cancel. The run must become cancelled within 10 seconds and remain inspectable.
To inspect through the supported API (use the run ID from the inspector):

```powershell
$qaRunId = 'replace-with-isolated-run-id'
(Invoke-RestMethod "$qaApi/runs/$qaRunId/thread").counters.nodeVisits
Invoke-RestMethod "$qaApi/runs/$qaRunId/cancel" -Method Post -ContentType 'application/json' -Body '{}'
Invoke-RestMethod "$qaApi/runs/$qaRunId"
```

Run a new copy with maximum visits 3 to see MAX_NODE_VISITS; run another with visits
Unlimited and deadline 5 seconds to see RUN_DEADLINE_EXCEEDED and an absolute deadline.
Null means No run deadline. Editing the definition must not change an existing run's pin.
Provider/service limits still fail explicitly; no built-in cost/token/usage budget exists.

## Automated native evidence

After build, from this worktree root:

```powershell
node apps/api/scripts/unlimited-mode.integration.mjs
# Isolate native stalled-turn cancellation and the authored 5-second deadline:
node apps/api/scripts/unlimited-mode.integration.mjs stall
```

This creates/removes its own gg-wp-f3 TEMP stores, chooses a free 5900-5909 port, checks
the default cap, executes beyond 20 fake turns, cancels a native stalled fake CLI and checks
its PID is gone, checks an authored 5-second deadline and no deadline and typed quota/transport/unknown
failures. It never uses the manual store above. A D-015 sandbox process-control denial
is a failed native qualification requiring the independent reviewer to run outside the sandbox.

## Stop and cleanup

Cancel active runs first. Stop only the process started above, then verify the resolved
TEMP target before deleting this independently created store:

```powershell
if (!$qaProcess.HasExited) { Stop-Process -Id $qaProcess.Id; $qaProcess.WaitForExit() }
$qaResolved = [IO.Path]::GetFullPath($qaRoot)
$qaTemp = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
if (!$qaResolved.StartsWith($qaTemp, [StringComparison]::OrdinalIgnoreCase) -or !(Split-Path $qaResolved -Leaf).StartsWith('gg-wp-f3-')) { throw 'Refusing cleanup outside this QA store' }
Remove-Item -LiteralPath $qaResolved -Recurse -Force
'GG_DATA_DIR','GG_DB_URL','GG_PORT','GG_HOST','GG_REQUIRE_API_KEY','GG_CODEX_BINARY','GG_WP_F3_SCENARIO','GG_WEB_DIST' | ForEach-Object { Remove-Item -LiteralPath "Env:$_" -ErrorAction SilentlyContinue }
```

## Round 2 deadline and storage regressions

D-027 removes the proposed default deadline: an omitted setting adds no timer to a new
or migrated run. To verify overnight work without waiting a day in real time, run:

```powershell
$env:PATH = "$env:APPDATA\nvm\v22.14.0;$env:PATH"
pnpm.cmd --filter @graphgoblin/engine exec vitest run src/unlimited.test.ts
pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run src/sqlite/definition-pins.test.ts src/claude/protocol.test.ts
```

The public engine-port scenarios advance a waiting run by 24 hours, with and without
restart, then signal its observed wait and verify success. A separate authored 5-second
parent deadline fails with RUN_DEADLINE_EXCEEDED and cancels its awaited child. The
SQLite historical-store test removes the deadline from the old definition and verifies
null pinned on existing runs, queued events and saved webhook intents; authored 5 stays 5.
Claude item details retain at most 16,384 characters while the complete final result is
unchanged. The 4 MiB stream failure remains HARNESS_OUTPUT_LIMIT. These are controlled
component checks; independent QA should also perform the isolated native recipe above.
