from pathlib import Path
import json, hashlib, datetime
E=Path('G:/ggq/delivery-evidence/2026-11-17-five-intents')
O=Path(__file__).resolve().parent
D=E/'i5-416-420-review-reproduction-01/old'
def read(p): return json.loads(p.read_text(encoding='utf-8-sig'))
def pin(p):
    b=p.read_bytes(); return {'source':str(p),'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}
m=read(D/'MANIFEST.json')
for expected in m['members']:
    p=(D/expected['path']).resolve(); assert p.is_relative_to(D.resolve())
    got=pin(p)
    assert all(got[k]==expected[k] for k in ('bytes','sha256')), expected['path']
assert len(m['members'])==86
c=read(D/'CLOSURE-AND-CASES.json'); assert all(c['parity'].values())
runs=[]
for name,expected in [('09-review12',(0,0,61)),('11-structured-review12',(3,9,49)),('13-structured-C1',(1,1,59))]:
    report=read(D/(name+'.json'))
    cases=[x for f in report['testResults'] for x in f['assertionResults']]
    passed=sum(x['status']=='passed' for x in cases); failed=sum(x['status']=='failed' for x in cases)
    filtered=len(cases)-passed-failed
    assert (passed,failed,filtered)==expected
    receipt=read(D/(name+'.receipt.json'))
    assert receipt['exitCode']==(0 if failed==0 else 1)
    for stream in ('stdout','stderr'):
        assert pin(Path(receipt[stream]))['sha256']==receipt[stream+'Sha256']
    runs.append({'name':name,'passed':passed,'failed':failed,'filtered':filtered,'raw':pin(D/(name+'.json'))})
fixture=Path('G:/ggq/gg-i5-offline-ui-qa/GraphGoblin/apps/web/src/runs/RunInspectorPage.independent-416.qa.test.tsx')
assert pin(fixture)['sha256']=='4bf07f6fb1e26725dbc08247534eb364231a50564010f048bcc51bdb1101daa6'
result={'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'rootReadFullReportAndRawFailures':True,'verifiedMembers':86,'manifest':pin(D/'MANIFEST.json'),'report':pin(D/'REPORT.md'),'runs':runs,'fixture':pin(fixture),'disposition':'All five named findings have reached old-source failure schedules, with four distinct passing controls. Only admitted command and C1 fixture corrections were repeated. No fixed-source or browser acceptance.','C1Qualification':'The stale-label assertion failed before the later button-enabled assertions. The disabled-control consequence is source-supported, not separately observed in this failed case.','author':'Actual ordinary-Max Claude Opus5.5/xhigh, root-orchestrated, exec73886; no GPT UI implementation substitution.'}
with (O/'OLD-REPRODUCTION-ROOT-DISPOSITION.json').open('x',encoding='utf-8') as f: json.dump(result,f,indent=2); f.write('\n')
print(json.dumps({'verifiedMembers':86,'runs':runs,'rootDisposition':pin(O/'OLD-REPRODUCTION-ROOT-DISPOSITION.json')}))
