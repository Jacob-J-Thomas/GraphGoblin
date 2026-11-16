$ErrorActionPreference = 'Stop'
$auditDir = 'C:\Users\98jak\graphgoblin-qa\2026-11-13-aidlc-batch\review-410-astra-scan2'
$env:GIT_OPTIONAL_LOCKS = '0'
$snapshots = @(
  @{ name='ci-run'; endpoint='repos/Jacob-J-Thomas/GraphGoblin/actions/runs/43758754651' },
  @{ name='ci-attempt1-jobs'; endpoint='repos/Jacob-J-Thomas/GraphGoblin/actions/runs/43758754651/attempts/1/jobs?per_page=100' },
  @{ name='ci-attempt2-jobs'; endpoint='repos/Jacob-J-Thomas/GraphGoblin/actions/runs/43758754651/attempts/2/jobs?per_page=100' },
  @{ name='tested-merge'; endpoint='repos/Jacob-J-Thomas/GraphGoblin/git/commits/89fa84597f5aa124cf02d2fdebe27e4656ef1516' },
  @{ name='main-ref'; endpoint='repos/Jacob-J-Thomas/GraphGoblin/git/ref/heads/main' }
)
$results = @{}
foreach ($snapshot in $snapshots) {
  $raw = gh api $snapshot.endpoint
  if ($LASTEXITCODE -ne 0) { throw ('gh api failed: ' + $snapshot.endpoint) }
  $raw | Set-Content -LiteralPath (Join-Path $auditDir ('remote-raw-' + $snapshot.name + '.json')) -Encoding utf8
  $results[$snapshot.name] = $raw | ConvertFrom-Json
}
$run = $results['ci-run']
$merge = $results['tested-merge']
$jobs = foreach ($attempt in @(1,2)) {
  foreach ($job in $results['ci-attempt' + $attempt + '-jobs'].jobs) {
    [pscustomobject]@{ attempt=$attempt; id=$job.id; name=$job.name; head=$job.head_sha; status=$job.status; conclusion=$job.conclusion; started=$job.started_at; completed=$job.completed_at; successfulSteps=@($job.steps | Where-Object conclusion -eq success).Count; skippedSteps=@($job.steps | Where-Object conclusion -eq skipped | Select-Object -ExpandProperty name) }
  }
}
$refs = git ls-remote origin refs/heads/main refs/heads/codex/gg-20261115-terminal-waits refs/pull/487/head refs/pull/487/merge
if ($LASTEXITCODE -ne 0) { throw 'git ls-remote failed' }
$snapshot = [pscustomobject]@{ at=[DateTime]::UtcNow.ToString('o'); run=[pscustomobject]@{ id=$run.id; attempt=$run.run_attempt; head=$run.head_sha; status=$run.status; conclusion=$run.conclusion; event=$run.event; pullRequests=$run.pull_requests }; main=$results['main-ref'].object.sha; testedMerge=[pscustomobject]@{sha=$merge.sha;tree=$merge.tree.sha;parents=@($merge.parents.sha)}; jobs=$jobs; remoteRefs=$refs; localHead=(git rev-parse HEAD); localTree=(git rev-parse 'HEAD^{tree}'); localStatus=@(git status --porcelain=v2) }
$snapshot | ConvertTo-Json -Depth 15 | Set-Content -LiteralPath (Join-Path $auditDir 'final-remote-readback.json') -Encoding utf8
$snapshot | ConvertTo-Json -Depth 15
