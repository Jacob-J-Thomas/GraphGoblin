from pathlib import Path
import hashlib
import json

root = Path(__file__).resolve().parent
members = []
for file in sorted(root.iterdir()):
    if file.name == 'MANIFEST.json' or not file.is_file():
        continue
    data = file.read_bytes()
    members.append({'path': file.name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
manifest = {'scope': 'UNARMED corrected native10 source/build/admission drafts; no runner derivative or execution', 'members': members}
with (root / 'MANIFEST.json').open('x', encoding='utf-8', newline='\n') as f:
    json.dump(manifest, f, indent=2)
    f.write('\n')
data = (root / 'MANIFEST.json').read_bytes()
print(json.dumps({'members': len(members), 'manifestBytes': len(data), 'manifestSha256': hashlib.sha256(data).hexdigest()}))
