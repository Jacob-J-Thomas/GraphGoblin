# #321 independent QA: uncertain script outcomes

This recipe runs an actual built API and a local marker-producing script. It needs no provider, owner store or owner app. Work from this worktree in a fresh PowerShell window; ports 5910–5919 and a new `%TEMP%\gg-wp-d1-*` directory are the only runtime targets. Implementation evidence and gate results are in [verification.md](verification.md); independent QA records its own observations.

## Build and create the disposable environment

```powershell
$env:PATH = "$env:APPDATA\nvm\v22.14.0;$env:PATH"
node --version # must be v22.x
pnpm.cmd build
if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
$worktree = (Get-Location).Path
# This is a fresh shell: discard inherited GraphGoblin settings before selecting this store.
Get-ChildItem Env:GG_* | ForEach-Object { Remove-Item -LiteralPath ('Env:' + $_.Name) }
$qaDir = Join-Path $env:TEMP ('gg-wp-d1-qa-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $qaDir | Out-Null
$port = 5910 # select another free port in 5910..5919 if occupied
if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { throw 'Select a free QA port' }
$env:GG_DATA_DIR = $qaDir
$env:GG_DB_URL = 'file:' + (Join-Path $qaDir 'graphgoblin.db')
$env:GG_HOST = '127.0.0.1'
$env:GG_PORT = [string]$port
$env:GG_WEB_DIST = Join-Path $worktree 'apps/web/dist'
$env:GG_API_KEY_REQUIRED = 'true'
$env:GG_JEV_API_KEY = ''
$env:GG_MASTER_KEY = [Convert]::ToBase64String([byte[]](1..32))
$keyText = (& node apps/api/dist/main.js --create-api-key 'disposable script QA') -join "`n"
if ($LASTEXITCODE -ne 0) { throw 'Key creation failed' }
$token = [regex]::Match($keyText, '(?m)^\s+(gg_[A-Za-z0-9_-]+)\s*$').Groups[1].Value
if (!$token) { throw 'Key not returned' }
$origin = "http://127.0.0.1:$port"
$headers = @{ Authorization = "Bearer $token" }
function Start-QaApi {
  Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList @('apps/api/dist/main.js') -WorkingDirectory $worktree -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $qaDir 'api.out') -RedirectStandardError (Join-Path $qaDir 'api.err')
}
function Call-QaApi($method, $path, $body = @{}) {
  if ($method -eq 'GET') { return Invoke-RestMethod "$origin$path" -Headers $headers }
  Invoke-RestMethod "$origin$path" -Method $method -Headers $headers -ContentType 'application/json' -Body (ConvertTo-Json -InputObject $body -Depth 30)
}
function Wait-QaApi {
  $deadline = (Get-Date).AddSeconds(60)
  do {
    try { $null = Call-QaApi GET '/loops'; return } catch { Start-Sleep -Milliseconds 100 }
  } while ((Get-Date) -lt $deadline)
  throw 'QA API did not become ready; inspect only this directory api.err'
}
$server = Start-QaApi
Wait-QaApi
```

Do not put `$token`, `$keyText` or clipboard contents in QA evidence. All subsequent requests use the disposable key in memory. Stop and use the cleanup block on any unexpected result.

## Produce an effect, kill the API, and recover

```powershell
$marker = Join-Path $qaDir 'marker'
$release = Join-Path $qaDir 'release'
$script = Join-Path $worktree 'apps/api/scripts/uncertain-script-marker.mjs'
$definition = @{
  schemaVersion = 4; name = 'Uncertain script QA'
  nodes = @(
    @{ id='start'; kind='trigger'; label='Start'; config=@{ type='manual' } },
    @{ id='script'; kind='script'; label='Marker effect'; config=@{ command=(Get-Command node.exe).Source; args=@($script,$marker,$release); cwd=$qaDir } },
    @{ id='done'; kind='exit'; label='Done'; config=@{} }
  )
  edges = @(
    @{ id='a'; from=@{ node='start'; port='out' }; to=@{ node='script' } },
    @{ id='b'; from=@{ node='script'; port='out' }; to=@{ node='done' } }
  )
}
$loop = (Call-QaApi POST '/loops' @{ definition=$definition }).loop
$null = Call-QaApi POST "/loops/$($loop.id)/publish"
$run = (Call-QaApi POST "/loops/$($loop.id)/runs" @{ triggerNodeId='start' }).run
$deadline = (Get-Date).AddSeconds(60)
while (!(Test-Path -LiteralPath $marker) -or @((Get-Content -LiteralPath $marker -ErrorAction SilentlyContinue)).Count -lt 1) {
  if ((Get-Date) -gt $deadline) { throw 'Marker was not produced' }
  Start-Sleep -Milliseconds 25
}
if (@(Get-Content -LiteralPath $marker).Count -ne 1) { throw 'Expected one initial effect' }
$events = (Call-QaApi GET "/runs/$($run.id)/events?limit=500").items
if (@($events | Where-Object type -eq 'script.dispatched').Count -ne 1) { throw 'Dispatch was not durable before effect' }
# Hard kill only the API PID this recipe started; no graceful shutdown callback is involved.
Stop-Process -Id $server.Id -Force
$server.WaitForExit()
# Let the already-dispatched script exit; this does not supply a result to the dead API.
Set-Content -LiteralPath $release -Value done
$server = Start-QaApi
Wait-QaApi
$deadline = (Get-Date).AddSeconds(60)
do {
  $recovered = Call-QaApi GET "/runs/$($run.id)"
  if ($recovered.status -eq 'failed') { break }
  if ((Get-Date) -gt $deadline) { throw 'Recovery did not fail the uncertain script' }
  Start-Sleep -Milliseconds 100
} while ($true)
$recovered | Select-Object id,status,failure | ConvertTo-Json -Depth 10
@(Get-Content -LiteralPath $marker).Count # 1
```

Expected: `status: failed`, `failure.code: SCRIPT_OUTCOME_UNCERTAIN`, `resumable: true`, and `failure.script` containing the original `visitId`, `dispatchId` and `state: outcome-uncertain`. The message says the previous attempt may already have produced its effect and Resume runs it again. There is one `script.dispatched` and one `run.failed` in the events. Repeated restart must preserve the same failure and marker count 1. No automatic retry is permitted.

## Inspect, cancel recovery, then knowingly Resume

Open `$origin` in the browser, connect to that URL with the disposable key held in `$token`, and open `/app/runs/<the run ID>`. Use the usual local connection form; never connect this QA browser to 4747/4748. Capture evidence without the key.

1. The inspector shows **Failed: SCRIPT_OUTCOME_UNCERTAIN** and a plain sentence saying the previous attempt may already have produced its effect and Resume can repeat it. The timeline contains `script.dispatched` with its visit/dispatch IDs and the failure.
2. Choose **Recover script**. The dialog offers **Resume**, **Replay**, **Cancel**, and explains each. Cancel closes the dialog, leaves the run failed and the marker count 1. Reopening the dialog also runs nothing.
3. Choose **Recover script → Resume** knowingly. The run should succeed. The marker count becomes 2. Its two dispatches have the same logical visit ID and different dispatch IDs. The failed outcome remains in history. It is possible for an explicitly repeated script to produce its effect twice; this is not an exactly-once guarantee.
4. To check **Replay**, repeat the setup and interruption in a fresh disposable store and choose Replay on its failed run. It creates a new run starting at the failed script, with its own identities, and can repeat the effect. Cancel is cancellation of the recovery choice; it leaves the failed run unchanged, rather than rewriting a terminal outcome.

API-only equivalent for step 3 (use instead of clicking Resume):

```powershell
$null = Call-QaApi POST "/runs/$($run.id)/resume"
$deadline = (Get-Date).AddSeconds(60)
do {
  $done = Call-QaApi GET "/runs/$($run.id)"
  if ($done.status -eq 'succeeded') { break }
  if ((Get-Date) -gt $deadline) { throw 'Resumed script did not finish' }
  Start-Sleep -Milliseconds 100
} while ($true)
@(Get-Content -LiteralPath $marker).Count # 2
(Call-QaApi GET "/runs/$($run.id)/events?limit=500").items | Where-Object type -eq 'script.dispatched' | Select-Object visitId,dispatchId
```

## Boundary and refusal checks

After cleanup of the manual app, run these supported automated cases from the same worktree with Node 22. The API test builds no app itself, so keep the initial build requirement. Tests use only new disposable stores; no provider turn occurs.

```powershell
pnpm.cmd --filter @graphgoblin/api exec vitest run src/script-restart.test.ts
pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run src/process/script-recovery.test.ts src/process/scripts.test.ts
pnpm.cmd --filter @graphgoblin/engine exec vitest run src/script-recovery.test.ts src/handlers/script-dispatch.test.ts
pnpm.cmd --filter @graphgoblin/web exec vitest run src/runs/ScriptRecovery.test.tsx --pool=threads --maxWorkers=1
pnpm.cmd --filter @graphgoblin/web exec playwright test --config=playwright.script-recovery.config.ts
```

The real API cases kill during an input wait before the script, during the dispatched marker script, and during an input wait after completion. The first and third end with one marker; the dispatched case stays at one until explicit Resume produces two. Real missing-command and Windows `.cmd` refusals must be `SCRIPT_START_FAILED`, `definitely-not-started`, resumable. Restart preserves the proven failure; explicit Resume after installing the missing command starts it. A completed nonzero exit must keep `SCRIPT_EXIT_CODE`, `state: completed`, visit/dispatch IDs and its exit code.

## Stop and cleanup (also on failure)

```powershell
if (Test-Path -LiteralPath $qaDir) { Set-Content -LiteralPath (Join-Path $qaDir 'release') -Value done }
if ($server -and !$server.HasExited) { Stop-Process -Id $server.Id -Force; $server.WaitForExit() }
# Wait for any orphaned marker process to acknowledge release before removing its directory.
$deadline = (Get-Date).AddSeconds(30)
function Test-QaMarkerAlive {
  $alive = @(Get-ChildItem -LiteralPath $qaDir -Filter 'marker.active-*' -ErrorAction SilentlyContinue | ForEach-Object {
    $markerPid = [int]([IO.File]::ReadAllText($_.FullName))
    Get-Process -Id $markerPid -ErrorAction SilentlyContinue
  })
  return $alive.Count -gt 0
}
while (Test-QaMarkerAlive) {
  if ((Get-Date) -gt $deadline) { throw 'Marker still active: preserve the directory and investigate its recorded PID' }
  Start-Sleep -Milliseconds 100
}
$resolved = [IO.Path]::GetFullPath($qaDir)
$tempRoot = [IO.Path]::GetFullPath($env:TEMP).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if (!$resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or (Split-Path $resolved -Leaf) -notlike 'gg-wp-d1-qa-*') { throw 'Refuse cleanup outside this QA store' }
Remove-Item -LiteralPath $resolved -Recurse -Force
if (Test-Path -LiteralPath $resolved) { throw 'Disposable store was not removed' }
$token = $null; $keyText = $null
Get-ChildItem Env:GG_* | ForEach-Object { Remove-Item -LiteralPath ('Env:' + $_.Name) }
```

Record build/test results, marker counts, failure/provenance fields, inspector observations, explicit recovery choice and successful cleanup. Report failed checks without retry-to-green. Independent review and QA remain distinct from implementation verification.
