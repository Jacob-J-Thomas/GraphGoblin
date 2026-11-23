from datetime import datetime, timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import subprocess

O = Path(__file__).resolve().parent
E = O.parent
W = Path('G:/ggq/gg-i5-offline-inspector/GraphGoblin')
A = E / 'i5-d241-actual-max-session-feedback-correction-01'
FREEZE = E / 'i5-d241-residual-corrected-freeze-01/FREEZE.json'
PRIOR_CHECK = E / 'i5-d241-final-residual-checks-01/AFTER.json'
CONFIG = O / 'correction.admitted.json'
GIT = Path('C:/Program Files/Git/cmd/git.exe')
SCOPE = {
    'CHANGELOG.md',
    'apps/web/src/runs/RunInspectorPage.offline.test.tsx',
    'apps/web/src/runs/RunInspectorPage.tsx',
    'apps/web/src/runs/inspector/SessionRecoveryControls.test.tsx',
    'apps/web/src/runs/inspector/SessionRecoveryControls.tsx',
    'docs/09-frontend-and-pwa.md',
}
EVIDENCE = ('ordinary-handoff.md', 'process.json', 'terminal.json', 'source-after.json')
EXACT_CORE = {
    'apps/web/src/api/queries.ts',
    'apps/web/src/runs/inspector-read-provenance.test.ts',
    'apps/web/src/runs/inspector-read-provenance.ts',
}


def need(ok, reason):
    if not ok:
        raise RuntimeError(reason)


def content_pin(data):
    return {'bytes': len(data), 'sha256': sha256(data).hexdigest()}


def bare_pin(record):
    return {key: record[key] for key in ('bytes', 'sha256')}


def pin(path):
    return {'path': str(path), **content_pin(path.read_bytes())}


def pinned_json(path, expected):
    data = path.read_bytes()
    need(content_pin(data)['sha256'] == expected, f'Changed prerequisite {path.name}')
    return json.loads(data.decode('utf-8'))


def git(*args):
    env = {name: value for name, value in os.environ.items() if not name.upper().startswith('GIT_')}
    env.update(GIT_OPTIONAL_LOCKS='0', GIT_NO_LAZY_FETCH='1')
    return subprocess.check_output([str(GIT), '--no-optional-locks', '-C', str(W), *args], env=env)


def git_path(*args):
    return (W / git('rev-parse', *args).decode('utf-8').strip()).resolve()


def changed_paths(expected_source):
    head_and_parents = git('rev-list', '--parents', '-1', 'HEAD').decode('ascii').split()
    tree = git('rev-parse', 'HEAD^{tree}').decode('ascii').strip()
    need(head_and_parents == [expected_source['head'], *expected_source['parents']]
         and tree == expected_source['tree'], 'Checkout is not at the exact correction base')
    need(not git('diff', '--cached', '--name-only', '-z') and
         not git('ls-files', '--others', '--exclude-standard', '-z'), 'Staged or untracked source detected')
    data = git('diff', '--no-ext-diff', '--no-textconv', '--name-only', '-z').decode('utf-8')
    return sorted(data.split('\0')[:-1])


def control_pins(snapshot, freeze, prior):
    index = git_path('--git-path', 'index')
    common = git_path('--git-common-dir')
    need(not os.path.lexists(common / 'index'), 'Shared common index is present')
    paths = {'index': index, 'lock': W / 'pnpm-lock.yaml', 'modules': W / 'node_modules/.modules.yaml',
             'virtualStoreLock': W / 'node_modules/.pnpm/lock.yaml'}
    actual = {key: pin(path) for key, path in paths.items()}
    for name in ('index', 'lock', 'modules'):
        wanted = snapshot[name]
        need(paths[name] == Path(wanted['source']) and bare_pin(actual[name]) == bare_pin(wanted),
             f'{name} differs from the controller source snapshot')
    need(bare_pin(actual['index']) == bare_pin(freeze['index']), 'Index differs from the frozen base')
    for name in ('lock', 'modules', 'virtualStoreLock'):
        need(bare_pin(actual[name]) == prior[name], f'{name} differs from the prior closed check')
    need(set(snapshot['core']) == set(freeze['protectedCore']) == EXACT_CORE, 'Unexpected protected core roster')
    core = {name: pin(W / name) for name in sorted(EXACT_CORE)}
    for name in core:
        wanted = snapshot['core'][name]
        need(W / name == Path(wanted['source']) and bare_pin(core[name]) == bare_pin(wanted)
             == freeze['protectedCore'][name] == prior['core'][name], f'Protected file differs at {name}')
    return actual | {'core': core, 'commonIndexPresent': False}


def main():
    raw = O / 'raw-author'
    capture = O / 'CAPTURE.json'
    need(not os.path.lexists(raw) and not os.path.lexists(capture), 'Capture output already exists')
    freeze = pinned_json(FREEZE, '24b361c15b8d64d9090d8c1420ee84dd6f01c075e91cb9a0b1b46e3fc26317bf')
    prior = pinned_json(PRIOR_CHECK, '63ef8963898b4c99f4a95c0c4082b64b56f8b5fd07d239e491b41dc046be9cda')['controls']
    admitted = pinned_json(CONFIG, 'eaab8a281b5b50563ec4d256036f9f865bca3ff615570630b70e52555af3601b')
    need(admitted['rootAdmitted'] is True and admitted['source'] == freeze['source'] and freeze['clean'] is True
         and Path(admitted['checkout']) == W and Path(admitted['output']) == A
         and admitted['role'] == 'ui-author' and admitted['model'] == 'claude-opus-5-5'
         and admitted['effort'] == 'xhigh' and SCOPE <= set(admitted['allowedWritePaths']),
         'Unexpected root-admitted role, source or file scope')

    evidence = {name: pin(A / name) for name in EVIDENCE}
    closed = pinned_json(A / 'source-after.json', evidence['source-after.json']['sha256'])
    terminal = pinned_json(A / 'terminal.json', evidence['terminal.json']['sha256'])
    process = pinned_json(A / 'process.json', evidence['process.json']['sha256'])
    need(evidence['ordinary-handoff.md']['bytes'] > 0, 'Expected a retained ordinary handoff')
    need(closed['snapshotAttempted'] is True and closed['visibleChangesAttempted'] is True
         and closed['sourceAndControlsVerified'] is True and closed['closureUncertainAtReadback'] is False
         and closed['baseline'] == closed['snapshot'] and closed['snapshot']['source'] == freeze['source'],
         'Controller source or control closure is unverified')
    need(process['directChildReaped'] is True and process['streamReadersFinished'] is True
         and process['directHandleStopIssued'] is False and process['timeout'] is False
         and process['stdoutTruncated'] is False and process['originalFailure'] is None
         and not process['readerErrors'] and not process['cleanupErrors']
         and process['auth'] == 'claude.ai firstParty max'
         and all(process[key] == admitted[key] for key in ('role', 'model', 'effort')),
         'Expected normally closed, direct-child ordinary Max execution')
    need(terminal['acceptedProcess'] is True and terminal['streamComplete'] is True
         and terminal['terminalCount'] == 1 and terminal['processExit'] == 0
         and terminal['terminalReason'] == 'completed' and terminal['subtype'] == 'success'
         and terminal['isError'] is False and terminal['observedModels'] == [admitted['model']]
         and terminal['source'] == freeze['source'] and terminal['role'] == admitted['role']
         and not terminal['harvestErrors'] and not terminal['protocolProblems']
         and terminal['rootOwnershipCheckRequired'] is False,
         'Controller terminal did not pass')
    requests = terminal['toolRequests']
    matched = terminal['matchedToolResults']
    pending = terminal['pendingToolRequests']
    need(isinstance(requests, list) and type(matched) is int and type(pending) is int
         and len(requests) == matched and pending == 0, 'Tool requests and results are not fully paired')

    need(Path(admitted['gitBinary']['source']) == GIT and
         bare_pin(pin(GIT)) == bare_pin(admitted['gitBinary']), 'Git executable differs from admission')
    expected_source = closed['snapshot']['source']
    changes = changed_paths(expected_source)
    need(changes and len(changes) == len(set(changes)) and set(changes) <= SCOPE
         and changes == sorted(closed['changedPaths']), 'Worktree changes differ from the closed six-path scope')
    edit_paths = {row['path'] for row in requests if row['tool'] in ('Edit', 'Write')}
    need(set(changes) <= edit_paths <= SCOPE, 'Observed tool writes differ from the admitted scope')
    before = control_pins(closed['snapshot'], freeze, prior)

    raw.mkdir()
    members = {}
    for name in changes:
        live = W / name
        need(live.resolve(strict=True) == live and live.is_file(), f'Changed file is redirected or absent: {name}')
        saved = raw / name
        saved.parent.mkdir(parents=True, exist_ok=True)
        content = live.read_bytes()
        with saved.open('xb') as stream:
            stream.write(content)
        members[name] = pin(saved)
        need(bare_pin(members[name]) == content_pin(content), f'Capture readback differs at {name}')
    diff_args = ('diff', '--no-ext-diff', '--no-textconv', '--binary')
    patch = git(*diff_args)
    need(bool(patch), 'Missing binary-capable Git patch')
    with (raw / 'author.patch').open('xb') as stream:
        stream.write(patch)
    members['author.patch'] = pin(raw / 'author.patch')
    need(changed_paths(expected_source) == changes
         and control_pins(closed['snapshot'], freeze, prior) == before
         and all(bare_pin(pin(W / name)) == bare_pin(members[name]) for name in changes)
         and git(*diff_args) == patch
         and bare_pin(members['author.patch']) == content_pin(patch)
         and {name: pin(A / name) for name in EVIDENCE} == evidence,
         'Source, captured patch or controller evidence changed during capture')

    record = {'utc': datetime.now(timezone.utc).isoformat(), 'source': expected_source,
              'changedPaths': changes, 'members': members, 'controls': before,
              'actualClaudeEvidence': evidence, 'admittedConfig': pin(CONFIG),
              'terminal': {'processExit': terminal['processExit'], 'terminalReason': terminal['terminalReason'],
                           'toolRequests': len(requests), 'matchedToolResults': matched,
                           'pendingToolRequests': pending, 'protocolProblems': len(terminal['protocolProblems']),
                           'directChildReaped': process['directChildReaped'],
                           'streamReadersFinished': process['streamReadersFinished'],
                           'descendantClosureVerified': process['descendantClosureVerified']}}
    with capture.open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(record, stream, indent=2)
        stream.write('\n')
    print(json.dumps({'capture': pin(capture), 'changedPaths': changes, 'toolPairs': matched}))


if __name__ == '__main__':
    main()
