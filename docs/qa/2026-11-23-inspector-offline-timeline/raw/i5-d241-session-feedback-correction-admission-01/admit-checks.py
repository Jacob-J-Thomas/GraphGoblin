from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re

O = Path(__file__).resolve().parent
E = O.parent
W = Path('G:/ggq/gg-i5-offline-inspector/GraphGoblin')
A = E / 'i5-d241-actual-max-session-feedback-correction-01'
C = E / 'i5-d241-session-feedback-checks-01'

def read(p):
    return json.loads(p.read_text(encoding='utf-8'))

def pin(p):
    b = p.read_bytes()
    return {'path': str(p), 'bytes': len(b), 'sha256': sha256(b).hexdigest()}

def bare(p):
    value = pin(p)
    return {k: value[k] for k in ('bytes', 'sha256')}

def save(p, value):
    with p.open('x', encoding='utf-8', newline='\n') as f:
        json.dump(value, f, indent=2)
        f.write('\n')

assert pin(O / 'CAPTURE.json')['sha256'] == '38e13befba698b4cc8a9956053b465a5e7cfe3419cc020dd587f63d600f99588'
capture = read(O / 'CAPTURE.json')
freeze = read(E / 'i5-d241-residual-corrected-freeze-01/FREEZE.json')
assert capture['source'] == freeze['source']
for rel in capture['changedPaths']:
    assert bare(W / rel) == {k: capture['members'][rel][k] for k in ('bytes', 'sha256')}
for name, expected in capture['actualClaudeEvidence'].items():
    assert pin(A / name) == expected
patch = (O / 'raw-author/author.patch').read_text()
assert len(re.findall(r'^\+  it\(', patch, re.M)) == 4
assert not re.search(r'^-  it\(', patch, re.M)
record = {
    'utc': datetime.now(timezone.utc).isoformat(), 'source': capture['source'],
    'changedPaths': capture['changedPaths'], 'members': capture['members'],
    'actualClaudeEvidence': capture['actualClaudeEvidence'], 'capture': pin(O / 'CAPTURE.json'),
    'rootReadFullDiffAndOrdinaryReport': True, 'runtimeAcceptedForChecksOnly': True,
    'testsRunOnTheseBytes': False, 'expectedFocusedCases': 233, 'preservedExistingCases': 229,
    'scope': 'Page-owned session action above unchanged qualified-run presentation; per-visit pending/refusal; four new public-interface regressions, existing assertions retained and two docs updated. No core, layout, dependency or parked-scope implementation.',
    'limits': 'Ordinary author handoff is source reasoning, not executed proof. Its A-to-B-to-A no-double-send comment is not accepted as a universal already-dispatched guarantee: the existing per-visit gate fences queued dispatch, while navigation retires presentation ownership. No new cross-credential or cross-visit idempotency guarantee is claimed. Current static/focused, independent/native/coverage/CI/final audit gates remain.',
    'formatting': 'Mechanical scoped formatting is admitted after these exact raw author bytes were preserved; preserve first check output and formatter delta. No semantic correction is admitted by this flag.',
}
save(O / 'AUTHOR-ROOT-READBACK.json', record)
b = read(C / 'BINDING.template.json')
b['rootAdmitted'] = True
b['authorReadbackSha256'] = pin(O / 'AUTHOR-ROOT-READBACK.json')['sha256']
b['correctedAuthorFiles'] = {name: bare(W / name) for name in freeze['files']}
b['correctionPaths'] = capture['changedPaths']
b['expectedTestCount'] = 233
b['allowScopedFormatting'] = True
b['closedEvidenceSha256'] = {name: pin(A / name)['sha256'] for name in b['closedEvidenceSha256']}
save(C / 'BINDING.json', b)
print(json.dumps({'readback': pin(O / 'AUTHOR-ROOT-READBACK.json'), 'binding': pin(C / 'BINDING.json'), 'expectedTests': 233, 'testsRun': False}))
