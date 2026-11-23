from pathlib import Path
from hashlib import sha256
import json

E = Path('G:/ggq/delivery-evidence/2026-11-17-five-intents')
O = Path(__file__).resolve().parent
W = Path('G:/ggq/gg-i5-offline-inspector/GraphGoblin')
A = E / 'i5-d241-actual-max-residual-correction-01'

def read(p):
    return json.loads(p.read_text(encoding='utf-8'))

def pin(p):
    b = p.read_bytes()
    return {'bytes': len(b), 'sha256': sha256(b).hexdigest()}

c = read(O / 'BINDING.template.json')
freeze = read(E / 'i5-d241-final-correction-freeze-01/FREEZE.json')
raw = read(E / 'i5-d241-residual-correction-admission-01/AUTHOR-ROOT-READBACK.json')
assert c['rootAdmitted'] is False and c['expectedHead'] == freeze['source']['head'] == raw['source']['head']
pins = {name: pin(W / name) for name in freeze['files']}
assert sorted(name for name, value in pins.items() if value != freeze['files'][name]) == raw['changedPaths']
for name in raw['changedPaths']:
    before = raw['members'][name]
    assert pins[name]['sha256'] == before['sha256'] and pins[name]['bytes'] == before['bytes']
c.update(rootAdmitted=True, correctedAuthorFiles=pins, correctionPaths=raw['changedPaths'],
         expectedTestCount=229, allowScopedFormatting=True,
         closedEvidenceSha256={name: pin(A / name)['sha256'] for name in c['closedEvidenceSha256']})
with (O / 'BINDING.json').open('x', encoding='utf-8', newline='\n') as f:
    json.dump(c, f, indent=2)
    f.write('\n')
print(json.dumps({'binding': pin(O / 'BINDING.json'), 'expectedCases': 229, 'source': freeze['source'], 'executionStarted': False}))
