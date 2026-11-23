"""Materialize one root-admitted D242 ordinary Max review config, without launching it."""
from datetime import datetime, timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import subprocess
import time

P = Path(__file__).resolve().parent
E = P.parent
Q = Path('C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents')
DECISION = E / 'i5-d242-b2-remount-correction-01/DECISION.md'
FINDING = Q / 'i5-564-final-astra-max-03/REPORT.md'
PRIOR_CORE = E / 'i5-b2-remount-max-preparation-01/CORE-REVIEW-REBIND.json'
BEFORE = 'f64287619b499c14601e11bce3d1c6b5414b6227'
LOCK = E / 'i5-d236-max-continuation-owner.lock'
HELPER = P / 'fable-correction.draft.py'


def need(ok, message):
    if not ok:
        raise RuntimeError(message)


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def content_pin(data):
    return {'bytes': len(data), 'sha256': sha256(data).hexdigest()}


def pin(path):
    return {'source': str(path), **content_pin(path.read_bytes())}


def save(name, value):
    with (P / name).open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(value, stream, indent=2, ensure_ascii=False)
        stream.write('\n')


def public(ref, exact=None):
    path = Path(ref['source'])
    need(path.is_absolute() and path.resolve(strict=True) == path and path.is_file()
         and (path.is_relative_to(E) or path.is_relative_to(Q))
         and not any(part.casefold().startswith('private') for part in path.parts)
         and (exact is None or path == exact), 'Expected exact public evidence path')
    need(ref['bytes'] > 0 and pin(path) == ref, f'Public evidence changed: {path.name}')
    return path


def closed_processes():
    ps = r"""$rows = @(Get-CimInstance Win32_Process -Filter "Name = 'claude.exe'" | ForEach-Object {
        if (-not $_.CommandLine -or -not $_.CreationDate) { throw 'Claude process identity is incomplete' }
        [pscustomobject]@{ pid=$_.ProcessId; parent=$_.ParentProcessId;
        created=$_.CreationDate.ToUniversalTime().ToString('o');
        isPrint=($_.CommandLine -match '(?:^|\s)(?:-p|--print)(?:\s|$)') }
    })
    ConvertTo-Json -InputObject $rows -Compress"""
    return json.loads(subprocess.check_output(['pwsh', '-NoProfile', '-Command', ps], timeout=30).decode('utf-8'))


def admit():
    binding_path = P / 'ROOT-ADMISSION.json'
    need(binding_path.is_file(), 'Actual D242 root admission is absent')
    binding = read(binding_path)
    need(binding['rootAdmitted'] is True and binding['apiRouteAuthorized'] is False
         and binding['rootVerifiedClosedAuthorAndQa'] is True and binding['beforeHead'] == BEFORE
         and time.time() >= 1795417200, 'D242 runtime admission is unset')
    manifest = read(P / 'MANIFEST.json')
    for name, expected in manifest['members'].items():
        need(pin(P / name) == expected, f'Preparation member changed: {name}')
    for expected in manifest['references']:
        need(pin(Path(expected['source'])) == expected, 'Preparation lineage changed')

    fixed = read(P / 'FIXED-CONTROLS.json')
    c = read(P / 'fable-review.unarmed.json')
    need(c['rootAdmitted'] is False and c['apiRouteAuthorized'] is False and c['singleOwner'] is None
         and c['allowedWritePaths'] == [] and c['model'] == 'claude-fable-5-2' and c['effort'] == 'xhigh'
         and c['scope'] == 'D242-ordinary-max-b2-correction-assessment' and c['role'] == 'b2-correction-review',
         'Unarmed review template changed')
    need(pin(HELPER) == binding['controller'], 'Exact controller changed')
    need(pin(DECISION)['sha256'] == 'fde33cf9501704239af7e45de22b68785b09163f34e5438f97658f3a95b234ec',
         'D242 decision changed')
    need(public(binding['decision'], DECISION) == DECISION, 'Expected D242 decision')
    need(pin(public(binding['findingReport'], FINDING))['sha256'] ==
         '9cb4a10d6241abfa9f6d9dc1711ac44fd8ec412eef03fe6778933fd067e6a61b',
         'Original final audit report has changed')
    patch = public(binding['correctionPatch'])
    public(binding['brief'], P / 'BRIEF.md')
    for key in ('authorClosure', 'focusedQaReport', 'independentQaReport', 'targetReadback'):
        public(binding[key])
    acceptance = read(public(binding['independentAcceptance'],
                             E / 'i5-d242-fable-correction-independent-01/ACCEPTANCE.json'))
    need(acceptance['scope'] == c['scope'] and acceptance['role'] == c['role']
         and acceptance['mechanicsAccepted'] is True and acceptance['actualRuntimeAdmission'] is False
         and acceptance['readOnly'] is True and acceptance['authorRoleRejected'] is True
         and acceptance['controllerSha256'] == binding['controller']['sha256'],
         'Fresh independent mechanics acceptance is missing')
    for name in ('claudeBinary', 'gitBinary'):
        expected = fixed[name]
        need(binding[name] == expected and pin(Path(expected['source'])) == expected,
             f'Pinned local binary changed: {name}')

    output = Path(c['output'])
    need(output.parent == E and not any(os.path.lexists(path) for path in
         (output, LOCK, P / 'owner.json', P / 'fable-review.admitted.json', P / 'ADMISSION.json')),
         'Existing lock, owner, admission or output')
    w = Path(c['checkout'])
    env = {key: val for key, val in os.environ.items() if not key.upper().startswith('GIT_')}
    env.update(GIT_OPTIONAL_LOCKS='0', GIT_NO_LAZY_FETCH='1')

    def git(*args):
        return subprocess.check_output([fixed['gitBinary']['source'], '--no-optional-locks', '-C', str(w), *args],
                                       env=env, stderr=subprocess.PIPE, timeout=30)

    def git_path(*args):
        return (w / git('rev-parse', *args).decode('utf-8').strip()).resolve()

    source = binding['source']
    target = binding['target']
    need(set(source) == {'head', 'tree', 'parents'} and source['head'] != BEFORE
         and isinstance(source['parents'], list) and bool(source['parents'])
         and all(isinstance(v, str) and re.fullmatch(r'[0-9a-f]{40}', v)
                 for v in (source['head'], source['tree'], *source['parents'], target)),
         'Exact corrected source or target is missing')
    need(git('rev-list', '--parents', '-1', 'HEAD').decode('ascii').split() == [source['head'], *source['parents']]
         and git('rev-parse', 'HEAD^{tree}').decode('ascii').strip() == source['tree']
         and not git('status', '--porcelain=v1', '-z', '--untracked-files=all')
         and not os.path.lexists(git_path('--git-path', 'MERGE_HEAD')), 'Exact clean frozen source required')
    need(git('merge-base', BEFORE, source['head']).decode('ascii').strip() == BEFORE,
         'Corrected source is outside the held range')
    index = git_path('--git-path', 'index')
    common = git_path('--git-common-dir')
    need(pin(index) == binding['index'] and not os.path.lexists(common / 'index'), 'Index binding differs')
    dependencies = read(PRIOR_CORE)['visibleCandidateState']['unchangedDependencyControlPins']
    need(binding['dependencies'] == dependencies, 'Expected held source dependency pins')
    for wanted in dependencies.values():
        need(pin(Path(wanted['source'])) == wanted, 'Dependency control changed')
    for name, expected in fixed['protectedCore'].items():
        need(pin(w / name) == expected
             and git('rev-parse', 'HEAD:' + name).decode('ascii').strip() == fixed['reviewedCoreBlobs'][name],
             f'Protected core differs: {name}')

    flags = ('diff', '--no-ext-diff', '--no-textconv', '--no-renames')
    changes = set(git(*flags, '--name-only', '-z', BEFORE, source['head']).decode('utf-8').split('\0')[:-1])
    need(changes and changes <= set(fixed['correctionPaths']) and changes == set(binding['changedFilePins']),
         'Visible patch does not match the named eight-path correction envelope')
    candidate_patch = git(*flags, '--binary', '--full-index', BEFORE, source['head'])
    need(bool(candidate_patch) and content_pin(candidate_patch) ==
         {k: binding['correctionPatch'][k] for k in ('bytes', 'sha256')},
         'Scoped Git patch differs from root preservation')

    def blob(revision, name):
        key = revision + ':' + name
        return {'blob': git('rev-parse', key).decode('ascii').strip(),
                **content_pin(git('cat-file', 'blob', key))}

    for name, expected in binding['changedFilePins'].items():
        need(expected == {'before': blob(BEFORE, name), 'after': blob(source['head'], name)},
             f'Before/after blob binding differs: {name}')
    reads = binding['allowedReadPaths']
    need(isinstance(reads, list) and all(isinstance(name, str) for name in reads), 'Expected literal read list')
    need(len(reads) == len(set(reads)) and
         set(fixed['correctionPaths']) | set(fixed['protectedCore']) <= set(reads) <= set(fixed['allowedReadCeiling'])
         and set(reads) == set(binding['readFilePins']), 'Read roster differs from exact review boundary')
    for name in reads:
        path = w / name
        expected = binding['readFilePins'][name]
        need(path.resolve(strict=True) == path and path.is_file() and blob(source['head'], name) == expected
             and content_pin(path.read_bytes()) == {k: expected[k] for k in ('bytes', 'sha256')},
             f'Bound review input differs: {name}')

    observed = closed_processes()
    need(isinstance(observed, list) and all(row['isPrint'] is False for row in observed)
         and not os.path.lexists(LOCK) and not os.path.lexists(output), 'Existing task owner or print worker')

    owner = {'utc': datetime.now(timezone.utc).isoformat(), 'scope': c['scope'], 'role': c['role'],
             'source': source, 'rootExclusiveOwner': True, 'noOtherOwnedWorker': True,
             'observedClaude': observed, 'limit': 'Task-local ordinary Max. Unrelated interactive processes remain untouched.'}
    save('owner.json', owner)
    c.update(rootAdmitted=True, source=source, allowedReadPaths=reads, corePins=fixed['protectedCore'],
             brief=binding['brief'], singleOwner=pin(P / 'owner.json'),
             independentAcceptance=binding['independentAcceptance'],
             claudeBinary=binding['claudeBinary'], gitBinary=binding['gitBinary'])
    save('fable-review.admitted.json', c)
    receipt = {'utc': owner['utc'], 'source': source, 'target': target, 'beforeHead': BEFORE,
               'rootBinding': pin(binding_path), 'config': pin(P / 'fable-review.admitted.json'),
               'controller': pin(HELPER), 'patch': pin(patch), 'changedPaths': sorted(changes),
               'apiRouteAuthorized': False, 'providerCalledByAdmission': False}
    save('ADMISSION.json', receipt)
    print(json.dumps(receipt))


if __name__ == '__main__':
    admit()
