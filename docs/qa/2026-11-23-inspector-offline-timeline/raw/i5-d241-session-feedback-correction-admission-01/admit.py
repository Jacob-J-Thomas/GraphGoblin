from datetime import datetime, timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import subprocess

E = Path(r'G:/ggq/delivery-evidence/2026-11-17-five-intents')
O = Path(__file__).resolve().parent
HELPER = E / 'i5-d236-max-continuation-preparation-02/max-continuation.draft.py'
DECISION = E / 'i5-d241-review-correction-admission-01/decision-241.md'


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def pin(path):
    data = path.read_bytes()
    return {'source': str(path), 'bytes': len(data), 'sha256': sha256(data).hexdigest()}


def save(name, contents):
    with (O / name).open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(contents, stream, ensure_ascii=False, indent=2)
        stream.write('\n')


def need(condition, reason):
    if not condition:
        raise RuntimeError(reason)


def admit():
    manifest = read(O / 'MANIFEST.json')
    for name, wanted in manifest['members'].items():
        need(pin(O / name) == wanted, f'Prepared artifact changed: {name}')
    for wanted in manifest['inputs']:
        need(pin(Path(wanted['source'])) == wanted, 'Pinned preparation input changed')
    c = read(O / 'correction.draft.json')
    need(c['rootAdmitted'] is False and c['singleOwner'] is None and c['brief'] is None,
         'Expected unarmed correction draft')
    need(c['scope'] == 'D236-ordinary-max-continuation' and c['role'] == 'ui-author'
         and c['model'] == 'claude-opus-5-5' and c['effort'] == 'xhigh', 'Unexpected author role')
    need(pin(HELPER)['sha256'] == '636679ad6e298c47cc7ca5bbe2d3b04ef5ab73a4b7fbc23e76128235c8222a36',
         'Accepted Max controller changed')
    need(pin(DECISION)['sha256'] == '9a0350be88de71e24fd685074047be3a046ff2e1b1c64da7b849a44ea16d296c',
         'D241 decision changed')
    for role in ('rootCoreReview', 'independentAcceptance', 'gitBinary'):
        need(pin(Path(c[role]['source'])) == c[role], f'Pinned role input differs: {role}')
    core = read(Path(c['rootCoreReview']['source']))
    source = core['source']
    need(c['source'] == source and core['rootAcceptedActualClaudeCoreReview'] is True
         and core['model'] == 'claude-fable-5-2' and core['effort'] == 'xhigh'
         and core['rootRuntimeAdmitted'] is False, 'Invalid three-file core rebind')
    w = Path(c['checkout'])
    env = os.environ | {'GIT_OPTIONAL_LOCKS': '0', 'GIT_NO_LAZY_FETCH': '1'}

    def git(*args):
        return subprocess.check_output([c['gitBinary']['source'], '--no-optional-locks', '-C', str(w), *args], env=env)

    head = git('rev-list', '--parents', '-1', 'HEAD').decode('ascii').split()
    tree = git('rev-parse', 'HEAD^{tree}').decode('ascii').strip()
    need(head == [source['head'], *source['parents']] and tree == source['tree']
         and not git('status', '--porcelain=v1', '-z', '--untracked-files=all'),
         'Exact clean correction checkout required')
    need(len(c['allowedReadPaths']) == 75 and len(c['allowedWritePaths']) == 15
         and all((w / name).resolve(strict=True) == w / name for name in c['allowedReadPaths']),
         'Literal read/write roster changed or input unavailable')
    for name, expected in c['corePins'].items():
        need(pin(w / name) == expected and sha256(git('cat-file', 'blob', source['head'] + ':' + name)).hexdigest() == expected['sha256'],
             f'Protected core differs: {name}')
    index = (w / git('rev-parse', '--git-path', 'index').decode('utf-8').strip()).resolve()
    common = (w / git('rev-parse', '--git-common-dir').decode('utf-8').strip()).resolve()
    need(pin(index) == core['visibleCandidateState']['worktreeIndexUnchanged']
         and not os.path.lexists(common / 'index'), 'Unexpected index state')
    owner_lock = E / 'i5-d236-max-continuation-owner.lock'
    need(not os.path.lexists(owner_lock) and not os.path.lexists(Path(c['output'])),
         'Existing task owner or occupied correction output')
    brief = O / 'BRIEF.md'
    need(brief.is_file() and bool(brief.read_text(encoding='utf-8').strip()), 'Root-authored review correction brief required')
    c['brief'] = pin(brief)
    need(not (O / 'owner.json').exists() and not (O / 'correction.admitted.json').exists(),
         'Admission or owner receipt already exists')

    # Capture only identities and print-mode flags. Leave unrelated interactive sessions alone.
    ps = r"""$rows = @(Get-CimInstance Win32_Process -Filter "Name = 'claude.exe'" | ForEach-Object {
        if (-not $_.CommandLine -or -not $_.CreationDate) { throw 'Claude process identity is incomplete' }
        [pscustomobject]@{ pid=$_.ProcessId; parent=$_.ParentProcessId;
        created=$_.CreationDate.ToUniversalTime().ToString('o');
        isPrint=($_.CommandLine -match '(?:^|\s)--print(?:\s|$)') }
    })
    ConvertTo-Json -InputObject $rows -Compress"""
    observed = json.loads(subprocess.check_output(['pwsh', '-NoProfile', '-Command', ps]).decode('utf-8'))
    need(isinstance(observed, list) and all(row['isPrint'] is False for row in observed)
         and not os.path.lexists(owner_lock), 'Existing print worker prevents single-owner admission')
    save('owner.json', {
        'utc': datetime.now(timezone.utc).isoformat(), 'scope': c['scope'], 'role': c['role'], 'source': source,
        'rootExclusiveOwner': True, 'noOtherOwnedWorker': True, 'observedClaude': observed,
        'limit': 'Task-local ordinary Max handoff. Interactive identities remain untouched. No account-wide or descendant closure claim.',
    })
    c['singleOwner'] = pin(O / 'owner.json')
    c['rootAdmitted'] = True
    save('correction.admitted.json', c)
    print(json.dumps({'source': source, 'config': pin(O / 'correction.admitted.json'),
                      'helper': pin(HELPER), 'providerCalled': False}))


if __name__ == '__main__':
    admit()
