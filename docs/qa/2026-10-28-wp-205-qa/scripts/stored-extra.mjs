import fs from'node:fs';import path from'node:path';import{pathToFileURL}from'node:url';import*as L from'./qa.mjs';
const rec=new L.Recorder('stored-extra'),gs=[];
const line=fs.readFileSync(path.join(L.ROOT,'CHANGELOG.md'),'utf8').split('\n').find(l=>l.startsWith('- Effort `none`'));
const codes=[...line.matchAll(/`([^`]+)`/g)].map(m=>m[1]);const select=codes.find(s=>s.startsWith("SELECT 'loop_versions'"));const fix=codes.find(s=>s.startsWith('UPDATE loop_versions '));
const start=async(dir,f,label,base=false,env={})=>{const g=await L.startGateway({dir,port:6373,label,env:{...f.env,...env},rec,...(base?{root:L.state.main,loader:pathToFileURL(path.join(L.OUT,'scripts/baseline-loader.mjs')).href}:{})});gs.push(g);return g;};
const stop=async g=>{const c=await g.stop(2000);rec.check('ended '+g.label,c!==null,{pid:g.pid,exit:c});g.copyLog(g.label+'-gateway.log.txt');};
try{
 const dir=L.makeStore('snapshot-final'),f=L.fake(dir);let g=await start(dir,f,'snapshot-final-base',true);
 const c=await L.createLoop(g.call,L.loop('QA205 snapshot no provider',[],[L.edge('e','start','done')],{defaults:{byHarness:{codex:{model:'gpt-6-luna',effort:'low'}}}}));
 const sc=c.json.loop.id;const v=(await g.call('/loops/'+sc)).json.loop.draftVersionId;
 const run=await L.run(g,sc,{input:null,versionId:v,allowDraft:true});rec.check('base snapshot created through public draft run',run.done.status==='succeeded',run.done);
 await stop(g);const trigger=(await L.sql(dir,"SELECT sql FROM sqlite_master WHERE name='loop_versions_snapshot_immutable'")).rows[0].sql;
 const rewrite=async(sql)=>L.withDb(dir,async db=>db.batch(['DROP TRIGGER loop_versions_snapshot_immutable',sql,trigger],'write'));
 await rewrite(`UPDATE loop_versions SET definition=replace(definition,'"effort":"low"','"effort":"minimal"') WHERE status='snapshot'`);
 g=await start(dir,f,'snapshot-final-invalid');const found=(await L.sql(dir,select)).rows;
 rec.check('snapshot minimal refuses startup; SELECT finds row',g.failedStart!==undefined&&g.readLog().includes(run.done.versionId)&&found.length===1,{log:g.readLog(),found});await stop(g);
 rec.check('ordinary UPDATE skips snapshot',(await L.sql(dir,fix)).rowsAffected===0);
 await rewrite(fix.replace("status <> 'snapshot'","status = 'snapshot'"));g=await start(dir,f,'snapshot-final-repaired');
 rec.check('snapshot hand transaction repairs and restores exact trigger',g.failedStart===undefined&&(await L.sql(dir,select)).rows.length===0&&(await L.sql(dir,"SELECT sql FROM sqlite_master WHERE name='loop_versions_snapshot_immutable'")).rows[0].sql===trigger,{run:await g.call('/runs/'+run.id),trigger});await stop(g);
 // A historical session event is an additional stored effort, explicitly called untested by CHANGELOG.
 const evdir=L.makeStore('legacy-event'),ef=L.fake(evdir);g=await start(evdir,ef,'legacy-event-base',true);
 const id=await L.publishLoop(g.call,L.single('QA205 legacy event',L.inferenceNode('work',{model:'gpt-6-luna',effort:'low'})));const er=await L.run(g,id);await stop(g);
 await L.sql(evdir,`UPDATE run_events SET payload=replace(payload,'"effort":"low"','"effort":"minimal"') WHERE run_id=? AND type='harness.session'`,[er.id]);
 g=await start(evdir,ef,'legacy-event-head');const scan=(await L.sql(evdir,select)).rows;
 const events=await g.call('/runs/'+er.id+'/events?limit=1000');const detail=await g.call('/runs/'+er.id);const diagnostics=await g.call('/runs/diagnostics');
 rec.observe('legacy run_events minimal omitted by CHANGELOG SELECT',{scan,events,detail,diagnostics});
 L.state.legacyEvent={dir:evdir,runId:er.id,status:events.status,body:events.json};L.saveState();await stop(g);
 // Park valid low runs, orderly stop, inject invalid pinned configuration, and restart.
 const pd=L.makeStore('pinned-runtime'),pf=L.fake(pd);g=await start(pd,pf,'pinned-create');
 const cases=[];
 for(const [h,m,source]of[['claude','claude-haiku-5-5','inference'],['claude','claude-haiku-5-5','loop'],['claude','claude-haiku-5-5','owner'],['claude','claude-haiku-5-5','process'],['codex','gpt-5.5','process']]){
  await g.call('/settings',{method:'PUT',body:{defaults:{byHarness:{[h]:{model:m,effort:'low'}}}}});
  const wait={id:'hold',kind:'wait',label:'Hold',config:{mode:'input',prompt:'QA gate'}};
  const n=L.inferenceNode('work',{harness:h,...(source==='inference'?{model:m,effort:'low'}:{})});
  const def=L.loop('QA205 pinned '+h+'/'+source,[wait,n],[L.edge('a','start','hold'),L.edge('b','hold','work'),L.edge('c','work','done')],source==='loop'?{defaults:{byHarness:{[h]:{model:m,effort:'low'}}}}:{});
  const id=await L.publishLoop(g.call,def);const r=await g.call(`/loops/${id}/runs`,{method:'POST',body:{input:null}});if(r.status!==202)throw new Error('park '+JSON.stringify(r));const rid=r.json.run.id;
  const parked=await L.waitRun(g.call,rid,['waiting'],10000);cases.push({h,m,source,id,rid,waitId:parked.waiting.waitId});
 }
 await stop(g);
 for(const c of cases){if(['inference','loop'].includes(c.source))await L.sql(pd,`UPDATE loop_versions SET definition=replace(definition,'"effort":"low"','"effort":"none"') WHERE loop_id=?`,[c.id]);
  else {const row=(await L.sql(pd,'SELECT pinned FROM runs WHERE id=?',[c.rid])).rows[0];const pin=JSON.parse(row.pinned);rec.log('pinned top-level keys '+c.source,Object.keys(pin));
   if(c.source==='owner')pin.ownerDefaults={byHarness:{[c.h]:{model:c.m,effort:'none'}}};
   else {pin.ownerDefaults={byHarness:{}};pin.processDefaults={byHarness:{[c.h]:{model:c.m,effort:'none'}}};}
   await L.sql(pd,'UPDATE runs SET pinned=? WHERE id=?',[JSON.stringify(pin),c.rid]);}
 }
 g=await start(pd,pf,'pinned-reopened');
 for(const c of cases){const before=pf.requests().length;const answer=await g.call(`/runs/${c.rid}/input`,{method:'POST',body:{waitId:c.waitId,input:null}});const done=await L.waitRun(g.call,c.rid,['failed','succeeded','cancelled'],10000);const d=done.failure?.details;
  rec.check('pinned runtime none refused '+c.h+'/'+c.source,answer.status===200&&done.failure?.code==='EVALUATION_INVALID_CONFIGURATION'&&d?.code==='EFFORT_UNSUPPORTED'&&d.path==='effort'&&!Array.isArray(d)&&(!['owner','loop','process'].includes(c.source)||d.level===c.source)&&pf.requests().length===before,{answer,done,cliDelta:pf.requests().length-before});
 }
 await stop(g);
}catch(e){rec.check('stored-extra driver exception',false,String(e.stack??e));}finally{for(const g of gs)if(g.exitCode()===null)await stop(g);rec.finish();}
