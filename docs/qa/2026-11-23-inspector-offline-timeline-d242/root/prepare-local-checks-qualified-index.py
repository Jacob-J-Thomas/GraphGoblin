from datetime import datetime, timezone
from hashlib import sha256
import importlib.util
import json
import os
from pathlib import Path
import subprocess

E = Path(__file__).resolve().parent.parent
P = E / 'i5-d242-b2-focused-checks-01'
A = E / 'i5-b2-remount-actual-max-author-01'
O = E / 'i5-d242-b2-author-readback-01'
spec = importlib.util.spec_from_file_location('d242_checks', P / 'run-checks.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
def read(path):
    return json.loads(path.read_text(encoding='utf-8'))
def save(path, value):
    with path.open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')

assert not O.exists() and not (E / 'i5-d236-max-continuation-owner.lock').exists()
process, terminal, closure = (read(A / name) for name in ('process.json', 'terminal.json', 'source-after.json'))
assert process['directChildReaped'] and process['streamReadersFinished'] and not process['timeout']
assert process['originalFailure'] is None and not process['readerErrors'] and not process['cleanupErrors']
assert terminal['acceptedProcess'] and terminal['processExit'] == 0 and terminal['terminalCount'] == 1
assert terminal['streamComplete'] and terminal['subtype'] == 'success' and terminal['terminalReason'] == 'completed'
assert terminal['observedModels'] == terminal['modelUsage'] == ['claude-opus-5-5']
assert not terminal['protocolProblems'] and not terminal['harvestErrors'] and terminal['pendingToolRequests'] == 0
assert terminal['matchedToolResults'] == len(terminal['toolRequests']) == 83
assert closure['sourceAndControlsVerified'] and not closure['closureUncertainAtReadback']
assert closure['snapshot'] == closure['baseline'] and closure['changedPaths'] == list(m.PATHS)
before = m.snapshot()
assert before['head'] == m.HEAD and before['changedPaths'] == list(m.PATHS)
assert not before['commonIndexPresent'] and not before['untracked']
assert before['stagedDiffSha256'] == sha256(b'').hexdigest()
qualification_path = Path(__file__).resolve().parent / 'ROOT-INDEX-QUALIFICATION.json'
assert m.pin(qualification_path)['sha256'] == 'acb66395c7eb32afdeb308cc72be4f6134fc212dbd25ddfa22f6a28624dd9c11'
qualification = read(qualification_path)
assert qualification['rootAcceptedIndexQualificationForChecksOnly'] is True
assert qualification['controllerSnapshotIndex'] == {key: closure['snapshot']['index'][key] for key in ('bytes', 'sha256')}
assert before['index'] == qualification['currentIndex']
for name, wanted in closure['snapshot']['core'].items():
    assert before['controls'][name] == {key: wanted[key] for key in ('bytes', 'sha256')}
for name, role in (('pnpm-lock.yaml', 'lock'), ('node_modules/.modules.yaml', 'modules')):
    assert before['controls'][name] == {key: closure['snapshot'][role][key] for key in ('bytes', 'sha256')}
O.mkdir()
for name in m.PATHS:
    target = O / 'original' / name
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open('xb') as out:
        out.write((m.W / name).read_bytes())
    assert m.pin(target) == before['files'][name]
with (O / 'AUTHOR.patch').open('xb') as out:
    out.write(m.git('diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--binary', '--full-index', 'HEAD', '--'))
save(O / 'BEFORE-FORMAT.json', before)
env = os.environ | {'PATH': str(m.NODE_DIR) + os.pathsep + os.environ['PATH']}
assert subprocess.check_output([str(m.NODE_DIR / 'node.exe'), '--version'], env=env).decode().strip() == 'v22.23.4'
args = [os.environ['COMSPEC'], '/d', '/s', '/c', subprocess.list2cmdline(['pnpm.cmd', 'exec', 'prettier', '--write', *m.PATHS])]
started = datetime.now(timezone.utc).isoformat()
with (O / 'FORMAT.stdout').open('xb') as out, (O / 'FORMAT.stderr').open('xb') as err:
    result = subprocess.run(args, cwd=m.W, env=env, stdout=out, stderr=err, check=False)
save(O / 'FORMAT-COMMAND.json', {'argv': args, 'cwd': str(m.W), 'startedUtc': started,
                               'finishedUtc': datetime.now(timezone.utc).isoformat(), 'exit': result.returncode,
                               'stdout': m.pin(O / 'FORMAT.stdout'), 'stderr': m.pin(O / 'FORMAT.stderr')})
after = m.snapshot()
save(O / 'AFTER-FORMAT.json', after)
assert result.returncode == 0
assert all(before[key] == after[key] for key in ('head', 'index', 'commonIndexPresent', 'stagedDiffSha256', 'untracked', 'controls'))
assert after['changedPaths'] == list(m.PATHS)
assert all(before['tests'][name] == after['tests'][name] for name in m.SELECTION if 'apps/web/' + name not in m.PATHS)
with (O / 'FORMATTED.patch').open('xb') as out:
    out.write(m.git('diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--binary', '--full-index', 'HEAD', '--'))
author_refs = {name: m.pin(A / name) for name in ('process.json', 'terminal.json', 'source-after.json', 'ordinary-handoff.md')}
readback = {'utc': datetime.now(timezone.utc).isoformat(), 'runtimeAcceptedForChecksOnly': True,
            'originalClosure': author_refs, 'source': closure['snapshot']['source'], 'changedPaths': after['changedPaths'],
            'authorToolsPaired': 83, 'originalEightFilesPreserved': before['files'], 'formattedEightFiles': after['files'],
            'formatChangedPaths': [name for name in m.PATHS if before['files'][name] != after['files'][name]],
            'rootReadAllEightPathDiffsAndCompleteHandoff': True, 'testsRunOrProductAccepted': False,
            'expectedPriorCases': 233, 'expectedNewCasesFromSource': 11,
            'limits': ['Direct child and stream closure verified, descendant closure not claimed',
                       'Author source-only claims and design limitations retained for scoped Fable assessment']}
readback['indexQualification'] = m.pin(qualification_path)
readback['indexByteIdenticalToAuthorSnapshot'] = False
save(O / 'ROOT-READBACK.json', readback)
binding = {'rootAdmitted': True, 'runner': m.pin(P / 'run-checks.py'), 'source': after,
           'authorClosure': author_refs, 'priorReport': m.pin(m.PRIOR), 'rootReadback': m.pin(O / 'ROOT-READBACK.json')}
save(P / 'ROOT-BINDING.json', binding)
print(json.dumps({'readback': m.pin(O / 'ROOT-READBACK.json'), 'binding': m.pin(P / 'ROOT-BINDING.json'),
                  'formatChangedPaths': readback['formatChangedPaths'], 'checksAdmitted': True}))
