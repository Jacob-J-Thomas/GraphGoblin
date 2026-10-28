// Independent fixture assembled through the real archived base API and native fake CLIs.
import fs from'node:fs';import path from'node:path';import{pathToFileURL}from'node:url';import{createHash}from'node:crypto';import*as L from'./qa.mjs';import{find,repair,recipeHash}from'./recipe.mjs';
const rec=new L.Recorder('wide'),gs=[];const dir=L.makeStore('wide'),f=L.fake(dir);const runs={},loops={};
const start=async(label,base=false)=>{const g=await L.startGateway({dir,port:6373,label,env:f.env,rec,...(base?{root:L.state.main,loader:pathToFileURL(path.join(L.OUT,'scripts/baseline-loader.mjs')).href}:{})});gs.push(g);return g;};
const stop=async g=>{rec.check('gateway ended '+g.label,await g.stop(3000)!==null,g.exitCode());g.copyLog(g.label+'-gateway.log.txt');};
const mode=v=>fs.writeFileSync(path.join(f.cli,'codex-mode.txt'),v);
function spec(events,code=0){for(const[n,value]of[['spec-events.txt',events.map(e=>JSON.stringify(e)).join('\n')],['spec-exit.txt',String(code)],['spec-stderr.txt','']])fs.writeFileSync(path.join(f.cli,n),value);mode('spec');}
const authored={effort:'minimal'};const prompt='Reply READY; authored word minimal and JSON {"effort":"minimal"} must remain literal.';
function gated(name){const a=L.inferenceNode('one',{model:'gpt-6-luna',effort:'low',template:prompt}),b=L.inferenceNode('two',{model:'gpt-6-luna',effort:'low'});b.config.session={policy:'resume-previous'};return {...L.loop(name,[a,{id:'hold',kind:'wait',label:'Hold',config:{mode:'input',prompt:'QA gate'}},b],[L.edge('a','start','one'),L.edge('b','one','hold'),L.edge('c','hold','two'),L.edge('d','two','done')]),variables:{payload:{type:'object',default:authored}}};}
async function readAll(g){const out={};for(const[k,id]of Object.entries(runs)){out[k]={};for(const[suffix,label]of[['','run'],['/events?after=0&limit=1000','events'],['/thread','thread']]){const r=await g.call('/runs/'+id+suffix);out[k][label]={status:r.status,body:r.json};}}return out;}
const expected=[];const planted=[];
async function mutateJson(table,column,where,args,patch){const r=await L.sql(dir,`SELECT ${column} AS value FROM ${table} WHERE ${where}`,args);for(const row of r.rows){if(row.value===null)continue;const j=JSON.parse(row.value);if(!patch(j))continue;await L.sql(dir,`UPDATE ${table} SET ${column}=? WHERE ${where}`,[JSON.stringify(j),...args]);planted.push({table,column,where,args});}}
const changeDefaults=x=>{let n=0;for(const level of['owner','process'])for(const h of['codex','claude']){const d=x?.defaults?.[level]?.byHarness?.[h];if(d?.effort==='low'){d.effort='minimal';n++;}}return n;};
try{
 let g=await start('wide-base',true);mode('success');
 await g.call('/settings',{method:'PUT',body:{defaults:{byHarness:{codex:{model:'gpt-6-luna',effort:'low'}}}}});
 // One authored-only row must not even be selected or reserialized by the hand fix.
 const authoredLoop={...L.single('QA205b authored-only',L.inferenceNode('work',{model:'gpt-6-luna',effort:'low',template:prompt})),variables:{payload:{type:'object',default:authored}}};
 loops.authored=await L.publishLoop(g.call,authoredLoop);
 for(const k of['A','B']){loops[k]=await L.publishLoop(g.call,gated('QA205b missing '+k));const r=await g.call(`/loops/${loops[k]}/runs`,{method:'POST',body:{input:{authored}}});runs[k]=r.json.run.id;const parked=await L.waitRun(g.call,runs[k],['waiting','failed'],15000);runs[k+'wait']=parked.waiting?.waitId;}
 spec([{type:'error',message:'thread not found: qa-205b'},{type:'turn.failed',error:{message:'thread not found: qa-205b'}}],1);
 for(const k of['A','B']){await g.call('/runs/'+runs[k]+'/input',{method:'POST',body:{waitId:runs[k+'wait'],input:authored}});const done=await L.waitRun(g.call,runs[k],['failed','succeeded'],15000);rec.check('base made actual missing-session failure '+k,done.failure?.missingSession?.effort==='low',done.failure);delete runs[k+'wait'];}
 loops.C=await L.publishLoop(g.call,L.single('QA205b decision',L.llmDecisionNode('work',{model:'gpt-6-luna',effort:'low'})));
 spec([{type:'thread.started',thread_id:'qa205b-decision'},{type:'turn.started'},{type:'item.completed',item:{id:'qa',type:'agent_message',text:JSON.stringify({route:'finish',confidence:0.9,reasoning:'QA controlled route'})}},{type:'turn.completed',usage:{input_tokens:1,cached_input_tokens:0,output_tokens:1}}]);
 const c=await L.run(g,loops.C);runs.C=c.id;rec.check('base made real decision event',c.done.status==='succeeded'&&c.events.some(e=>e.type==='decision.made'),{status:c.done.status,decision:c.events.find(e=>e.type==='decision.made')});
 mode('success');const failureSeq=(await L.events(g.call,runs.A)).find(e=>e.type==='run.failed').seq;
 const recover=await g.call('/runs/'+runs.A+'/recover-session',{method:'POST',body:{nodeId:'two',failureSeq}});const done=await L.waitRun(g.call,runs.A,['succeeded','failed'],15000);rec.check('base recovery writes fresh-session event',recover.status===200&&done.status==='succeeded'&&(await L.events(g.call,runs.A)).some(e=>e.type==='run.resumed'),{status:recover.status,done:done.status});
 // Real receipt admissions, with authored payloads containing minimal outside typed paths.
 for(const[k,config]of[['E',{type:'event',eventType:'qa205b'}],['W',{type:'webhook'}]]){
  const def=L.loop('QA205b receipt '+k,[],[L.edge('e','start','done')]);def.nodes[0].config=config;loops[k]=await L.publishLoop(g.call,def);
  const r=k==='E'?await g.call('/events',{method:'POST',body:{loopId:loops[k],type:'qa205b',payload:{authored},dedupeKey:'qa205b-1'}}):await g.call((await g.call('/loops/'+loops[k]+'/triggers')).json.webhooks[0].path,{method:'POST',body:{authored}});
  rec.check('base receipt accepted '+k,r.status===202,r.json);
 }
 const sd=await L.createLoop(g.call,L.loop('QA205b snapshot',[],[L.edge('e','start','done')],{defaults:{byHarness:{codex:{model:'gpt-6-luna',effort:'low'}}}}));loops.S=sd.json.loop.id;const vid=(await g.call('/loops/'+loops.S)).json.loop.draftVersionId;runs.S=(await L.run(g,loops.S,{input:{authored},allowDraft:true,versionId:vid})).id;
 await L.sleep(300);const cleanReads=await readAll(g);rec.check('all base run/event/thread reads healthy',Object.values(cleanReads).every(x=>Object.values(x).every(r=>r.status===200)),Object.fromEntries(Object.entries(cleanReads).map(([k,v])=>[k,Object.fromEntries(Object.entries(v).map(([n,r])=>[n,r.status]))])));
 await stop(g);
 const originalAuth=(await L.sql(dir,'SELECT definition FROM loop_versions WHERE loop_id=?',[loops.authored])).rows.map(r=>r.definition);
 const originalThread=(await L.sql(dir,'SELECT id, initial_thread, thread_snapshot FROM runs')).rows;
 const promptBefore=(await L.sql(dir,'SELECT definition FROM loop_versions WHERE loop_id=?',[loops.A])).rows.map(r=>JSON.parse(r.definition).nodes.find(n=>n.id==='one').config.prompt.template);
 // History-only phase, all five event kinds plus record/session/receipt paths.
 const evs=(await L.sql(dir,'SELECT run_id,seq,type,payload FROM run_events')).rows;
 for(const row of evs){const j=JSON.parse(row.payload);let n=0;
  if(row.type==='harness.session'&&j.effort==='low'){j.effort='minimal';n++;}
  if(row.type==='run.queued')n+=changeDefaults(j.pinned);
  if(row.type==='run.failed'&&j.failure?.missingSession?.effort==='low'){j.failure.missingSession.effort='minimal';n++;}
  if(row.type==='run.resumed'&&j.freshSession?.effort==='low'){j.freshSession.effort='minimal';n++;}
  if(row.type==='decision.made'){if(j.provenance?.effort==='low'){j.provenance.effort='minimal';n++;}for(const d of j.diagnostics??[])if(d.provenance?.effort==='low'){d.provenance.effort='minimal';n++;}}
  if(n){await L.sql(dir,'UPDATE run_events SET payload=? WHERE run_id=? AND seq=?',[JSON.stringify(j),row.run_id,row.seq]);expected.push({place:'run_events',match:row.run_id+'#'+row.seq,type:row.type});}
 }
 for(const r of(await L.sql(dir,'SELECT id,pinned,failure FROM runs')).rows){const p=JSON.parse(r.pinned);const a=changeDefaults(p);let failure=r.failure?JSON.parse(r.failure):null;const b=failure?.missingSession?.effort==='low';if(b)failure.missingSession.effort='minimal';if(a||b){await L.sql(dir,'UPDATE runs SET pinned=?,failure=? WHERE id=?',[JSON.stringify(p),failure?JSON.stringify(failure):null,r.id]);expected.push({place:'runs',match:r.id});}}
 const sessions=(await L.sql(dir,"SELECT run_id,node_id,attempt FROM harness_sessions WHERE effort='low'")).rows;await L.sql(dir,"UPDATE harness_sessions SET effort='minimal' WHERE effort='low'");for(const s of sessions)expected.push({place:'harness_sessions',match:s.run_id+'/'+s.node_id+'/'+s.attempt});
 for(const t of['webhook_receipts','event_receipts'])for(const r of(await L.sql(dir,`SELECT id,intent FROM ${t}`)).rows){const j=JSON.parse(r.intent);const n=changeDefaults(j.run?.pinned)+changeDefaults(j.queued?.pinned);if(n){await L.sql(dir,`UPDATE ${t} SET intent=? WHERE id=?`,[JSON.stringify(j),r.id]);expected.push({place:t,match:r.id});}}
 let found=await find(dir);const kinds=[...new Set(expected.filter(x=>x.place==='run_events').map(x=>x.type))];
 rec.check('published SELECT finds every planted history/session/receipt row, all five event kinds',expected.every(e=>found.some(r=>r.place===e.place&&r.ref.includes(e.match)))&&['harness.session','run.queued','decision.made','run.failed','run.resumed'].every(k=>kinds.includes(k))&&sessions.length>0,{expected,found,kinds});
 g=await start('wide-history-invalid');const invalidReads=await readAll(g);rec.observe('typed legacy history is refused before hand fix',Object.fromEntries(Object.entries(invalidReads).map(([k,v])=>[k,Object.fromEntries(Object.entries(v).map(([n,r])=>[n,{status:r.status,code:r.body?.code}]))])));await stop(g);
 // Also cover the original four places and immutable snapshot transaction.
 const beforeTrigger=(await L.sql(dir,"SELECT sql FROM sqlite_master WHERE name='loop_versions_snapshot_immutable'")).rows[0].sql;
 await L.withDb(dir,db=>db.batch(['DROP TRIGGER loop_versions_snapshot_immutable',`UPDATE loop_versions SET definition=json_set(definition,'$.settings.defaults.byHarness.codex.effort','minimal') WHERE loop_id='${loops.S}' AND status='snapshot'`,beforeTrigger],'write'));
 const snapshot=(await L.sql(dir,"SELECT id FROM loop_versions WHERE loop_id=? AND status='snapshot'",[loops.S])).rows[0].id;expected.push({place:'loop_versions',match:snapshot});
 await L.sql(dir,"UPDATE settings SET value=json_set(value,'$.byHarness.codex.effort','minimal') WHERE key='defaults'");expected.push({place:'settings',match:'defaults'});
 await L.sql(dir,`INSERT INTO model_catalog(harness,model,source,display_name,efforts,default_effort,enabled) VALUES('codex','qa205b-custom','harness','QA205b custom','["minimal","none","low"]','minimal',1)`);expected.push({place:'model_catalog',match:'codex/qa205b-custom'});
 // A mixed updated row also retains the authored prompt and variable default.
 await L.sql(dir,"UPDATE loop_versions SET definition=json_set(definition,'$.nodes[1].config.effort','minimal') WHERE loop_id=?",[loops.A]);const av=(await L.sql(dir,'SELECT id FROM loop_versions WHERE loop_id=?',[loops.A])).rows;for(const r of av)expected.push({place:'loop_versions',match:r.id});
 found=await find(dir);rec.check('full SELECT covers all eight places and no authored-only row',expected.every(e=>found.some(r=>r.place===e.place&&r.ref.includes(e.match)))&&new Set(found.map(r=>r.place)).size===8&&!found.some(r=>r.place==='loop_versions'&&originalAuth.some(s=>s.includes(r.ref))),{expected,found});
 g=await start('wide-all-invalid');rec.check('typed minimal snapshot/version/default still refuses startup',g.failedStart!==undefined,{exit:g.exitCode(),log:g.readLog()});await stop(g);
 await repair(dir);const remaining=await find(dir);rec.check('verbatim CHANGELOG updates and snapshot transaction clear discovery',remaining.length===0,{remaining,recipeHash});
 const afterAuth=(await L.sql(dir,'SELECT definition FROM loop_versions WHERE loop_id=?',[loops.authored])).rows.map(r=>r.definition);const afterThread=(await L.sql(dir,'SELECT id, initial_thread, thread_snapshot FROM runs')).rows;
 const promptAfter=(await L.sql(dir,'SELECT definition FROM loop_versions WHERE loop_id=?',[loops.A])).rows.map(r=>JSON.parse(r.definition).nodes.find(n=>n.id==='one').config.prompt.template);
 rec.check('authored-only definition and both thread columns byte-identical; mixed prompt unchanged',L.same(originalAuth,afterAuth)&&L.same(originalThread,afterThread)&&L.same(promptBefore,promptAfter),{authoredDefinitionSHA256:originalAuth.map(s=>createHash('sha256').update(s).digest('hex')),promptBefore,promptAfter});
 const trigger=(await L.sql(dir,"SELECT sql FROM sqlite_master WHERE name='loop_versions_snapshot_immutable'")).rows[0].sql;rec.check('snapshot trigger restored exactly',trigger===beforeTrigger,trigger);
 g=await start('wide-repaired');const reads=await readAll(g);rec.check('every run/events/thread read returns 200 after repair',Object.values(reads).every(x=>Object.values(x).every(r=>r.status===200)),Object.fromEntries(Object.entries(reads).map(([k,v])=>[k,Object.fromEntries(Object.entries(v).map(([n,r])=>[n,r.status]))])));
 const typed=[];for(const[k,v]of Object.entries(reads)){const r=v.run.body;if(r.failure?.missingSession)typed.push(['failure '+k,r.failure.missingSession.effort]);for(const e of v.events.body.items){if(e.type==='harness.session')typed.push([e.type,e.effort]);if(e.type==='decision.made'&&e.provenance?.effort)typed.push([e.type,e.provenance.effort]);if(e.type==='run.failed'&&e.failure?.missingSession)typed.push([e.type,e.failure.missingSession.effort]);if(e.type==='run.resumed'&&e.freshSession)typed.push([e.type,e.freshSession.effort]);if(e.type==='run.queued')typed.push([e.type,e.pinned.defaults.owner.byHarness.codex?.effort], [e.type,e.pinned.defaults.process.byHarness.codex?.effort]);}}
 rec.check('repaired typed history fields all show canonical none',typed.length>10&&typed.every(([,e])=>e==='none'),typed);
 const hs=(await L.sql(dir,'SELECT run_id,node_id,effort FROM harness_sessions')).rows;rec.check('harness_sessions now none',hs.length>0&&hs.every(s=>s.effort==='none'),hs);
 const authoredRead=(await g.call('/loops/'+loops.authored)).json;rec.check('authored variable default and word minimal remain served',authoredRead.current.definition.variables.payload.default.effort==='minimal'&&authoredRead.current.definition.nodes[1].config.prompt.template===prompt,authoredRead.current.definition.variables);
 await stop(g);L.state.wide={dir,runs,loops};L.saveState();
}catch(e){rec.check('wide driver exception',false,String(e.stack??e));}finally{for(const g of gs)if(g.exitCode()===null)await stop(g);rec.finish({recipeHash,store:dir,runs,loops});}
