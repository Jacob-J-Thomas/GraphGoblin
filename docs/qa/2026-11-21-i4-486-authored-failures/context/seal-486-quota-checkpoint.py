from pathlib import Path
import json,hashlib,shutil,datetime,subprocess
q=Path(__file__).resolve().parent;out=q/'i4-486-quota-checkpoint-01';out.mkdir(exist_ok=False)
sha=lambda b:hashlib.sha256(b).hexdigest();records=[]
for name in ['i4-486-fable-review-01','i4-486-independent-01']:
 root=q/name;provider=root/'provider';exit=json.loads((provider/'exit.json').read_bytes());launch=json.loads((provider/'launch.json').read_bytes());events=[json.loads(x) for x in (provider/'events.jsonl').read_text(encoding='utf-8').splitlines()];results=[x for x in events if x.get('type')=='result'];assert len(results)==1
 result=results[0];assert exit['code']==1 and result['is_error'] and result['api_error_status']==429 and result['api_error']=='usage_limit_reached'
 visible=[];calls=[]
 for event in events:
  if event.get('type')=='assistant':
   for item in event.get('message',{}).get('content',[]):
    if item.get('type')=='text':visible.append({'timestamp':event.get('timestamp'),'text':item.get('text','')})
    if item.get('type')=='tool_use':calls.append({'timestamp':event.get('timestamp'),'name':item.get('name'),'input':item.get('input')})
 files=[]
 for file in sorted(root.rglob('*')):
  if file.is_file():
   rel=file.relative_to(root);b=file.read_bytes();record={'path':rel.as_posix(),'bytes':len(b),'sha256':sha(b),'original':str(file)}
   if rel.parts[0]!='provider':
    dest=out/name/rel;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(file,dest);assert dest.read_bytes()==b;record['snapshot']=str(dest)
   files.append(record)
 packet={'root':name,'launch':launch,'exit':exit,'result':result,'files':files,'verdict':'NONE: quota error, not worker success','reviewSlot':'unfinished formal1' if 'fable' in name else 'independent QA incomplete'}
 (out/(name+'-visible-text.json')).write_bytes((json.dumps(visible,indent=2)+'\n').encode());(out/(name+'-tool-calls.json')).write_bytes((json.dumps(calls,indent=2)+'\n').encode());records.append(packet)
source=[]
for repo in ['G:/ggq/gg-i4-486-authored-errors/GraphGoblin','G:/ggq/gg-i4-486-qa/GraphGoblin']:
 h=subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip();status=subprocess.check_output(['git','status','--porcelain'],cwd=repo);assert h=='633d9ac72c10fe4b8d76f7ba50221f9ed8557cb9' and not status
 source.append({'repo':repo,'head':h,'clean':True})
record={'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'resetUTC':'2026-11-21T16:00:00Z','sameModelsAndEffortRequired':True,'noPaidOverage':True,'source':source,'packets':records,'continuation':'Fresh provider output folders after reset, with original transcript and frozen source; runner disables session persistence. Do not overwrite original records or call quota text an approval.'}
(out/'checkpoint.json').write_bytes((json.dumps(record,indent=2)+'\n').encode());seal=[{'path':p.relative_to(out).as_posix(),'bytes':p.stat().st_size,'sha256':sha(p.read_bytes())} for p in sorted(out.rglob('*')) if p.is_file()];(out/'SHA256SUMS.json').write_bytes((json.dumps(seal,indent=2)+'\n').encode());print(json.dumps({'packets':len(records),'snapshotMembers':len(seal),'sealSha256':sha((out/'SHA256SUMS.json').read_bytes()),'resetUTC':record['resetUTC']}))
