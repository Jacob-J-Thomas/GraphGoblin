"""Create a targeted helper revision; preserve the original helper/prep hashes."""
from pathlib import Path
import ast
import difflib
import hashlib
import json
import runpy

OUT = Path(__file__).resolve().parent
original = OUT / 'integrate.py'
raw = original.read_bytes()
sha = lambda b: hashlib.sha256(b).hexdigest()
assert sha(raw) == '8b2029921ae3827951931f6ea9157c699e1873700fffa75d095820325a2a7b98'
source = raw.decode()
function = '''def sparse_scope():
    rows = git('ls-files', '-t', '-z', '--', *sorted(COMBINED)).split(b'\\0')[:-1]
    flags = {}
    for row in rows:
        flag, path = row[:1].decode(), row[2:].decode()
        require(path in COMBINED and flag != 'S', 'Combined path is outside sparse scope: ' + path)
        flags.setdefault(path, []).append(flag)
    require(set(flags) == COMBINED, 'A combined path is not present in the owned index')
    for path in COMBINED:
        require((REPO / path).is_file() and not (REPO / path).is_symlink(), 'Combined path is not an existing regular worktree file: ' + path)
    pattern = Path(git('rev-parse', '--path-format=absolute', '--git-path', 'info/sparse-checkout').decode().strip())
    data = pattern.read_bytes() if pattern.is_file() else b''
    return {'patternPath': str(pattern), 'patternExists': pattern.is_file(), 'patternBytes': len(data), 'patternSha256': sha(data),
        'combinedPathFlags': {p: sorted(v) for p, v in sorted(flags.items())}, 'allSixExistingPathsInScope': True,
        'scope': 'Targeted six-path admission only; no archive payload/materialization traversal and no sparse expansion'}

'''
assert source.count('def target_guard():') == 1
source = source.replace('def target_guard():', function + 'def target_guard():')
old = "    target_guard()\n    require(snapshot()['head'] == ours and snapshot()['clean'], 'Owned delivery head/index is not the admitted clean phase input')"
new = "    target_guard()\n    sparse_before = sparse_scope()\n    require(sparse_before['patternSha256'] == cfg['initialSparsePatternSha256'], 'Sparse-pattern bytes changed before phase')\n    require(snapshot()['head'] == ours and snapshot()['clean'], 'Owned delivery head/index is not the admitted clean phase input')"
assert source.count(old) == 1
source = source.replace(old, new)
old = "    run_mutation(name + '-stage-combined-only', 'add', '--', *sorted(COMBINED))"
new = "    sparse_pre_stage = sparse_scope()\n    require(sparse_pre_stage['patternSha256'] == cfg['initialSparsePatternSha256'], 'Sparse-pattern bytes changed before staging')\n    run_mutation(name + '-stage-combined-only', 'add', '--', *sorted(COMBINED))"
assert source.count(old) == 1
source = source.replace(old, new)
old = "    put('execution/' + name + '-receipt.json', {**new, 'parents': [ours, theirs], 'base': base, 'proof': proof, 'testsBuildsProvidersPushPerformed': False})"
new = "    sparse_after = sparse_scope()\n    require(sparse_after['patternSha256'] == sparse_before['patternSha256'], 'Sparse-pattern bytes changed during phase')\n    put('execution/' + name + '-receipt.json', {**new, 'parents': [ours, theirs], 'base': base, 'proof': proof, 'sparseBefore': sparse_before, 'sparseAfter': sparse_after, 'noSparseExpansion': True, 'testsBuildsProvidersPushPerformed': False})"
assert source.count(old) == 1
source = source.replace(old, new)
old = "    target_guard()\n    result = {'delivery': initial,"
new = "    target_guard()\n    sparse = sparse_scope()\n    require(sparse['patternSha256'] == cfg['initialSparsePatternSha256'], 'Sparse-pattern bytes changed since root preparation')\n    result = {'sparseScope': sparse, 'delivery': initial,"
assert source.count(old) == 1
source = source.replace(old, new)
ast.parse(source)
revision = OUT / 'integrate-sparse-01.py'
with revision.open('xb') as stream:
    stream.write(source.encode())
with (OUT / 'sparse-revision.patch').open('xb') as stream:
    stream.write(''.join(difflib.unified_diff(raw.decode().splitlines(keepends=True), source.splitlines(keepends=True), fromfile='integrate.py', tofile='integrate-sparse-01.py', n=3)).encode())
oldns = runpy.run_path(str(original), run_name='old_preparation_definitions')
before = oldns['snapshot']()
ns = runpy.run_path(str(revision), run_name='sparse_preparation_definitions')
scope = ns['sparse_scope']()
assert all(flags == ['H'] for flags in scope['combinedPathFlags'].values())
decision = Path('C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/decision-209.md')
assert sha(decision.read_bytes()) == 'a85217e83b50daa3e7c3c0ceb97e51cebfd5703dfeaed0aa8bd9b5d5e5d82d7e'
cfg = json.loads((OUT / 'integration-config.draft.json').read_bytes())
cfg['documentationQualification']['decisionPath'] = str(decision)
cfg['documentationQualification']['decisionSha256'] = sha(decision.read_bytes())
cfg['documentationQualification']['publicDecision'] = 'https://github.com/Jacob-J-Thomas/GraphGoblin/issues/486#issuecomment-7066877917'
cfg['initialSparsePatternSha256'] = scope['patternSha256']
cfg['initialCombinedPathFlags'] = scope['combinedPathFlags']
cfg['helperRevision'] = revision.name
assert cfg['rootExecutionAuthorized'] is False
with (OUT / 'integration-config-D209.draft.json').open('xb') as stream:
    stream.write((json.dumps(cfg, indent=2) + '\n').encode())
after = oldns['snapshot']()
assert after == before
report = {'status': 'TARGETED_SPARSE_PREPARATION_COMPLETE_EXECUTION_NOT_AUTHORIZED',
    'originalHelperSha256': sha(raw), 'revision': revision.name, 'revisionSha256': sha(revision.read_bytes()), 'originalHelperUnchanged': original.read_bytes() == raw,
    'initialPreparationHashesPreserved': True, 'sparseScope': scope, 'deliveryHeadAndIndexUnchanged': True,
    'scope': 'No materialization rescans, sparse expansion, --sparse staging fallback or payload copies; only six existing path flags and sparse-pattern bytes',
    'D209': {'path': str(decision), 'sha256': sha(decision.read_bytes())}, 'evidenceCommitStillPending': True, 'executionAuthorized': False,
    'sourcePublicationAuthorQACheckoutsAccessed': False, 'noGitMutationsTestsBuildsProvidersPushOrGitHub': True}
with (OUT / 'sparse-revision-report.json').open('xb') as stream:
    stream.write((json.dumps(report, indent=2) + '\n').encode())
new_names = ['derive-sparse-revision.py', 'integrate-sparse-01.py', 'sparse-revision.patch', 'integration-config-D209.draft.json', 'sparse-revision-report.json']
members = []
for name in new_names:
    b = (OUT / name).read_bytes();members.append({'path': name, 'bytes': len(b), 'sha256': sha(b)})
with (OUT / 'SPARSE-REVISION-SHA256.json').open('xb') as stream:
    stream.write((json.dumps({'meaning': 'Separate targeted preparation revision; original helper/prep manifest retained unchanged', 'files': members}, indent=2) + '\n').encode())
print(json.dumps(report))
