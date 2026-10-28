// Repair QA's erroneous extra top-level defaults keys, then exercise the actual pinned shape.
import fs from'node:fs';import path from'node:path';import*as L from'./qa.mjs';
const rec=new L.Recorder('pinned-final');let g;
try{
 const entries=fs.readFileSync(path.join(L.OUT,'pids.log.txt'),'utf8').trim().split('\n').map(JSON.parse);const entry=entries.find(x=>x.label==='pinned-create');const dir=path.join(path.dirname(L.state.main),path.basename(entry.dir.replaceAll('\\','/')));const f={env:{GG_CODEX_BINARY:path.join(dir,'fake/codex.exe'),GG_CLAUDE_BINARY:path.join(dir,'fake/claude.exe')}};
 const rs=(await L.sql(dir,"SELECT id, pinned, waiting FROM runs WHERE status='waiting'")).rows;
 for(const r of rs){const pin=JSON.parse(r.pinned);const source=pin.name.endsWith('/owner')?'owner':'process';const h=pin.name.includes('codex/')?'codex':'claude';const model=h==='codex'?'gpt-5.5':'claude-haiku-5-5';delete pin.ownerDefaults;delete pin.processDefaults;
  pin.defaults.owner=source==='owner'?{byHarness:{[h]:{model,effort:'none'}}}:{byHarness:{}};
  if(source==='process')pin.defaults.process={byHarness:{[h]:{model,effort:'none'}}};
  await L.sql(dir,'UPDATE runs SET pinned=? WHERE id=?',[JSON.stringify(pin),r.id]);
 }
 g=await L.startGateway({dir,port:6373,label:'pinned-finish',env:f.env,rec});
 const requests=()=>fs.existsSync(path.join(dir,'fake/requests.jsonl'))?fs.readFileSync(path.join(dir,'fake/requests.jsonl'),'utf8'):'';
 for(const r of rs){const before=requests();const waiting=(await g.call('/runs/'+r.id)).json.waiting;const answer=await g.call('/runs/'+r.id+'/input',{method:'POST',body:{waitId:waiting.waitId,input:null}});const done=await L.waitRun(g.call,r.id,['failed','succeeded'],10000);const d=done.failure?.details;
  rec.check('pinned '+done.pinned?.name,answer.status===200&&done.failure?.code==='EVALUATION_INVALID_CONFIGURATION'&&d?.code==='EFFORT_UNSUPPORTED'&&d.path==='effort'&&!Array.isArray(d)&&d.level===(done.pinned?.name.endsWith('/owner')?'owner':'process')&&requests()===before,{failure:done.failure,status:done.status,pinned:done.pinned});
 }
}catch(e){rec.check('pinned-finish exception',false,String(e.stack??e));}finally{if(g){await g.stop();g.copyLog('pinned-finish-gateway.log.txt');}rec.finish();}
