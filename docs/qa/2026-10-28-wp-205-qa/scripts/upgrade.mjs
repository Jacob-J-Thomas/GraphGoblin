// Base-built disposable stores, normal public writes followed by explicit old-content fixtures.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import * as L from './qa.mjs';
const rec=new L.Recorder('upgrade');const gs=[];
const change=fs.readFileSync(path.join(L.ROOT,'CHANGELOG.md'),'utf8').split('\n').find(l=>l.startsWith('- Effort `none`'));
const statements=[...change.matchAll(/`([^`]+)`/g)].map(m=>m[1]);
const select=statements.find(s=>s.startsWith("SELECT 'loop_versions'"));
const fixes=['loop_versions','settings','model_catalog','runs'].map(t=>statements.find(s=>s.startsWith('UPDATE '+t+' ')));
const scan=dir=>L.sql(dir,select).then(r=>r.rows);
const start=async(dir,fake,label,base=false)=>{const g=await L.startGateway({dir,port:6372,label,env:fake.env,rec,...(base?{root:L.state.main,loader:pathToFileURL(path.join(L.OUT,'scripts/baseline-loader.mjs')).href}:{})});gs.push(g);return g;};
const stop=async g=>{rec.check('ends '+g.label,await g.stop()!==null,g.exitCode());g.copyLog('upgrade-'+g.label+'-gateway.log.txt');};
const defs=()=>[
 L.single('QA205 base inference',L.inferenceNode('work',{model:'gpt-6-luna',effort:'max'})),
 L.single('QA205 base decision',L.llmDecisionNode('work',{model:'gpt-5.5',effort:'xhigh'})),
 L.single('QA205 base loop default',L.inferenceNode('work'),{defaults:{byHarness:{codex:{model:'gpt-5.6-sol',effort:'low'}}}})
];
try {
 const clean=L.makeStore('upgrade-clean'),f1=L.fake(clean);let g=await start(clean,f1,'clean-base',true);
 const oldCatalog=(await g.call('/model-catalog')).json.items;
 rec.check('base catalog has no none/minimal',oldCatalog.every(r=>!r.efforts.includes('none')&&!r.efforts.includes('minimal')),oldCatalog);
 await g.call('/model-catalog/codex/gpt-6-astra',{method:'PATCH',body:{enabled:false}});
 await g.call('/settings',{method:'PUT',body:{defaults:{byHarness:{codex:{model:'gpt-6-luna',effort:'low'},claude:{model:'claude-sonnet-5-5',effort:'high'}}}}});
 const ids=[];for(const d of defs())ids.push(await L.publishLoop(g.call,d));
 ids.push((await L.createLoop(g.call,L.single('QA205 base Claude',L.inferenceNode('work',{harness:'claude',model:'claude-haiku-5-5',effort:'medium'})))).json.loop.id);
 const before={loops:await Promise.all(ids.map(id=>g.call('/loops/'+id).then(r=>r.json))),settings:(await g.call('/settings')).json};
 await stop(g);g=await start(clean,f1,'clean-head');
 const after={loops:await Promise.all(ids.map(id=>g.call('/loops/'+id).then(r=>r.json))),settings:(await g.call('/settings')).json};
 const cat=(await g.call('/model-catalog')).json.items;
 rec.check('clean main store upgrades: seed refresh, disabled preserved, loops/defaults byte-equivalent',L.same(before,after)&&cat.filter(r=>/^gpt-(6|5\.6)/.test(r.model)).every(r=>L.same(r.efforts,L.scale))&&cat.find(r=>r.model==='gpt-6-astra').enabled===false,{before,after,catalog:cat});
 rec.check('upgrade did not reach providers',f1.requests().length===0);await stop(g);
 const dirty=L.makeStore('upgrade-minimal'),f2=L.fake(dirty);g=await start(dirty,f2,'dirty-base',true);
 await g.call('/settings',{method:'PUT',body:{defaults:{byHarness:{codex:{model:'gpt-6-luna',effort:'low'}}}}});
 const a=await L.publishLoop(g.call,L.single('QA205 stored inference',L.inferenceNode('work',{model:'gpt-6-luna',effort:'low'})));
 const b=(await L.createLoop(g.call,L.single('QA205 stored decision',L.llmDecisionNode('work',{model:'gpt-6-luna',effort:'low'})))).json.loop.id;
 const empty=await L.publishLoop(g.call,L.loop('QA205 no provider',[],[L.edge('e','start','done')]));
 const run=await L.run(g,empty);await stop(g);
 await L.sql(dirty,`UPDATE loop_versions SET definition=replace(replace(definition,'"effort":"low"','"effort":"minimal"'),'"effort":{"mode":"explicit","value":"low"}','"effort":{"mode":"explicit","value":"minimal"}') WHERE loop_id IN (?,?)`,[a,b]);
 await L.sql(dirty,`UPDATE settings SET value=replace(value,'"effort":"low"','"effort":"minimal"') WHERE key='defaults'`);
 await L.sql(dirty,`INSERT INTO model_catalog(harness,model,source,display_name,efforts,default_effort,enabled) VALUES('codex','qa-old-custom','harness','QA old custom','["minimal","low"]','minimal',1)`);
 await L.sql(dirty,`UPDATE runs SET pinned=replace(pinned,'"effort":"low"','"effort":"minimal"') WHERE id=?`,[run.id]);
 const old=await scan(dirty);rec.check('CHANGELOG SELECT sees all requested locations',old.length===5,old);
 // Observe each boundary before applying precisely the corresponding published statement.
 for(let step=0;step<4;step++) {
  g=await start(dirty,f2,'dirty-step'+step);
  if(step===0)rec.check('minimal loop version refuses startup naming row',g.failedStart!==undefined&&g.readLog().includes('stored loop version'),{log:g.readLog(),scan:await scan(dirty)});
  if(step===1)rec.check('minimal owner defaults refuses startup naming defaults',g.failedStart!==undefined&&g.readLog().includes('owner harness defaults'),{log:g.readLog(),scan:await scan(dirty)});
  if(step===2){const r=await g.call('/model-catalog');rec.check('minimal custom catalog starts but catalog read is 500 RESPONSE_INVALID',g.failedStart===undefined&&r.status===500&&r.json.code==='RESPONSE_INVALID',r);}
  if(step===3){const r=await g.call('/runs/'+run.id);rec.check('minimal pinned run starts but read is 500 STORED_RUN_INVALID',g.failedStart===undefined&&r.status===500&&r.json.code==='STORED_RUN_INVALID',r);}
  await stop(g);const update=await L.sql(dirty,fixes[step]);rec.log('Exact CHANGELOG hand update '+step,{sql:fixes[step],rows:update.rowsAffected,remaining:await scan(dirty)});
 }
 g=await start(dirty,f2,'dirty-fixed');
 const reads={catalog:await g.call('/model-catalog'),a:await g.call('/loops/'+a),b:await g.call('/loops/'+b),settings:await g.call('/settings'),run:await g.call('/runs/'+run.id)};
 rec.check('published SQL repairs all requested places; API serves everything; SELECT empty',Object.values(reads).every(r=>r.status===200)&&(await scan(dirty)).length===0,reads);
 await stop(g);
 // Snapshot fixture: pin a draft while at low on the base build, then hand-restore legacy effort.
 const snap=L.makeStore('upgrade-snapshot'),f3=L.fake(snap);g=await start(snap,f3,'snapshot-base',true);
 const sc=(await L.createLoop(g.call,L.single('QA205 snapshot',L.inferenceNode('work',{model:'gpt-6-luna',effort:'low'})))).json.loop.id;
 await L.run(g,sc,{input:null,allowDraft:true});await stop(g);
 const trigger=(await L.sql(snap,"SELECT sql FROM sqlite_master WHERE name='loop_versions_snapshot_immutable'")).rows[0].sql;
 await L.withDb(snap,async db=>{const tx=await db.transaction('write');try{await tx.execute('DROP TRIGGER loop_versions_snapshot_immutable');await tx.execute(`UPDATE loop_versions SET definition=replace(definition,'"effort":"low"','"effort":"minimal"') WHERE status='snapshot'`);await tx.execute(trigger);await tx.commit();}finally{tx.close();}});
 g=await start(snap,f3,'snapshot-minimal');rec.check('snapshot minimal startup refused, SELECT includes snapshot',g.failedStart!==undefined&&(await scan(snap)).length===1,{log:g.readLog(),scan:await scan(snap)});await stop(g);
 rec.check('ordinary CHANGELOG loop update skips immutable snapshot',(await L.sql(snap,fixes[0])).rowsAffected===0);
 await L.withDb(snap,async db=>{const tx=await db.transaction('write');try{await tx.execute('DROP TRIGGER loop_versions_snapshot_immutable');await tx.execute(fixes[0].replace("status <> 'snapshot'","status = 'snapshot'"));await tx.execute(trigger);await tx.commit();}finally{tx.close();}});
 g=await start(snap,f3,'snapshot-fixed');const restored=(await L.sql(snap,"SELECT sql FROM sqlite_master WHERE name='loop_versions_snapshot_immutable'")).rows[0].sql;
 rec.check('documented snapshot transaction repairs it and restores trigger exactly',g.failedStart===undefined&&restored===trigger&&(await scan(snap)).length===0,{restored,reads:await g.call('/runs')});await stop(g);
 L.state.upgrade={clean,dirty,snap,ids,legacyRun:run.id};L.saveState();
}catch(e){rec.check('upgrade driver exception',false,String(e.stack??e));}
finally{for(const g of gs){if(g.exitCode()===null)await stop(g);}rec.finish();}
