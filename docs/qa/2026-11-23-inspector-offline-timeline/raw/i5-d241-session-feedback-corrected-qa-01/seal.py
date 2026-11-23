import hashlib
import json
from pathlib import Path

directory = Path(__file__).parent
prep = directory.parent / 'i5-d241-session-feedback-corrected-preparation-01'


def sha(data):
    return hashlib.sha256(data).hexdigest()


for name, expected in [
    ('run-corrected.ps1', 'e2c6391f5f399321f72fdce99eadba92602cb878e5f5927a4df1a07d1208614f'),
    ('module-boundary.cjs', 'bfc5e9782f583f52187787eddf8eec300079f0b442405554e5d0d16bd3296602'),
]:
    data = (prep / name).read_bytes()
    assert sha(data) == expected
    with (directory / ('executed.' + name)).open('xb') as stream:
        stream.write(data)
members = []
for path in sorted(directory.rglob('*')):
    if path.is_file() and path.name != 'MANIFEST.json':
        data = path.read_bytes()
        members.append({'path': path.relative_to(directory).as_posix(), 'bytes': len(data), 'sha256': sha(data)})
with (directory / 'MANIFEST.json').open('x', encoding='utf-8', newline='\n') as stream:
    json.dump({'scope': 'Actual a0 unchanged55 fresh2 plus separate full63 component QA; finite read-only closure',
               'members': members}, stream, indent=2)
    stream.write('\n')
print(json.dumps({'members': len(members), 'manifestSha256': sha((directory / 'MANIFEST.json').read_bytes()),
                  'reportSha256': sha((directory / 'REPORT.md').read_bytes())}, indent=2))
