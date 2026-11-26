import csv
import hashlib
import json
import os
from pathlib import Path
import subprocess
from zipfile import ZipFile

E = Path('G:/ggq/delivery-evidence/2026-11-17-five-intents')
OUT = Path(__file__).resolve().parent
W = Path('G:/ggq/gg-macos-current-main/GraphGoblin')
I = E / 'mac-post-564-integration-01'
A = E / 'mac-post-564-local-admission-01'
D = E / 'mac-post-564-local-admission-decision-01'
S = E / 'i5-d242-core-delivery-supplement-01'
HEAD = 'd91386a7509a77db4bccdab6f95a3d01e730ad50'
MAC = '4690b5493390df6bac8ba16cadfd23a1c56bc6ca'
TARGET = 'd2df8600c2c8574bec420947de686b936910b245'
commands = []

def sha(data):
    return hashlib.sha256(data).hexdigest()

def pin(p):
    raw = Path(p).read_bytes()
    return {'source': str(p), 'bytes': len(raw), 'sha256': sha(raw)}

def read(p):
    return json.loads(Path(p).read_text(encoding='utf-8-sig'))

def save(name, data):
    with (OUT / name).open('x', encoding='utf-8', newline='\n') as f:
        json.dump(data, f, indent=2)
        f.write('\n')

def git(*args):
    argv = ['C:/Program Files/Git/cmd/git.exe', '--no-optional-locks', '-C', str(W), *args]
    p = subprocess.run(argv, env=dict(os.environ, GIT_OPTIONAL_LOCKS='0'), capture_output=True, check=True)
    commands.append({'argv': argv, 'exit': p.returncode, 'stdoutBytes': len(p.stdout), 'stdoutSha256': sha(p.stdout), 'stderrBytes': len(p.stderr), 'stderrSha256': sha(p.stderr)})
    return p.stdout

def text(*args):
    return git(*args).decode('utf-8').strip()

def entries(commit):
    result = {}
    for row in git('ls-tree', '-r', '-z', commit).split(b'\0'):
        if row:
            meta, name = row.split(b'\t', 1)
            result[name.decode('utf-8')] = tuple(meta.decode('ascii').split())
    return result

freeze = read(I / 'FREEZE.json')
proof = read(I / 'STAGED-PROOF.json')
resolution = read(I / 'RESOLUTION-AND-SUPPLEMENT.json')
cohort = read(A / 'SOURCE-COHORT.json')
binding = read(A / 'ROOT-BINDING.json')
index_path = Path(freeze['indexPath'])
common = Path(text('rev-parse', '--path-format=absolute', '--git-common-dir'))
def boundary():
    return {'head': text('rev-parse', 'HEAD'), 'tree': text('rev-parse', 'HEAD^{tree}'), 'index': pin(index_path), 'stagedEntriesSha256': sha(git('ls-files', '--stage', '-z')), 'commonIndexExists': (common / 'index').exists(), 'commonHeadSha256': sha((common / 'HEAD').read_bytes()), 'localMainRef': text('rev-parse', 'refs/heads/main'), 'lock': pin(W / 'pnpm-lock.yaml'), 'modules': pin(W / 'node_modules/.modules.yaml')}
before = boundary()
assert before['head'] == HEAD and before['tree'] == 'b7f195c32652729270960b0e4cb08557e500ee28'
assert before['index']['sha256'] == freeze['indexSha256']
assert before['stagedEntriesSha256'] == freeze['stagedEntriesSha256']
assert before['commonIndexExists'] is False and before['commonHeadSha256'] == freeze['commonHeadSha256']
assert before['localMainRef'] == freeze['mainRef']
assert before['lock']['sha256'] == freeze['lockSha256'] and before['modules']['sha256'] == freeze['modulesSha256']
parents = text('show', '-s', '--format=%P', HEAD).split()
assert parents == freeze['parents'] == [MAC, TARGET]
base = text('merge-base', MAC, TARGET)
assert base == '0f6c325becf3e3e0562ae69dfae2c42bcf1d7129'
trees = {name: entries(commit) for name, commit in [('base', base), ('mac', MAC), ('target', TARGET), ('integrated', HEAD)]}
b, m, t, current = (trees[k] for k in ('base', 'mac', 'target', 'integrated'))
mac_changed = {p for p in b.keys() | m.keys() if b.get(p) != m.get(p)}
target_changed = {p for p in b.keys() | t.keys() if b.get(p) != t.get(p)}
shared = mac_changed & target_changed
assert shared == {'.gitattributes', '.prettierignore', 'CHANGELOG.md', 'docs/09-frontend-and-pwa.md'}
manual = set(proof['manualPaths'])
assert manual == shared | {'docs/delivery/2026-11-17-five-intents-register.md'}
rows = list(csv.DictReader((S / 'COPY-PLAN.csv').read_text(encoding='utf-8-sig').splitlines()))
archive_paths = {r['repository_relative_destination'] for r in rows}
assert len(rows) == len(archive_paths) == 65
expected = {}
for p in b.keys() | m.keys() | t.keys():
    if p in manual:
        continue
    if p in mac_changed and p in target_changed:
        assert m.get(p) == t.get(p), p
    value = m.get(p) if p in mac_changed else t.get(p)
    if value is not None:
        expected[p] = value
for p, value in expected.items():
    assert current.get(p) == value, p
assert set(current) == set(expected) | manual | archive_paths
archive_readback = []
for r in rows:
    p = r['repository_relative_destination']
    if '!' in r['source']:
        archive, member = r['source'].split('!', 1)
        with ZipFile(archive) as bundle:
            raw = bundle.read(member.lstrip('/\\').replace('\\', '/'))
    else:
        raw = Path(r['source']).read_bytes()
    assert len(raw) == int(r['bytes']) and sha(raw) == r['sha256']
    blob = hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()
    assert current[p] == ('100644', 'blob', blob), p
    assert (W / p).read_bytes() == raw, p
    archive_readback.append({'path': p, 'blob': blob, 'bytes': len(raw), 'sha256': sha(raw)})
physical_cohort = []
assert cohort['head'] == HEAD
for p, expected_pin in cohort['files'].items():
    actual_pin = pin(W / p)
    assert (actual_pin['bytes'], actual_pin['sha256']) == (expected_pin['bytes'], expected_pin['sha256']), p
    assert current[p] == (expected_pin['mode'], 'blob', expected_pin['blob']), p
    physical_cohort.append({'path': p, **expected_pin})
manual_readback = []
for record in resolution['resolution']:
    p = record['path']
    conflicted_path = I / ({'.gitattributes': 'gitattributes.conflicted.raw', '.prettierignore': 'prettierignore.conflicted.raw', 'CHANGELOG.md': 'CHANGELOG.md.conflicted.raw'}[p])
    raw = conflicted_path.read_bytes()
    assert sha(raw) == record['conflictedSha256']
    union = b''.join(b'\n' if line.startswith(b'=======') else b'' if line.startswith((b'<<<<<<<', b'>>>>>>>')) else line for line in raw.splitlines(keepends=True))
    assert sha(union) == record['unionSha256'], p
    actual = git('show', HEAD + ':' + p)
    if p == 'CHANGELOG.md':
        assert actual == union
    else:
        addition = (S / ('gitattributes.additions.txt' if p == '.gitattributes' else 'prettierignore.additions.txt')).read_bytes()
        assert actual == union + b'\n' + addition, p
    assert (W / p).read_bytes() == actual
    manual_readback.append({'path': p, 'conflictMarkerRemovalAndBothSidesExact': True, 'unionSha256': sha(union), 'finalSha256': sha(actual), 'onlySupplementRulesAddedAfterUnion': p != 'CHANGELOG.md'})
doc = 'docs/09-frontend-and-pwa.md'
normalize = lambda raw: b'\n'.join(line for line in raw.splitlines() if not line.startswith(b'index '))
assert normalize(git('diff', base, MAC, '--', doc)) == normalize(git('diff', TARGET, HEAD, '--', doc))
reg = 'docs/delivery/2026-11-17-five-intents-register.md'
old_reg = git('show', TARGET + ':' + reg)
new_reg = git('show', HEAD + ':' + reg)
fragment = (S / 'REGISTER-FRAGMENT.draft.md').read_bytes()
assert new_reg == old_reg + b'\n' + fragment
web_tree = text('rev-parse', HEAD + ':apps/web')
assert web_tree == text('rev-parse', TARGET + ':apps/web') == proof['appsWebTree'] == 'c2f489343ef414c67c7b750ec7245f50364126d0'
mac_native_paths = {p for p in m if p.startswith('apps/macos-launcher/')}
assert all(current[p] == m[p] for p in mac_native_paths)
hosted_paths = ['.github/workflows/ci.yml', 'apps/api/src/main.test.ts', 'apps/api/src/testing/api-subprocess.ts', 'apps/api/src/config.ts', 'apps/api/src/container.ts', 'apps/api/vitest.config.ts', 'apps/api/package.json', 'package.json']
extra_pins = []
for p in hosted_paths:
    assert current[p] == m[p], p
    raw = git('show', HEAD + ':' + p)
    assert (W / p).read_bytes() == raw
    extra_pins.append({'path': p, 'blob': current[p][2], 'bytes': len(raw), 'sha256': sha(raw)})
api_args = next(g['argv'] for g in binding['gates'] if g['label'] == '02-api')
web_args = next(g['argv'] for g in binding['gates'] if g['label'] == '03-web')
api_files = [x for x in api_args if x.endswith('.test.ts')]
web_files = [x for x in web_args if x.endswith('.test.ts') or x.endswith('.test.tsx')]
assert len(api_files) == 11 and 'src/main.test.ts' not in api_files
assert len(web_files) == 9
assert api_args[-2:] == web_args[-2:] == ['--maxWorkers=1', '--retry=0']
after = boundary()
assert after == before
inputs = [I / n for n in ['STAGED-PROOF.json', 'RESOLUTION-AND-SUPPLEMENT.json', 'FREEZE.json', 'gitattributes.conflicted.raw', 'prettierignore.conflicted.raw', 'CHANGELOG.md.conflicted.raw']]
inputs += [D / 'DECISION.md', D / 'ROOT-SOURCE-PINS.json', A / 'SOURCE-COHORT.json', A / 'ROOT-ADMISSION.json', A / 'ROOT-BINDING.json']
inputs += [S / n for n in ['COPY-PLAN.csv', 'SUPPLEMENT-SEAL.json', 'REGISTER-FRAGMENT.draft.md', 'gitattributes.additions.txt', 'prettierignore.additions.txt']]
save('READBACK.json', {'scope': 'Independent read-only source composition and D243 placement metadata; no tests, Git mutations, provider or GUI activity', 'head': HEAD, 'tree': before['tree'], 'parents': parents, 'mergeBase': base, 'entryCounts': {k: len(v) for k,v in trees.items()}, 'sharedChangedPaths': sorted(shared), 'manualPaths': sorted(manual), 'runtimeOverlapOrManualRuntimeConflictPaths': [], 'nonmanualParentObjectsMatched': len(expected), 'archiveCopiesExactInGitAndPhysical': archive_readback, 'physicalCohortExact': physical_cohort, 'manualUnionReadback': manual_readback, 'docs09ExactMacDeltaOnTarget': True, 'registerExactTargetBytesPlusSupplementFragment': True, 'appsWebTree': web_tree, 'targetAppsWebTree': web_tree, 'macNativeParentObjectsExact': len(mac_native_paths), 'hostedAndStartupPathsUnchangedFromMacParent': extra_pins, 'localApi11': api_files, 'localWeb9': web_files, 'workers': 1, 'retry': 0, 'before': before, 'after': after, 'boundaryUnchanged': True, 'inputPins': [pin(p) for p in inputs], 'commandReceipts': commands, 'limits': ['No local checks run or assessed here; root checks were active.', 'Physical equality covers the40-file supplied cohort, eight additional paths and65 archive destinations; the full tree result is Git object equality, not a full filesystem presence inventory.', 'No observed provider connection, universal network-isolation claim, native Mac GUI acceptance or final/general Astra audit.']})
print(json.dumps({'entries': len(current), 'cohort': len(physical_cohort), 'nonmanual': len(expected), 'archive': len(rows), 'nativeMacPaths': len(mac_native_paths), 'shared': sorted(shared), 'readback': pin(OUT / 'READBACK.json')}))
