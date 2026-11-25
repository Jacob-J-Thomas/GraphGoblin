from pathlib import Path
import datetime, hashlib, json, subprocess, sys

sys.stdout.reconfigure(encoding='utf-8')
OUT = Path(__file__).resolve().parent
REPO = 'repos/Jacob-J-Thomas/GraphGoblin/'
RUN = 45104292980
HEAD = '504afbc6d799aa21b16158248ade424783ecc2ce'
TARGET = '0f6c325becf3e3e0562ae69dfae2c42bcf1d7129'
TESTED = '97fc005f3fcc5d626556e1b8b1871de331582ff2'

def fetch(name, endpoint):
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    args = ['gh', 'api', REPO + endpoint]
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=55)
    (OUT / (name + '.json')).write_bytes(result.stdout)
    (OUT / (name + '.stderr')).write_bytes(result.stderr)
    (OUT / (name + '.receipt.json')).write_text(json.dumps({
        'startedUtc': started, 'finishedUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'args': args, 'exit': result.returncode,
    }, indent=2) + '\n', encoding='utf-8')
    if result.returncode:
        raise RuntimeError(name + ' read failed; no automatic retry')
    return json.loads(result.stdout)

run = fetch('run', f'actions/runs/{RUN}')
jobs = fetch('jobs', f'actions/runs/{RUN}/attempts/1/jobs?per_page=100')
artifacts = fetch('artifacts', f'actions/runs/{RUN}/artifacts?per_page=100')
pr = fetch('pr', 'pulls/501')
main = fetch('main', 'git/ref/heads/main')
tested = fetch('tested-merge', 'git/commits/' + TESTED)
assert run['id'] == RUN and run['run_attempt'] == 1 and run['head_sha'] == HEAD
assert run['status'] == 'completed' and run['conclusion'] == 'failure'
assert jobs['total_count'] == 7 and len(jobs['jobs']) == 7
assert all(j['status'] == 'completed' for j in jobs['jobs'])
failed = [j for j in jobs['jobs'] if j['conclusion'] != 'success']
assert len(failed) == 1 and failed[0]['name'] == 'macOS launcher' and failed[0]['conclusion'] == 'failure'
assert [p['sha'] for p in tested['parents']] == [TARGET, HEAD]
assert pr['head']['sha'] == HEAD and pr['draft'] is True and pr['state'] == 'open'
assert main['object']['sha'] == TARGET
summary = {
    'utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'run': RUN, 'attempt': 1, 'head': HEAD, 'target': TARGET, 'testedMerge': TESTED,
    'conclusion': 'failure',
    'jobs': [{k: j[k] for k in ['id','name','status','conclusion','started_at','completed_at']} for j in jobs['jobs']],
    'artifactCount': artifacts['total_count'],
    'monitorToolObservedExit': 1, 'monitorScriptIntendedFailureExit': 2,
    'monitorExitQualification': 'Tool session 50486 reported exit 1; saved monitor source calls sys.exit(2). Shell normalization cause was not established. GitHub completed failure is independently recorded.',
    'gateAcceptance': False, 'artifactVerifierExecuted': False, 'rerunRequested': False,
    'nativeSwiftAndInstallerAcceptance': 'Skipped after failed API selection; no acceptance inferred.',
    'firstFailureEvidence': '../mac-d237-ci-first-failure-01',
}
(OUT / 'SUMMARY.json').write_text(json.dumps(summary, indent=2) + '\n', encoding='utf-8')
files = []
for path in sorted(OUT.iterdir()):
    if path.is_file() and path.name != 'MANIFEST.json':
        raw = path.read_bytes()
        files.append({'path': path.name, 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()})
(OUT / 'MANIFEST.json').write_text(json.dumps({'files': files}, indent=2) + '\n', encoding='utf-8')
print(json.dumps(summary, indent=2))
