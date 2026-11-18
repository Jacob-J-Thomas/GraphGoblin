$env:RUNNER_TEMP = $env:GITHUB_WORKSPACE
node tooling/scripts/windows-launcher-evidence.mjs init
exit $LASTEXITCODE
