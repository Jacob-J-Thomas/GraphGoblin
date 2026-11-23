from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path

E = Path(__file__).resolve().parent.parent
def pin(path):
    data = path.read_bytes()
    return {'bytes': len(data), 'sha256': sha256(data).hexdigest()}

rows = []
for name, digest in (
    ('i5-d242-fable-correction-preparation-01', 'fdb9890ed2608aa06e3c98998463d087710df2122fc95476e783ee086dbeba98'),
    ('i5-d242-fable-correction-independent-01', '503eca54caff6e6d711c3346e27fdca05873e1df772c9f94371b29a43286007c'),
):
    folder = E / name
    manifest = folder / 'MANIFEST.json'
    assert pin(manifest)['sha256'] == digest
    data = json.loads(manifest.read_text(encoding='utf-8'))
    for member, expected in data['members'].items():
        assert pin(folder / member) == {key: expected[key] for key in ('bytes', 'sha256')}, member
    for ref in data.get('references', []):
        assert pin(Path(ref['source'])) == {key: ref[key] for key in ('bytes', 'sha256')}
    rows.append({'directory': str(folder), 'manifest': pin(manifest), 'verifiedMembers': len(data['members']),
                 'verifiedReferences': len(data.get('references', []))})
result = {'utc': datetime.now(timezone.utc).isoformat(), 'verified': rows,
          'rootReadCompleteControllerDiffAndAdmissionWrapper': True,
          'rootReadCompleteIndependentReportAndAcceptance': True,
          'qualifiedMechanicsAccepted': True, 'actualRuntimeAdmission': False,
          'conditions': ['Compare generated config to admission digest and exact root roster',
                         'Recheck bound index, dependencies and physical read byte pins immediately before launch',
                         'Validate brief as nonblank UTF-8', 'Keep checkout and task lock exclusively owned'],
          'formalReviews': 3, 'generalScans': 2, 'heldVerdict': 'CHANGES REQUIRED'}
with (Path(__file__).parent / 'FABLE-MECHANICS-ROOT-READBACK.json').open('x', encoding='utf-8', newline='\n') as out:
    json.dump(result, out, indent=2)
    out.write('\n')
print(json.dumps(result))
