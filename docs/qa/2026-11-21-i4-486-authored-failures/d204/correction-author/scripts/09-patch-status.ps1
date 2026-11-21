$ErrorActionPreference = 'Stop'
git diff --stat
Get-Content -LiteralPath 'packages/engine/src/failure-publication.ts' | Select-Object -First 30
