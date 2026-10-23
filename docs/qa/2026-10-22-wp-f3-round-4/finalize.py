from pathlib import Path
import hashlib
import json
import re
import subprocess

root = Path(__file__).resolve().parent
repo = root.parents[2]
baseline = json.loads((root / 'baseline.json').read_text())
profile = re.compile(r'''(?i)(?:[a-z]:)?[\\/]+Users[\\/]+[^\\/\s"'<>]+''')
redactions = []
for path in root.glob('*.log.txt'):
    before = path.read_bytes()
    after = profile.sub('<USERPROFILE>', before.decode('utf-8')).encode('utf-8')
    if before != after:
        path.write_bytes(after)
        record_path = root / (path.name.removesuffix('.log.txt') + '-result.json')
        if record_path.exists():
            record = json.loads(record_path.read_text())
            record['captureBeforeFinalPrivacyBytes'] = len(before)
            record['captureBeforeFinalPrivacySha256'] = hashlib.sha256(before).hexdigest()
            record['captureBytes'] = len(after)
            record['captureSha256'] = hashlib.sha256(after).hexdigest()
            record['finalPrivacyNormalization'] = 'Removed profile directories split across pnpm wrapped lines; previous capture hash retained separately.'
            record_path.write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8', newline='\n')
        redactions.append(path.name)

index = hashlib.sha256(subprocess.check_output(['git', 'ls-files', '--stage', '-z'], cwd=repo)).hexdigest()
protected = hashlib.sha256((repo / 'apps/api/src/subloop-restart.test.ts').read_bytes()).hexdigest()
head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip()
merge = subprocess.check_output(['git', 'rev-parse', 'MERGE_HEAD'], cwd=repo, text=True).strip()
assert head == baseline['head'] and merge == baseline['mergeHead']
assert index == baseline['indexSha256']
assert protected == baseline['protectedTestSha256']
markers = []
for name in baseline['conflicts']:
    if re.search(r'^(<<<<<<< |=======\s*$|>>>>>>> )', (repo / name).read_text(encoding='utf-8-sig'), re.M):
        markers.append(name)
assert not markers, markers
bad_paths = []
large = []
for path in root.rglob('*'):
    if not path.is_file():
        continue
    if path.stat().st_size > 1_000_000:
        large.append(path.name)
    if profile.search(path.read_text(encoding='utf-8-sig')):
        bad_paths.append(path.name)
assert not large, large
assert not bad_paths, bad_paths
cleanup = json.loads((root / 'migration-cleanup.json').read_text(encoding='utf-8-sig'))
assert cleanup['databaseFilesRemaining'] == 0
for row in cleanup['files']:
    # Check the exact recorded basename under TEMP, without retaining local absolute paths.
    import tempfile
    assert not (Path(tempfile.gettempdir()) / row['file']).exists(), row['file']
chain = json.loads((root / 'migration-chain.json').read_text())
drizzle = repo / 'packages/infrastructure/drizzle'
assert hashlib.sha256((drizzle / '0017_run_execution_limits.sql').read_bytes()).hexdigest() == chain['sqlSha256']
journal = json.loads((drizzle / 'meta/_journal.json').read_text())
main_journal = json.loads(subprocess.check_output(['git', 'show', 'MERGE_HEAD:packages/infrastructure/drizzle/meta/_journal.json'], cwd=repo))
assert journal['entries'][:-1] == main_journal['entries']
snapshot16 = json.loads((drizzle / 'meta/0016_snapshot.json').read_text())
snapshot17 = json.loads((drizzle / 'meta/0017_snapshot.json').read_text())
assert snapshot17['prevId'] == snapshot16['id']
assert {k: v for k, v in snapshot16.items() if k not in ['id', 'prevId']} == {k: v for k, v in snapshot17.items() if k not in ['id', 'prevId']}
native_directories = []
for path in root.glob('coverage-infrastructure*.log.txt'):
    names = sorted(set(re.findall(r'gg-claude-process-[A-Za-z0-9]+', path.read_text(encoding='utf-8'))))
    for name in names:
        directory = Path(tempfile.gettempdir()) / name
        native_directories.append({'capture': path.name, 'name': name, 'existsAtClose': directory.exists(), 'directoryNotDeleted': True})
(root / 'native-failure-directories.json').write_text(json.dumps(native_directories, indent=2) + '\n', encoding='utf-8', newline='\n')
boundary = {
    'head': head, 'mergeHead': merge, 'indexSha256': index,
    'indexUnchanged': True, 'protectedC6TestUnchanged': True,
    'protectedC6TestSha256': protected, 'workingConflictMarkers': markers,
    'unmergedIndexPathsIntentionallyRetained': baseline['conflicts'],
    'privacyNormalizedCaptures': sorted(set(redactions + (json.loads((root / 'boundary.json').read_text()).get('privacyNormalizedCaptures', []) if (root / 'boundary.json').exists() else []))), 'localUserDirectoriesAbsent': True,
    'retainedArtifactsOver1000000Bytes': large,
    'ownMigrationDatabaseFilesRemaining': 0,
    'emptyFixtureDirectoriesPreserved': cleanup['emptyFixtureDirectories'],
}
(root / 'boundary.json').write_text(json.dumps(boundary, indent=2) + '\n', encoding='utf-8', newline='\n')
if not (root / 'NOT-KEPT.md').exists():
    (root / 'NOT-KEPT.md').write_text('# Captures not kept (D-034)\n\nNo capture exceeded 1,000,000 bytes. All acquired captures for this round are retained.\n', encoding='utf-8', newline='\n')
manifest = []
for path in sorted(root.rglob('*')):
    if not path.is_file() or path.name == 'manifest.json':
        continue
    data = path.read_bytes()
    manifest.append({'name': path.relative_to(root).as_posix(), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
(root / 'manifest.json').write_text(json.dumps({'excludesSelf': True, 'artifacts': manifest}, indent=2) + '\n', encoding='utf-8', newline='\n')
print('Closing boundary verified; manifest written. Git index and C6 test unchanged; no conflict markers, local user directories or owned migration database files remain.')
