from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path

P = Path(__file__).resolve().parent
E = P.parent
N = E / 'i5-416-420-post-feedback-browser12-execution-01'

def read(p):
    return json.loads(p.read_text(encoding='utf-8'))

def pin(p):
    b = p.read_bytes()
    return {'bytes': len(b), 'sha256': sha256(b).hexdigest()}

checks = []
for name, expected in [('BUILD-EVIDENCE-MANIFEST.json', 'a961a80342fac5df844860a4d25f9c612839fba01b3dcc17102b7f91c20033ae'),
                       ('BROWSER-EVIDENCE-MANIFEST.json', '71a94997e85298bcbc1144ac8ed98d8d9d110e1136fcc5ffc183968a589ac959')]:
    assert pin(N / name)['sha256'] == expected
    seal = read(N / name)
    for path, record in seal['members'].items():
        assert pin(N / path) == record, path
    checks.append({'manifest': name, 'sha256': expected, 'verifiedMembers': len(seal['members'])})
comparison = read(N / 'G1-THREE-WAY.json')
assert comparison['currentAndPriorMetricsIdenticalAll12'] and len(comparison['cells']) == 12
sources = {}
for role, record in comparison['sources'].items():
    source = (N if role == 'currentA0' else E) / record['path']
    assert pin(source) == {k: record[k] for k in ('bytes', 'sha256')}
    sources[role] = {(m['width'], m['textScale'], m['seq']): m for m in read(source)['measurements']}
for cell in comparison['cells']:
    key = (cell['width'], cell['textScale'], cell['sequence'])
    for role in sources:
        m = sources[role][key]
        actual = {'documentScrollWidth': m['viewport']['scrollWidth'], 'bodyScrollWidth': m['viewport']['bodyScrollWidth'],
                  'outsideVisibleTextRanges': len(m['viewport']['visibleTextOutsideViewport']), 'overlaps': len(m['overlaps']),
                  'sequenceClips': len(m['number']['clipping']), 'eventTypeClips': len(m['type']['clipping']),
                  'sequenceFontPx': m['number']['fontSize'], 'eventTypeFontPx': m['type']['fontSize']}
        assert actual == cell[role], (key, role)
    assert cell['currentA0'] == cell['prior223']
    assert cell['currentA0']['overlaps'] == cell['currentA0']['sequenceClips'] == cell['currentA0']['eventTypeClips'] == 0
    assert cell['baseline0f']['overlaps'] == 1
result = read(N / 'BROWSER-RESULT.json')
assert result['exit'] == 1 and result['browserPassed'] is False
assert result['playwrightStats']['expected'] == 11 and result['playwrightStats']['unexpected'] == 1
assert result['sourceUnchanged'] and result['buildDistUnchanged'] and result['ownedDistRestored']
assert result['geometry']['strictMatrixComplete']
api = read(N / 'BROWSER-API-READBACK.json')
assert len(api['cases']) == 12 and sum(c['status'] == 'passed' for c in api['cases']) == 11
assert next(c for c in api['cases'] if c['status'] == 'failed')['title'].startswith('G1:')
assert api['b3']['observedBrowserRunPostCount'] == 0
assert all(r['method'] == 'GET' for r in api['b3']['requestAttachment']['requests'])
receipt = {'utc': datetime.now(timezone.utc).isoformat(), 'source': read(N / 'BUILD-MANIFEST.json')['source'],
           'seals': checks, 'threeWayCellsRecomputedFromRaw': 12, 'actualBrowserResult': result,
           'scopeDisposition': 'Accepted bounded #416 and #420 evidence; strict G1 remains failed and pre-existing #563 stays parked. No final review, CI, merge or owner acceptance is implied.',
           'rootReadReportAndApiReadback': True, 'rootViewedCurrent320Doubled15DigitPng': True}
with (P / 'ROOT-READBACK.json').open('x', encoding='utf-8') as f:
    json.dump(receipt, f, indent=2)
    f.write('\n')
print(json.dumps({'seals': checks, 'cellsRecomputed': 12, 'source': receipt['source'], 'strictG1': 'failed'}, indent=2))
