from pathlib import Path
from hashlib import sha256
import json
E=Path('G:/ggq/delivery-evidence/2026-11-17-five-intents')
C=E/'i4-486-d216-opus-reset-controller-01'
s=json.loads((C/'SESSION.json').read_bytes())
p=json.loads((C/'startup-preflight.json').read_bytes())
assert s['pid']==21904 and s['providerInvocations']==0 and s['resetEpoch']==1795417200
assert p['source']['head']=='e630bb83679bdb055bdd90d2b30e25fbf60571ac' and p['source']['status']=='' and p['preparationMembersVerified']==42
r={'execSession':5166,'pid':s['pid'],'startedUtc':s['startedUtc'],'actualStartupState':'WAITING_FOR_EXACT_RESET','resetEpoch':s['resetEpoch'],'sessionRecordSha256':sha256((C/'SESSION.json').read_bytes()).hexdigest(),'startupPreflightSha256':sha256((C/'startup-preflight.json').read_bytes()).hexdigest(),'providerCallsAtStartup':0,'noQAResultClaimed':True}
with (E/'d217-root-admission-01/reset-controller-launch.json').open('x',encoding='utf-8') as f:json.dump(r,f,indent=2)
Q=Path('C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents')
entry='\n\nD217 reset controller actually started 2026-11-21T23:12:41.290963Z, exec session5166/PID21904. Startup verified frozen e630 source/index and all42 preparation members; state WAITING_FOR_EXACT_RESET, zero provider calls. One Opus5.5/xhigh attempt scheduled within this active session for epoch1795417200 (Nov23 07:00UTC/01:00Chicago), 2h provider cap. Output E/i4-486-d216-independent-02 after reset; no standing app automation or QA result yet. Do not start a duplicate. Preserve common no-checkout main HEAD/index a608 while the controller uses its binding; origin/main can advance independently.\n'
for n in ('OWNER-DECISIONS.md','QA-SIGN-OFF.md','RESUME.md'):
    with (Q/n).open('a',encoding='utf-8') as f:f.write(entry)
print(json.dumps(r))
