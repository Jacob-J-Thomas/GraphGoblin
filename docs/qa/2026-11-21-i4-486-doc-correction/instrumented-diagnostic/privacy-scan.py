"""Static captured-record scan. Never emit plaintext credential candidates."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import zipfile

P=Path(__file__).resolve().parent
R=Path('G:/ggq/gg-i4-553-browser-diagnostic/GraphGoblin')
def sha(data):return hashlib.sha256(data).hexdigest()
patterns={
    'graphgoblin-api-key':re.compile(rb'(?<![A-Za-z0-9_-])gg_[A-Za-z0-9_-]{32}(?![A-Za-z0-9_-])'),
    'graphgoblin-device-key':re.compile(rb'(?<![A-Za-z0-9_-])ggd_[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])'),
    'provider-or-github-candidate':re.compile(rb'(?<![A-Za-z0-9_-])(?:sk-(?:ant-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,})(?![A-Za-z0-9_-])'),
}
members=[];hits=[];headers=[];storage=[];controls=[];data_paths=set()
def walk(value,path,location):
    if isinstance(value,dict):
        if value.get('name')=='graphgoblin-api-key' and isinstance(value.get('value'),str) and value['value']:
            storage.append({'location':location,'jsonPath':path,'valueSha256':sha(value['value'].encode()),'valueBytes':len(value['value'].encode())})
        for key,item in value.items():walk(item,path+'.'+str(key),location)
    elif isinstance(value,list):
        for index,item in enumerate(value):walk(item,path+'['+str(index)+']',location)
def inspect(data,location):
    for label,pattern in patterns.items():
        for match in pattern.finditer(data):
            value=match.group();hits.append({'kind':label,'location':location,'byteOffset':match.start(),
                                           'line':data.count(b'\n',0,match.start())+1,'valueBytes':len(value),'valueSha256':sha(value)})
    for match in re.finditer(rb'[^\s"<>]{0,180}gg-api-[A-Za-z0-9_-]{3,80}',data):
        data_paths.add(match.group().decode('utf8',errors='replace'))
    if location.endswith('.trace') or location.endswith('.network'):
        for line_number,line in enumerate(data.splitlines(),1):
            try:row=json.loads(line)
            except (ValueError,UnicodeDecodeError):continue
            walk(row,'$',location+':'+str(line_number))
            if location.endswith('.network'):
                snap=row.get('snapshot',{});request=snap.get('request',{});url=request.get('url','')
                if '/worker/' in url or '/apps' in url or '/instances' in url or '/api-keys' in url:
                    controls.append({'location':location,'line':line_number,'url':url,'method':request.get('method'),'status':snap.get('response',{}).get('status')})
                for direction,part in [('request',request),('response',snap.get('response',{}))]:
                    for header in part.get('headers',[]):
                        if header.get('name','').lower() in ['authorization','proxy-authorization','x-api-key','cookie','set-cookie'] and header.get('value'):
                            value=header['value'].encode()
                            headers.append({'location':location,'line':line_number,'direction':direction,'name':header['name'],
                                            'valueBytes':len(value),'valueSha256':sha(value),'url':url})

for archive in sorted((P/'attempts').rglob('trace.zip')):
    with zipfile.ZipFile(archive) as z:
        for entry in z.infolist():
            if entry.is_dir():continue
            data=z.read(entry);location=archive.relative_to(P).as_posix()+'!'+entry.filename
            members.append({'location':location,'bytes':len(data),'sha256':sha(data)})
            if entry.filename.endswith(('.trace','.network','.js','.ts','.json','.md','.html','.txt')):inspect(data,location)
for file in sorted((P/'attempts').rglob('*')):
    if file.is_file() and file.suffix in ['.json','.jsonl','.md','.log']:
        inspect(file.read_bytes(),file.relative_to(P).as_posix())

source_ranges={
    'apps/api/src/testing/test-app.ts':[(60,78),(121,133)],
    'apps/web/e2e/server.ts':[(181,204),(611,633),(663,673)],
    'apps/api/src/plugins/auth.ts':[(193,198)],
    'packages/infrastructure/src/sqlite/settings.ts':[(263,283)],
    'apps/web/src/api/api-key.ts':[(1,12),(26,31)],
}
excerpts=[]
for file,ranges in source_ranges.items():
    data=subprocess.check_output(['git','-C',str(R),'show','29e165e14fdda138300ba2a34585ddd47268b475:'+file])
    lines=data.decode('utf8').splitlines()
    excerpts.append({'path':file,'sha256':sha(data),'ranges':[{'start':a,'end':b,'lines':[{'line':i,'text':lines[i-1]} for i in range(a,min(b,len(lines))+1)]} for a,b in ranges]})
(P/'store-privacy-source-excerpts.json').write_text(json.dumps(excerpts,indent=2)+'\n',encoding='utf8')
result={'scope':'All five retained local trace archives: textual trace/network/source/resource members, plus attempt JSON/JSONL/error-context records.',
        'traceArchives':len(list((P/'attempts').rglob('trace.zip'))),'traceMemberCount':len(members),
        'traceMembers':members,'credentialPatternCandidates':hits,'sensitiveHttpHeaderValues':headers,
        'nonemptyApiKeyStorageRecords':storage,'controlAndApiKeyRequests':controls,
        'discoveredDataDirCandidates':sorted(data_paths),
        'runtimeDatabaseLocation':':memory:','requireApiKey':False,
        'scratchRoot':str(P/'temp'),'scratchPrefix':'gg-api-',
        'scratchPathLimit':'Random mkdtemp suffixes were not logged before fixture auto-removal. Exact deleted filesystem dataDir names are unobserved; no reconstruction/re-execution attempted.',
        'keyRevocationClaim':'None. No key minted/observed means no assertion about revocation is needed. Any unexpected surviving task store must be retired pending inspection, not assumed revoked.',
        'limits':['Static format/pattern scan, not an exhaustive proof against every possible secret encoding.','Source includes a fixed test-only master-key construction; this is not an owner/provider credential.','No owner/provider stores or account material accessed.','No extra live executions to assess privacy.']}
(P/'privacy-review.json').write_text(json.dumps(result,ensure_ascii=True,indent=2)+'\n',encoding='utf8')
print(json.dumps({'traceArchives':result['traceArchives'],'traceMembers':len(members),'credentialPatternCandidates':len(hits),
                  'sensitiveHeaderValues':len(headers),'apiKeyStorageRecords':len(storage),'discoveredDataDirCandidates':len(data_paths),
                  'controlAndApiKeyRequests':len(controls)},ensure_ascii=True))
