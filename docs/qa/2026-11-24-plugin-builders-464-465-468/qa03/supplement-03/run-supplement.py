"""Tool-free actual-Claude supplement, adapted from successful #554 pattern."""
from datetime import datetime,timezone
from importlib import import_module
import json
from pathlib import Path
import subprocess
import sys
from threading import Event,Thread

sys.dont_write_bytecode=True
import evidence as ev
HERE=ev.HERE
CONTRACT=HERE/'SUPPLEMENT-CONTRACT.json'
PROOF=HERE/'READONLY-EVIDENCE-PROOF.json'
APPROVAL=HERE/'ROOT-ADMISSION.json'
OUT=HERE/'claude-supplement-01'
FLOOR='2026-11-25T10:10:20+00:00'
TIMEOUT=1800
VERDICTS=('# SCOPED PASS','# SCOPED FAIL','# SCOPED BLOCKED')
sys.path.insert(0,str(ev.SHARED))
shared=import_module('prepare-scope')

def construct():
    proof,raw,excerpts,derived=ev.assemble()
    tool=proof['toolProof']; answer=tool['pairedToolResult']; metadata=answer['metadata']
    compact={k:v for k,v in proof.items() if k not in ('rawInputHashes','toolProof','guardedPrivateJournalsNotDelivered')}
    compact['toolProof']={k:v for k,v in tool.items() if k!='pairedToolResult'}
    compact['toolProof']['pairedToolResult']={k:v for k,v in answer.items() if k!='metadata'}
    compact['toolProof']['pairedToolResult']['metadata']={k:v for k,v in metadata.items() if k!='stdout'}
    compact['toolProof']['omittedMetadataStdout']={'characters':len(metadata['stdout']),'sha256Utf8':ev.sha(metadata['stdout'].encode()),'delivery':'not supplied; exact prefix/size reconstruction guard retained'}
    binding=ev.read(ev.QA/'BINDINGS.json')
    compact['complete116FileSourceRuntimeMap']=binding['currentSourceAndRuntimeFiles']
    prior=ev.read(ev.QA02/'NATIVE-PLUGIN-RESULTS.json')
    compact['legacy02ExactScopedProjection']={k:prior[k] for k in ('nodeVersion','fixtureGatewayResponse','fixtureGatewayRequests','directResourceOracle','claude')}
    compact['legacy02TraceBinding']={str(p):ev.digest(p) for p in sorted((ev.QA02/'mcp-trace').iterdir()) if p.is_file()}
    compact['inputDeliveryQualification']='All original input hashes and private-journal hashes remain guarded by unchanged evidence.py/READONLY-EVIDENCE-PROOF.json and contract. Only explicitly labelled complete attachments below are delivered; other originals are bound-only. Projections are derived from guarded originals, not recovered raw.'
    blocks=[(HERE/'SUPPLEMENT-BRIEF.md').read_text(encoding='utf-8'),'DERIVED SCOPED PROVENANCE PROJECTION (complete116-file hash map; no raw log completeness claim):\n'+json.dumps(compact,indent=2,ensure_ascii=False,sort_keys=True)]
    full_names={'QA-REPORT.claude.md','CLAUDE-LAUNCH.json','CLAUDE-EXIT.json','NATIVE-ATTEMPT.json','NATIVE-RESULT.json','NATIVE-PLUGIN-RESULTS.json','native-codex-rpc.json','native-codex-app-server.stdout.log','native-codex-app-server.stderr.log'}
    selected={name:data for name,data in raw.items() if Path(name).parent==ev.QA and Path(name).name in full_names}
    selected.update(excerpts)
    delivered={};aliases={};by_sha={}
    for name,data in selected.items():
        content=data.decode('utf-8');ev.need(content.encode('utf-8')==data,'NONLOSSLESS_ATTACHMENT: '+name)
        digest=ev.sha(data)
        if digest in by_sha:
            aliases[name]={'identicalTo':by_sha[digest],'bytes':len(data),'sha256':digest};continue
        by_sha[digest]=name;delivered[name]={'bytes':len(data),'sha256':digest}
        blocks.append('BEGIN COMPLETE LITERAL EVIDENCE '+name+' bytes='+str(len(data))+' SHA256='+digest+'\n'+content+'\nEND COMPLETE LITERAL EVIDENCE '+name)
    blocks.append('Exact byte-identical aliases supplied once above:\n'+json.dumps(aliases,indent=2,ensure_ascii=False))
    prompt='\n\n'.join(blocks).encode('utf-8')
    ev.need(len(prompt)<=200000,'FOCUSED_SUPPLEMENT_PROMPT_EXCEEDS_200000: '+str(len(prompt)))
    c={'issues':[464,465,468],'decision':'FUP081','role':'fresh tool-free immutable evidence assessment supplement timeout continuation03','model':'claude-opus-5-5',
       'effort':'xhigh','tools':[],'notBefore':FLOOR,'deadlineSeconds':TIMEOUT,'source':proof['source'],
       'originalSessions':proof['originalSessions'],'original03Disposition':'INCOMPLETE, unchanged',
       'original01And02NativeDisposition':'FAIL, unchanged','rawInputs':proof['rawInputHashes'],
       'guardedPrivateJournalsNotDelivered':proof['guardedPrivateJournalsNotDelivered'],
       'deliveredCompleteEvidence':delivered,'byteIdenticalAliases':aliases,'sourceExcerpts':proof['sourceExcerptHashes'],
       'boundOnlyOriginals':{name:ev.sha(data) for name,data in raw.items() if name not in selected},
       'scopedProjectionSha256':ev.sha(json.dumps(compact,indent=2,ensure_ascii=False,sort_keys=True).encode()),
       'evidenceScriptSha256':ev.digest(HERE/'evidence.py'),'runnerSha256':ev.digest(Path(__file__)),
       'briefSha256':ev.digest(HERE/'SUPPLEMENT-BRIEF.md'),'subscriptionHelperSha256':ev.digest(ev.SHARED/'prepare-scope.py'),
       'sourceRunnerPatternSha256':ev.digest(ev.E/'authored-cleanup-554/qa-supplement-01/run-supplement.py'),
       'previousPreparationManifestSha256':ev.digest(HERE.with_name('evidence-supplement-02')/'MANIFEST.json'),
       'previousTimedOutReceiptSha256':ev.digest(HERE.with_name('evidence-supplement-02')/'claude-supplement-01/CLAUDE-EXIT.json'),
       'promptBytes':len(prompt),'promptSha256':ev.sha(prompt),'original03ExitSha256':ev.digest(ev.QA/'CLAUDE-EXIT.json'),
       'derivedWrapperDisplaySha256':ev.sha(derived),'derivedDisplayDelivered':False,'nativeCallsAuthorized':0,'ownerAcceptance':False}
    return c,prompt,proof,derived

def events(path):
    for line in path.read_text(encoding='utf-8',errors='replace').splitlines():
        try:yield json.loads(line)
        except json.JSONDecodeError:continue
def monitor(path,child,stop):
    while not stop.wait(1):
        if any(r.get('rate_limit_info',{}).get('isUsingOverage') is True for r in events(path)):
            if child.poll() is None:child.kill()
            return
def dispatch(c,prompt):
    approval={'authorized':True,'issues':[464,465,468],'decision':'FUP081','kind':'tool-free-qa03-evidence-supplement','ordinaryMaxOnly':True,
              'contractSha256':ev.digest(CONTRACT),'promptSha256':c['promptSha256'],
              'original03ExitSha256':c['original03ExitSha256'],'original03IncompletePreserved':True,'tools':[]}
    ev.need(APPROVAL.is_file() and ev.read(APPROVAL)==approval,'EXACT_ROOT_TOOLFREE_SUPPLEMENT_ADMISSION_REQUIRED')
    ev.need(datetime.now(timezone.utc)>=datetime.fromisoformat(FLOOR),'WAIT_NATURAL_RESET_FLOOR')
    ev.need(not OUT.exists(),'ONE_FRESH_TOOLFREE_SUPPLEMENT_ONLY')
    env=shared.subscription_environment();auth=shared.require_subscription(env)
    current,new_prompt,new_proof,_=construct()
    ev.need(current==c and new_prompt==prompt and ev.read(PROOF)==new_proof,'INPUT_CHANGED_BEFORE_PROVIDER')
    OUT.mkdir(exist_ok=False);(OUT/'CLAUDE-BRIEF.private.txt').write_bytes(prompt);ev.save(OUT/'CLAUDE-INPUTS.json',c)
    args=shared.common_cli_options()+['--tools','','--system-prompt',
        'Fresh independent tool-free plugin QA03 evidence supplement. Use only complete supplied immutable evidence. '
        'No tools or new execution. Original INCOMPLETE and native01/02 FAIL history remain unchanged. '
        'Report scoped criterion verdicts and exact logical-versus-wire/process visibility limits.']
    raw=OUT/'CLAUDE-EVENTS.private.jsonl';done=Event();timed_out=False
    with raw.open('xb') as out,(OUT/'CLAUDE-STDERR.private.log').open('xb') as err:
        with subprocess.Popen(args,cwd=OUT,env=env,stdin=subprocess.PIPE,stdout=out,stderr=err,
                              creationflags=subprocess.CREATE_NO_WINDOW) as child:
            ev.save(OUT/'CLAUDE-LAUNCH.json',{'model':shared.MODEL,'effort':'xhigh','tools':[],'auth':auth,'pid':child.pid,
                    'startedUtc':shared.utc_now(),'contractSha256':ev.digest(CONTRACT),'promptSha256':ev.sha(prompt),'role':c['role']})
            watcher=Thread(target=monitor,args=(raw,child,done),daemon=True);watcher.start()
            try:child.communicate(prompt,timeout=TIMEOUT)
            except subprocess.TimeoutExpired:
                timed_out=True;child.kill();child.communicate(timeout=20)
            finally:done.set();watcher.join(timeout=2)
    rows=list(events(raw));inits=[r for r in rows if r.get('type')=='system' and r.get('subtype')=='init'];initial=inits[0] if len(inits)==1 else {}
    result,calls,models=shared.read_result(raw);report=(result.get('result') or '').strip();verdict=report.splitlines()[0] if report else None
    rates=[r['rate_limit_info'].get('isUsingOverage') for r in rows if 'rate_limit_info' in r]
    after,unchanged,error=None,False,None
    try:
        after,again,newproof,_=construct();unchanged=after==c and again==prompt and ev.read(PROOF)==newproof
    except (OSError,RuntimeError,ValueError,KeyError,subprocess.SubprocessError) as failure:error=str(failure)
    valid=(child.returncode==0 and not timed_out and result.get('is_error') is False and verdict in VERDICTS
           and initial.get('model')==shared.MODEL=='claude-opus-5-5' and initial.get('apiKeySource')=='none'
           and initial.get('session_id') and initial['session_id'] not in c['originalSessions'].values()
           and initial.get('tools')==[] and not calls and not result.get('permission_denials')
           and list(result.get('modelUsage',{}))==models==[shared.MODEL] and rates and set(rates)=={False} and unchanged)
    report_name='SUPPLEMENT-REPORT.claude.md' if valid else 'SUPPLEMENT-PARTIAL-UNVALIDATED.claude.md'
    if report:(OUT/report_name).write_bytes(report.encode()+b'\n')
    receipt={'validated':bool(valid),'verdict':verdict,'scopedEvidenceAccepted':bool(valid and verdict=='# SCOPED PASS'),
       'providerExitCode':child.returncode,'timedOut':timed_out,'providerModel':initial.get('model'),
       'providerApiKeySource':initial.get('apiKeySource'),'providerSessionId':initial.get('session_id'),
       'effectiveTools':initial.get('tools'),'toolCalls':calls,'assistantModels':models,'overageObservations':rates,
       'permissionDenials':result.get('permission_denials',[]),'sourceBefore':c['source'],'sourceAfter':after['source'] if after else None,
       'sourceAndAllEvidenceUnchanged':unchanged,'postflightError':error,'original03Disposition':'INCOMPLETE preserved',
       'nativeBuildUnitReplayCount':0,'rawEventsSha256':ev.digest(raw),'rawStderrSha256':ev.digest(OUT/'CLAUDE-STDERR.private.log'),
       'reportTextSha256':ev.sha(report.encode()) if report else None,'reportFileSha256':ev.digest(OUT/report_name) if report else None,'finishedUtc':shared.utc_now()}
    ev.save(OUT/'CLAUDE-EXIT.json',receipt)
    print(json.dumps({k:v for k,v in receipt.items() if k not in ('sourceBefore','sourceAfter')},ensure_ascii=True))
    return int(not receipt['scopedEvidenceAccepted'])

def main():
    ev.need(sys.argv[1:] in ([],['--freeze-local-contract'],['--check-contract']),'USE run-supplement.py [--freeze-local-contract|--check-contract]')
    c,prompt,proof,derived=construct()
    if sys.argv[1:]==['--freeze-local-contract']:
        ev.need(not CONTRACT.exists() and not PROOF.exists() and not OUT.exists(),'SUPPLEMENT_ALREADY_FROZEN')
        ev.save(PROOF,proof);ev.save(CONTRACT,c)
        (HERE/'FROZEN-PROMPT.txt').write_bytes(prompt)
        (HERE/'DERIVED-WRAPPER-DISPLAY.txt').write_bytes(derived)
        ev.save(HERE/'ROOT-ADMISSION.template.json',{'authorized':True,'issues':[464,465,468],'decision':'FUP081',
            'kind':'tool-free-qa03-evidence-supplement','ordinaryMaxOnly':True,'contractSha256':ev.digest(CONTRACT),
            'promptSha256':c['promptSha256'],'original03ExitSha256':c['original03ExitSha256'],'original03IncompletePreserved':True,'tools':[]})
        ev.save(HERE/'QUEUE-ITEM.proposed.json',{'id':'plugin-464-465-468-qa03-evidence-supplement-03','notBefore':FLOOR,
            'argv':[sys.executable,str(Path(__file__).resolve())],'cwd':str(HERE),'contractSha256':ev.digest(CONTRACT),
            'role':'tool-free immutable-evidence supplement','queueEligible':False})
    ev.need(ev.read(CONTRACT)==c and ev.read(PROOF)==proof and (HERE/'FROZEN-PROMPT.txt').read_bytes()==prompt,
            'FROZEN_SUPPLEMENT_SOURCE_OR_EVIDENCE_CHANGED')
    if sys.argv[1:]:
        print(json.dumps({'contractValid':True,'providerInvoked':False,'testsNativeBuildRun':False,'tools':[],
          'promptBytes':len(prompt),'promptSha256':c['promptSha256'],'contractSha256':ev.digest(CONTRACT),
          'deliveredUniqueFullAttachments':len(c['deliveredCompleteEvidence']),'byteIdenticalAliases':len(c['byteIdenticalAliases']),
          'runtimeSourceFiles':116,'rootAdmissionPresent':APPROVAL.exists()},ensure_ascii=True));return 0
    return dispatch(c,prompt)

if __name__=='__main__':
    try:raise SystemExit(main())
    except (OSError,RuntimeError,ValueError,KeyError,subprocess.SubprocessError) as error:
        print(str(error),file=sys.stderr);raise SystemExit(2)
