"""Inventory sealed CI credential contexts without printing or copying values."""
from pathlib import Path
from hashlib import sha256
from collections import Counter
import json,re,runpy

OUT=Path(__file__).resolve().parent
B=runpy.run_path(str(OUT/'bindings.py'))
globals().update({k:v for k,v in B.items() if not k.startswith('__')})

def main():
    inventory=read(OUT/'input-inventory.json');source_before=source_state()
    roots=[DIAG,CI];source_records=[];observations=[];names=Counter();seen=set()
    sensitive=re.compile(r'(?i)^(?:authorization|proxy-authorization|(?:x[-_])?(?:graphgoblin[-_])?api[-_]?key|owner[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|auth[-_]?token|password|secret|client[-_]?secret|cookie|set-cookie|gg_api_key|gg_test_api_key)$')
    context_names=re.compile(r'(?i)\b(?:authorization|proxy-authorization|x-api-key|graphgoblin-api-key|apiKey|api_key|ownerKey|accessToken|refreshToken|clientSecret|GG_API_KEY|GG_TEST_API_KEY|localStorage|sessionStorage)\b')
    def emit(path,line,jpath,name,value,kind,scope):
        names[(name,kind)]+=1
        if not isinstance(value,str) or not value:return
        encoded=value.encode();normalized=re.sub(r'(?i)^Bearer\s+','',value)
        identifier=(str(path),line,jpath,name,sha256(encoded).hexdigest())
        if identifier in seen:return
        seen.add(identifier)
        observations.append({'source':record(path),'line':line,'jsonPath':jpath,'headerOrPropertyName':name,'contextType':kind,'valueBytes':len(encoded),'valueSha256':sha256(encoded).hexdigest(),'normalizedCredentialSha256':sha256(normalized.encode()).hexdigest(),'classification':scope,'classificationLimit':'Captured in source-bound CI material; this alone does not prove fixture-only provenance, store retirement or absence of owner/provider/account credentials','valuesPrintedOrCopiedIntoThisRecord':False})
    def walk(node,path,line,jpath,scope,storage_context=False):
        if isinstance(node,dict):
            expression=node.get('expression') or node.get('function') or ''
            local_context=storage_context or (isinstance(expression,str) and 'localStorage' in expression and 'graphgoblin-api-key' in expression)
            if 'name' in node and 'value' in node and isinstance(node['name'],str) and sensitive.fullmatch(node['name']):
                emit(path,line,jpath,node['name'],node['value'],'structured_header_or_named_storage_property',scope)
            if node.get('k')=='key' and isinstance(node.get('v'),dict) and local_context:
                emit(path,line,jpath,'graphgoblin-api-key',node['v'].get('s'),'playwright_serialized_localStorage_key_argument',scope)
            for k,v in node.items():
                if sensitive.fullmatch(str(k)):
                    emit(path,line,jpath+'/'+str(k),str(k),v,'structured_credential_property',scope)
                walk(v,path,line,jpath+'/'+str(k),scope,local_context)
        elif isinstance(node,list):
            if len(node)>1 and isinstance(node[0],str) and node[0].lower()=='input' and isinstance(node[1],dict):
                attrs=node[1]
                if attrs.get('type')=='password' or any(re.search(r'(?i)api.?key|auth|token|password',str(attrs.get(k,''))) for k in ['name','id','placeholder']):
                    emit(path,line,jpath,'input.value',attrs.get('value'),'captured_authentication_input_attribute',scope)
            for n,v in enumerate(node):walk(v,path,line,jpath+'/'+str(n),scope,storage_context)
    for root in roots:
        scope='CI trace/network/source attachment candidate' if root==DIAG else 'CI log or run metadata candidate'
        for p in files(root):
            source_records.append(record(p))
            if p.suffix.lower() in ['.png','.jpeg','.jpg','.woff2','.zip']:continue
            text=p.read_text(encoding='utf-8-sig',errors='replace')
            for found in context_names.finditer(text):names[(found.group().lower(),'textual_name_only')]+=1
            parsed=False
            if p.suffix=='.json':
                try:walk(json.loads(text),p,None,'$',scope);parsed=True
                except json.JSONDecodeError:pass
            if not parsed:
                for n,line in enumerate(text.splitlines(),1):
                    if line.startswith('{'):
                        try:walk(json.loads(line),p,n,'$',scope)
                        except json.JSONDecodeError:pass
                    # Literal header/property assignments in retained source or escaped diagnostic strings.
                    # Values are hashed in memory and never emitted. Expressions are not claimed to be credentials.
                    pattern=r'''(?i)(?:["'](?P<quoted>authorization|x-api-key|graphgoblin-api-key|apiKey|api_key|accessToken|refreshToken|password|clientSecret)["']|(?P<bare>apiKey|api_key|accessToken|refreshToken|password|clientSecret))\s*:\s*(["'])(?P<value>[^"'\r\n]{1,512})\3'''
                    for match in re.finditer(pattern,line):
                        emit(p,n,'text-offset:'+str(match.start()),match['quoted'] or match['bare'],match['value'],'literal_credential_property_candidate',scope)
    # Group only opaque digests, never values, to connect header/storage occurrences.
    groups={}
    for item in observations:groups.setdefault(item['normalizedCredentialSha256'],[]).append({'source':item['source']['source'],'line':item['line'],'name':item['headerOrPropertyName'],'contextType':item['contextType']})
    report={'status':'ROOT_NEW_PACKET_CREDENTIAL_CONTEXT_DISPOSITION_REQUIRED','scopeRoots':[str(r) for r in roots],'originalFilesReadAndHashed':source_records,'credentialBearingNames':[{'name':n,'contextType':t,'occurrences':c} for (n,t),c in sorted(names.items())],'potentialValueOccurrences':observations,'opaqueValueGroups':[{'normalizedCredentialSha256':h,'occurrences':v} for h,v in groups.items()],'classification':{'ciFixtureKeys':'Potential CI-captured header/storage values are inventoried below. Fixture-origin and exact retired stores require source-backed root disposition, not D208 inheritance.','localInstrumentedDiagnosticKeys':'PENDING in the separate active reproduction packet; not read, listed, inventoried or approved here.','ownerProviderAccountCredentials':'No clearance is asserted. Any matching or ambiguous occurrence remains pending root contextual review; semantic scans do not establish absence.','D208Scope':'Only its exact two earlier stores/keys. It grants no disclosure, retirement or safety decision for this CI/diagnosis or future reproduction packet.'},'images':{'selectedCount':40,'privacyInspectionPerformedHere':False,'limit':'Exact sealed screenshots/frames may contain visible data; root contextual selection review remains required.'},'limits':['Named fields, structured headers/storage and bounded literal assignments, not an exhaustive secret detector.','Source scripts and UI labels can be false positives. CI capture alone is not proof that a key is safe to disclose.','All original bytes remain unchanged; no redaction, public-copy admission, credential revocation or retired-store decision is made.','No active reproduction or owner/provider/account store/process was accessed.']}
    for item in source_records:verify(item)
    require(source_state()==source_before,'Source/index changed during read-only credential context review')
    write_new(OUT/'credential-context-review-01.json',report)
    print(json.dumps({'filesReviewed':len(source_records),'namedContexts':len(names),'potentialValueOccurrences':len(observations),'opaqueValueGroups':len(groups),'credentialNames':sorted({x['headerOrPropertyName'] for x in observations}),'valuesPrinted':False,'privacyApproved':False}))

if __name__=='__main__':main()
