"""Read-only exact-head and retained-evidence audit; writes only beside this file."""
from pathlib import Path
import datetime, hashlib, json, os, re, subprocess, zipfile

OUT = Path(__file__).resolve().parent
REPO = Path(r'C:\Users\98jak\.codex\worktrees\gg-20261115-runtime\GraphGoblin')
BATCH = Path(r'C:\Users\98jak\graphgoblin-qa\2026-11-13-aidlc-batch')
HEAD = '2732dd34457bcd9a7007e89c3fa11fe085af764c'
BASE = 'be633141be5a0cd2b4f960a46761fabbf2cb82c7'
TREE = 'd064706fb48def7bacac5e434f96825c5850d214'
MERGE = '80c581ebc95de2000c25ed2b5995d5a648fa95ba'
PRODUCT = 'a73b9a887c50f51d4fc4af54aa806fda42e31abf'
os.environ['GIT_OPTIONAL_LOCKS'] = '0'
inventory, failures = {}, []
def digest(data): return hashlib.sha256(data).hexdigest()
def read(path, purpose='offline integrity validation'):
    path = Path(path)
    data = path.read_bytes()
    inventory[str(path)] = {'path': str(path), 'bytes': len(data), 'sha256': digest(data), 'purpose': purpose}
    return data
def parsed(path, purpose='offline structured-evidence validation'):
    return json.loads(read(path, purpose).decode('utf-8-sig'))
def check(condition, label):
    if not condition: failures.append(label)
def git(*args): return subprocess.check_output(['git', *args], cwd=REPO)
def seal(root):
    count = 0
    seal_path = root / 'SHA256SUMS.txt'
    if not seal_path.is_file(): return {'path': str(root), 'rows': 0, 'status': 'no packet seal'}
    for line in read(seal_path).decode('utf-8-sig').splitlines():
        if not line.strip(): continue
        m = re.match(r'^([0-9a-fA-F]{64})\s+\*?(.+)$', line)
        if not m:
            failures.append(f'Invalid seal row: {seal_path}: {line}')
            continue
        expected, name = m.groups()
        p = root / name.replace('\\', '/')
        check(p.resolve().is_relative_to(root.resolve()), f'Out-of-packet seal path {p}')
        check(digest(read(p)) == expected.lower(), f'Packet digest mismatch {p}')
        count += 1
    return {'path': str(root), 'rows': count, 'status': 'verified'}

result = {'atUtc': datetime.datetime.now(datetime.timezone.utc).isoformat()}
result['git'] = {'head': git('rev-parse', 'HEAD').decode().strip(), 'tree': git('rev-parse', 'HEAD^{tree}').decode().strip(),
    'branch': git('branch', '--show-current').decode().strip(), 'status': git('status', '--porcelain=v1').decode(),
    'mergeBase': git('merge-base', HEAD, BASE).decode().strip(), 'merge': git('show', '-s', '--format=%H %T %P', MERGE).decode().strip(),
    'remoteRefs': git('ls-remote', 'origin', 'refs/heads/main', 'refs/heads/codex/gg-20261116-installer-validation').decode().splitlines()}
check(result['git']['head'] == HEAD and result['git']['tree'] == TREE and not result['git']['status'], 'Git admission mismatch')
check(result['git']['mergeBase'] == BASE, 'Merge-base mismatch')
check(result['git']['merge'] == f'{MERGE} {TREE} {BASE} {HEAD}', 'Tested merge identity mismatch')
check(set(result['git']['remoteRefs']) == {HEAD+'\trefs/heads/codex/gg-20261116-installer-validation', BASE+'\trefs/heads/main'}, 'Remote ref drift')
index = Path(git('rev-parse', '--git-path', 'index').decode().strip())
if not index.is_absolute(): index = REPO/index
result['indexSha256Before'] = digest(read(index, 'index nonmutation check'))
manifest = parsed(BATCH/'launcher-436-discovery-corrected-candidate-source.json')
result['activeFiles'] = []
for row in manifest['files']:
    raw = read(REPO/row['path'], 'active source fully read or active document diff inspected')
    blob = git('show', HEAD+':'+row['path'])
    product = git('show', PRODUCT+':'+row['path'])
    check(raw == blob == product, 'Active file source/product mismatch '+row['path'])
    check(digest(blob) == row['sha256'] and len(blob) == row['bytes'], 'Manifest mismatch '+row['path'])
    result['activeFiles'].append({**row, 'headAndProductAndWorktreeEqual': raw == blob == product})
source = (REPO/'scripts/install-windows-launcher.ps1').read_bytes().decode('utf-8').replace('\r\n','\n')
starts = list(re.finditer(r'^function ([A-Za-z][\w-]*)', source, re.M))
declarations = {m.group(1): source[m.start():starts[i+1].start() if i+1 < len(starts) else len(source)].rstrip()
    for i,m in enumerate(starts)}
result['rollbackDeclarations'] = []
for row in manifest['rollback']:
    actual = digest(declarations[row['function']].encode())
    check(actual == row['sha256'], 'Rollback declaration mismatch '+row['function'])
    result['rollbackDeclarations'].append({'function': row['function'], 'sha256': actual, 'match': actual == row['sha256']})
wf = '.github/workflows/ci.yml'
check(git('show', HEAD+':'+wf) == git('show', BASE+':'+wf), 'Workflow differs from target')
result['workflowEqualsTarget'] = True
changes = [line.split('\t') for line in git('diff', '--name-status', BASE, HEAD).decode().splitlines()]
result['effectiveDiff'] = {'fileCount': len(changes), 'entries': changes}
expected_modified = {r['path'] for r in manifest['files']} | {'docs/qa/.gitattributes','docs/delivery/2026-11-13-four-intents-register.md'}
check({p for status,p in changes if status != 'A'} == expected_modified, 'Unexpected modified path')
check(all(status == 'A' and p.startswith('docs/qa/') or p in expected_modified for status,p in changes), 'Unexpected active change')
packets = sorted({REPO/Path(*Path(p).parts[:3]) for status,p in changes if status == 'A' and p.startswith('docs/qa/')})
result['packetSeals'] = [seal(p) for p in packets]
ci_packet = BATCH/'proposed/docs/qa/2026-11-16-installer-validation-final-ci'
result['finalCiSeal'] = seal(ci_packet)
copy_map = parsed(ci_packet/'source-copy-map.json')
for row in copy_map['files']:
    data = read(ci_packet/row['path'])
    check(digest(data) == row['sha256'] and len(data) == row['bytes'], 'Final CI copy-map mismatch '+row['path'])
    check(data == read(BATCH/row['sourcePath']), 'Final CI source copy mismatch '+row['path'])
result['finalCiSourceCopiesVerified'] = len(copy_map['files'])
for relative, expected in [
    ('review-436-opus-scan1/full-report.md','a2db5fb598ba266008ddc55b9a4a9c7bf6d90ba8c69e92cacc0bc2765ec802be'),
    ('review-436-opus-scan1/root-dispositions.md','5d66ba7fd55a8d162f6d47450e8f853ef8d7e0f3b7674362c045539f1ea17f3f'),
    ('launcher/436-final-ci-root-acceptance.json','97d4d2390ebe2cbf67f80f1317b21618e716ad612d6a1cba4d7bf057f32c8418')]:
    check(digest(read(BATCH/relative, 'complete prior report/disposition/receipt read')) == expected, 'Admission artifact hash mismatch '+relative)
receipt = parsed(BATCH/'launcher/436-final-ci-root-acceptance.json')
for row in receipt['files']:
    data = read(row['path'])
    check(digest(data) == row['sha256'] and len(data) == row['bytes'], 'CI receipt mismatch '+row['path'])

candidate = REPO/'docs/qa/2026-11-16-installer-validation-candidate-corrected'
result['archives'] = []
for ziprel, invrel in [('artifact/artifact-14206620250.zip','artifact-member-inventory.json'),
    ('rollback-artifact/artifact-14205449836.zip','rollback-artifact-member-inventory.json')]:
    rows = parsed(candidate/invrel)
    zp = candidate/ziprel
    raw = read(zp, 'whole archive and every contained member integrity checked')
    with zipfile.ZipFile(zp) as z:
        names = [i.filename for i in z.infolist() if not i.is_dir()]
        check(len(names) == len(set(names)) == len(rows), 'ZIP member count/uniqueness '+ziprel)
        check(set(names) == {r['path'] for r in rows}, 'ZIP inventory name mismatch '+ziprel)
        for row in rows:
            data = z.read(row['path'])
            check(digest(data) == row['sha256'] and len(data) == row['bytes'], 'ZIP member mismatch '+row['path'])
    result['archives'].append({'path': str(zp), 'bytes': len(raw), 'sha256': digest(raw), 'fileMembersVerified': len(rows)})
private = REPO/'docs/qa/2026-11-16-installer-private-cli-corrected'
private_inv = parsed(private/'work-member-inventory.json')
zp = private/'work-evidence.zip'
read(zp, 'private component evidence archive and every member integrity checked')
with zipfile.ZipFile(zp) as z:
    check(len(z.infolist()) == private_inv['zipEntryCount'], 'Private ZIP entry count')
    for row in private_inv['fileMembers']:
        data = z.read(row['zipEntry'])
        check(digest(data) == row['sha256'] and len(data) == row['bytes'], 'Private ZIP member mismatch '+row['zipEntry'])
result['privateArchiveMembersVerified'] = len(private_inv['fileMembers'])
ci = BATCH/'launcher/436-final-ci'
coverage_map = parsed(ci/'coverage-members.json')
read(ci/'coverage-14208778425.zip', 'coverage artifact digest and all summaries recomputed')
result['coverage'] = []
with zipfile.ZipFile(ci/'coverage-14208778425.zip') as z:
    for row in coverage_map:
        data = z.read(row['Name'])
        check(digest(data) == row['SHA256'].lower() and len(data) == row['Length'], 'Coverage member mismatch '+row['Name'])
        total = json.loads(data)['total']
        lines, branches = total['lines']['pct'], total['branches']['pct']
        check(lines >= 90 and branches >= 90, 'Coverage floor '+row['Name'])
        check(lines == row['Lines'] and branches == row['Branches'], 'Coverage report differs '+row['Name'])
        result['coverage'].append({'path': row['Name'], 'lines': lines, 'branches': branches})
run = parsed(ci/'run-43829142179.json')
result['ciRunIdentity'] = {key: run.get(key) for key in ['id','head_sha','head_branch','event','run_attempt','status','conclusion']}
check(run['head_sha'] == HEAD and run['run_attempt'] == 1 and run['conclusion'] == 'success', 'Run identity/result mismatch')
jobs = parsed(ci/'jobs-github-api.json')
jobrows = jobs.get('jobs',[]) if isinstance(jobs,dict) else jobs
result['jobs'] = [{'id':j['id'], 'name':j['name'], 'conclusion':j['conclusion'], 'steps':len(j['steps'])} for j in jobrows]
check(len(jobrows)==4 and all(j['conclusion']=='success' for j in jobrows), 'CI job mismatch')
check(len(next(j for j in jobrows if j['name']=='Gates')['steps'])==32, 'Gates step count mismatch')
gates = read(ci/'gates.decoded.log', 'selected checkout/gate/test summaries read and test totals independently summed').decode('utf-8-sig')
summary_lines = [line for line in gates.splitlines() if re.search(r'\bTests\s+',re.sub(r'\x1b\[[0-9;]*m','',line)) and 'passed' in line]
counts = []
for line in summary_lines:
    plain = re.sub(r'\x1b\[[0-9;]*m','',line)
    passed = re.search(r'\bTests\s+(\d+) passed',plain)
    if passed:
        skipped = re.search(r'(\d+) skipped',plain)
        counts.append({'passed': int(passed[1]), 'skipped': int(skipped[1]) if skipped else 0, 'raw': plain})
result['vitestCounts'] = {'groups':len(counts),'passed':sum(r['passed'] for r in counts),'skipped':sum(r['skipped'] for r in counts),'rows':counts}
check((len(counts), result['vitestCounts']['passed'],result['vitestCounts']['skipped'])==(13,9619,41),'Vitest totals mismatch')
result['indexSha256After'] = digest(index.read_bytes())
check(result['indexSha256After']==result['indexSha256Before'],'Index changed')
check(not git('status','--porcelain=v1').strip(),'Worktree changed')
result['failures'] = failures
result['status'] = 'PASS' if not failures else 'FAILED'
(OUT/'offline-verification.json').write_text(json.dumps(result,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
(OUT/'mechanical-evidence-inventory.json').write_text(json.dumps(list(inventory.values()),indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
print(json.dumps({'status':result['status'],'failures':failures,'changedFiles':len(changes),'sealedPackets':len(packets),
    'sealRows':sum(r['rows'] for r in result['packetSeals']),'finalCiSeal':result['finalCiSeal'],
    'archives':result['archives'],'privateMembers':result['privateArchiveMembersVerified'],
    'coverageGroups':len(result['coverage']),'vitest':{k:v for k,v in result['vitestCounts'].items() if k!='rows'},
    'inventoryFiles':len(inventory)},indent=2))
raise SystemExit(bool(failures))
