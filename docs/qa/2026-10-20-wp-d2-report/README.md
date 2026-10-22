# Projection measurement evidence tooling

The archived benchmark uses the API package's public workspace dependencies. After building,
run a temporary copy in that package's module scope from the repository root (Node 22):

```powershell
$env:PATH = "$env:APPDATA\nvm\v22.14.0;$env:PATH"
$benchmarkCopy = Join-Path (Get-Location) ("apps/api/scripts/.projection-" + [guid]::NewGuid().ToString('N') + '.mjs')
Copy-Item -LiteralPath 'docs/qa/2026-10-20-wp-d2-report/delivery-projection.measure.mjs' -Destination $benchmarkCopy
try { node $benchmarkCopy } finally { Remove-Item -LiteralPath $benchmarkCopy -Force }
```

The benchmark removes its `gg-wp-d2-projection-*` temporary store after the SQLite worker
exits. The wrapper removes only its temporary script file. The original observations are
in [the round-two report](../2026-10-20-wp-d2-round-2.md).
