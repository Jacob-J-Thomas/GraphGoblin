from pathlib import Path
from datetime import datetime,timezone
import hashlib,json
O=Path(__file__).resolve().parent; E=O.parent
def read(p): return json.loads(p.read_text(encoding='utf-8-sig'))
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
packets={
 'i5-416-420-ui-independent-qa-01/corrected-component-execution-01':'31ef84de938cf37ec46205dbe900587d29bc0a682e8a79f17be228ee1732cab6',
 'i5-416-420-ui-independent-qa-01/corrected-component-execution-02':'64ee0e1feb0df61ddb07476262943ac0327e5f6e9aee52d80a100d5f226d5392',
 'i5-d241-independent-qa-fixture-correction-01':'740f550dbf7ca41c816a92a3742f402fbd9b6151c0b3a60eed8f0702090bfcb7',
 'i5-416-420-corrected-component-execution-preparation-02':'5f14927a8ec2b07eaea0fb94ac9680aac1942e9945e8dc212667da511163d2b2'}
verified={}
for directory,digest in packets.items():
 d=E/directory; assert sha(d/'MANIFEST.json')==digest,directory
 members=read(d/'MANIFEST.json')['members']
 for member in members:
  p=d/member['path']; assert p.stat().st_size==member['bytes'] and sha(p)==member['sha256'],p
 verified[directory]={'manifestSha256':digest,'verifiedMembers':len(members)}
p=E/'i5-416-420-ui-independent-qa-01/corrected-component-execution-02'
r=read(p/'06-full61.json'); cases=[a for t in r['testResults'] for a in t['assertionResults']]
assert len(cases)==61 and all(a['status']=='passed' for a in cases)
phase=read(p/'PHASE-RECEIPT.json')
assert phase['failure'] is None and phase['stageReached']=='completed' and phase['afterMatchesRootBinding']
assert all(c['exitCode']==0 for c in phase['commands'])
assert read(p/'before.json')==read(p/'after.json')
out={'utc':datetime.now(timezone.utc).isoformat(),'rootReadReportFailureAndMinimalFixtureDelta':True,'verifiedPackets':verified,'actualExecutedSource':{'head':'d71fbe81a3bff5ea3c9cb672fa470a16c0d4a881','tree':'57e4fb60972870657bb0ee04ae01d21bcc4fe777'},'casesPassed':61,'failed':0,'filteredOrPendingOrTodo':0,'behavioralStderrBytes':(p/'06-full61.stderr.log').stat().st_size,'allSevenCommandsPassed':True,'sourceControlsBeforeAfterEqual':True,'firstResultRetained':'60passed/1ambiguous alert text lookup failed; final one-POST assertion then unreached. Second run reaches every retained assertion. No result relabelled.','acceptedScope':'Independent component evidence for original49 controls and twelve supplemental schedules; public fixtures only.','limits':['Source carry to223 requires explicit exact product equality; actual executed head remainsd71.','No native listener/browser/geometry/CI/current coverage/finalreview/merge/owner acceptance claim.']}
with (O/'ACCEPTANCE.json').open('x',encoding='utf-8') as f: json.dump(out,f,indent=2); f.write('\n')
print(json.dumps({'verifiedMembers':sum(v['verifiedMembers'] for v in verified.values()),'casesPassed':61,'acceptanceSha256':sha(O/'ACCEPTANCE.json')}))
