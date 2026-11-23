import hashlib
import json
from pathlib import Path

directory = Path(__file__).resolve().parent.parent / 'i5-d242-b2-independent63-execution-01'
prep = Path(__file__).resolve().parent


def sha(data):
    return hashlib.sha256(data).hexdigest()


for name, expected in [
    ('run-corrected.ps1', '407d6159bab8ebe525f1a368d2060d3156e6e56ed40fa77c1de79f5775b461ac'),
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
    json.dump({'scope': 'Actual D242 unchanged55 fresh2 plus separate full63 component QA',
               'members': members}, stream, indent=2)
    stream.write('\n')
print(json.dumps({'members': len(members), 'manifestSha256': sha((directory / 'MANIFEST.json').read_bytes()),
                  'reportSha256': sha((directory / 'REPORT.md').read_bytes())}, indent=2))
