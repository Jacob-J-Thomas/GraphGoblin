"""Bind candidate classification to exact immutable source and sealed CI origin; no values emitted."""
from pathlib import Path
from hashlib import sha256
import json,re,runpy,urllib.parse

OUT=Path(__file__).resolve().parent
B=runpy.run_path(str(OUT/'bindings.py'))
globals().update({k:v for k,v in B.items() if not k.startswith('__')})

def main():
    before=source_state();review=read(OUT/'credential-context-review-02.json')
    token_file=DIAG/'trace/resources/993d48f5192d782475ee00b09b8b1673e9e3fb18.json'
    snapshot=read(token_file);token=snapshot['controlToken'];parts=token.split(':')
    require(len(parts)==3 and re.fullmatch(r'[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}',parts[0]) and parts[1].isdecimal() and parts[2]==snapshot['phase'],'Captured control revision structure differs')
    token_hash=sha256(token.encode()).hexdigest()
    require(token_hash=='ec4722ff574476dbd275400c404649ab62cc68c20055134c0f58899137b6be9b','Captured candidate hash differs')
    origins=[];headers=[];authorization=[];cookies=[]
    for p in sorted((DIAG/'trace').glob('*.network')):
        for n,line in enumerate(p.read_text(encoding='utf-8').splitlines(),1):
            row=json.loads(line).get('snapshot',{});request=row.get('request',{});response=row.get('response',{})
            url=urllib.parse.urlsplit(request.get('url',''))
            context={'network':record(p),'line':n,'method':request.get('method'),'scheme':url.scheme,'hostname':url.hostname,'port':url.port,'path':url.path,'status':response.get('status')}
            if response.get('content',{}).get('_file')=='resources/'+token_file.name:origins.append(context)
            for item in request.get('headers',[]):
                name=item['name'].lower()
                if name=='x-graphgoblin-client':headers.append({**context,'name':name,'valueBytes':len(item['value'].encode()),'valueSha256':sha256(item['value'].encode()).hexdigest()})
                if name in ['authorization','proxy-authorization','x-api-key','x-graphgoblin-api-key','x-graphgoblin-shutdown-token']:authorization.append({**context,'name':name,'valueSha256':sha256(item['value'].encode()).hexdigest()})
            if request.get('cookies'):cookies.append({**context,'cookieNames':[x['name'] for x in request['cookies']]})
    require(len(origins)==8 and all(x['path']=='/system/shutdown' and x['method']=='GET' and x['hostname']=='127.0.0.1' for x in origins),'Captured control revision endpoint differs')
    require(len(headers)==31 and len({x['valueSha256'] for x in headers})==1 and all(x['valueSha256']!=token_hash for x in headers),'Client marker differs or was conflated with control revision')
    require({x['valueSha256'] for x in headers}=={sha256(b'ui').hexdigest()},'Captured client marker does not match source UI constant')
    selections={
      'apps/api/src/routes/system.ts':[(16,17),(35,38),(51,83)],
      'apps/api/src/plugins/auth.ts':[(134,151),(169,198)],
      'apps/web/src/api/context.tsx':[(8,16)],
      'apps/web/src/api/api-key.ts':[(1,13),(62,83)],
      'apps/web/e2e/server.ts':[(1,9),(179,212),(652,678)],
      'apps/api/src/testing/test-app.ts':[(59,75),(124,139)]
    }
    excerpts=[]
    for name,ranges in selections.items():
        raw=git('show',HEAD+':'+name);a=raw.decode().splitlines()
        require(raw==(REPO/name).read_bytes(),'Source file differs from frozen Git bytes')
        excerpts.append({'path':name,'head':HEAD,'gitEntry':git('ls-tree',HEAD,'--',name).decode().strip(),'bytes':len(raw),'sha256':sha256(raw).hexdigest(),'ranges':[{'first':lo,'last':min(hi,len(a)),'lines':[{'line':n,'text':a[n-1]} for n in range(lo,min(hi,len(a))+1)]} for lo,hi in ranges]})
    write_new(OUT/'credential-source-excerpts-02.json',{'scope':'Exact source excerpts; no captured runtime token or API-key value','excerpts':excerpts})
    result={'status':'SOURCE_QUALIFIED_CANDIDATES_NO_PRIVACY_ADMISSION','discoveryRecord':record(OUT/'credential-context-review-02.json'),'controlToken':{'capturedResource':record(token_file),'field':'controlToken','valueBytes':len(token.encode()),'valueSha256':token_hash,'structure':{'parts':3,'first':'random UUID incarnation','second':'decimal control revision','thirdEqualsCapturedPhase':True},'origin':origins,'sourceCreation':'apps/api/src/routes/system.ts:35-38','sourceUse':'Optional x-graphgoblin-shutdown-token comparison before shutdown action; absent header does not grant or replace authentication','classification':'Optimistic shutdown incarnation/revision control value, not an API authentication key','revocationClaim':False,'apiAuthBoundaryChanged':False},'clientMarker':{'field':'x-graphgoblin-client','occurrences':len(headers),'opaqueValueHashDistinctFromControlToken':True,'source':'apps/web/src/api/context.tsx:8-16','classification':'Nonsecret UI provenance marker used to identify the client; not API authentication','requests':headers},'apiAuthentication':{'source':'apps/api/src/plugins/auth.ts:134-198','mechanism':'Authorization Bearer authenticates an API key or scoped device credential; private-route checks remain separate','browserStorageSource':'apps/web/src/api/api-key.ts:1-13,62-83','credentialHeaderOccurrencesInSelectedNetwork':authorization,'nonemptyRequestCookieOccurrencesInSelectedNetwork':cookies,'limit':'Selected trace network inventory is not exhaustive proof that every artifact is credential-free; compiled names/source strings are not actual API keys'},'ciFixtureBoundary':{'source':'apps/web/e2e/server.ts:179-212 and apps/api/src/testing/test-app.ts:59-75','main':'Source starts loopback main with requireApiKey false and disposable in-memory database/fake harnesses','cleanupSource':'e2e/server.ts:662-678 closes owned servers/apps; test-app.ts close removes its disposable directory','runtimeLifecycleLimit':'CI completion and intended teardown do not prove a captured credential was revoked or every process/store was retired; no revocation or PID-absence claim is made'},'initialOverbroadClassificationErratum':'The semantic candidate report grouped controlToken and x-graphgoblin-client as possible control-token material. Their hashes differ. Source establishes distinct optimistic-control revision and UI marker roles. Preserve that initial discovery, this qualification and all original bytes.','D208Scope':'Only the exact two earlier stores and keys; no authority is inherited by current or future packets.','futureInstrumentedDiagnostic':'Active separate packet not read; any actual keys and store/lifecycle claims await sealed release and separate root disposition.','ownerProviderAccountCredentials':'No actual owner/provider/account credential was positively identified by these bounded named-context/source checks. No absence or privacy-clearance claim is made.','images':'40 exact selected image assets remain subject to root contextual visual/disclosure review; no new visual QA was performed.','rootPrivacyApproved':False,'rootOwnsAnyLocalOnlyExclusionOrPublicationDecision':True}
    require(source_state()==before,'Source/index changed during source qualification')
    write_new(OUT/'credential-source-scope-02.json',result)
    print(json.dumps({'controlValueHash':token_hash,'controlOriginPath':origins[0]['path'],'clientHeaderOccurrences':len(headers),'separateOpaqueHashGroups':2,'apiCredentialHeadersObserved':len(authorization),'sourceFilesBound':len(excerpts),'privacyApproved':False,'valuesPrinted':False}))

if __name__=='__main__':main()
