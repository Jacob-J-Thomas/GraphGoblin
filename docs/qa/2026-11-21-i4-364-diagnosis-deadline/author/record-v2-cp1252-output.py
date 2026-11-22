import datetime, hashlib, json, os, pathlib, shutil, subprocess, sys, time

sys.dont_write_bytecode = True
ROOT = pathlib.Path('G:/ggq/gg-i4-364-claude-start/GraphGoblin')
E = pathlib.Path(__file__).parent
Q = pathlib.Path('C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents')
RUNTIME = pathlib.Path.home() / '.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64'
os.environ['PATH'] = str(RUNTIME) + os.pathsep + os.environ['PATH']
os.environ['TEMP'] = os.environ['TMP'] = 'G:/ggq/qa-scratch/i4-364-deadline-author-01'
pathlib.Path(os.environ['TEMP']).mkdir(parents=True, exist_ok=True)
SOURCE = ['packages/infrastructure/src/claude/process.ts', 'packages/infrastructure/src/claude/process-failure.test.ts', 'docs/06-harness-integration.md', 'docs/decisions/README.md', 'docs/decisions/ADR-0089-bounded-claude-refusal-diagnosis.md']

def digest(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()

def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)

def write_json(name, value):
    (E / name).write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')

def snapshot(label):
    index = pathlib.Path(git('rev-parse', '--path-format=absolute', '--git-path', 'index').decode().strip())
    files = {}
    for p in SOURCE:
        path = ROOT / p
        files[p] = {'exists': path.exists(), **({'sha256': digest(path), 'bytes': path.stat().st_size} if path.exists() else {})}
    archive = {}
    archive_roots = ['docs/qa/' + p for p in ['2026-11-21-i4-364-claude-start', '2026-11-21-i4-364-probe-correction', '2026-11-21-i4-427-365', '2026-11-21-i4-363-structured-temp', '2026-11-21-i4-363-marker-correction', '2026-11-21-i4-442-plugin-diagnostics']]
    entries = git('ls-tree', '-rz', 'HEAD', '--', *archive_roots).split(b'\0')
    for entry in entries:
        if not entry:
            continue
        meta, rawpath = entry.split(b'\t', 1)
        p = rawpath.decode()
        mode, kind, blob = meta.decode().split()
        archive[p] = {'mode': mode, 'blob': blob, 'bytes': (ROOT / p).stat().st_size, 'sha256': digest(ROOT / p)}
    status = git('status', '--porcelain=v2', '--branch')
    (E / (label + '-status.txt')).write_bytes(status)
    staged = git('diff', '--cached', '--raw', '-z')
    (E / (label + '-staged.raw')).write_bytes(staged)
    write_json(label + '-snapshot.json', {'utc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'head': git('rev-parse', 'HEAD').decode().strip(), 'tree': git('rev-parse', 'HEAD^{tree}').decode().strip(), 'all_qa_tree': git('rev-parse', 'HEAD:docs/qa').decode().strip(), 'index_path': str(index), 'index_bytes': index.stat().st_size, 'index_sha256': digest(index), 'staged_sha256': hashlib.sha256(staged).hexdigest(), 'source': files, 'archive_files': archive})

if __name__ == '__main__':
    action = sys.argv[1]
    if action == 'before':
        assert git('rev-parse', 'HEAD').decode().strip() == '580aded6d295061897b047ac16811e5da230d9e0'
        assert not git('status', '--porcelain')
        snapshot('before')
        for p in SOURCE:
            path = ROOT / p
            if path.exists():
                dest = E / 'before-source' / p
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(path, dest)
        inputs = [Q / 'i4-364-deadline-author-01/BRIEF.md', Q / 'decision-203.md', Q / 'i4-549-final-astra-02/REPORT.md', ROOT / 'AGENTS.md', ROOT / 'docs/README.md', ROOT / 'docs/15-issue-workflow.md', ROOT / 'docs/delivery/2026-11-17-five-intents-register.md']
        write_json('input-hashes.json', [{'path': str(p), 'bytes': p.stat().st_size, 'sha256': digest(p)} for p in inputs])
        write_json('preparation-notes.json', {'read_only_failures': ['Initial Get-Content tooling/vitest.ts failed because actual shared config is tooling/vitest.shared.mjs; no source change or test attempt occurred.', 'PowerShell rg path glob was rejected; repeated with rg directory -g file glob.'], 'instrumentation_fix_1': 'Stopped own broad before-snapshot process PID49024 after ~4 minutes: it unnecessarily hashed all 34048 historical QA files. Preserved exact helper v1. Narrowed byte inventory to six relevant inherited packets and retained HEAD:docs/qa tree identity plus clean status/index for the whole archive. No product test attempted during this correction.', 'overflow': 'Some batched read-only tool output was truncated; source sections were re-read in bounded queries.', 'runtime_policy': 'Node 22.23.4 prepended to actual helper process PATH; pnpm.cmd only; task-scoped TEMP/TMP on G.'})
        print('before snapshot saved; archive files:', len(json.loads((E / 'before-snapshot.json').read_text())['archive_files']))
    elif action == 'after':
        snapshot('after')
    elif action == 'run':
        name, command = sys.argv[2], sys.argv[3:]
        assert name and not (E / (name + '.json')).exists()
        start = time.time()
        with open(E / (name + '.log'), 'wb') as log:
            result = subprocess.run(command, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)
        write_json(name + '.json', {'command': command, 'cwd': str(ROOT), 'utc': datetime.datetime.fromtimestamp(start, datetime.timezone.utc).isoformat(), 'elapsed_seconds': time.time()-start, 'exit_code': result.returncode, 'log_sha256': digest(E / (name + '.log')), 'node_path': shutil.which('node'), 'node_version': subprocess.check_output(['node', '--version']).decode().strip(), 'temp': os.environ['TEMP']})
        print(name, 'exit', result.returncode)
        print((E / (name + '.log')).read_text(encoding='utf-8', errors='replace')[-6500:])
        sys.exit(result.returncode)
