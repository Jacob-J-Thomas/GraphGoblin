import collections, hashlib, json, pathlib, shutil, subprocess, sys
sys.dont_write_bytecode = True
import record

E, ROOT = record.E, record.ROOT
before = json.loads((E / 'before-snapshot.json').read_text())
after = json.loads((E / 'after-snapshot.json').read_text())
assert before['head'] == after['head'] == '580aded6d295061897b047ac16811e5da230d9e0'
assert before['tree'] == after['tree'] == '49f4ae66198c4699867cab6c4f95c9ab4bf863b7'
assert before['index_sha256'] == after['index_sha256']
assert before['archive_files'] == after['archive_files']
assert len(after['archive_files']) == 1929
assert before['all_qa_tree'] == after['all_qa_tree']
assert not record.git('diff', '--cached', '--raw')
assert record.digest(pathlib.Path(after['index_path'])) == after['index_sha256']
tracked = record.git('diff', '--name-only').decode().splitlines()
untracked = record.git('ls-files', '--others', '--exclude-standard').decode().splitlines()
assert sorted(tracked + untracked) == sorted(record.SOURCE)
source = {}
for p in record.SOURCE:
    file = ROOT / p
    assert record.digest(file) == after['source'][p]['sha256']
    dest = E / 'candidate-source' / p
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(file, dest)
    source[p] = {'before': before['source'][p], 'after': after['source'][p], 'candidate_git_blob': record.git('hash-object', '--path=' + p, p).decode().strip(), 'mode': '100644', 'canonical_after_bytes': str(dest)}

archive_counts = collections.Counter()
for p, meta in after['archive_files'].items():
    archive_counts[p.split('/')[2]] += 1
    h = hashlib.sha1()
    h.update(('blob ' + str(meta['bytes']) + '\0').encode())
    with open(ROOT / p, 'rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    assert h.hexdigest() == meta['blob'], p

control = json.loads((E / 'old-source-control-01.json').read_text())
control_log = (E / 'old-source-control-01.log').read_text(encoding='utf-8')
assert control['exit_code'] == 1
assert '2 failed | 42 skipped (44)' in control_log
assert 'expected false to be true' in control_log
restoration = json.loads((E / 'old-source-restoration.json').read_text())
assert restoration['restored_source_sha256'] == source['packages/infrastructure/src/claude/process.ts']['after']['sha256']
checks = {}
for name in ['format-write-01', 'focused-process-failure-01', 'typecheck-01', 'lint-01', 'focused-claude-02', 'scoped-process-coverage-01', 'format-check-01', 'diff-check-01']:
    receipt = json.loads((E / (name + '.json')).read_text())
    assert receipt['exit_code'] == 0
    assert receipt['node_version'] == 'v22.23.4'
    assert record.digest(E / (name + '.log')) == receipt['log_sha256']
    checks[name] = receipt

diff = record.git('diff', '--binary', '--no-ext-diff', 'HEAD', '--', *record.SOURCE)
(E / 'source.diff').write_bytes(diff)
adr = subprocess.run(['git', 'diff', '--no-index', '--', '/dev/null', 'docs/decisions/ADR-0089-bounded-claude-refusal-diagnosis.md'], cwd=ROOT, capture_output=True)
assert adr.returncode == 1
(E / 'new-adr.diff').write_bytes(adr.stdout)
assert not adr.stderr
history = {
    'distinct_instrumentation_corrections': 3,
    'cap': 3,
    'source_fixes_after_test_failures': 0,
    'records': [
        {'number': 1, 'kind': 'inventory scope', 'failure_or_limit': 'Initial baseline unnecessarily streamed all 34048 historical QA paths. Stopped only own matching Python PID49024 before editing source, after about four minutes.', 'preserved_original': 'record-v1-broad-snapshot.py', 'correction': 'Stream hashes of the six relevant inherited packets (1929 files), preserve HEAD:docs/qa tree identity, exact clean head/index and whole workingtree scope.'},
        {'number': 2, 'kind': 'console encoding', 'failure_or_limit': "After the expected old-source failure, record.py persisted its raw log and exit JSON then raised UnicodeEncodeError: 'charmap' codec can't encode character '\\u276f' in position 85: character maps to <undefined>, while printing to cp1252 console. This trace text is transcribed from the retained tool result; the test log is the exact original.", 'preserved_original': 'record-v2-cp1252-output.py', 'correction': 'Set only helper stdout to UTF-8 with replacement. Did not rerun the old source. Read back original log and command receipt to verify both intended failures and candidate restoration.'},
        {'number': 3, 'kind': 'process-local TEMP path spelling', 'failure_or_limit': 'focused-claude-01: 304 passed and 2 failed of 306. The unchanged native help fixture compares dirname(request.cwd) exactly to tmpdir(); task TEMP used forward slashes while dirname returns backslashes. native-temp-spelling-diagnosis-01 is the exact false-equality witness.', 'preserved_original': 'record-v3-forward-slash-temp.py', 'correction': 'Normalize only task helper process TEMP/TMP to the same resolved G directory using pathlib. No assertion, source, timeout, global environment or target directory change. focused-claude-02 then passed 306/306.'},
    ],
    'read_only_discovery_errors': ['Missing guessed tooling/vitest.ts (actual tooling/vitest.shared.mjs).', 'PowerShell rg literal wildcard path rejected; corrected directory plus -g search.', 'Guessed __fixtures__ directory absent (actual fixtures directory).'],
    'failed_unchanged_product_reruns': 0,
}
record.write_json('instrumentation-history.json', history)
proof = {'starting_head': before['head'], 'starting_tree': before['tree'], 'final_head': after['head'], 'final_head_tree': after['tree'], 'source_ownership': 'Released to root with exactly five unstaged changed/new paths, no staging/commit/push.', 'source': source, 'index_sha256_unchanged': after['index_sha256'], 'staged_diff_empty': True, 'all_qa_tree_unchanged': after['all_qa_tree'], 'inherited_archive_counts': dict(archive_counts), 'inherited_archive_files': 1929, 'inherited_archive_verification': 'Every relevant working-file SHA256, byte count, Git blob and mode identical before/after; additionally streamed every current file as a Git blob and matched all 1929 HEAD blob IDs. All other historical QA paths excluded from changed paths and their HEAD tree is unchanged.', 'check_receipts': checks, 'old_source_control': restoration, 'instrumentation_history': 'instrumentation-history.json', 'remaining_limits': ['Scoped process coverage is not full infrastructure coverage.', 'Held metadata and child events are controlled seams; no naturally stalled native filesystem or live provider behavior is established.', 'Native stat is not cancelled by the deadline.', 'Independent Fable corrective review, separate Opus QA, fresh current-head/current-target CI/native and coordinator completion remain root-owned delivery gates.', 'No fourth general scan, independent QA verdict, merge approval, deployment or owner acceptance is claimed.']}
record.write_json('frozen-source-receipt.json', proof)
print(json.dumps({'paths': len(source), 'archives': dict(archive_counts), 'index': after['index_sha256'], 'diff_bytes': len(diff), 'receipt_sha256': record.digest(E / 'frozen-source-receipt.json')}, indent=2))
