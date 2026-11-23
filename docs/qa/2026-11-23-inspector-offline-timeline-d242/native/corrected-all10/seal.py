from pathlib import Path
import hashlib
import json

root = Path(__file__).resolve().parent
semantic = json.loads((root / 'SEMANTIC-READBACK.json').read_text())
closure = {k: semantic[k] for k in ('rootReportedSession', 'rootReportedTerminalExit', 'actualCommandReceiptExit', 'startUtc', 'endUtc', 'source', 'cases', 'passed', 'failed', 'fixtureErrors', 'expectedCorrectCriteriaPassed', 'protectedCount', 'beforeAfterAndPostClosureRehashEqual', 'browserCloseResolved', 'allTenContextClosesResolved', 'closureLimit', 'scopeLimit')}
closure.update(actualBehaviorInvocations=1, independentReadbackOnly=True, rootReportedHeavySlotReleased=True, rawFilesMutated=False)
with (root / 'CLOSURE.json').open('x', encoding='utf-8', newline='\n') as f:
    json.dump(closure, f, indent=2)
    f.write('\n')
members = []
for file in sorted(root.rglob('*')):
    if not file.is_file() or file.name == 'MANIFEST.json' or 'temp' in file.relative_to(root).parts:
        continue
    data = file.read_bytes()
    members.append({'path': file.relative_to(root).as_posix(), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
with (root / 'MANIFEST.json').open('x', encoding='utf-8', newline='\n') as f:
    json.dump({'scope': 'Closed root-executed corrected native10 plus independent evidence readback; all raw output and40 PNGs selected, temp diagnostics excluded', 'exclusions': ['temp/ (retained browser/compilation diagnostics, untouched)'], 'members': members}, f, indent=2)
    f.write('\n')
data = (root / 'MANIFEST.json').read_bytes()
report = (root / 'REPORT.md').read_bytes()
print(json.dumps({'members': len(members), 'manifestBytes': len(data), 'manifestSha256': hashlib.sha256(data).hexdigest(), 'reportBytes': len(report), 'reportSha256': hashlib.sha256(report).hexdigest()}))
