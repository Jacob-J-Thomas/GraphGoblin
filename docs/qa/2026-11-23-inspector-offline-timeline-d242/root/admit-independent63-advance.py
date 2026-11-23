from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path

E = Path(__file__).resolve().parent.parent
P = E / 'i5-d242-b2-independent63-preparation-02'
F = E / 'i5-d242-b2-corrected-freeze-01/FREEZE.json'
N = E / 'i5-d242-b2-native-old-f642-execution-02'
C = E / 'i5-d242-b2-focused-checks-02'
def pin(path):
    data = path.read_bytes()
    return {'source': str(path), 'bytes': len(data), 'sha256': sha256(data).hexdigest()}
def read(path):
    return json.loads(path.read_text(encoding='utf-8'))
def save(path, value):
    with path.open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')

counts = []
for folder, digest in ((P, '8def7a3507c048ddfbbd421b320f23ffa41e9924a4cccb7ca12e71348c90f546'),
                       (N, 'fc4a57ac0ad05c656e72852707c94f73655704d2c32e18339c512d2eb89b411d')):
    manifest = folder / 'MANIFEST.json'
    assert pin(manifest)['sha256'] == digest
    members = read(manifest)['members']
    rows = members.items() if isinstance(members, dict) else ((row['path'], row) for row in members)
    for name, expected in rows:
        assert {key: pin(folder / name)[key] for key in ('bytes', 'sha256')} == {key: expected[key] for key in ('bytes', 'sha256')}
    counts.append({'manifest': pin(manifest), 'membersVerified': len(members)})
assert pin(F)['sha256'] == 'bba83c55b7570b98df79a9c07672551dba720183d2156d13b6b78b508e6f0a3c'
freeze = read(F)
result = read(C / 'RESULT.json')
assert result['allPassed'] and result['passed'] == result['total'] == 244 and not result['missingPriorCases']
assert read(C / 'AFTER.json')['files'] == freeze['files']
native = read(N / 'native/RESULTS.json')
assert native['browserCloseResolved'] and native['protectedInputsAndDistributionUnchanged']
assert native['passed'] == 0 and native['failed'] == native['expectedCases'] == 4
assert all(case['state'] == 'failed' and case['cleanupCloseResolved'] and not case['unknown'] for case in native['cases'])
assert read(N / 'COMMAND.receipt.json')['exitCode'] == 1
disposition = {
    'utc': datetime.now(timezone.utc).isoformat(), 'rootReadReportAndAllFourActualCases': True,
    'rootViewedDeletionLateFailureScreenshot': True, 'verifiedManifests': counts,
    'oldNativeWrapperSession': 81991, 'actualExit': 1, 'actualBehaviorCases': 4, 'fixtureErrors': 0,
    'knownNegativeWitnessConfirmed': True, 'browserCloseResolved': True,
    'originalUiqaIndexReleasedForAdmittedAdvance': True,
    'limits': ['Intercepted native browser dispatch only; no backend effects', 'First loader error remains separate with zero browser cases',
               'No corrected product acceptance; this only releases the old-index hold after closed witness'],
}
disposition_path = Path(__file__).resolve().parent / 'OLD-NATIVE-ROOT-DISPOSITION.json'
save(disposition_path, disposition)
admission = read(P / 'ROOT-FF-ADMISSION.template.json')
admission.update(ffAdmitted=True, executionAdmitted=False, originalUiqaIndexReleasedByRoot=True,
                 preparationManifestSha256=pin(P / 'MANIFEST.json')['sha256'], source=freeze['source'],
                 freezeReceipt=pin(F), focusedReceipt=pin(C / 'RESULT.json'),
                 oldNativeDisposition=pin(disposition_path), correctedFiles=freeze['files'])
save(P / 'ROOT-FF-ADMISSION.json', admission)
print(json.dumps({'disposition': pin(disposition_path), 'advanceAdmission': pin(P / 'ROOT-FF-ADMISSION.json'), 'source': freeze['source']}))
