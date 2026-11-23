from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import json

E = Path('G:/ggq/delivery-evidence/2026-11-17-five-intents')
P = E / 'i5-d242-fable-correction-preparation-01'
D = E / 'i5-d242-fable-correction-root-draft-01'
N = E / 'i5-d242-b2-native-corrected-execution-01'
B = E / 'i5-d242-b2-browser12-execution-01'
T = E / 'i5-d242-target-readback-02/READBACK.json'

def read(path):
    return json.loads(path.read_text(encoding='utf-8'))

def pin(path):
    data = path.read_bytes()
    return {'source': str(path), 'bytes': len(data), 'sha256': sha256(data).hexdigest()}

def put(path, value):
    with path.open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write('\n')

def verify_manifest(folder, name, expected):
    path = folder / name
    assert pin(path)['sha256'] == expected
    members = read(path)['members']
    pairs = members.items() if isinstance(members, dict) else ((m['path'], m) for m in members)
    count = 0
    for relative, record in pairs:
        actual = pin(folder / relative)
        assert all(actual[k] == record[k] for k in ('bytes', 'sha256')), relative
        count += 1
    return count

counts = {
    'rootDraft': verify_manifest(D, 'MANIFEST.json', '07690527e605b6f8a74da4e243665f4c025d87a210121529856abec966bd4e28'),
    'native': verify_manifest(N, 'MANIFEST.json', '5f8c9b19e7caee0c6e4fe0488e8f8ea2726e4042f58bcaa08d1194488abed535'),
    'browser': verify_manifest(B, 'BROWSER-EVIDENCE-MANIFEST.json', '7aab388b4916d1757d82072c0bba67b6715af1c9220ee02acce902b6faf22822'),
}
admission = read(D / 'ROOT-ADMISSION.draft.json')
target = read(T)
native = read(N / 'native/RESULTS.json')
assert target['target'] == admission['target'] and target['signatureVerified'] is True
assert native['source'] == admission['source'] and native['passed'] == 10 and native['failed'] == 0
assert native['browserCloseResolved'] and native['protectedInputsAndDistributionUnchanged']
assert read(N / 'COMMAND.receipt.json')['exitCode'] == 0
brief = (D / 'BRIEF.draft.md').read_text(encoding='utf-8')
patch = Path(admission['correctionPatch']['source']).read_bytes()
assert patch in brief.encode('utf-8'), 'Complete exact patch must remain embedded'
placeholder = next(line for line in brief.splitlines() if line.startswith('**NATIVE_ALL10_PENDING_ROOT_INSERTION'))
resolved = (
    'Corrected native all-10 is CLOSED: root wrapper10352 exited0; all ten cases and49 criteria passed, '
    'with zero fixture errors. Native manifest SHA ' + pin(N / 'MANIFEST.json')['sha256'] + '. '
    'Build manifest SHA ' + pin(B / 'BUILD-MANIFEST.json')['sha256'] + ' identifies the exact same20a69 source. '
    'Root read all case criteria, actual POST bodies/phases, remount/storage schedules and closure, '
    'and visually inspected the unobscured deletion failure and the later dismissed-dialog case. '
    'The independent report is appended below in full, including its modal visibility qualification. '
    'Root accepts these finite witnesses as evidence for the named fix, while substantive Fable assessment, '
    'whole-web coverage currently running, broad/current CI/native artifacts and signed delivery remain outstanding. '
    'Fixed12 closed11pass/1strictG1failure; all twelve geometry measurement sets match the retained baseline. '
    'Do not interpret that preserved G1/#563 failure as green or as new in-scope behavior.'
)
brief = brief.replace(placeholder, resolved, 1)
brief = brief.replace('**root must refresh its exact signed-target readback before admission**',
                      'root refreshed its exact signed-target readback at ' + target['utc'])
brief = brief.replace('"recordedTargetPendingFreshReadback":', '"freshVerifiedTarget":')
extra = {
    'signedTargetReadback': pin(T),
    'nativeReport': pin(N / 'REPORT.md'),
    'nativeManifest': pin(N / 'MANIFEST.json'),
    'nativeClosure': pin(N / 'CLOSURE.json'),
    'browserReport': pin(B / 'REPORT.md'),
    'browserManifest': pin(B / 'BROWSER-EVIDENCE-MANIFEST.json'),
    'currentBuild': pin(B / 'BUILD-MANIFEST.json'),
}
brief += '\n\n## Root closed native and browser evidence additions\n\n```json\n' + json.dumps(extra, indent=2) + '\n```\n\n'
brief += '### Actual independent native report\n\n' + (N / 'REPORT.md').read_text(encoding='utf-8')
brief += '\n\n### Actual fixed12 report, retained strict failure\n\n' + (B / 'REPORT.md').read_text(encoding='utf-8')
assert 'NATIVE_ALL10_PENDING_ROOT_INSERTION' not in brief and patch in brief.encode('utf-8')
with (P / 'BRIEF.md').open('x', encoding='utf-8', newline='\n') as stream:
    stream.write(brief)
admission.update(rootAdmitted=True, rootVerifiedClosedAuthorAndQa=True,
                 independentQaReport=pin(N / 'REPORT.md'), targetReadback=pin(T), brief=pin(P / 'BRIEF.md'))
assert admission['apiRouteAuthorized'] is False
put(P / 'ROOT-ADMISSION.json', admission)
put(P / 'ROOT-BRIEF-DISPOSITION.json', {
    'utc': datetime.now(timezone.utc).isoformat(), 'source': admission['source'],
    'rehashCounts': counts, 'brief': pin(P / 'BRIEF.md'), 'rootAdmission': pin(P / 'ROOT-ADMISSION.json'),
    'rootReadRawNativeCases': 10, 'nativeWrapperSession': 10352, 'nativeObservedExit': 0,
    'nativeAcceptedAsFiniteFixEvidence': True, 'sourceOnlySubstantiveFableVerdictPending': True,
    'fixed12Disposition': 'All12 measured geometry cells equal the prior run. Existing strictG1/#563 failure remains failed and parked under D242. Other11 pass.',
    'scope': 'Read-only ordinary-Max Fable5.2/xhigh known-B2 assessment only; no fourth formal audit or Astra sign-off. API closed. Current broad gates and signed merge remain required.'
})
print(json.dumps({'brief': pin(P / 'BRIEF.md'), 'admission': pin(P / 'ROOT-ADMISSION.json'), 'membersRehashed': counts}))
