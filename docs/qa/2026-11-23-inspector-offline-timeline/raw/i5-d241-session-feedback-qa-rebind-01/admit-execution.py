from datetime import datetime, timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import subprocess

P = Path(__file__).resolve().parent
E = P.parent
W = Path('G:/ggq/gg-i5-offline-ui-qa/GraphGoblin')
G = 'C:/Program Files/Git/cmd/git.exe'

def digest(p):
    return sha256(p.read_bytes()).hexdigest()

def read(p):
    return json.loads(p.read_text())

def git(*args):
    return subprocess.check_output([G, '--no-optional-locks', '-C', str(W), *args], env=os.environ | {'GIT_OPTIONAL_LOCKS': '0', 'GIT_NO_LAZY_FETCH': '1'})

def verify(folder, name, expected):
    p = folder / name
    assert digest(p) == expected
    entries = read(p)['members']
    rows = entries.items() if isinstance(entries, dict) else ((r['path'], r) for r in entries)
    count = 0
    for rel, item in rows:
        f = (folder / rel).resolve()
        assert f.is_relative_to(folder.resolve())
        assert f.stat().st_size == item['bytes'] and digest(f) == item['sha256'], rel
        count += 1
    return count

def save(p, value):
    with p.open('x', encoding='utf-8', newline='\n') as f:
        json.dump(value, f, indent=2)
        f.write('\n')

counts = [
    verify(P, 'MANIFEST.json', 'cff028e942196f37149a06d99fe4671439fa20020e4c432002864b197aab78f5'),
    verify(E / 'i5-d241-session-feedback-corrected-preparation-01', 'MANIFEST.json', '920a0e5fed8c1818af69a4294dcfe37c0d1b8e2963059c26c2dfa8a7bb3bfee8'),
    verify(E / 'i5-d241-session-feedback-checks-01', 'EXECUTION-MANIFEST.json', '67fcda88996a67176c088e5d39d58ff6c4e8d98fe9c679e270693b1393a483f4'),
]
assert counts == [17, 8, 45]
assert digest(P / 'ROOT-BINDING.unarmed.json') == '148862a722b0cc0b9d89d34c010f4f7ebd0337798b8885585fcbcf1c987f0dcf'
b = read(P / 'ROOT-BINDING.unarmed.json')
s = b['source']
assert git('rev-parse', 'HEAD').decode().strip() == s['head'] == 'a0ce7b781e333b70f4711b5e9201ef63c157df1d'
assert git('rev-parse', 'HEAD^{tree}').decode().strip() == s['tree'] == '3f47fed82c18930fc0a56bc8e2598e7190ba8f3c'
assert git('status', '--porcelain=v1', '--untracked-files=all').decode().splitlines() == s['status']
assert sha256(git('ls-files', '--stage', '-z')).hexdigest() == s['stagedEntriesSha256']
index = Path(git('rev-parse', '--path-format=absolute', '--git-path', 'index').decode().strip())
common = Path(git('rev-parse', '--path-format=absolute', '--git-common-dir').decode().strip())
assert digest(index) == s['indexSha256'] and not os.path.lexists(common / 'index')
for rel, expected in (s['selectedSources'] | b['overlays']).items():
    assert digest(W / rel) == expected, rel
freeze = E / 'i5-d241-session-feedback-corrected-freeze-01/FREEZE.json'
assert digest(freeze) == '777c5e8f9f3a2f6d2d4ef170b5992f3065a2bb1471a55d40d1671dc594fc3ed7'
frozen = read(freeze)
for rel, expected in (frozen['files'] | frozen['protectedCore']).items():
    assert digest(W / rel) == expected['sha256'], rel
old = read(E / 'i5-d241-feedback-render-diagnostic-qa-03/ROOT-BINDING.executed.json')
for group in ['rootInstallInputs19', 'independentInputs18', 'metadata', 'overlays', 'selectedModules', 'runtime', 'childEnvironmentControl']:
    assert b[group] == old[group], group
assert b['selection']['sameExactFixtureForBoth'] == '55a0c5a29f8f7dc6de1045d3d4858d790fdca548385237684ec3bbb5c6f31c3a'
assert b['selection']['fresh2']['selected'] == 2 and b['selection']['full63']['selected'] == 63
assert b['selection']['maxWorkers'] == 1 and b['selection']['retry'] == 0
assert not Path(b['executionDirectory']).exists()
admission = {
    'utc': datetime.now(timezone.utc).isoformat(), 'executionAdmitted': True,
    'verifiedManifestMembers': sum(counts), 'source': frozen['source'],
    'rootRead': ['FF report/plan and live binding', 'Actual233 result and four-test delta', 'Exact two mechanical format diffs', 'Unchanged two-phase runner delta and reporting plan'],
    'scope': 'One static phase, exact55 fresh2 and conditional separate full63, one worker/retry0 with unchanged limits and immediate strict assertions. Sole heavy slot assigned to independent QA until closure.',
    'additionalEvidence': 'Report captured replacement-button disabled state before old release, DOM identity/removal, oldPOST0, immediate/settled visible NotSent and one new explicit matching POST in each phase and variant. An unexpected observation is not waived by total pass count.',
    'preservedFailures': 'Original8a62/63, diagnostic55old62/63 and both static-only attempts remain unchanged.',
    'excluded': 'No product/fixture/source/index edit, further FF, build, native browser, provider, automatic retry or formal review pass.',
}
save(P / 'EXECUTION-ADMISSION.json', admission)
b['executionAdmitted'] = True
b['rootAdmission'] = {'path': str(P / 'EXECUTION-ADMISSION.json'), 'sha256': digest(P / 'EXECUTION-ADMISSION.json')}
b['rootInstructions'] = admission['scope'] + ' ' + admission['additionalEvidence'] + ' ' + admission['excluded']
save(P / 'ROOT-BINDING.admitted.json', b)
print(json.dumps({'binding': str(P / 'ROOT-BINDING.admitted.json'), 'sha256': digest(P / 'ROOT-BINDING.admitted.json'), 'membersVerified': sum(counts)}))
