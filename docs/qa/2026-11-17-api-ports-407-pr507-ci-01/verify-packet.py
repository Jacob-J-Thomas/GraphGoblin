from collections import Counter
from datetime import datetime
from hashlib import sha256
from pathlib import Path, PurePosixPath
import json
import re
import stat
from zipfile import ZipFile

root = Path(__file__).resolve().parent
run_id = 44250712750
head_sha = '62d443cd2aa321585b45099acb591bf3c24eafaf'
base_sha = '6d7fcc9838d831fe1be3c3cf52c90a2f33e8f5b1'
merge_sha = 'ce8c365d70a221ea358b8c96a7f638a541d0e000'
jobs_expected = {
    'Gates': (134620427512, 'failure', 'gates.raw.log'),
    'Browser': (134620427647, 'success', 'browser.raw.log'),
    'Windows launcher': (134620427169, 'success', 'windows-launcher.raw.log'),
    'Template image': (134620427434, 'success', 'template-image.raw.log'),
}
coverage_metadata = json.loads((root / 'github-artifact-pages.json').read_bytes())
coverage_id = next(a['id'] for page in coverage_metadata for a in page['artifacts'] if a['name']=='coverage')
ansi = re.compile(r'\x1b\[[0-?]*[ -/]*[@-~]')

def receipt(raw):
    return {'bytes': len(raw), 'sha256': sha256(raw).hexdigest()}

def read(name):
    return json.loads((root / name).read_bytes())

def stamp(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00'))

def seconds(start, end):
    return round((stamp(end) - stamp(start)).total_seconds(), 6)

def connector_fingerprint(text):
    fnv = 14695981039346656037
    for byte in text.encode('utf-16-le'):
        fnv = ((fnv ^ byte) * 1099511628211) & 0xffffffffffffffff
    return format(fnv,'016x')

run, attempt, pr = [read(name) for name in (
    'github-run.json','github-run-attempt1.json','github-pr.json'
)]
for record in (run, attempt):
    assert record['id'] == run_id and record['run_number'] == 920 and record['run_attempt'] == 1
    assert record['event'] == 'pull_request' and record['status'] == 'completed'
    assert record['head_sha'] == head_sha and record['conclusion'] == 'failure'
assert pr['number'] == 507 and pr['draft']
assert pr['head']['sha'] == head_sha and pr['base']['sha'] == base_sha
assert pr['merge_commit_sha'] == merge_sha
head, base, merge = [read(f'github-{name}.json') for name in (
    'head-commit','base-commit','synthetic-merge'
)]
assert (head['sha'], base['sha'], merge['sha']) == (head_sha, base_sha, merge_sha)
assert [p['sha'] for p in head['parents']] == [base_sha]
assert [p['sha'] for p in merge['parents']] == [base_sha, head_sha]
assert head['tree']['sha'] == merge['tree']['sha'] != base['tree']['sha']

job_pages = read('github-jobs-pages.json')
official_jobs = [j for page in job_pages for j in page['jobs']]
assert all(page['total_count'] == 4 for page in job_pages)
assert set(j['name'] for j in official_jobs) == set(jobs_expected)
assert len(official_jobs) == 4
connector = read('github-connector-readback.json')
cjobs = {job['id']:job for job in connector['jobs']}
logs, jobs = {}, {}
for job in official_jobs:
    label = job['name']
    expected_id, conclusion, logfile = jobs_expected[label]
    assert job['id'] == expected_id and job['conclusion'] == conclusion
    assert job['run_id'] == run_id and job['run_attempt'] == 1 and job['head_sha'] == head_sha
    assert job['status'] == 'completed'
    raw = (root / logfile).read_bytes()
    log_text = raw.decode('utf-8')
    assert len(log_text.encode('utf-16-le')) // 2 == cjobs[expected_id]['logUTF16Units']
    assert connector_fingerprint(log_text) == cjobs[expected_id]['connectorUTF16LEFingerprint']
    log = ansi.sub('', log_text).splitlines()
    checkout = [i+1 for i,l in enumerate(log) if l.partition(' ')[2].strip() == merge_sha]
    assert checkout
    logs[label] = log
    steps = job['steps']
    csteps = cjobs[expected_id]['steps']
    step_key = lambda s: tuple(s[k] for k in ('name','number','status','conclusion'))
    assert [step_key(s) for s in steps] == [step_key(s) for s in csteps]
    jobs[label] = {
        'id': expected_id, 'conclusion': conclusion, 'url':job['html_url'],
        'startedAt': job['started_at'], 'completedAt': job['completed_at'],
        'durationSeconds': seconds(job['started_at'],job['completed_at']),
        'stepsByConclusion': dict(Counter(s['conclusion'] for s in steps)),
        'steps': [dict(s, durationSeconds=seconds(s['started_at'],s['completed_at'])) for s in steps],
        'log': {'file':logfile, **receipt(raw), 'checkoutLines': checkout,
                'matchesConnectorDecodedFingerprint': True},
    }

gates = logs['Gates']
gates_steps = jobs['Gates']['steps']
broken = [s['name'] for s in gates_steps if s['conclusion']=='failure']
assert broken == ['Dependency audit']
post = [s['name'] for s in gates_steps if s['conclusion']=='skipped']
assert post == ['Post Run actions/setup-node@v4']
for exact in ['Licence allowlist', 'Generated docs are current',
              'Design token contrast table is current and passing',
              'Unit tests with coverage thresholds','Upload coverage reports']:
    assert [step['conclusion'] for step in gates_steps if step['name'] == exact] == ['success']

def loghit(log, literal):
    result=[i+1 for i,l in enumerate(log) if literal in l]
    assert result, literal
    return result

def timestamp(line):
    return line.partition(' ')[0].lstrip('\ufeff')

loghit(gates,'pnpm audit --audit-level=high')
loghit(gates,'Vulnerable versions │ <=4.0.7')
loghit(gates,'Patched versions    │ None')
loghit(gates,'https://github.com/advisories/GHSA-fc5q-39xc-vjpf')
loghit(gates,'Severity: 7 low | 13 moderate | 1 high')
audit_start_idx=loghit(gates,'##[group]Run pnpm audit --audit-level=high')[0]
audit_exit_idx=loghit(gates,'##[error]Process completed with exit code 1.')[0]
loghit(gates,'22 successful, 22 total')
api_port_case_lines = loghit(gates, 'src/testing/api-port.test.ts (13 tests)')
assert len(api_port_case_lines) == 1
assert '✓' in gates[api_port_case_lines[0] - 1]
annotation_pages = read('github-gates-annotations-pages.json')
audit_annotations = [
    annotation for page in annotation_pages for annotation in page
    if annotation['annotation_level'] == 'failure'
]
assert len(audit_annotations) == 1
assert 'Process completed with exit code 1.' in audit_annotations[0]['message']
coverage_duration = next(re.search(r'\bTime:\s+(\d+)m([\d.]+)s', line) for line in reversed(gates) if re.search(r'\bTime:\s+(\d+)m([\d.]+)s', line))
coverage_seconds = 60*int(coverage_duration[1])+float(coverage_duration[2])

artifact_pages=read('github-artifact-pages.json')
artifacts=[a for page in artifact_pages for a in page['artifacts']]
assert all(page['total_count']==1 for page in artifact_pages)
assert len(artifacts)==1 and len(connector['artifactListing'])==1
assert all(artifacts[0][key]==value for key,value in connector['artifactListing'][0].items())
artifact=artifacts[0]
assert connector['coverageDownload']['artifactId'] == coverage_id
assert artifact['id'] == coverage_id and artifact['name']=='coverage' and not artifact['expired']
assert artifact['workflow_run']['id']==run_id and artifact['workflow_run']['head_sha']==head_sha

coverage_groups = {}
group=None
for line in gates:
    match=re.match(r'\S+\s+##\[group\]@graphgoblin/(.+):test:coverage$',line)
    if match:
        group=match[1]
        assert group not in coverage_groups
        coverage_groups[group]={}
    if not group:
        continue
    count=re.match(r'\S+\s+Tests\s+(\d+) passed(?: \| (\d+) skipped)?\s+\((\d+)\)$',line)
    if count:
        passed=int(count[1]); skipped=int(count[2] or 0); total=int(count[3])
        assert passed+skipped==total
        coverage_groups[group].update(passed=passed, skipped=skipped)
    duration=re.match(r'\S+\s+Duration\s+([\d.]+)(ms|s)\b',line)
    if duration:
        coverage_groups[group]['vitestDurationSeconds']=float(duration[1])/(1000 if duration[2]=='ms' else 1)
    if line.endswith('##[endgroup]'):
        group=None
assert len(coverage_groups)==13
pass_total=sum(x['passed'] for x in coverage_groups.values())
skip_total=sum(x['skipped'] for x in coverage_groups.values())
archive_name=f'coverage-{coverage_id}.zip'
archive_data=(root/archive_name).read_bytes()
archive_digest=receipt(archive_data)
assert 'sha256:'+archive_digest['sha256']==artifact['digest']
assert archive_digest['bytes']==artifact['size_in_bytes']
loghit(gates,archive_digest['sha256'])
loghit(gates,str(coverage_id))
floors=('lines','branches','functions','statements')
members=[]
with ZipFile(root/archive_name) as archive:
    assert archive.testzip() is None
    names=archive.namelist()
    assert len(names)==len(set(names))==13
    for name in names:
        rel=PurePosixPath(name)
        assert not rel.is_absolute() and '..' not in rel.parts
        assert rel.parts[-2:]==('coverage','coverage-summary.json')
        package='tooling' if rel.parts[0]=='tooling' else rel.parts[1]
        assert package in coverage_groups and package not in {m['package'] for m in members}
        info = archive.getinfo(name)
        assert not info.is_dir() and not stat.S_ISLNK(info.external_attr >> 16)
        data=archive.read(name)
        summary=json.loads(data)
        measures=summary['total']
        api_probe = {
            key: probes for key, probes in summary.items()
            if key.endswith('/apps/api/src/testing/api-port.ts')
        }
        if package == 'api':
            assert len(api_probe) == 1
            coverage_groups[package]['apiPortModule'] = next(iter(api_probe.values()))
        assert all(isinstance(measures[key]['pct'], (float,int)) and measures[key]['pct']>=90 for key in floors)
        members.append({
            'file':name,'package':package,**receipt(data),
            'coverage': {key:measures[key] for key in floors},
            **coverage_groups[package],
        })

browser = logs['Browser']; windows =logs['Windows launcher']; template=logs['Template image']
loghit(browser, 'pnpm exec playwright test --retries=0 --workers=1')
loghit(browser, '481 passed')
loghit(browser, '1 skipped')
loghit(browser, 'GG_E2E_BROWSER_CHANNEL: msedge')
loghit(browser, 'LIVE: build, publish, and run an inference loop against Codex from the UI')
loghit(windows, '# tests 25')
loghit(windows, '# pass 25')
loghit(windows, '# fail 0')
loghit(windows, '# skipped 0')
loghit(windows, 'include-hidden-files: false')
windows_warning=loghit(windows, 'No files were found with the provided path: .tmp/windows-launcher-*/')
templates=[]
for line in template:
    body=line.partition(' ')[2]
    if body.startswith('{"template":'):
        templates.append(json.loads(body))
assert {item['template'] for item in templates}=={'starter','implementation','review','qa'}
data={
    'runId':run_id,'runNumber':920,'attempt':1,'pr':507,'status':'completed',
    'conclusion':'failure','runUrl':run['html_url'],'checkedOutSha':merge_sha,
    'publicationHead':head_sha,'publicationTree':head['tree']['sha'],'testedMerge':merge_sha,
    'testedMergeTree':merge['tree']['sha'],'target':base_sha,'targetTree':base['tree']['sha'],
    'mergeParents':[base_sha,head_sha],
    'pagination': {'jobsPages':len(job_pages),'jobCount':len(official_jobs),'artifactPages':len(artifact_pages),'artifactCount':len(artifacts)},
    'jobs':jobs,
    'gates': {'finding':{'package':'picomatch','id':'GHSA-fc5q-39xc-vjpf','range':'<=4.0.7','patched':None,
                      'observedExit':1,'severityCounts':{'low':7,'moderate':13,'high':1},
                      'auditLogStartLine':audit_start_idx,'auditExitLine':audit_exit_idx,
                      'elapsedFromRawLogSeconds':seconds(timestamp(gates[audit_start_idx-1]),timestamp(gates[audit_exit_idx-1]))},
               'testedPackages':13,'apiPortCasesPassed':13,'apiPortTestLogLines':api_port_case_lines,'passed':pass_total,'skipped':skip_total,'turboSuccessfulTasks':22,'turboElapsedSeconds':coverage_seconds},
    'coverageArchive': {'id':coverage_id,'uri':f'{run["html_url"]}/artifacts/{coverage_id}','file':archive_name,
                        **archive_digest,'floors':{k:90 for k in floors},
                        'minimum':{k:min(row['coverage'][k]['pct'] for row in members) for k in floors},
                        'members':members},
    'browser':{'passed':481,'skipped':1,'retries':0,'workers':1,'channel':'msedge'},
    'windows':{'passed':25,'skipped':0,'failed':0,'artifactCount':0,'missingUploadWarningLines':windows_warning},
    'templateImage':templates,
}
(root/'evidence.json').write_text(json.dumps(data,indent=2)+'\n',encoding='utf-8')
print(json.dumps({
    'jobDurations':{name:record['durationSeconds'] for name,record in jobs.items()},
    'audit':data['gates']['finding'],'minimums':data['coverageArchive']['minimum'],
    'matchesConnectorDecodedFingerprint':True,
    'coverageCounts':[pass_total,skip_total],'coverageSeconds':coverage_seconds,
    'zipId':coverage_id,'zipDigest':archive_digest['sha256'],
},indent=2))
