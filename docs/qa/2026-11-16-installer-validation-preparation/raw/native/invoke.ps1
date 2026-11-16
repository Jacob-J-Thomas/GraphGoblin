[CmdletBinding()]
param([Parameter(Mandatory)][string]$Request)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
try {
    $qaRequest = Get-Content -Raw -LiteralPath $Request | ConvertFrom-Json -AsHashtable
    if (!$IsWindows -or $env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted') {
        throw 'The QA launcher runs only on a hosted Windows Actions job.'
    }
    $qaOptions = @{}
    foreach ($qaEntry in $qaRequest.options.GetEnumerator()) { $qaOptions[$qaEntry.Key] = $qaEntry.Value }
    if ($qaOptions.ContainsKey('Environment')) {
        $qaEnvironment = @{}
        foreach ($qaEntry in $qaOptions.Environment.GetEnumerator()) {
            $qaEnvironment[$qaEntry.Key] = $qaEntry.Value
        }
        $qaOptions.Environment = $qaEnvironment
    }
    # The one actual public installer call. Keep its stdout and exception from the child process.
    & $qaRequest.installer @qaOptions
    if (!$?) { exit 1 }
    exit 0
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    [Console]::Error.WriteLine($_.FullyQualifiedErrorId)
    [Console]::Error.WriteLine($_.ScriptStackTrace)
    exit 1
}
