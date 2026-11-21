import hashlib, json, os, pathlib, subprocess, sys
sys.dont_write_bytecode = True
E = pathlib.Path(__file__).parent
ROOT = pathlib.Path('G:/ggq/gg-i4-364-claude-start/GraphGoblin')
path = ROOT / 'packages/infrastructure/src/claude/process.ts'
original = E / 'before-source/packages/infrastructure/src/claude/process.ts'
candidate = path.read_bytes()
candidate_hash = hashlib.sha256(candidate).hexdigest()
assert hashlib.sha256(original.read_bytes()).hexdigest() != candidate_hash
os.environ['PATH'] = str(pathlib.Path.home() / '.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64') + os.pathsep + os.environ['PATH']
try:
    path.write_bytes(original.read_bytes())
    assert path.read_bytes() == original.read_bytes()
    code = subprocess.run([sys.executable, '-B', str(E / 'record.py'), 'run', 'old-source-control-01', 'pnpm.cmd', '--filter', '@graphgoblin/infrastructure', 'exec', 'vitest', 'run', 'src/claude/process-failure.test.ts', '-t', 'settles a default public turn'], cwd=ROOT).returncode
finally:
    path.write_bytes(candidate)
    assert hashlib.sha256(path.read_bytes()).hexdigest() == candidate_hash
receipt = {'original_source_sha256': hashlib.sha256(original.read_bytes()).hexdigest(), 'candidate_source_sha256': candidate_hash, 'restored_source_sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'control_exit_code': code, 'scope': 'Only process.ts replaced by exact clean 580aded6 bytes; maintained final tests and all other candidate source unchanged; finally restored exact candidate bytes.', 'expected_failure': 'Both default-public-turn cases fail the finite terminal === true assertion at 1000ms; held metadata, no request deadline, watchdog or external abort.'}
(E / 'old-source-restoration.json').write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf-8')
print(json.dumps(receipt, indent=2))
assert code != 0, 'Old source unexpectedly passed the liveness oracle'
