from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path

P = Path(__file__).resolve().parent
def read(name):
    return json.loads((P / name).read_text(encoding='utf-8'))
def pin(path):
    b = path.read_bytes()
    return {'bytes': len(b), 'sha256': sha256(b).hexdigest()}
result, command = read('RESULT.json'), read('COMMAND.json')
before, after = read('BEFORE.json'), read('AFTER.json')
assert result['exit'] == command['exit'] == 0 and result['sourceAndControlsUnchanged']
assert before['head'] == after['head'] == 'a0ce7b781e333b70f4711b5e9201ef63c157df1d'
assert before['tree'] == after['tree'] == '3f47fed82c18930fc0a56bc8e2598e7190ba8f3c'
for key in before.keys() & after.keys():
    assert before[key] == after[key], key
assert not before['status'] and not after['commonIndexPresent']
assert pin(P / 'vitest.stdout') == command['stdout']
assert pin(P / 'vitest.stderr') == command['stderr']
assert pin(P / 'vitest-results.json') == command['report']
assert command['node'] == 'v22.23.4' and command['pnpm'] == '12.8.1'
report = read('vitest-results.json')
cases = [c for suite in report['testResults'] for c in suite['assertionResults']]
assert len(report['testResults']) == 236 and len(cases) == 3179
assert all(c['status'] == 'passed' for c in cases) and report['success']
coverage = read('coverage-summary.json')['total']
assert coverage == result['coverage']
assert all(coverage[m]['pct'] >= 90 for m in ('lines', 'branches', 'statements', 'functions'))
assert result['freshCoverageFiles'] == ['coverage-summary.json']
assert pin(P / 'coverage-summary.json') == {k: after['freshCoverageArtifacts']['coverage-summary.json'][k] for k in ('bytes', 'sha256')}
text = '''# Current whole-web coverage

The single ordinary pnpm web coverage command passed at source a0ce7b781e333b70f4711b5e9201ef63c157df1d, tree3f47fed82c18930fc0a56bc8e2598e7190ba8f3c: **3179 tests in236 files**, zero failed, skipped or pending cases. Node22.23.4 and pnpm12.8.1 were selected for the whole shell. The run started2026-11-23T13:18:10Z and closed13:36:08Z with exit0; wrapper91884 also closed0. No retry was used.

Fresh V8 coverage is12319/12483 lines (98.68%),13158/13929 branches (94.46%),14029/14355 statements (97.72%), and3518/3615 functions (97.31%). The configured summary reporter produced coverage-summary.json; no coverage-final.json is claimed. The raw Vitest JSON, full stdout/stderr, command argv/times, initial artifact metadata and copied fresh summary remain here. Existing stderr diagnostics remain retained.

Root independently counted every raw assertion and rechecked the four reported thresholds, output hashes and before/after controls. Source/head/tree/index, protected core, lockfile and module metadata stayed unchanged; the common index stayed absent. This is current web coverage, not all-package CI, native behavior, final review, merge, installed-build or owner acceptance. Those separate gates remain.
'''
with (P / 'REPORT.md').open('x', encoding='utf-8', newline='\n') as f:
    f.write(text)
members = {p.name: pin(p) for p in sorted(P.iterdir()) if p.is_file() and p.name != 'MANIFEST.json'}
manifest = {'utc': datetime.now(timezone.utc).isoformat(), 'source': {'head': before['head'], 'tree': before['tree']},
            'scope': 'Single closed current-source whole-web coverage; raw before/after and actual reports retained', 'members': members}
with (P / 'MANIFEST.json').open('x', encoding='utf-8', newline='\n') as f:
    json.dump(manifest, f, indent=2)
    f.write('\n')
print(json.dumps({'manifest': pin(P / 'MANIFEST.json'), 'members': len(members), 'cases': len(cases), 'coverage': coverage}, indent=2))
