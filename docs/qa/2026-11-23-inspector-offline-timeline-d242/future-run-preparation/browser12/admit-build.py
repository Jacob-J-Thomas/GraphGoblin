from pathlib import Path
from hashlib import sha256
import json
import subprocess
import os
from datetime import datetime, timezone

E = Path('G:/ggq/delivery-evidence/2026-11-17-five-intents')
O = Path(__file__).resolve().parent
W = Path('G:/ggq/gg-i5-offline-ui-qa/GraphGoblin')

def read(p):
    return json.loads(p.read_text(encoding='utf-8'))

def digest(p):
    return sha256(p.read_bytes()).hexdigest()

def git(*args):
    return subprocess.check_output(['C:/Program Files/Git/cmd/git.exe', '--no-optional-locks', '-C', str(W), *args], env=os.environ | {'GIT_OPTIONAL_LOCKS': '0'}).decode().strip()

inputs = read(O / 'ROOT-ADMISSION-INPUTS.json')
assert inputs['rootAdmitted'] is True and inputs['rootReadFullDerivativeDeltaAndPlan'] is True
for role in ('freeze', 'focusedManifest'):
    assert isinstance(inputs[role]['path'], str) and Path(inputs[role]['path']).is_absolute()
    assert digest(Path(inputs[role]['path'])) == inputs[role]['sha256']
freeze_path = Path(inputs['freeze']['path'])
freeze = read(freeze_path)
qa = Path(inputs['independentQa']['folder'])
assert qa.is_absolute() and digest(qa / 'MANIFEST.json') == inputs['independentQa']['manifestSha256']
assert read(qa / 'FRESH2-SELECTION.json')['passed'] == 2
assert read(qa / 'FULL63-SELECTION.json')['passed'] == 63
receipt = read(qa / 'PHASE-RECEIPT.json')
assert receipt['stageReached'] == 'completed' and receipt['failure'] is None and receipt['afterMatchesRootBinding'] is True
assert read(qa / 'ROOT-BINDING.executed.json')['source']['head'] == freeze['source']['head']
assert digest(O / 'PREPARATION-MANIFEST.json') == inputs['preparationManifestSha256']
count = 0
for folder, file in [(O, 'PREPARATION-MANIFEST.json'), (Path(inputs['focusedManifest']['path']).parent, Path(inputs['focusedManifest']['path']).name), (qa, 'MANIFEST.json')]:
    members = read(folder / file)['members']
    items = members.items() if isinstance(members, dict) else ((m['path'], m) for m in members)
    for rel, expected in items:
        p = folder / rel
        assert p.stat().st_size == expected['bytes'] and digest(p) == expected['sha256'], rel
        count += 1
assert digest(O / 'run-browser12.py') == read(O / 'PREPARATION-MANIFEST.json')['members']['run-browser12.py']['sha256']
b = read(O / 'SOURCE-BINDING.template.json')
assert b['rootAdmitted'] is False and b['source'] == {'head': None, 'tree': None, 'parents': None}
b['source'] = freeze['source']
b['freeze'] = inputs['freeze']
b['advanceRef'] = inputs['advanceRef']
if b['advanceRef'] is not None:
    assert digest(Path(b['advanceRef']['path'])) == b['advanceRef']['sha256']
assert git('rev-parse', 'HEAD') == freeze['source']['head'] and git('rev-parse', 'HEAD^{tree}') == freeze['source']['tree']
assert not git('diff', '--name-only') and not git('diff', '--cached', '--name-only')
for rel, expected in (freeze['files'] | freeze['protectedCore']).items():
    if b['sourceFiles'].get(rel) is not None:
        assert b['sourceFiles'][rel] == expected['sha256'], rel
    b['sourceFiles'][rel] = expected['sha256']
    assert digest(W / rel) == expected['sha256']
assert all(isinstance(value, str) and len(value) == 64 for value in b['sourceFiles'].values())
for rel, expected in b['overlays'].items():
    assert digest(W / rel) == expected
dist = W / 'apps/web/dist'
assert W.resolve(strict=True) == W and dist.resolve(strict=True) == dist and dist.is_dir()
assert not dist.is_symlink() and dist.lstat().st_file_attributes & 0x400 == 0
index = (W / git('rev-parse', '--git-path', 'index')).resolve()
b['indexSha256'] = digest(index)
assert b['indexSha256'] == inputs['expectedUIQAIndexSha256']
assert not os.path.lexists((W / git('rev-parse', '--git-common-dir')).resolve() / 'index')
b['rootAdmitted'] = True
b['rebuildFromPreviousManifestSha256'] = '4b63d8a4907641c011fb65822595ed688b6412ee0871dfcd7222f4cd217e13d6'
b['rootBuildAdmission'] = {
    'utc': datetime.now(timezone.utc).isoformat(), 'preparedMembersRehashed': count,
    'literalWorkingDistVerified': str(dist), 'rootReadFullDerivativeDeltaAndPlan': True,
    'condition': 'Run only after the independently owned fresh2/full63 phase closes and releases the heavy slot. Build admission only; separate browser admission requires successful fresh build and its manifest.',
    'scope': 'Ordinary pnpm build in this disposable checkout, preserving verified prior retained distribution; no manual deletion, dependency install or owner-instance action.'}
with (O / 'SOURCE-BINDING.json').open('x', encoding='utf-8', newline='\n') as f:
    json.dump(b, f, indent=2)
    f.write('\n')
print(json.dumps({'bindingSha256': digest(O / 'SOURCE-BINDING.json'), 'membersVerified': count, 'buildStarted': False}))
