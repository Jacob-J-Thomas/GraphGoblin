"""Stage one verified, explicitly named evidence archive and its narrow policy changes."""
from pathlib import Path, PurePosixPath
import json, hashlib, subprocess, sys

checkout, prefix, source, seal_hash, count, receipt, message = sys.argv[1:]
root = Path(checkout).resolve()
prefix = prefix.rstrip('/') + '/'
assert str(root).replace('\\', '/').lower().startswith('g:/ggq/')
assert prefix.startswith('docs/qa/') and '..' not in PurePosixPath(prefix).parts
archive = root / prefix
sha = lambda b: hashlib.sha256(b).hexdigest()
def git(*args): return subprocess.check_output(['git', *args], cwd=root)
assert git('rev-parse', 'HEAD').decode().strip() == source
pre_staged = git('diff', '--cached', '--name-only', '-z').decode().split('\0')[:-1]
assert set(pre_staged) <= {'.gitattributes', '.prettierignore'}
for name in pre_staged: assert git('cat-file', 'blob', ':' + name) == (root / name).read_bytes()
dirty = git('diff', 'HEAD', '--name-only', '-z').decode().split('\0')[:-1]
assert set(dirty) <= {'.gitattributes', '.prettierignore'}, dirty
manifest_bytes = (archive / 'integration-manifest.json').read_bytes()
assert sha(manifest_bytes) == seal_hash
manifest = json.loads(manifest_bytes)
assert manifest['sourceHead'] == source and len(manifest['files']) == int(count)
files = manifest['files'] + [{'path': 'integration-manifest.json', 'sha256': seal_hash}]
assert len({f['path'] for f in files}) == len(files)
for f in files:
    assert not PurePosixPath(f['path']).is_absolute() and '..' not in PurePosixPath(f['path']).parts
    b = (archive / f['path']).read_bytes()
    assert sha(b) == f['sha256'], f['path']
    if 'bytes' in f: assert len(b) == f['bytes'], f['path']
    prospective = git('hash-object', '--path=' + prefix + f['path'], '--', str(archive / f['path'])).decode().strip()
    raw = git('hash-object', '--no-filters', '--', str(archive / f['path'])).decode().strip()
    assert prospective == raw, f['path']
git('diff', '--check')
git('add', '--sparse', '-f', '--', prefix, '.gitattributes', '.prettierignore')
paths = git('diff', '--cached', '--name-only', '-z').decode().split('\0')[:-1]
expected = {prefix + f['path'] for f in files} | set(dirty)
assert set(paths) == expected, {'extra': list(set(paths)-expected), 'missing': list(expected-set(paths))}
for f in files: assert sha(git('cat-file', 'blob', ':' + prefix + f['path'])) == f['sha256'], f['path']
git('diff', '--cached', '--check')
commit_output = git('commit', '-m', message).decode()
head = git('rev-parse', 'HEAD').decode().strip()
assert git('rev-parse', 'HEAD^').decode().strip() == source
assert not git('status', '--porcelain')
for f in files: assert sha(git('cat-file', 'blob', head + ':' + prefix + f['path'])) == f['sha256'], f['path']
record = {'sourceParent': source, 'head': head, 'tree': git('rev-parse', 'HEAD^{tree}').decode().strip(), 'archive': prefix, 'archiveBlobsVerified': files, 'changedPaths': paths, 'commitOutput': commit_output, 'cleanAfter': True}
with Path(receipt).open('x', encoding='utf-8') as stream: stream.write(json.dumps(record, indent=2) + '\n')
print(json.dumps({'head': head, 'tree': record['tree'], 'archiveBlobsVerified': len(files), 'changedPaths': len(paths), 'clean': True}))
