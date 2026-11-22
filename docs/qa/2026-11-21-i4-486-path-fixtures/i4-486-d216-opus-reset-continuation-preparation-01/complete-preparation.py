"""Final frozen-code offline proof and seal; never start wait/provider modes."""
from pathlib import Path
import ast, datetime, hashlib, json, subprocess, sys

P = Path(__file__).resolve().parent

def rec(p):
    p = Path(p).resolve()
    h = hashlib.sha256()
    with p.open('rb') as f:
        for part in iter(lambda: f.read(1024 * 1024), b''):
            h.update(part)
    return {'source': str(p), 'bytes': p.stat().st_size, 'sha256': h.hexdigest()}

def new(p, obj):
    with Path(p).open('xb') as f:
        f.write((json.dumps(obj, indent=2) + '\n').encode())

controller = P / 'controller.py'
ast.parse(controller.read_text(encoding='utf-8'))
c = json.loads((P / 'config.template.json').read_bytes())
assert c['rootExecutionAuthorized'] is False
checks = []
for label, args, expected in [
    ('final-offline-validation', ['validate', '--validation-evidence', str(P / 'final-source-check')], 0),
    ('final-pre-reset-refusal', ['check-dispatch-time'], 23),
]:
    argv = [sys.executable, '-B', str(controller), *args, '--config', str(P / 'config.template.json')]
    with (P / (label + '.stdout')).open('xb') as out, (P / (label + '.stderr')).open('xb') as err:
        result = subprocess.run(argv, stdout=out, stderr=err)
    assert result.returncode == expected, (label, result.returncode)
    value = json.loads((P / (label + '.stdout')).read_bytes())
    assert value['status'] == ('OFFLINE_VALIDATION_PASS_NO_PROVIDER' if expected == 0 else 'REFUSED_BEFORE_RESET')
    checks.append({'label': label, 'argv': argv, 'exit': result.returncode,
        'status': value['status'], 'stdout': rec(P / (label + '.stdout')),
        'stderr': rec(P / (label + '.stderr'))})
assert not Path(c['attempt']).exists() and not Path(c['controllerEvidence']).exists()
new(P / 'completion.json', {'status': 'SEALED_PREPARATION_NOT_LAUNCHED',
    'atUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'controller': rec(controller), 'config': rec(P / 'config.template.json'),
    'frozenBrief': rec(P / 'BRIEF.attempt02.md'), 'frozenSpec': rec(P / 'spec.template.json'),
    'checks': checks, 'providerCalls': 0, 'controllerSessionStarted': False,
    'attempt02Created': False, 'sourceIndexOrOldPacketWrites': 0,
    'originalQuotaSealMembersVerified': 42, 'rootExecutionAuthorized': False,
    'resetEpoch': c['resetEpoch'], 'latestLaunchEpoch': c['latestLaunchEpoch'],
    'maximumProviderSeconds': c['maximumProviderSeconds'],
    'waitBound': 'Remaining time to exact reset plus 600 seconds monotonic clock-drift allowance; clock sleeps capped at 60 seconds. No provider before reset.',
    'launchWindowUtc': '2026-11-23T07:00:00Z through 2026-11-23T09:00:00Z',
    'latestOrdinaryProviderDeadlineUtc': '2026-11-23T11:00:00Z',
    'rootConfigDestination': str(P.parent / 'i4-486-d216-opus-reset-controller-config.root-admitted-01.json'),
    'runtimeBranchesNotExecuted': ['wait loop', 'actual provider dispatch', 'process-tree timeout'],
    'rootAcceptanceOfFutureReport': False, 'finalCiNativeCapMergeAcceptance': False})
files = []
for p in sorted(P.rglob('*')):
    if p.is_file() and p.name != 'SHA256SUMS.json':
        r = rec(p)
        files.append({'path': str(p.relative_to(P)).replace('\\', '/'), 'bytes': r['bytes'], 'sha256': r['sha256']})
new(P / 'SHA256SUMS.json', {'status': 'PREPARATION_ONLY_NO_PROVIDER_OR_CONTROLLER_STARTED',
    'selfExcluded': 'SHA256SUMS.json', 'files': files})
for item in files:
    r = rec(P / item['path'])
    assert r['bytes'] == item['bytes'] and r['sha256'] == item['sha256']
print(json.dumps({'status': 'SEALED_PREPARATION_NOT_LAUNCHED', 'members': len(files),
    'controller': rec(controller), 'config': rec(P / 'config.template.json'),
    'brief': rec(P / 'BRIEF.attempt02.md'), 'spec': rec(P / 'spec.template.json'),
    'completion': rec(P / 'completion.json'), 'seal': rec(P / 'SHA256SUMS.json'),
    'bytesTotal': sum(i['bytes'] for i in files), 'providerCalls': 0}))
