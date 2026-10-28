// The first QA's original legacy harness.session fixture, with the new published recipe.
import fs from'node:fs';import path from'node:path';import{pathToFileURL}from'node:url';import*as L from'./qa.mjs';import{find,repair,recipeHash}from'./recipe.mjs';
const rec=new L.Recorder('stored-extra');const gs=[];
try{
 const dir=L.makeStore('legacy-event'),f=L.fake(dir);
 let g=await L.startGateway({dir,port:6372,label:'original-base',env:f.env,rec,root:L.state.main,loader:pathToFileURL(path.join(L.OUT,'scripts/baseline-loader.mjs')).href});gs.push(g);
 const id=await L.publishLoop(g.call,L.single('QA205b original legacy event',L.inferenceNode('work',{model:'gpt-6-luna',effort:'low'})));
 const run=await L.run(g,id);await g.stop();g.copyLog('original-base-gateway.log.txt');
 await L.sql(dir,`UPDATE run_events SET payload=replace(payload,'"effort":"low"','"effort":"minimal"') WHERE run_id=? AND type='harness.session'`,[run.id]);
 g=await L.startGateway({dir,port:6372,label:'original-invalid',env:f.env,rec});gs.push(g);
 const listed=await find(dir);const events=await g.call('/runs/'+run.id+'/events?limit=1000');
 rec.check('original Q205-1: CHANGELOG SELECT now lists the legacy event',listed.length===1&&listed[0].place==='run_events'&&listed[0].ref.includes(run.id),{listed,events});
 await g.stop();g.copyLog('original-invalid-gateway.log.txt');await repair(dir);
 g=await L.startGateway({dir,port:6372,label:'original-repaired',env:f.env,rec});gs.push(g);
 const reads=await Promise.all(['','/events?limit=1000','/thread'].map(s=>g.call('/runs/'+run.id+s)));
 rec.check('verbatim CHANGELOG repair restores original run, events and thread; effort none',reads.every(r=>r.status===200)&&reads[1].json.items.some(e=>e.type==='harness.session'&&e.effort==='none')&&(await find(dir)).length===0,{statuses:reads.map(r=>r.status),session:reads[1].json.items?.find(e=>e.type==='harness.session')});
 await g.stop();g.copyLog('original-repaired-gateway.log.txt');
}catch(e){rec.check('original fixture exception',false,String(e.stack??e));}finally{for(const g of gs)if(g.exitCode()===null)await g.stop();rec.finish({recipeHash});}
