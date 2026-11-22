"""New detached environment preparation only; no product QA/review/provider.

Writes evidence only under this owned G: directory, creates the explicitly named
new worktree, installs frozen dependencies offline, and runs exactly one build.
Old source/index/master records are never written. No online fallback or cleanup.
"""
from pathlib import Path
import datetime
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time

OUT = Path(__file__).resolve().parent
EVIDENCE_ROOT = Path('G:/ggq/delivery-evidence/2026-11-17-five-intents').resolve()
Q = Path('C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents').resolve()
AUTHOR = Path('G:/ggq/gg-i4-364-claude-start/GraphGoblin').resolve()
OLD_QA = Path('G:/ggq/gg-i4-364-qa/GraphGoblin').resolve()
DEST = Path('G:/ggq/gg-i4-364-deadline-qa/GraphGoblin').resolve()
HEAD = 'e8cf31d51837a4fa362f909604b3070277db6c25'
TREE = '0927bbbf9f3889791c956e7816e3524c9a5a8fe6'
OLD_HEAD = 'b90ffd2dfce3d4a73b83c5722393298453cec07b'
RUNTIME = Path('C:/Users/98jak/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64').resolve()
TASK_TEMP = r'G:\ggq\qa-scratch\i4-364-deadline-qa-build-01'
POINTER = Q / 'i4-364-deadline-qa-preparation-01-pointer.json'
FREEZE = Q / 'i4-364-deadline-root-freeze-01/receipt.json'
ENV = {**os.environ, 'PATH': str(RUNTIME) + os.pathsep + os.environ['PATH'],
       'TEMP': TASK_TEMP, 'TMP': TASK_TEMP, 'GIT_OPTIONAL_LOCKS': '0',
       'TURBO_TELEMETRY_DISABLED': '1', 'NO_UPDATE_NOTIFIER': '1'}
PS = shutil.which('powershell.exe')
COMMANDS = []
sha = lambda b: hashlib.sha256(b).hexdigest()
utc = lambda: datetime.datetime.now(datetime.timezone.utc).isoformat()

def require(ok, message):
    if not ok:
        raise ValueError(message)

def write(name, value):
    path = (OUT / name).resolve()
    require(path.is_relative_to(OUT), 'Evidence path escapes configured G: root')
    path.parent.mkdir(parents=True, exist_ok=True)
    data = value if isinstance(value, bytes) else (json.dumps(value, indent=2) + '\n').encode()
    with path.open('xb') as stream:
        stream.write(data)

def file_info(path):
    path = Path(path).resolve()
    digest = hashlib.sha256()
    size = 0
    with path.open('rb') as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
            size += len(chunk)
    return {'path': str(path), 'bytes': size, 'sha256': digest.hexdigest()}

def run(label, args, cwd, input_bytes=None):
    start = utc()
    out_path, err_path = OUT / ('commands/' + label + '.stdout'), OUT / ('commands/' + label + '.stderr')
    out_path.parent.mkdir(exist_ok=True)
    with out_path.open('xb') as stdout, err_path.open('xb') as stderr:
        process = subprocess.Popen(args, cwd=cwd, env=ENV, stdin=subprocess.PIPE if input_bytes is not None else subprocess.DEVNULL,
                                   stdout=stdout, stderr=stderr)
        process.communicate(input=input_bytes)
    receipt = {'label': label, 'argv': [str(a) for a in args], 'cwd': str(cwd), 'startedUtc': start, 'endedUtc': utc(),
               'pid': process.pid, 'exitCode': process.returncode, 'stdout': file_info(out_path), 'stderr': file_info(err_path),
               'processLocalEnvironment': {'nodePathFirst': str(RUNTIME), 'TEMP': TASK_TEMP, 'TMP': TASK_TEMP,
                    'GIT_OPTIONAL_LOCKS': '0', 'TURBO_TELEMETRY_DISABLED': '1', 'NO_UPDATE_NOTIFIER': '1'}}
    if input_bytes is not None:
        receipt['stdinUtf8'] = input_bytes.decode()
    write('commands/' + label + '.receipt.json', receipt)
    COMMANDS.append(receipt)
    print(json.dumps({'command': label, 'exitCode': process.returncode, 'stdoutBytes': receipt['stdout']['bytes']}), flush=True)
    return receipt

def git_read(repo, *args):
    return subprocess.check_output(['git', *args], cwd=repo, env=ENV, stderr=subprocess.PIPE)

def state(repo):
    status = git_read(repo, 'status', '--porcelain=v1', '-z', '--untracked-files=all')
    index = Path(git_read(repo, 'rev-parse', '--path-format=absolute', '--git-path', 'index').decode().strip())
    return {'repo': str(repo), 'head': git_read(repo, 'rev-parse', 'HEAD').decode().strip(),
            'tree': git_read(repo, 'rev-parse', 'HEAD^{tree}').decode().strip(),
            'symbolicHead': subprocess.run(['git', 'symbolic-ref', '-q', 'HEAD'], cwd=repo, env=ENV, stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout.decode().strip() or None,
            'statusSha256': sha(status), 'statusBytes': len(status), 'clean': not status,
            'index': file_info(index), 'trackedIndexSha256': sha(git_read(repo, 'ls-files', '--stage', '-z')),
            'trackedTreeSha256': sha(git_read(repo, 'ls-tree', '-r', '-z', 'HEAD')),
            'lockfile': file_info(repo / 'pnpm-lock.yaml')}

def materialized_sources(repo):
    tracked = git_read(repo, 'ls-files', '-z').decode().split('\0')[:-1]
    entries, absent_archives = [], 0
    for name in tracked:
        if name.startswith('docs/qa/') and name != 'docs/qa/design-contrast.md':
            absent_archives += not (repo / name).exists()
            continue
        path = repo / name
        require(path.is_file(), 'Required source/governing document absent: ' + str(path))
        entries.append({**file_info(path), 'relativePath': name})
    digest = sha(json.dumps([{k: x[k] for k in ['relativePath', 'bytes', 'sha256']} for x in entries], separators=(',', ':')).encode())
    return {'repo': str(repo), 'files': entries, 'canonicalSourceDigest': digest,
            'scope': 'Every tracked path except historical docs/qa; design-contrast.md retained',
            'historicalArchivePathsAbsent': absent_archives}

def ps_command(command):
    return [PS, '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command]

def listeners(label):
    receipt = run(label, ps_command("Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object { $_.LocalPort -in @(4747,4748,11434) } | Select-Object LocalAddress,LocalPort,OwningProcess | ConvertTo-Json -Compress"), OUT)
    require(receipt['exitCode'] == 0, 'Listener snapshot unavailable')
    raw = Path(receipt['stdout']['path']).read_bytes().strip()
    return {'receipt': str(OUT / ('commands/' + label + '.receipt.json')), 'ownerPorts': json.loads(raw) if raw else [],
            'limit': 'Point-in-time listener snapshot only; no continuous port monitoring or API request'}

protected_before = None
try:
    require(OUT.parent == EVIDENCE_ROOT and OUT.name == 'i4-364-deadline-qa-preparation-01', 'Unexpected configured evidence root')
    require(not DEST.exists() and not POINTER.exists(), 'Destination or success pointer already exists')
    require(PS and (RUNTIME / 'node.exe').is_file(), 'Required local runtime/shell missing')
    Path(TASK_TEMP).mkdir(parents=True, exist_ok=True)
    freeze_raw = FREEZE.read_bytes()
    freeze = json.loads(freeze_raw)
    require(freeze['head'] == HEAD and freeze['tree'] == TREE and freeze['clean'], 'Root freeze binding differs')
    protected_before = {'author': state(AUTHOR), 'oldQA': state(OLD_QA)}
    require(protected_before['author']['head'] == HEAD and protected_before['author']['tree'] == TREE and protected_before['author']['clean'], 'Author not clean/frozen')
    require(protected_before['oldQA']['head'] == OLD_HEAD and protected_before['oldQA']['clean'], 'Old QA baseline differs')
    protected_sources = {'author': materialized_sources(AUTHOR), 'oldQA': materialized_sources(OLD_QA)}
    write('protected-worktrees-before.json', protected_before)
    write('protected-source-inventories.json', protected_sources)
    before_ports = listeners('01-owner-ports-before')
    write('admission.json', {'status': 'ENVIRONMENT_PREPARATION_ONLY', 'createdUtc': utc(), 'candidate': HEAD, 'tree': TREE,
          'destinationDidNotExist': True, 'destination': str(DEST), 'author': str(AUTHOR), 'oldQA': str(OLD_QA),
          'rootFreeze': file_info(FREEZE), 'selectedFiveSourceHashes': freeze['sourceHashes'],
          'TEMP': TASK_TEMP, 'TMP': TASK_TEMP, 'processLocalOnly': True, 'initialOwnerPorts': before_ports,
          'freeDiskBytes': shutil.disk_usage('G:/').free, 'offlineOnly': True,
          'permittedGitWrites': ['New named worktree registration', 'New named worktree sparse settings/index/checkout'],
          'forbidden': ['Primary/author/old-QA index or source edits', 'Tests/QA/provider/native API/browser calls', 'Online install fallback', 'Git commits/push/publication', 'HOME/global environment changes']})
    add = run('02-worktree-add-no-checkout', ['git', '-C', str(AUTHOR), 'worktree', 'add', '--detach', '--no-checkout', str(DEST), HEAD], AUTHOR)
    require(add['exitCode'] == 0, 'New worktree creation failed')
    init = run('03-new-worktree-sparse-init', ['git', '-C', str(DEST), 'sparse-checkout', 'init', '--no-cone'], DEST)
    require(init['exitCode'] == 0, 'New worktree sparse init failed')
    sparse = run('04-new-worktree-sparse-patterns', ['git', '-C', str(DEST), 'sparse-checkout', 'set', '--no-cone', '--stdin'], DEST,
                 b'/*\n!/docs/qa/*\n/docs/qa/design-contrast.md\n')
    require(sparse['exitCode'] == 0, 'New worktree sparse set failed')
    checkout = run('05-new-worktree-checkout', ['git', '-C', str(DEST), 'checkout', '--detach', HEAD], DEST)
    require(checkout['exitCode'] == 0, 'New detached checkout failed')
    candidate_before = state(DEST)
    require(candidate_before['head'] == HEAD and candidate_before['tree'] == TREE and candidate_before['clean'] and candidate_before['symbolicHead'] is None, 'Candidate not exact/clean/detached')
    candidate_sources = materialized_sources(DEST)
    require(candidate_sources['canonicalSourceDigest'] == protected_sources['author']['canonicalSourceDigest'], 'Candidate materialized source differs from author')
    for name, expected in freeze['sourceHashes'].items():
        require(file_info(DEST / name)['sha256'] == expected, 'Frozen source hash mismatch: ' + name)
    require(candidate_before['lockfile']['sha256'] == protected_before['author']['lockfile']['sha256'], 'Committed lockfile differs')
    write('candidate-before-install-build.json', candidate_before)
    write('candidate-source-inventory.json', candidate_sources)
    node = run('06-node-version', ['node', '--version'], DEST)
    require(node['exitCode'] == 0 and Path(node['stdout']['path']).read_text().strip() == 'v22.23.4', 'Project Node runtime not selected')
    pnpm = run('07-pnpm-version', ps_command('pnpm.cmd --version; exit $LASTEXITCODE'), DEST)
    require(pnpm['exitCode'] == 0 and Path(pnpm['stdout']['path']).read_text().strip() == '12.8.1', 'Unexpected committed package-manager version')
    install = run('08-offline-frozen-install', ps_command('pnpm.cmd install --offline --frozen-lockfile --store-dir G:/.pnpm-store; exit $LASTEXITCODE'), DEST)
    if install['exitCode'] != 0:
        combined = Path(install['stdout']['path']).read_bytes() + Path(install['stderr']['path']).read_bytes()
        write('offline-install-failure.json', {'exitCode': install['exitCode'], 'cacheMissDetected': any(p in combined for p in [b'ERR_PNPM_NO_OFFLINE', b'ERR_PNPM_OFFLINE', b'not available in the store', b'not found in local']),
              'onlineFallbackAttempted': False, 'action': 'Report exact failure to root before any online action', 'commandReceipt': str(OUT / 'commands/08-offline-frozen-install.receipt.json')})
        raise ValueError('Offline frozen install failed; no online fallback or build attempted')
    after_install = state(DEST)
    require(after_install == candidate_before, 'Candidate source/index/lock changed during offline install')
    write('candidate-after-install-state.json', {'matchesBeforeExactly': True, 'state': after_install})
    build = run('09-single-pnpm-build', ps_command('pnpm.cmd build; exit $LASTEXITCODE'), DEST)
    require(build['exitCode'] == 0, 'Single authorized build failed; no retry performed')
    candidate_after = state(DEST)
    require(candidate_after == candidate_before, 'Candidate source/index/lock changed during build')
    require(materialized_sources(DEST)['canonicalSourceDigest'] == candidate_sources['canonicalSourceDigest'], 'Materialized tracked sources changed')
    outputs = []
    output_roots = []
    for parent in ['apps', 'packages']:
        for package in sorted((DEST / parent).iterdir()):
            if not package.is_dir():
                continue
            for name in ['dist', 'dist-goblin']:
                directory = package / name
                if directory.is_dir():
                    output_roots.append(directory.relative_to(DEST).as_posix())
                    for p in sorted(directory.rglob('*')):
                        if p.is_file():
                            outputs.append({**file_info(p), 'relativePath': p.relative_to(DEST).as_posix()})
    required_outputs = ['packages/infrastructure/dist/claude/process.js', 'packages/engine/dist/run-manager.js', 'apps/api/dist/main.js', 'apps/api/dist/container.js', 'apps/mcp/dist/main.js', 'apps/web/dist/index.html', 'apps/web/dist-goblin/index.html']
    require(set(required_outputs) <= {x['relativePath'] for x in outputs}, 'Relevant runtime build output missing')
    write('emitted-output-hashes.json', {'outputRoots': output_roots, 'memberCount': len(outputs), 'files': outputs,
          'requiredQAEntryPoints': required_outputs, 'meaning': 'Built bytes only; not executed as API/native/browser/provider or accepted by QA'})
    installed_metadata = []
    for name in ['node_modules/.modules.yaml', 'node_modules/.pnpm/lock.yaml']:
        if (DEST / name).is_file():
            installed_metadata.append(file_info(DEST / name))
    write('dependency-binding.json', {'committedLock': candidate_after['lockfile'], 'installReceipt': str(OUT / 'commands/08-offline-frozen-install.receipt.json'),
          'offline': True, 'frozenLockfile': True, 'store': 'G:/.pnpm-store', 'installedMetadata': installed_metadata,
          'packageManager': 'pnpm 12.8.1', 'node': 'v22.23.4', 'dependencyOrLockEdits': False})
    protected_after = {'author': state(AUTHOR), 'oldQA': state(OLD_QA)}
    require(protected_after == protected_before, 'Author/old QA source head/tree/index/lock/status changed')
    for key, repo in [('author', AUTHOR), ('oldQA', OLD_QA)]:
        require(materialized_sources(repo)['canonicalSourceDigest'] == protected_sources[key]['canonicalSourceDigest'], 'Protected worktree source bytes changed')
    require(FREEZE.read_bytes() == freeze_raw, 'Root freeze receipt changed')
    after_ports = listeners('10-owner-ports-after')
    require(after_ports['ownerPorts'] == before_ports['ownerPorts'], 'Owner-port listener snapshot changed; report before releasing')
    write('protected-worktrees-after.json', {'unchanged': True, 'states': protected_after, 'materializedSourcesUnchanged': True})
    write('candidate-after-build.json', {'matchesBeforeExactly': True, 'state': candidate_after,
          'sourceInventory': file_info(OUT / 'candidate-source-inventory.json'), 'sourceDigestUnchanged': True,
          'portsBefore': before_ports, 'portsAfter': after_ports})
    report = {'status': 'ENVIRONMENT_PREPARATION_COMPLETE_NOT_QA', 'finishedUtc': utc(), 'checkout': str(DEST), 'head': HEAD, 'tree': TREE,
              'cleanDetached': True, 'sourceIndexLockUnchangedAcrossInstallBuild': True, 'authorAndOldQAUnchanged': True,
              'node': 'v22.23.4', 'pnpm': '12.8.1', 'offlineFrozenInstallExit': install['exitCode'], 'buildInvocations': 1, 'buildExit': build['exitCode'],
              'outputFiles': len(outputs), 'outputRoots': output_roots, 'sourceOwnershipReleasedToRoot': True,
              'independentOpusQACompleted': False, 'productTestsOrAPIOrBrowserOrProviderCalls': False,
              'ownerPortsPointInTimeUnchanged': True, 'scratch': TASK_TEMP, 'scratchPreserved': True,
              'largePayloadCopies': False, 'publicationCommitOrPush': False,
              'limitations': ['Build-output preparation only; no behavior or regression QA', 'Listener records are point-in-time snapshots', 'No remote-provider readiness claim', 'Scratch and dependencies retained for the next owner']}
    write('receipt.json', report)
    write('SOURCE-OWNERSHIP-RELEASE.md', (f'''# Environment ownership release

Preparation is complete for `{DEST}` detached at `{HEAD}`, tree `{TREE}`. The preparation process has finished all checkout/index/source work and releases this new environment to root for the separately required independent actual Opus QA.

One offline frozen dependency installation and one ordinary `pnpm build` completed. All emitted `dist`/`dist-goblin` files are hash-bound; the source, index and lock remain exact and clean. Author and old QA head/tree/index/lock/source digests are unchanged. The old QA remains at `{OLD_HEAD}`.

This is environment preparation, not QA, review, a provider verdict or completion of the product gate. No product tests, gateway, browser, API calls or provider calls were launched. Point-in-time owner-port snapshots match; they do not constitute continuous monitoring. Logs have one canonical copy here. Task TEMP/TMP used `{TASK_TEMP}` only in child environments and remain preserved. No HOME/global setting or original evidence was changed.
''').encode())
    members = [{**file_info(p), 'relativePath': p.relative_to(OUT).as_posix()} for p in sorted(OUT.rglob('*')) if p.is_file()]
    write('MANIFEST.sha256.json', {'schema': 'graphgoblin-364-deadline-environment-preparation/1', 'status': report['status'], 'files': members, 'memberCount': len(members), 'excludes': ['MANIFEST.sha256.json', 'SEAL.json']})
    write('SEAL.json', {'kind': 'Environment preparation only, not QA', 'head': HEAD, 'tree': TREE,
          'manifest': file_info(OUT / 'MANIFEST.sha256.json'), 'receipt': file_info(OUT / 'receipt.json'), 'outputs': file_info(OUT / 'emitted-output-hashes.json'),
          'sourceOwnershipReleasedToRoot': True})
    pointer = {'kind': 'Environment preparation complete; not QA', 'canonicalEvidence': str(OUT), 'checkout': str(DEST), 'head': HEAD, 'tree': TREE,
               'receiptSha256': file_info(OUT / 'receipt.json')['sha256'], 'manifestSha256': file_info(OUT / 'MANIFEST.sha256.json')['sha256'],
               'sealSha256': file_info(OUT / 'SEAL.json')['sha256'], 'sourceOwnershipReleasedToRoot': True}
    with POINTER.open('xb') as stream:
        stream.write((json.dumps(pointer, indent=2) + '\n').encode())
    print(json.dumps({'status': report['status'], 'checkout': str(DEST), 'receipt': file_info(OUT / 'receipt.json'),
                      'outputs': file_info(OUT / 'emitted-output-hashes.json'), 'seal': file_info(OUT / 'SEAL.json'), 'pointer': file_info(POINTER)}), flush=True)
except Exception as error:
    failure = {'status': 'ENVIRONMENT_PREPARATION_INCOMPLETE', 'atUtc': utc(), 'reason': str(error), 'commands': [x['label'] for x in COMMANDS],
               'offlineFallbackNeverAttempted': True, 'productQAOrProviderLaunched': False, 'successPointerWritten': POINTER.exists()}
    if protected_before is not None:
        try:
            failure['protectedAfterFailure'] = {'author': state(AUTHOR), 'oldQA': state(OLD_QA)}
            failure['protectedStateStillExact'] = failure['protectedAfterFailure'] == protected_before
        except Exception as check_error:
            failure['protectedCheckError'] = str(check_error)
    write('failure.json', failure)
    print(json.dumps(failure), flush=True)
    raise
