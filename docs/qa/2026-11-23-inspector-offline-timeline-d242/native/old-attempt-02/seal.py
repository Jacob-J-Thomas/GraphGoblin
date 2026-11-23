import hashlib
import json
import os
from pathlib import Path

out = Path(__file__).parent


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


members = []
for directory, dirs, files in os.walk(out):
    parent = Path(directory)
    if parent == out:
        dirs[:] = [name for name in dirs if name != 'temp']
    for name in files:
        file = parent / name
        if file == out / 'MANIFEST.json':
            continue
        raw = file.read_bytes()
        members.append({'path': file.relative_to(out).as_posix(), 'bytes': len(raw), 'sha256': sha(raw)})
members.sort(key=lambda row: row['path'])
with (out / 'MANIFEST.json').open('x', encoding='utf-8', newline='\n') as stream:
    json.dump({'scope': 'Original f642 repro4 negative witness:4 behavioral failures/0 fixture errors; corrected acceptance absent',
               'excludedSubtrees': [{'path': 'temp/', 'reason': 'Incidental owned browser/compilation cache, excluded without reading contents or deletion.'}],
               'members': members}, stream, indent=2)
    stream.write('\n')
for item in members:
    raw = (out / item['path']).read_bytes()
    assert len(raw) == item['bytes'] and sha(raw) == item['sha256']
print(json.dumps({'members': len(members), 'manifestSha256': sha((out / 'MANIFEST.json').read_bytes()),
                  'reportSha256': sha((out / 'REPORT.md').read_bytes()), 'tempExcluded': True}))
