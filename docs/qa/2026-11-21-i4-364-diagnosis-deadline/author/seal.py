import datetime, json, pathlib, sys
sys.dont_write_bytecode = True
import record

E, ROOT = record.E, record.ROOT
assert not (E / 'manifest.json').exists() and not (E / 'seal.json').exists()
frozen = json.loads((E / 'frozen-source-receipt.json').read_text())
for p, meta in frozen['source'].items():
    assert record.digest(ROOT / p) == meta['after']['sha256']
    assert record.digest(pathlib.Path(meta['canonical_after_bytes'])) == meta['after']['sha256']
assert record.git('rev-parse', 'HEAD').decode().strip() == frozen['final_head']
assert record.digest(pathlib.Path(json.loads((E / 'after-snapshot.json').read_text())['index_path'])) == frozen['index_sha256_unchanged']
assert not record.git('diff', '--cached', '--raw')
status = record.git('status', '--porcelain=v2', '--branch')
(E / 'release-status.txt').write_bytes(status)
release = json.loads((E / 'process-release.json').read_text(encoding='utf-8-sig'))
assert release['matching_native_fixture_processes'] == []
files = []
for p in sorted(E.rglob('*')):
    assert not p.is_symlink(), p
    if p.is_file():
        files.append({'path': p.relative_to(E).as_posix(), 'bytes': p.stat().st_size, 'sha256': record.digest(p)})
record.write_json('manifest.json', {'kind': 'D203 authored bounded correction evidence; no independent verdict', 'utc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'canonical_root': str(E), 'files': files, 'member_count': len(files), 'alias_policy': 'One canonical raw artifact per command. Before/candidate source copies are explicit before/after originals, not replaced historical reports. No whole archive payload copies.', 'source_receipt': 'frozen-source-receipt.json', 'limits': frozen['remaining_limits']})
seal = {'manifest': 'manifest.json', 'manifest_sha256': record.digest(E / 'manifest.json'), 'report_sha256': record.digest(E / 'REPORT.md'), 'source_receipt_sha256': record.digest(E / 'frozen-source-receipt.json'), 'sealed_file_members': len(files), 'sealed_payload_bytes': sum(p['bytes'] for p in files), 'final_head': frozen['final_head'], 'index_sha256_unchanged': frozen['index_sha256_unchanged'], 'source_released_to': 'root', 'unstaged_paths': 5}
record.write_json('seal.json', seal)
for meta in files:
    p = E / meta['path']
    assert p.stat().st_size == meta['bytes'] and record.digest(p) == meta['sha256']
assert record.digest(E / 'manifest.json') == seal['manifest_sha256']
print(json.dumps({**seal, 'seal_sha256': record.digest(E / 'seal.json')}, indent=2))
