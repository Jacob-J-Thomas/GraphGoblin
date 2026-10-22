# Pre-upgrade terminal Event-return regression

`before.json` and `after.json` record the same original store, created through the built API
from archived commit `52360d9`. The before build is integrated commit `670527cf`; the after
build adds the terminal-return guard in this round. No provider turns run.

The child exits to a held webhook, a retired Event destination, caller and log. Its parent
is already parked on it. Kill the old API after the receiver sees the webhook: the child
has one durable `run.finished`, terminal status and no finalization marker, the parent is
waiting, and no return receipt or Event effect has been produced. Each new build receives
its own copy of that original store, with a successful receiver at the same destination.

Before the fix, finalization fails receipt validation and stays pending. The integrated
parent's independent recovery reconciliation already lets it continue once. After the fix,
the retired destination produces a typed warning, supported returns finish, the child is
finalized and its parent continues once. Existing event rows and definitions are compared
byte-for-byte; a second startup must change neither runs nor events and send no new request.
`verify.json` is a separate fresh-base repeat of the positive regression, also asserting the
caller and log delivery receipts and comparing every run/version column on second startup.
It does not replace the original before/after pair.

## Reproduction

Use Node 22 and `pnpm.cmd` from the worktree root. Export the base with `git archive`, without
checkout changes, then use Windows' tar executable (Git's GNU tar treats a drive colon as a
remote archive):

```powershell
$env:PATH = "C:\Users\98jak\AppData\Roaming\nvm\v22.14.0;$env:PATH"
$baseExport = Join-Path $env:TEMP ('gg-wp-d2-base-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $baseExport | Out-Null
git archive --format=tar --output="$baseExport/base.tar" 52360d9
& 'C:\Windows\System32\tar.exe' -xf "$baseExport/base.tar" -C $baseExport
pnpm.cmd exec node docs/qa/2026-10-21-wp-d2-report/base-build.mjs $baseExport
$env:GG_WP_D2_BASE_ROOT = $baseExport
$env:GG_WP_D2_CURRENT_ROOT = (Get-Location).Path
pnpm.cmd exec node --experimental-loader ./docs/qa/2026-10-21-wp-d2-report/base-loader.mjs "$baseExport/apps/api/dist/templates/copy-catalog.js"
```

`base-build.mjs` emits archived TypeScript sources as JavaScript using the installed TypeScript
compiler. This is emission, without the old tree's typecheck or dependency installation. The
loader resolves archived workspace exports to that archive's own `dist/`, and installed external
dependencies from this worktree with normal ESM import conditions. The lockfile is identical
between `52360d9` and `670527cf`. No external dependency links, source edits or Git worktrees are
created. Relative module and asset paths retain the original package layout.

Build the unmodified integrated API, then capture the failing case:

```powershell
pnpm.cmd --filter @graphgoblin/api build
pnpm.cmd exec node docs/qa/2026-10-21-wp-d2-report/retired-return.acceptance.mjs before $baseExport
```

After applying the finalization fix and rebuilding, run:

```powershell
pnpm.cmd --filter @graphgoblin/api build
pnpm.cmd exec node docs/qa/2026-10-21-wp-d2-report/retired-return.acceptance.mjs after $baseExport
```

For a standalone regression on the fixed build, create a fresh base-built store and verify both
startups in one command:

```powershell
pnpm.cmd exec node docs/qa/2026-10-21-wp-d2-report/retired-return.acceptance.mjs verify $baseExport
```

The evidence script uses only available ports in 5800-5809. It retains the original fixture
between the two phases under `%TEMP%/gg-wp-d2-retired-return-*`, names it in the temporary
`gg-wp-d2-r4-fixture.json` manifest, and removes the entire store fixture with bounded cleanup
after the after phase or a failed invocation. The source export is separate evidence tooling,
not a store; COMMON's restriction on manual directory deletion leaves its removal to the
orchestrator. Logs and the export path are recorded under `%TEMP%/gg-wp-d2-r4-*`.
