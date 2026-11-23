"""Root-bound finite D242 local checks; refuses an active/unclosed author."""
from datetime import datetime, timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import subprocess
import sys

E = Path(__file__).resolve().parent
W = Path('G:/ggq/gg-i5-offline-inspector/GraphGoblin')
AUTHOR = E.parent / 'i5-b2-remount-actual-max-author-01'
PRIOR = E.parent / 'i5-d241-session-feedback-checks-01/vitest-results.json'
GIT = 'C:/Program Files/Git/cmd/git.exe'
NODE_DIR = Path('C:/Users/98jak/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64')
HEAD = 'f64287619b499c14601e11bce3d1c6b5414b6227'
PATHS = (
    'CHANGELOG.md',
    'apps/web/src/runs/HistoryEligibility.test.tsx',
    'apps/web/src/runs/HistoryEligibility.tsx',
    'apps/web/src/runs/RunInspectorPage.offline.test.tsx',
    'apps/web/src/runs/RunInspectorPage.tsx',
    'apps/web/src/runs/ScriptRecovery.test.tsx',
    'apps/web/src/runs/inspector/ScriptRecovery.tsx',
    'docs/09-frontend-and-pwa.md',
)
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
    'src/runs/inspector/ExecutionEvidence.test.tsx',
    'src/runs/inspector/EvaluationDetails.test.tsx',
    'src/runs/RunInspectorPage.lifecycle.test.tsx',
)
PROTECTED = (
    'apps/web/src/api/queries.ts',
    'apps/web/src/runs/inspector-read-provenance.ts',
    'apps/web/src/runs/inspector-read-provenance.test.ts',
)


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def pin(path):
    data = Path(path).read_bytes()
    return {'bytes': len(data), 'sha256': sha256(data).hexdigest()}


def load(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def save(name, value):
    with (E / name).open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(value, stream, indent=2, ensure_ascii=False)
        stream.write('\n')


def git(*args):
    env = {key: value for key, value in os.environ.items() if not key.upper().startswith('GIT_')}
    env.update(GIT_OPTIONAL_LOCKS='0', GIT_NO_LAZY_FETCH='1')
    return subprocess.check_output([GIT, '--no-optional-locks', '-c', 'core.longpaths=true', *args], cwd=W, env=env)


def snapshot():
    git_dir = Path(git('rev-parse', '--absolute-git-dir').decode().strip())
    common = Path(git('rev-parse', '--path-format=absolute', '--git-common-dir').decode().strip())
    diff = git('diff', '--binary', 'HEAD', '--')
    return {
        'head': git('rev-parse', 'HEAD').decode().strip(),
        'index': pin(git_dir / 'index'),
        'commonIndexPresent': (common / 'index').exists(),
        'stagedDiffSha256': sha256(git('diff', '--cached', '--binary', '--')).hexdigest(),
        'diff': {'bytes': len(diff), 'sha256': sha256(diff).hexdigest()},
        'changedPaths': sorted(git('diff', '--name-only', 'HEAD', '--').decode().splitlines()),
        'untracked': git('ls-files', '--others', '--exclude-standard', '-z').decode().split('\0')[:-1],
        'files': {path: pin(W / path) for path in PATHS},
        'tests': {path: pin(W / 'apps/web' / path) for path in SELECTION},
        'controls': {path: pin(W / path) for path in (*PROTECTED, 'pnpm-lock.yaml', 'node_modules/.modules.yaml', 'node_modules/.pnpm/lock.yaml')},
    }


def run(label, argv, env):
    started = datetime.now(timezone.utc).isoformat()
    with (E / (label + '.stdout')).open('xb') as out, (E / (label + '.stderr')).open('xb') as err:
        result = subprocess.run(argv, cwd=W, env=env, stdout=out, stderr=err, check=False)
    record = {'argv': argv, 'cwd': str(W), 'startedUtc': started,
              'finishedUtc': datetime.now(timezone.utc).isoformat(), 'exit': result.returncode,
              'stdout': pin(E / (label + '.stdout')), 'stderr': pin(E / (label + '.stderr'))}
    save(label + '.json', record)
    print(label, result.returncode, flush=True)
    return result.returncode


def cases(report):
    result = {}
    for item in report['testResults']:
        path = Path(item['name']).resolve().relative_to(W / 'apps/web').as_posix()
        require(path not in result, 'Duplicate test file in report')
        result[path] = item['assertionResults']
    return result


def main():
    binding = load(E / 'ROOT-BINDING.json')
    require(binding.get('rootAdmitted') is True, 'Root admission absent')
    require(binding['runner'] == pin(Path(__file__)), 'Runner changed after root admission')
    require(not (E.parent / 'i5-d236-max-continuation-owner.lock').exists(), 'Provider owner lock remains')
    for name, expected in binding['authorClosure'].items():
        require(pin(AUTHOR / name) == expected, 'Author closure changed: ' + name)
    process = load(AUTHOR / 'process.json')
    closure = load(AUTHOR / 'source-after.json')
    require(process['directChildReaped'] and process['streamReadersFinished'] and not process['timeout']
            and process['originalFailure'] is None, 'Author did not close normally')
    require(closure['sourceAndControlsVerified'] and not closure['closureUncertainAtReadback'], 'Unverified author source')
    require(pin(PRIOR) == binding['priorReport'], 'Prior 233-case report changed')
    old = cases(load(PRIOR))
    old_names = {(path, row['fullName']) for path, rows in old.items() for row in rows}
    require(len(old_names) == 233 and set(old) == set(SELECTION)
            and all(row['status'] == 'passed' for rows in old.values() for row in rows), 'Unexpected prior roster')
    before = snapshot()
    require(before == binding['source'], 'Source differs from root binding')
    require(before['head'] == HEAD and not before['commonIndexPresent'] and not before['untracked'], 'Unexpected source state')
    require(before['changedPaths'] and set(before['changedPaths']) <= set(PATHS), 'Correction exceeds eight-path scope')
    require(before['stagedDiffSha256'] == sha256(b'').hexdigest(), 'Unexpected staged changes')
    save('BEFORE.json', before)
    env = os.environ | {'PATH': str(NODE_DIR) + os.pathsep + os.environ['PATH']}
    def pnpm(label, *args):
        return run(label, [os.environ['COMSPEC'], '/d', '/s', '/c', subprocess.list2cmdline(['pnpm.cmd', *args])], env)
    require(run('00-node', [str(NODE_DIR / 'node.exe'), '--version'], env) == 0, 'Node probe failed')
    require((E / '00-node.stdout').read_text().strip() == 'v22.23.4', 'Wrong Node version')
    require(pnpm('00-pnpm', '--version') == 0 and (E / '00-pnpm.stdout').read_text().strip() == '12.8.1', 'Wrong pnpm')
    static = {
        'typecheck': pnpm('01-typecheck', '--filter', '@graphgoblin/web', 'run', 'typecheck'),
        'eslint': pnpm('02-eslint', 'exec', 'eslint', *(path for path in PATHS if path.endswith('.tsx'))),
        'prettier': pnpm('03-prettier', 'exec', 'prettier', '--check', *PATHS),
    }
    after_static = snapshot()
    save('AFTER-STATIC.json', after_static)
    save('STATIC-RESULT.json', static | {'sourceUnchanged': after_static == before})
    if any(static.values()) or after_static != before:
        save('RESULT.json', {'staticPassed': False, 'focusedInvoked': False})
        return 1
    report_path = E / 'vitest-results.json'
    code = pnpm('04-focused', '--filter', '@graphgoblin/web', 'exec', 'vitest', 'run', *SELECTION,
                '--maxWorkers=1', '--retry=0', '--reporter=verbose', '--reporter=json', '--outputFile.json=' + report_path.as_posix())
    after = snapshot()
    save('AFTER.json', after)
    report = load(report_path) if report_path.exists() else None
    observed = cases(report) if report else {}
    names = {(path, row['fullName']) for path, rows in observed.items() for row in rows}
    rows = [row for values in observed.values() for row in values]
    passed = bool(code == 0 and report and report['success'] and set(observed) == set(SELECTION)
                  and old_names <= names and len(names) == len(rows) and len(rows) > 233
                  and all(row['status'] == 'passed' for row in rows) and after == before)
    save('RESULT.json', {'staticPassed': True, 'focusedInvoked': True, 'focusedExit': code,
                         'total': len(rows), 'passed': sum(row['status'] == 'passed' for row in rows),
                         'missingPriorCases': sorted(old_names - names), 'newCases': sorted(names - old_names),
                         'failures': [{'file': path, 'name': row['fullName'], 'messages': row.get('failureMessages', [])}
                                      for path, values in observed.items() for row in values if row['status'] != 'passed'],
                         'sourceUnchanged': before == after, 'allPassed': passed})
    return 0 if passed else 1


if __name__ == '__main__':
    sys.exit(main())
