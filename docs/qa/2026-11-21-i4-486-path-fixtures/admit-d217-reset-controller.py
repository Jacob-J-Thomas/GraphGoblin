from pathlib import Path
from hashlib import sha256
from datetime import datetime,timezone
import json
E=Path('G:/ggq/delivery-evidence/2026-11-17-five-intents')
P=E/'i4-486-d216-opus-reset-continuation-preparation-01'
raw=(P/'SHA256SUMS.json').read_bytes()
assert sha256(raw).hexdigest()=='aba1c961be727896288691dbd6c3cf1221791a6189bca0cba5f29bd4737e8f69'
rows=json.loads(raw)['files'];assert len(rows)==42
for row in rows:
    p=(P/row['path']).resolve();assert p.is_relative_to(P.resolve())
    b=p.read_bytes();assert len(b)==row['bytes'] and sha256(b).hexdigest()==row['sha256'],row['path']
assert sha256((P/'controller.py').read_bytes()).hexdigest()=='1f49882ba4e05f2bdbf9ff0ff7850388582770e94de6b929e6280e8967674a23'
check=json.loads((P/'verification-02.json').read_bytes())
assert check['controllerSha256']==sha256((P/'controller.py').read_bytes()).hexdigest()
assert [x['exit'] for x in check['checks']]==[0,23] and check['providerCalls']==0
c=json.loads((P/'config.template.json').read_bytes());assert c['rootExecutionAuthorized'] is False
c['rootExecutionAuthorized']=True
dest=E/'i4-486-d216-opus-reset-controller-config.root-admitted-01.json'
with dest.open('x',encoding='utf-8') as f:json.dump(c,f,indent=2)
receipt={'at':datetime.now(timezone.utc).isoformat(),'preparationMembersVerified':42,'sealSha256':sha256(raw).hexdigest(),'controllerSha256':check['controllerSha256'],'briefReadInFull':True,'controllerReadInFullIncludingFinalSpecBinding':True,'realPreResetRefusalExit':23,'rootConfig':str(dest),'rootConfigSha256':sha256(dest.read_bytes()).hexdigest(),'singleActualOpusAfterResetAuthorized':True,'resetEpoch':1795417200,'maximumProviderSeconds':7200,'actualControllerLaunchPending':True,'noQAOrMergeAcceptance':True}
with (E/'d217-root-admission-01/reset-controller-admission.json').open('x',encoding='utf-8') as f:json.dump(receipt,f,indent=2)
print(json.dumps(receipt))
