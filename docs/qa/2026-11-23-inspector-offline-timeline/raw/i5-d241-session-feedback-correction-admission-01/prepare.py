from datetime import datetime, timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import subprocess

E = Path('G:/ggq/delivery-evidence/2026-11-17-five-intents')
O = Path(__file__).resolve().parent
OLD = E / 'i5-d241-residual-correction-admission-01'
W = Path('G:/ggq/gg-i5-offline-inspector/GraphGoblin')
GIT = 'C:/Program Files/Git/cmd/git.exe'

def pin(path):
    data = path.read_bytes()
    return {'source': str(path), 'bytes': len(data), 'sha256': sha256(data).hexdigest()}

def read(path):
    return json.loads(path.read_text(encoding='utf-8'))

def save(name, value):
    with (O / name).open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(value, stream, indent=2, ensure_ascii=False)
        stream.write('\n')

def git(*args):
    return subprocess.check_output([GIT, '--no-optional-locks', '-C', str(W), *args], env=os.environ | {'GIT_OPTIONAL_LOCKS': '0', 'GIT_NO_LAZY_FETCH': '1'})

freeze_path = E / 'i5-d241-residual-corrected-freeze-01/FREEZE.json'
assert pin(freeze_path)['sha256'] == '24b361c15b8d64d9090d8c1420ee84dd6f01c075e91cb9a0b1b46e3fc26317bf'
source = read(freeze_path)['source']
assert git('rev-list', '--parents', '-1', 'HEAD').decode().split() == [source['head'], *source['parents']]
assert git('rev-parse', 'HEAD^{tree}').decode().strip() == source['tree']
assert not git('status', '--porcelain=v1', '-z', '--untracked-files=all')
core = read(OLD / 'CORE-REVIEW-REBIND.json')
core['source'] = source
core['rebindingUtc'] = datetime.now(timezone.utc).isoformat()
core['rebindingVerifiedBy'] = 'root; protected source and Git blob equality through d8; session-feedback UI correction only'
for name, expected in core['coreBlobEquality'].items():
    assert pin(W / name)['sha256'] == expected['sha256']
    assert git('rev-parse', 'HEAD:' + name).decode().strip() == expected['reviewedBlob'] == expected['candidateBlob']
    assert sha256(git('cat-file', 'blob', 'HEAD:' + name)).hexdigest() == expected['sha256']
state = core['visibleCandidateState']
index_path = Path(state['worktreeIndexUnchanged']['source'])
state['worktreeIndexUnchanged'] = pin(index_path)
assert state['worktreeIndexUnchanged']['sha256'] == '1ee2483f37d0136ff97206aeef0186d7ecb0aa3cd53eb5ec39ea59914b68d84b'
common = (W / git('rev-parse', '--git-common-dir').decode().strip()).resolve()
assert not os.path.lexists(common / 'index')
for expected in state['unchangedDependencyControlPins'].values():
    actual = pin(Path(expected['source']))
    assert actual['sha256'] == expected['sha256'] and actual['bytes'] == expected['bytes']
save('CORE-REVIEW-REBIND.json', core)
c = read(OLD / 'correction.draft.json')
c['source'] = source
c['output'] = str(E / 'i5-d241-actual-max-session-feedback-correction-01')
c['rootCoreReview'] = pin(O / 'CORE-REVIEW-REBIND.json')
assert c['rootAdmitted'] is False and c['singleOwner'] is None and c['brief'] is None
save('correction.draft.json', c)
assert pin(OLD / 'admit.py')['sha256'] == '0acc9f6369501315cf8c7f2e37235182554149629048b2b2bc30668326e86c1c'
with (O / 'admit.py').open('xb') as out:
    out.write((OLD / 'admit.py').read_bytes())
save('MANIFEST.json', {
    'members': {name: pin(O / name) for name in ['prepare.py', 'admit.py', 'correction.draft.json', 'CORE-REVIEW-REBIND.json', 'DECISION.md', 'BRIEF.md']},
    'inputs': [pin(path) for path in [
        OLD / 'admit.py', OLD / 'correction.draft.json', OLD / 'CORE-REVIEW-REBIND.json', freeze_path,
        E / 'i5-416-420-targeted-review-02/REPORT.md',
        E / 'i5-d240-max-core-root-acceptance-01/ACCEPTANCE.json',
        E / 'i5-d236-max-continuation-preparation-02/max-continuation.draft.py',
        E / 'i5-d241-review-correction-admission-01/decision-241.md',
        E / 'i5-d241-feedback-render-diagnostic-qa-03/DOM-DIAGNOSTICS.raw.json',
        E / 'i5-d241-feedback-render-diagnostic-qa-03/DOM-DIAGNOSTICS.summary.json',
        E / 'i5-d241-feedback-render-diagnostic-qa-03/PHASE-RECEIPT.json',
        E / 'i5-d241-feedback-render-diagnostic-qa-03/06-diagnostic63.stderr.log',
    ]],
    'briefOnlyWritePaths': [
        'apps/web/src/runs/RunInspectorPage.tsx',
        'apps/web/src/runs/inspector/SessionRecoveryControls.tsx',
        'apps/web/src/runs/RunInspectorPage.offline.test.tsx',
        'apps/web/src/runs/inspector/SessionRecoveryControls.test.tsx',
        'docs/09-frontend-and-pwa.md', 'CHANGELOG.md',
    ],
    'ownerReceiptCreated': False, 'admissionExecuted': False, 'providerCalled': False,
    'pending': 'Root must execute unchanged admission immediately before the ordinary Max controller. No whole-candidate acceptance.',
})
print(json.dumps({'prepared': pin(O / 'MANIFEST.json'), 'source': source, 'providerCalled': False}))
