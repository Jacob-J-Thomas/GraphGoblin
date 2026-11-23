from datetime import datetime, timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import subprocess
import sys

W = Path(r'G:/ggq/gg-i5-offline-inspector/GraphGoblin').resolve(strict=True)
E = Path(r'G:/ggq/delivery-evidence/2026-11-17-five-intents/i5-416-420-author-focused-01').resolve(strict=True)
STATIC = E.parent / 'i5-416-420-author-static-01'
CLOSURE = E.parent / 'i5-d240-actual-max-ui-author-01' / 'source-after.json'
NODE = Path(os.environ['USERPROFILE']) / '.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64'
ENV = os.environ | {'PATH': str(NODE) + os.pathsep + os.environ['PATH']}
SELECTION = (
    'src/runs/RunInspectorPage.offline.test.tsx',
    'src/runs/RunInspectorPage.corrective.test.tsx',
    'src/runs/HistoryEligibility.test.tsx',
    'src/runs/recovery-controls.test.tsx',
    'src/runs/RunInspectorPage.test.tsx',
    'src/runs/ScriptRecovery.test.tsx',
    'src/runs/inspector/SessionRecoveryControls.test.tsx',
    'src/runs/inspector/Timeline.test.tsx',
    'src/runs/inspector/WaitPanel.test.tsx',
    'src/api/queries.reconnect.test.tsx',
    'src/runs/inspector-read-provenance.test.ts',
)


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def pin(path):
    blob = path.read_bytes()
    return {'sha256': sha256(blob).hexdigest(), 'bytes': len(blob)}


def write(name, data):
    with (E / name).open('x', encoding='utf-8', newline='\n') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write('\n')


def check(closure, after):
    source = closure['snapshot']
    index = Path(source['index']['source'])
    return {
        'authors': {path: pin(W / path) for path in after['authors']},
        'selection': {path: pin(W / 'apps/web' / path) for path in SELECTION},
        'controls': {
            'index': pin(index),
            'lock': pin(Path(source['lock']['source'])),
            'modules': pin(Path(source['modules']['source'])),
            'virtualStoreLock': pin(W / 'node_modules/.pnpm/lock.yaml'),
            'core': {path: pin(W / path) for path in source['core']},
            'commonIndexPresent': (index.parent.parent.parent / 'index').exists(),
            'sourceAfter': pin(CLOSURE),
        },
    }


def main():
    assert len(SELECTION) == len(set(SELECTION)) == 11
    assert all((W / 'apps/web' / path).is_file() for path in SELECTION)
    static_result = read(STATIC / 'RESULT.json')
    assert static_result['staticAccepted']
    assert pin(STATIC / 'AFTER.json')['sha256'] == 'f2004a81f1005079b718a61d98810007fc446a59a15ed512a2d308df3f0f890b'
    assert pin(STATIC / 'RESULT.json')['sha256'] == 'c4c8ba04b6d6f2ea24bf59bb292dc1ebec2000c9b4a2c5fed3288812dba3e3ff'
    closure = read(CLOSURE)
    formatted = read(STATIC / 'AFTER.json')
    pre = check(closure, formatted)
    assert pre['authors'] == formatted['authors'] and pre['controls'] == formatted['controls']
    write('BEFORE.json', pre | {
        'staticAfter': pin(STATIC / 'AFTER.json'), 'staticResult': pin(STATIC / 'RESULT.json'),
        'firstSelectionPreflight': pin(E / 'FIRST-SELECTION-PREFLIGHT.json'),
        'sourceFromAuthorClosure': closure['snapshot']['source'],
    })
    cmd = os.environ['COMSPEC']
    node_version = subprocess.check_output([str(NODE / 'node.exe'), '--version'], cwd=W, env=ENV)
    pnpm_version = subprocess.check_output([cmd, '/d', '/s', '/c', 'pnpm.cmd --version'], cwd=W, env=ENV)
    assert node_version.strip() == b'v22.23.4' and pnpm_version.strip() == b'12.8.1'
    report = E / 'vitest-results.json'
    assert not report.exists()
    args = ['pnpm.cmd', '--filter', '@graphgoblin/web', 'exec', 'vitest', 'run', *SELECTION,
            '--maxWorkers=1', '--retry=0', '--reporter=verbose', '--reporter=json',
            '--outputFile.json=' + report.as_posix()]
    argv = [cmd, '/d', '/s', '/c', subprocess.list2cmdline(args)]
    start = datetime.now(timezone.utc).isoformat()
    with (E / 'vitest.stdout').open('xb') as stdout, (E / 'vitest.stderr').open('xb') as stderr:
        process = subprocess.run(argv, cwd=W, env=ENV, stdout=stdout, stderr=stderr, check=False)
    write('COMMAND.json', {'argv': argv, 'pnpmArgv': args, 'cwd': str(W),
                           'node': node_version.decode().strip(), 'pnpm': pnpm_version.decode().strip(),
                           'startedUtc': start, 'finishedUtc': datetime.now(timezone.utc).isoformat(),
                           'exit': process.returncode, 'stdout': pin(E / 'vitest.stdout'),
                           'stderr': pin(E / 'vitest.stderr'), 'report': pin(report) if report.is_file() else None})
    post = check(closure, formatted)
    write('AFTER.json', post)
    print('vitest exit', process.returncode, 'source and controls match', pre == post, flush=True)
    if not report.is_file():
        write('RESULT.json', {'exit': process.returncode, 'jsonReportPresent': False,
                              'sourceAndControlsUnchanged': pre == post,
                              'selectionComplete': False})
        return process.returncode or 1
    results = read(report)
    named = {str(Path(entry['name']).resolve().relative_to(W / 'apps/web')).replace('\\', '/')
             for entry in results['testResults']}
    summary = {k: v for k, v in results.items() if k.startswith('num') or k == 'success'}
    summary.update({'exit': process.returncode, 'jsonReportPresent': True,
                    'observedTestFiles': sorted(named), 'selectionComplete': named == set(SELECTION),
                    'sourceAndControlsUnchanged': pre == post})
    write('RESULT.json', summary)
    print('JSON counts', summary, flush=True)
    return process.returncode or (0 if pre == post and named == set(SELECTION) else 1)


if __name__ == '__main__':
    sys.exit(main())
