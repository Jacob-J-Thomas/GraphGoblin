"""Independent offline checks of trace page plans, source red, logs and links."""
import base64
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
from urllib.parse import unquote

OUT = Path(__file__).resolve().parent
EXT = OUT.parent
REPO = Path(r'C:\Users\98jak\.codex\worktrees\gg-20261115-runtime\GraphGoblin')
QA = REPO / 'docs/qa'
def read_json(path): return json.loads(Path(path).read_text(encoding='utf-8-sig'))
def sha(data): return hashlib.sha256(data).hexdigest()
def digest(path): return sha(Path(path).read_bytes())
def clean(path): return re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', Path(path).read_text(encoding='utf-8-sig'))
receipt = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat()}

wrappers = [QA / ('2026-11-15-history-disconnect-' + x) / 'README.md' for x in ['baseline','implementation','candidate']]
wrappers += [QA / ('2026-11-15-terminal-wait-' + x) / 'README.md' for x in ['current-ci','opus-review','completion']]
wrappers += [REPO / 'docs/delivery/2026-11-13-four-intents-register.md']
links = []
for path in wrappers:
    found = []
    for match in re.finditer(r'\[[^\]]*\]\(([^)]+)\)', path.read_text(encoding='utf-8-sig')):
        target = match.group(1)
        if re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*:', target) or target.startswith('#'):
            continue
        target = unquote(target.split('#')[0])
        if not target: continue
        destination = (path.parent / target).resolve()
        assert destination.exists(), (str(path), target)
        found.append(target)
    links.append({'file': str(path.relative_to(REPO)), 'count': len(found), 'targets': found})
receipt['links'] = links
receipt['linkTotal'] = sum(x['count'] for x in links)
assert receipt['linkTotal'] == 166

base = read_json(QA / '2026-11-15-history-disconnect-baseline/native-harness/evidence-baseline-first/summary.json')
cand = read_json(QA / '2026-11-15-history-disconnect-candidate/native/evidence-candidate-first/summary.json')
changed_modules = [key for key, binding in cand['bindings'].items() if binding['sha256'] != base['bindings'][key]['sha256']]
assert changed_modules == ['routes','history']
assert cand['baseline']['bindings'] == base['bindings']
assert all(digest(row['file']) == row['sha256'] for row in cand['bindings'].values())
receipt['loadedBindings'] = {'count': len(cand['bindings']), 'changedFromBaseline': changed_modules,
                              'candidateAllCurrentHashesMatch': True, 'baselineBindingInCandidateMatchesOriginal': True}
targets = {'historical-seed':0, 'historical-first-event':1, 'historical-two-pages':129,
 'historical-cold':693, 'historical-completed-input':693, 'historical-checkpoint':693,
 'historical-before-checkpoint':190, 'historical-past-tail':743,
 'historical-before-bad-event':199, 'historical-before-bad-checkpoint':190}
receipt['pagePlans'] = []
for phase, s in [('baseline',base),('candidate',cand)]:
    for name,target in targets.items():
        case = s['cases'][name]
        operations = case['operations']
        run_id = operations[0]['args'][0]
        assert operations[2]['stage'] == 'checkpoint' and operations[2]['args'][1] == target
        actual = [o['args'] for o in operations if o['stage']=='boundary' or o['stage'].startswith('page-')]
        expected = []
        after = 0
        if name == 'historical-checkpoint':
            expected.append([run_id,190,1]); after = 191
        while after < target:
            limit = min(128, target-after)
            expected.append([run_id,after,limit])
            observed = min(710-after,limit)
            if observed == 0: break
            after += observed
        assert actual == expected, (phase,name,actual,expected)
        receipt['pagePlans'].append({'phase':phase,'case':name,'target':target,'actual':actual})
    assert [o['stage'] for o in s['cases']['current']['operations']] == ['ownership','current']
    drained = s['cases']['historical-completed-input']['trace']
    incoming = next(t for t in drained if t['event']=='input-end')
    handler = next(t for t in drained if t['event']=='product-handler-entry')
    assert incoming['step'] < handler['step'] and not incoming['responseFinished'] and not incoming['inputAborted']
    assert s['positives']['historical-completed-input'] == s['positives']['historical-cold']

implementation = QA / '2026-11-15-history-disconnect-implementation/implementation'
red = read_json(implementation / 'focused-red-source.json')
for row in red['paths']:
    if row['path'].endswith('thread-disconnect.test.ts'):
        assert digest(implementation / 'final-test-red.ts.txt') == digest(REPO / row['path']) == row['sha256']
    else:
        raw = subprocess.check_output(['git','show',red['head']+':'+row['path']],cwd=REPO,env=dict(os.environ,GIT_OPTIONAL_LOCKS='0'))
        assert sha(raw) == row['sha256']
red_log = clean(implementation / 'focused-final-red.log')
assert 'Tests  7 failed | 3 passed (10)' in red_log
assert red_log.count('AssertionError:') == 7 and 'Timed out' not in red_log
assert 'Tests  22 passed (22)' in clean(implementation / 'focused-green.log')
local_coverage = clean(implementation / 'api-coverage.log')
assert re.search(r'Tests\s+1 failed \| 1952 passed \| 14 skipped',local_coverage)
assert 'EPERM' in local_coverage and 'tree.test.ts:56' in local_coverage
assert 'Coverage summary' not in local_coverage
assert 'Tests  7 passed (7)' in clean(implementation / 'reset-tree-isolated-diagnostic.log')
receipt['implementation'] = {'literalRedSource':red, 'finalTestMatchesCommitted':True,
    'red':{'failed':7,'passed':3,'assertionFailures':7,'timeouts':0}, 'focusedGreen':22,
    'localCoverage':{'failed':1,'passed':1952,'skipped':14,'totalsPresent':False,'failure':'reset/tree.test.ts:56 setup rename EPERM'},
    'isolatedUnchangedResetDiagnostic':7,
    'attemptReceipts':{p.stem:read_json(p) for p in implementation.glob('*.json') if p.stem not in ['candidate-source','focused-red-source']}}

gates = EXT / 'runtime-490-ci-attempt2/job-logs/gates.connector-decoded.exact.log'
log = clean(gates)
summary_lines = [line for line in log.splitlines() if re.search(r'\bTests\s+\d+ passed',line)]
passes = sum(int(re.search(r'\bTests\s+(\d+) passed',line).group(1)) for line in summary_lines)
skips = sum(int(m.group(1)) for line in summary_lines if (m:=re.search(r'(\d+) skipped',line)))
assert len(summary_lines)==13 and passes==9617 and skips==41
assert 'HEAD is now at 387322e7' in log
assert re.search(r'thread-disconnect.test.ts \(10 tests\)',log)
jobs = read_json(OUT / 'live-connector-ci.json')['jobs']['value']['structuredContent']['jobs']
gate_job = next(job for job in jobs if job['name']=='Gates')
assert gate_job['id']==133004478824 and len(gate_job['steps'])==32
assert all(s['conclusion']=='success' for s in gate_job['steps'])
receipt['ci'] = {'run':43773546178, 'attempt':2,'gatesJob':133004478824,
    'gatesSteps':32,'allStepsSuccess':True,'passes':passes,'skips':skips,'coverageGroupCount':13,
    'summaryLines':summary_lines,
    'focusedCaseLine':next(line for line in log.splitlines() if 'thread-disconnect.test.ts (10 tests)' in line),
    'keyLines':[line for line in log.splitlines() if re.search(r'HEAD is now|Tasks:|Cached:|Licence allowlist:|Generated docs are|vulnerabilities found|low \||SHA256 digest|failing enforced',line)]}
for name in ['browser','windows','template']:
    raw = clean(EXT / f'runtime-490-ci-attempt1/job-logs/{name}.connector-decoded.exact.log')
    assert 'HEAD is now at 387322e7' in raw
    selected = [line for line in raw.splitlines() if re.search(r'HEAD is now|481 passed|1 skipped|--retries=|# tests 14|# pass 14|# fail 0|No files were found|No artifacts|300 nodes, drag|starter,|implementation,|LIVE:|GG_ROUTING_STRICT_PERF',line)]
    receipt['ci'][name] = {'sha256':digest(EXT / f'runtime-490-ci-attempt1/job-logs/{name}.connector-decoded.exact.log'),'selectedLines':selected}
receipt['ci']['runMetadata']=read_json(EXT/'runtime-490-ci-attempt2/provenance/run-43773546178-attempt2-terminal.json')

receipt['result']='all detail assertions passed'
(OUT / 'detail-verification.json').write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'result':receipt['result'],'links':[{ 'file':r['file'],'count':r['count']} for r in links],
 'linkTotal':receipt['linkTotal'], 'loadedBindings':receipt['loadedBindings'],
 'sourceRedVerified':True, 'nativePagePlansVerified':len(receipt['pagePlans']),
 'currentCITestPasses':passes,'currentCITestSkips':skips,'currentCIGroups':len(summary_lines)},indent=2))
