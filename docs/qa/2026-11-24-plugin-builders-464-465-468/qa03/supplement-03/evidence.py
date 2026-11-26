"""Read immutable QA03 artifacts and current frozen source; never run native checks."""
from datetime import datetime
from importlib import util
import hashlib
import json
from pathlib import Path
import re
import sys

sys.dont_write_bytecode=True
HERE=Path(__file__).resolve().parent
QA=HERE.parent
E=QA.parents[1]
QA01=E/'plugin-builders-464-465-468/independent-qa-01'
QA02=E/'plugin-native-diagnosis-01/native-only-qa-02'
SHARED=E/'scope-preparation-01'
INDEX='ed2daa04358565ba90a4ef53947351c4876374c2e3e2682c25453fc3ce5b8e64'
MODEL='claude-opus-5-5'

def need(ok,label):
    if not ok:raise RuntimeError(label)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def digest(path):return sha(Path(path).read_bytes())
def read(path):return json.loads(Path(path).read_bytes())
def save(path,value):
    with Path(path).open('x',encoding='utf-8',newline='\n') as stream:
        json.dump(value,stream,indent=2,ensure_ascii=True);stream.write('\n')
def rows(path):
    for number,line in enumerate(Path(path).read_text(encoding='utf-8').splitlines(),1):
        if line:yield number,json.loads(line)
def init(path):
    found=[r for _,r in rows(path) if r.get('type')=='system' and r.get('subtype')=='init']
    need(len(found)==1 and found[0].get('model')==MODEL and found[0].get('apiKeySource')=='none','PRIOR_MODEL_INIT_NOT_BOUND')
    return {k:found[0].get(k) for k in ('model','apiKeySource','session_id','tools')}
def load_check():
    spec=util.spec_from_file_location('plugin03_readonly_snapshot',QA/'run-check.py')
    module=util.module_from_spec(spec);spec.loader.exec_module(module)
    return module
def index_hash(worktree):
    pointer=(worktree/'.git').read_text(encoding='utf-8').strip();need(pointer.startswith('gitdir: '),'OWNED_WORKTREE_POINTER_REQUIRED')
    root=Path(pointer[8:]);root=root if root.is_absolute() else worktree/root
    return digest(root/'index')

def assemble():
    check=load_check();need(index_hash(check.WORKTREE)==INDEX,'RAW_INDEX_CHANGED_BEFORE_GIT')
    check.verify_preparation();source=check.snapshot(check.environment())
    need(index_hash(check.WORKTREE)==INDEX,'RAW_INDEX_CHANGED_AFTER_READBACK')
    need(source==read(QA/'FROZEN-BEFORE.json')==read(QA/'FROZEN-AFTER.json')
         and source==read(QA/'NATIVE-RESULT.json')['before'],'QA03_SOURCE_BEFORE_AFTER_CURRENT_DRIFT')
    need(source['runtimeFileCount']==116 and len(source['changedFilesSha256'])==11,'EXACT_SOURCE_RUNTIME_COUNTS_CHANGED')
    terminal=read(QA/'CLAUDE-EXIT.json');launch=read(QA/'CLAUDE-LAUNCH.json');native=read(QA/'NATIVE-RESULT.json')
    initial=init(QA/'CLAUDE-EVENTS.private.jsonl')
    need(terminal['invocationSucceeded'] and terminal['providerExitCode']==0 and not terminal['providerError']
         and terminal['providerModel']==MODEL and terminal['providerApiKeySource']=='none'
         and terminal['providerSessionId']==initial['session_id'] and terminal['effectiveTools']==['Bash']
         and terminal['assistantModels']==terminal['meteredModels']==[MODEL]
         and terminal['usingOverage'] is False and not terminal['permissionDenials'],'ORIGINAL_ACTOR_PROVENANCE_UNPROVEN')
    need(launch['model']==MODEL and launch['effort']=='xhigh' and launch['auth']=={
        'loggedIn':True,'authMethod':'claude.ai','apiProvider':'firstParty','subscriptionType':'max','apiKeySource':None},'ORIGINAL_MAX_ROUTE_NOT_BOUND')
    need(digest(QA/'QA-REPORT.claude.md')==terminal['reportSha256']
         and b'INCOMPLETE' in (QA/'QA-REPORT.claude.md').read_bytes(),'ORIGINAL_INCOMPLETE_REPORT_CHANGED')
    need(digest(QA/'NATIVE-RESULT.json')==terminal['checkReceipts']['native']['sha256']
         and native['exitCode']==0 and native['timedOut'] is False and native['sourceUnchanged'] is True
         and native['controllerError'] is None and native['afterBindingVerified'] is True,'NATIVE_RECEIPT_NOT_BOUND')
    for stream in ('stdout','stderr'):
        item=native[stream];p=QA/item['file']
        need(digest(p)==item['sha256'] and p.stat().st_size==item['bytes'],'NATIVE_RAW_STREAM_CHANGED')
    result=read(QA/'NATIVE-PLUGIN-RESULTS.json')
    need((QA/'native.stdout.log').read_bytes()==(QA/'NATIVE-PLUGIN-RESULTS.json').read_bytes(),'NATIVE_RESULT_STDOUT_NOT_BYTE_IDENTICAL')
    for stream in ('stdout','stderr'):
        p=QA/('native-codex-app-server.'+stream+'.log')
        need(digest(p)==result['appServer'][stream+'Sha256'] and p.stat().st_size==result['appServer'][stream+'Bytes'],'APPSERVER_RAW_LOG_CHANGED')
    for item in result['commands']:
        for stream in ('stdout','stderr'):
            p=QA/('native-'+item['label']+'.'+stream+'.log')
            need(digest(p)==item[stream+'Sha256'] and p.stat().st_size==item[stream+'Bytes'],'NATIVE_COMMAND_STREAM_CHANGED')
    calls=[];answers=[]
    for number,row in rows(QA/'CLAUDE-EVENTS.private.jsonl'):
        message=row.get('message')
        if not isinstance(message,dict):continue
        for block in message.get('content',[]):
            if not isinstance(block,dict):continue
            if block.get('type')=='tool_use':calls.append({'eventLine':number,'timestamp':row.get('timestamp'),'block':block})
            if block.get('type')=='tool_result':answers.append({'eventLine':number,'timestamp':row.get('timestamp'),'block':block,'metadata':row.get('tool_use_result')})
    exact='C:/Users/98jak/AppData/Local/Programs/Python/Python311/python.exe run-check.py native'
    need(len(calls)==len(answers)==1 and calls[0]['block']['name']=='Bash'
         and calls[0]['block']['input']['command']==exact and not calls[0]['block']['input'].get('run_in_background')
         and answers[0]['block']['tool_use_id']==calls[0]['block']['id'] and not answers[0]['block'].get('is_error'),
         'ONE_NATIVE03_PAIRED_TOOL_CALL_NOT_PROVED')
    metadata=answers[0]['metadata'];need(metadata['interrupted'] is False,'ORIGINAL_TOOL_INTERRUPTED')
    # Reconstruct a derived display only; never call run-check.py or label this as recovered raw output.
    parts=[json.dumps(read(QA/name),indent=2,ensure_ascii=True)+'\n' for name in ('NATIVE-RESULT.json','NATIVE-PLUGIN-RESULTS.json')]
    for name in ('native-codex-app-server.stderr.log','native-codex-app-server.stdout.log'):
        p=QA/name;parts.extend(['FULL RAW DIAGNOSTIC '+name+' SHA256='+digest(p)+'\n',p.read_bytes().decode('utf-8',errors='backslashreplace').encode('ascii','backslashreplace').decode('ascii')+'\n'])
    derived=''.join(parts).replace('\n','\r\n').encode()
    need(len(derived)==metadata['persistedOutputSize'] and derived.decode().startswith(metadata['stdout']),
         'DERIVED_WRAPPER_DISPLAY_DOES_NOT_MATCH_RETAINED_PREFIX_AND_SIZE')
    tool_proof={'actorInit':initial,'pairedToolUse':calls[0],'pairedToolResult':answers[0],
        'persistedOutputReferencedPath':metadata['persistedOutputPath'],'persistedOutputOriginalAvailableAtPreparation':False,
        'qualification':'Recorded persisted file was absent at exact and separator-normalized path during preparation; no profile search. Complete underlying native files are supplied instead.',
        'derivedWrapperDisplay':{'bytes':len(derived),'sha256':sha(derived),'matchesRecordedSize':True,
          'matchesEntireRetained30000CharacterStdoutPrefix':True,'isOriginalRecoveredRaw':False}}
    reused={}
    for mode,count in (('BUILD',None),('CODEX',11),('CLAUDE',11),('WRITER',38)):
        receipt=read(QA01/(mode+'-RESULT.json'));need(receipt['exitCode']==0 and receipt['sourceUnchanged'],'QA01_REUSED_CHECK_NOT_SUCCESS')
        for stream in ('stdout','stderr'):need(digest(QA01/receipt[stream]['file'])==receipt[stream]['sha256'],'QA01_REUSED_STREAM_CHANGED')
        text=re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]','',(QA01/receipt['stdout']['file']).read_bytes().decode('utf-8'))
        if count is not None:need(re.search(r'Tests\s+'+str(count)+r' passed\s+\('+str(count)+r'\)',text),'REUSED_UNIT_COUNT_NOT_IN_RAW')
        reused[mode]={'receiptSha256':digest(QA01/(mode+'-RESULT.json')),'expectedTests':count,
                     'actualCountLines':[line for line in text.splitlines() if re.search(r'Tasks:|Cached:|Tests\s+\d',line)]}
    need(read(QA01/'NATIVE-RESULT.json')['exitCode']==read(QA02/'NATIVE-RESULT.json')['exitCode']==1,'PRIOR_NATIVE_FAIL_HISTORY_CHANGED')
    # Complete safe attachments, exact bytes. Private model journals/prompts are never delivered.
    paths=[QA/name for name in ('QA-CONTRACT.json','QA-REPORT.claude.md','CLAUDE-LAUNCH.json','CLAUDE-EXIT.json',
        'NATIVE-ATTEMPT.json','NATIVE-RESULT.json','NATIVE-PLUGIN-RESULTS.json','native.stdout.log','native.stderr.log',
        'native-codex-rpc.json','native-codex-app-server.stdout.log','native-codex-app-server.stderr.log',
        'BINDINGS.json','SOURCE-BINDINGS.json','FROZEN-BEFORE.json','FROZEN-AFTER.json','BUILTIN-SOURCE-LOCATORS.json','native-plugin-logging.mjs','run-check.py')]
    paths.extend(QA/('native-'+item['label']+'.'+stream+'.log') for item in result['commands'] for stream in ('stdout','stderr'))
    paths.extend(QA01/(mode+'-RESULT.json') for mode in reused)
    paths.extend(QA01/(mode.lower()+'.'+stream+'.log') for mode in reused for stream in ('stdout','stderr'))
    paths.extend(QA01/name for name in ('QA-REPORT.claude.md','NATIVE-RESULT.json','NATIVE-PLUGIN-RESULTS.json','native-claude-validate.stdout.log','native-claude-validate.stderr.log'))
    paths.extend(QA02/name for name in ('QA-REPORT.claude.md','NATIVE-RESULT.json','NATIVE-PLUGIN-RESULTS.json','native-claude-validate.stdout.log','native-claude-validate.stderr.log'))
    paths.extend(QA02/'mcp-trace'/name for name in ('mcp-49164.events.jsonl','mcp-49164.state.json','mcp-49164.stdin.raw','mcp-49164.stdout.raw','mcp-49164.stderr.raw'))
    paths.extend(QA.parent/name for name in ('PREPARATION-BLOCKED.json','DIAGNOSIS.json'))
    raw={str(p):p.read_bytes() for p in dict.fromkeys(paths)}
    # The proof is also injected directly, so it does not depend on a generated file during initial freeze.
    source_excerpts={}
    for rel,ranges in {'apps/mcp/src/resources.ts':None,'apps/mcp/src/server.ts':[(20,42)],
                       'packages/api-client/src/resources.ts':[(130,145)],'apps/api/src/routes/runs.ts':[(131,157)]}.items():
        data=(check.WORKTREE/rel).read_bytes();lines=data.decode('utf-8').splitlines(keepends=True)
        need(sha(data)==read(QA/'SOURCE-BINDINGS.json')['sourcePacketFilesSha256'][rel],'SOURCE_EXCERPT_FULL_FILE_DRIFT: '+rel)
        for low,high in ranges or [(1,len(lines))]:source_excerpts[rel+f':{low}-{high}']=(''.join(lines[low-1:high])).encode()
    sessions={str(q):init(q/'CLAUDE-EVENTS.private.jsonl')['session_id'] for q in (QA01,QA02,QA)}
    for q in (E/'plugin-builders-464-465-468/claude-author-run-01',E/'plugin-builders-464-465-468/claude-correction-01'):
        if (q/'CLAUDE-EVENTS.private.jsonl').is_file():sessions[str(q)]=init(q/'CLAUDE-EVENTS.private.jsonl')['session_id']
    proof={'source':source,'rawIndexBeforeAfter':INDEX,'rawInputHashes':{name:sha(data) for name,data in raw.items()},
           'toolProof':tool_proof,'reusedBuildUnits':reused,'originalSessions':sessions,
           'nativeDurationSeconds':(datetime.fromisoformat(native['finishedAt'])-datetime.fromisoformat(native['startedAt'])).total_seconds(),
           'original03ReportDisposition':'INCOMPLETE; controller exit0 proves invocation/check completion only',
           'prior01And02NativeDisposition':'FAIL, preserved','sourceAndRuntimeFileCount':116,
           'nativeChildPidAndOsExitObserved':False,'logicalDiagnosticsAreByteWire':False,
           'privateProviderReasoningDelivered':False,'sourceExcerptHashes':{k:sha(v) for k,v in source_excerpts.items()},
           'guardedPrivateJournalsNotDelivered':{str(Path(q)/'CLAUDE-EVENTS.private.jsonl'):digest(Path(q)/'CLAUDE-EVENTS.private.jsonl') for q in sessions}}
    return proof,raw,source_excerpts,derived
