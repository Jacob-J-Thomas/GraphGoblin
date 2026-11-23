from datetime import datetime, timezone
from hashlib import sha256
import importlib.util
import json
import os
from pathlib import Path
import subprocess

E = Path(__file__).resolve().parent.parent
C = E / 'i5-d242-b2-focused-checks-02'
F = E / 'i5-d242-b2-corrected-freeze-01'
spec = importlib.util.spec_from_file_location('checks', C / 'run-checks.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
def read(path):
    return json.loads(path.read_text(encoding='utf-8'))
def save(path, value):
    with path.open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')
def copy(path, data):
    with path.open('xb') as out:
        out.write(data)
env = {key: value for key, value in os.environ.items() if not key.upper().startswith('GIT_')}
env.update(GIT_OPTIONAL_LOCKS='0', GIT_NO_LAZY_FETCH='1', PATH=str(m.NODE_DIR) + os.pathsep + os.environ['PATH'])
git_args = [m.GIT, '--no-optional-locks', '-c', 'core.longpaths=true', '-C', str(m.W)]
def git(*args):
    return subprocess.check_output(git_args + list(args), env=env)
def run(label, args):
    started = datetime.now(timezone.utc).isoformat()
    with (F / (label + '.stdout')).open('xb') as out, (F / (label + '.stderr')).open('xb') as err:
        result = subprocess.run(git_args + args, env=env, stdout=out, stderr=err, check=False)
    save(F / (label + '.json'), {'argv': git_args + args, 'startedUtc': started,
                               'finishedUtc': datetime.now(timezone.utc).isoformat(), 'exit': result.returncode,
                               'stdout': m.pin(F / (label + '.stdout')), 'stderr': m.pin(F / (label + '.stderr'))})
    assert result.returncode == 0, label

result = read(C / 'RESULT.json')
assert result['allPassed'] and result['staticPassed'] and result['total'] == result['passed'] == 244
assert not result['missingPriorCases'] and len(result['newCases']) == 11 and result['sourceUnchanged']
assert not F.exists() and not (E / 'i5-d236-max-continuation-owner.lock').exists()
before = m.snapshot()
assert before == read(C / 'AFTER.json') and before['head'] == m.HEAD
assert before['changedPaths'] == list(m.PATHS) and not before['untracked'] and not before['commonIndexPresent']
assert before['stagedDiffSha256'] == sha256(b'').hexdigest()
index = Path(git('rev-parse', '--path-format=absolute', '--git-path', 'index').decode().strip())
F.mkdir()
save(F / 'BEFORE.json', before)
copy(F / 'index.before.raw', index.read_bytes())
copy(F / 'correction.before-commit.patch', git('diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--binary', '--full-index', 'HEAD', '--'))
run('stage', ['add', '--sparse', '--', *m.PATHS])
staged = sorted(git('diff', '--cached', '--name-only', '-z').decode().split('\0')[:-1])
assert staged == list(m.PATHS)
assert not git('diff', '--name-only', '-z')
for name in m.PATHS:
    blob = git('show', ':' + name)
    assert {'bytes': len(blob), 'sha256': sha256(blob).hexdigest()} == before['files'][name]
run('commit', ['commit', '-m', 'Keep inspector actions owned through withheld run sections'])
source = {'head': git('rev-parse', 'HEAD').decode().strip(), 'tree': git('rev-parse', 'HEAD^{tree}').decode().strip(),
          'parents': git('show', '-s', '--format=%P', 'HEAD').decode().strip().split()}
assert source['parents'] == [m.HEAD]
assert not git('status', '--porcelain=v1', '--untracked-files=all')
assert sorted(git('diff', '--name-only', '-z', m.HEAD, source['head']).decode().split('\0')[:-1]) == list(m.PATHS)
after = m.snapshot()
assert after['files'] == before['files'] and after['tests'] == before['tests'] and after['controls'] == before['controls']
assert not after['commonIndexPresent'] and not after['changedPaths'] and not after['untracked']
copy(F / 'index.after.raw', index.read_bytes())
copy(F / 'correction.patch', git('diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--binary', '--full-index', m.HEAD, source['head']))
save(F / 'AFTER.json', after)
archive = 'docs/qa/2026-11-23-inspector-offline-timeline'
archive_trees = git('rev-parse', m.HEAD + ':' + archive, source['head'] + ':' + archive).decode().splitlines()
assert len(archive_trees) == 2 and archive_trees[0] == archive_trees[1]
freeze = {'utc': datetime.now(timezone.utc).isoformat(), 'source': source, 'beforeHead': m.HEAD,
          'files': after['files'], 'protectedCore': {name: after['controls'][name] for name in m.PROTECTED},
          'index': {'source': str(index), **after['index']},
          'dependencies': {name: after['controls'][name] for name in ('pnpm-lock.yaml', 'node_modules/.modules.yaml', 'node_modules/.pnpm/lock.yaml')},
          'correctedPaths': list(m.PATHS), 'gitBlobs': {name: git('rev-parse', 'HEAD:' + name).decode().strip() for name in m.PATHS},
          'patch': m.pin(F / 'correction.patch'), 'focusedResult': m.pin(C / 'RESULT.json'),
          'focusedAfter': m.pin(C / 'AFTER.json'), 'focusedTestsPassed': 244,
          'previousArchiveTreeUnchanged': archive_trees[0],
          'localFreezeOnly': True, 'published': False, 'independentQaAndFablePending': True,
          'currentCiAndMergePending': True, 'ownerAcceptance': False}
save(F / 'FREEZE.json', freeze)
print(json.dumps({'source': source, 'freeze': m.pin(F / 'FREEZE.json'), 'patch': freeze['patch'], 'focusedTestsPassed': 244}))
