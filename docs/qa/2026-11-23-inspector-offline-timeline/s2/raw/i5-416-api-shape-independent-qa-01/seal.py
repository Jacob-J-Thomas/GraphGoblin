import hashlib, json, pathlib
root = pathlib.Path(__file__).parent
destination = root/'MANIFEST.json'
assert not destination.exists(), 'Do not rewrite a sealed packet'
members = [dict(path=str(p.relative_to(root)).replace('\\','/'), bytes=p.stat().st_size, sha256=hashlib.sha256(p.read_bytes()).hexdigest()) for p in sorted(root.rglob('*')) if p.is_file() and p != destination]
destination.write_text(json.dumps(dict(scope='S2 independent real API shape and core eligibility; raw first failures retained; no UI acceptance', members=members),indent=2)+'\n',encoding='utf-8')
for member in members:
    assert hashlib.sha256((root/member['path']).read_bytes()).hexdigest() == member['sha256']
print(json.dumps(dict(members=len(members),manifestSha256=hashlib.sha256(destination.read_bytes()).hexdigest(),reportSha256=hashlib.sha256((root/'REPORT.md').read_bytes()).hexdigest())))
