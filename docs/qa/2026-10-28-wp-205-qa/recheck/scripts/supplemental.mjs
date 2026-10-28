// Covers all six wider-fixture runs and the clean-store #426 upgrade control.
import path from'node:path';import{pathToFileURL}from'node:url';import*as L from'./qa.mjs';import{find}from'./recipe.mjs';
const rec=new L.Recorder('supplemental'),gs=[];const stop=async g=>{rec.check('ended '+g.label,await g.stop()!==null,g.exitCode());g.copyLog(g.label+'-gateway.log.txt');};
try{
 const dir=L.state.wide.dir;const env={GG_CODEX_BINARY:path.join(dir,'fake/codex.exe'),GG_CLAUDE_BINARY:path.join(dir,'fake/claude.exe')};let g=await L.startGateway({dir,port:6372,label:'wide-all-reads',env,rec});gs.push(g);
 const ids=(await L.sql(dir,'SELECT id FROM runs')).rows.map(r=>r.id),statuses=[];
 for(const id of ids)for(const suffix of['','/events?after=0&limit=1000','/thread']){const r=await g.call('/runs/'+id+suffix);statuses.push({runId:id,read:suffix||'/run',status:r.status});}
 rec.check('all six wider-fixture runs, including event/webhook, serve run/events/thread 200',ids.length===6&&statuses.every(s=>s.status===200),statuses);
 const receipts={};for(const t of['webhook_receipts','event_receipts']){const rows=(await L.sql(dir,`SELECT id,intent FROM ${t}`)).rows;receipts[t]=rows.map(r=>({id:r.id,run:JSON.parse(r.intent).run.pinned.defaults,queued:JSON.parse(r.intent).queued.pinned.defaults}));}
 rec.check('receipt typed defaults repaired to none',Object.values(receipts).every(rs=>rs.length>0&&rs.every(r=>[r.run.owner,r.run.process,r.queued.owner,r.queued.process].every(x=>x.byHarness.codex?.effort==='none'))),receipts);
 const authorVersionIds=(await L.sql(dir,'SELECT id FROM loop_versions WHERE loop_id=?',[L.state.wide.loops.authored])).rows.map(r=>r.id);rec.check('authored-only versions absent from discovery after repair',(await find(dir)).every(r=>!authorVersionIds.some(id=>r.ref.includes(id))));await stop(g);
 const clean=L.makeStore('clean-upgrade'),f=L.fake(clean);g=await L.startGateway({dir:clean,port:6372,label:'clean-base',env:f.env,rec,root:L.state.main,loader:pathToFileURL(path.join(L.OUT,'scripts/baseline-loader.mjs')).href});gs.push(g);
 await g.call('/settings',{method:'PUT',body:{defaults:{byHarness:{codex:{model:'gpt-6-luna',effort:'low'}}}}});await g.call('/model-catalog/codex/gpt-6-astra',{method:'PATCH',body:{enabled:false}});
 const id=await L.publishLoop(g.call,L.single('QA205b clean control',L.inferenceNode('work',{model:'gpt-6-luna',effort:'max'})));const before={loop:(await g.call('/loops/'+id)).json,settings:(await g.call('/settings')).json};const old=(await g.call('/model-catalog')).json.items.find(r=>r.model==='gpt-6-luna');await stop(g);
 g=await L.startGateway({dir:clean,port:6372,label:'clean-head',env:f.env,rec});gs.push(g);const after={loop:(await g.call('/loops/'+id)).json,settings:(await g.call('/settings')).json};const cat=(await g.call('/model-catalog')).json.items;
 rec.check('clean upgrade refreshes seeds, preserves loop/defaults and disabled state',!old.efforts.includes('none')&&L.same(before,after)&&L.same(cat.find(r=>r.model==='gpt-6-luna').efforts,L.scale)&&cat.find(r=>r.model==='gpt-6-astra').enabled===false,{before,after,catalog:cat});rec.check('clean upgrade started no fake turns',f.requests().length===0);await stop(g);
}catch(e){rec.check('supplemental exception',false,String(e.stack??e));}finally{for(const g of gs)if(g.exitCode()===null)await stop(g);rec.finish();}
