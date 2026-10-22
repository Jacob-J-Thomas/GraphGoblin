$env:NODE_OPTIONS = '--import=' + ([Uri](Join-Path (Get-Location).Path 'docs/qa/2026-10-22-wp-d1-qa/register-loader.mjs')).AbsoluteUri
& (Join-Path $PSScriptRoot 'run-command.ps1') -Name recovery-process -PnpmArguments @('test:recovery-process')
