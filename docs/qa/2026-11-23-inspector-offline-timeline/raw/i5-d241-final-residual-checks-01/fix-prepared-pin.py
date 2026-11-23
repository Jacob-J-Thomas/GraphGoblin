from pathlib import Path
from hashlib import sha256
import json

O = Path(__file__).resolve().parent
p = O / 'run-corrected-checks.py'
b = p.read_bytes()
bad = b'615f3142a84b4143611580693adb091608e2adebe86951a936d2f2e4bfac483'
good = b'615f3142a84b4143611580693adb091608e2adedbe86951a936d2f2e4bfac483'
assert sha256(b).hexdigest() == '191abf543e5ac7a05dd6e1e9ef4ad988818274fe626984a4e807ce9dc156961e'
assert b.count(bad) == 1
actual = O.parent / 'i5-d241-small-followup-checks-01/vitest-results.json'
assert sha256(actual.read_bytes()).hexdigest().encode() == good
fixed = b.replace(bad, good)
dest = O / 'run-root-pinned-checks.py'
with dest.open('xb') as f:
    f.write(fixed)
record = {'firstPreparedRunnerSha256': sha256(b).hexdigest(), 'executedRunnerSha256': sha256(fixed).hexdigest(),
          'change': 'One missing d restored in pinned historical report hash; root verified exact historical bytes. No test, scope, command, timeout, assertion or source change.',
          'priorPreparedExecution': False, 'firstPreparedRunnerPreserved': True,
          'rootBindingSha256': sha256((O / 'BINDING.json').read_bytes()).hexdigest()}
with (O / 'ROOT-PIN-CORRECTION.json').open('x', encoding='utf-8', newline='\n') as f:
    json.dump(record, f, indent=2)
    f.write('\n')
print(json.dumps(record))
