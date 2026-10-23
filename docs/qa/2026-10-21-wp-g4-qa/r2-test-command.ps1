param([Parameter(Mandatory=$true)][string]$RequestFile)
$ErrorActionPreference = 'Continue'
$request = Get-Content -LiteralPath $RequestFile -Raw -Encoding UTF8 | ConvertFrom-Json
$taskArgs = @($request.args)
& pnpm.cmd @taskArgs 2>&1 | Out-File -LiteralPath $request.log -Encoding utf8
exit $LASTEXITCODE