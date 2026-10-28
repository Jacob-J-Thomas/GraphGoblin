// Quick complete re-check of original checks 1, 2, 3 and 5 through built public interfaces.
import fs from'node:fs';import path from'node:path';import*as L from'./qa.mjs';
const rec=new L.Recorder('regression'),gs=[];const dir=L.makeStore('regression'),f=L.fake(dir);const response=[];const cases=[];
const defaults=(h,m,e)=>({byHarness:{[h]:{model:m,effort:e}}});
const capture=(name,r)=>{response.push({name,status:r.status,body:r.json});return r;};
const definition=(h,m,e,source)=>source==='decision'?L.single('QA205b authoring',L.llmDecisionNode('work',{harness:h,model:m,effort:e})):L.single('QA205b authoring',L.inferenceNode('work',{harness:h,...(source==='loop'?{}:{model:m,effort:e})}),source==='loop'?{defaults:defaults(h,m,e)}:{});
const stop=async g=>{rec.check('gateway ended '+g.label,await g.stop(3000)!==null,g.exitCode());g.copyLog(g.label+'-gateway.log.txt');};
try{
 let g=await L.startGateway({dir,port:6370,label:'regression',env:f.env,rec});gs.push(g);
 const catalog=(await g.call('/model-catalog')).json.items;
 rec.check('catalog has 8 Codex and 4 Claude, no minimal',catalog.filter(x=>x.harness==='codex').length===8&&catalog.filter(x=>x.harness==='claude').length===4&&!JSON.stringify(catalog).includes('minimal'),catalog);
 for(const row of catalog)rec.check('catalog efforts '+row.model,L.same(row.efforts,row.model==='gpt-5.5'?L.scale.slice(1,-1):row.harness==='claude'?L.scale.slice(1):L.scale),row.efforts);
 await L.sql(dir,`INSERT INTO model_catalog(harness,model,source,display_name,efforts,default_effort,enabled) VALUES('codex','qa-unknown-family','harness','QA unknown family',?,'low',1)`,[JSON.stringify(L.scale)]);
 const runs={};
 for(const[h,m,e]of[['codex','gpt-6-luna','none'],['codex','gpt-5.6-sol','none'],['codex','qa-unknown-family','none'],...L.scale.slice(1).map(e=>['codex','gpt-6-luna',e]),['claude','claude-haiku-5-5','low']]){
  const before=f.requests().length;const id=await L.publishLoop(g.call,L.single('QA205b '+h+'/'+m+'/'+e,L.inferenceNode('work',{harness:h,model:m,effort:e})));const r=await L.run(g,id);runs[h+'/'+m+'/'+e]=r.id;
  const session=r.events.find(x=>x.type==='harness.session'),argv=f.argv().at(-1),request=f.requests().slice(before);const exact=h==='codex'?argv.some((v,i)=>v===`model_reasoning_effort="${e}"`&&argv[i-1]==='--config'):argv.some((v,i)=>v===e&&argv[i-1]==='--effort');
  rec.check('run succeeds with canonical session and exact CLI effort '+h+'/'+m+'/'+e,r.done.status==='succeeded'&&session?.effort===e&&exact&&request.length===1&&request[0].effort===e,{runId:r.id,status:r.done.status,session,argv,request,failure:r.done.failure});
 }
 const control=(await L.createLoop(g.call,definition('codex','gpt-6-luna','low','inference'))).json.loop.id;
 for(const[h,m]of[['codex','gpt-5.5'],['claude','claude-haiku-5-5']]){
  for(const source of h==='codex'?['inference','decision','loop']:['inference','loop']){
   const def=definition(h,m,'none',source);
   for(const[label,url,method]of[['create','/loops','POST'],['save',`/loops/${control}/draft`,'PUT'],['validate',`/loops/${control}/validate`,'POST']]){const r=capture(h+'/'+source+'/'+label,await g.call(url,{method,body:{definition:def}}));rec.check('unsupported none '+h+'/'+source+'/'+label,r.text.includes('EFFORT_UNSUPPORTED')&&(label==='validate'?r.status===200&&r.json.publishable===false:r.status===400),r.json);}
   const d=await L.createLoop(g.call,definition(h,m,'low',source));const did=d.json.loop.id;const version=(await g.call('/loops/'+did)).json.loop.draftVersionId;
   const body=JSON.parse((await L.sql(dir,'SELECT definition FROM loop_versions WHERE id=?',[version])).rows[0].definition);
   if(source==='decision')body.nodes[1].config.effort.value='none';else if(source==='loop')body.settings.defaults.byHarness[h].effort='none';else body.nodes[1].config.effort='none';
   await L.sql(dir,'UPDATE loop_versions SET definition=? WHERE id=?',[JSON.stringify(body),version]);const r=capture(h+'/'+source+'/publish',await g.call('/loops/'+did+'/publish',{method:'POST'}));rec.check('publish refuses stored none '+h+'/'+source,r.status===422&&r.text.includes('EFFORT_UNSUPPORTED'),r.json);
  }
  const owner=capture(h+'/Settings',await g.call('/settings',{method:'PUT',body:{defaults:defaults(h,m,'none')}}));rec.check('Settings refuses none '+h,owner.status===400&&owner.text.includes('EFFORT_UNSUPPORTED'),owner.json);
 }
 for(const h of['codex','claude'])for(const source of h==='codex'?['inference','decision','loop']:['inference','loop']){
  const m=h==='codex'?'gpt-6-luna':'claude-haiku-5-5';
  for(const[label,url,method]of[['create','/loops','POST'],['save',`/loops/${control}/draft`,'PUT'],['validate',`/loops/${control}/validate`,'POST']]){const r=capture('minimal/'+h+'/'+source+'/'+label,await g.call(url,{method,body:{definition:definition(h,m,'minimal',source)}}));rec.check('minimal schema refusal '+h+'/'+source+'/'+label,r.status===400&&r.json.code==='VALIDATION_FAILED',r.json);}
 }
 for(const h of['codex','claude']){const r=await g.call('/settings',{method:'PUT',body:{defaults:defaults(h,h==='codex'?'gpt-6-luna':'claude-haiku-5-5','minimal')}});rec.check('minimal Settings 400 '+h,r.status===400&&r.json.code==='VALIDATION_FAILED',r.json);}
 // Pin accepted low runs before introducing invalid none; this also reaches Claude runtime.
 for(const[h,m]of[['codex','gpt-5.5'],['claude','claude-haiku-5-5']])for(const source of h==='codex'?['inference','decision','loop','owner','process']:['inference','loop','owner','process']){
  await g.call('/settings',{method:'PUT',body:{defaults:defaults(h,m,'low')}});
  const def=definition(h,m,'low',source==='decision'?'decision':source==='loop'?'loop':'inference');if(source==='owner'||source==='process'){delete def.nodes[1].config.model;delete def.nodes[1].config.effort;}
  const node=def.nodes[1],hold={id:'hold',kind:'wait',label:'Hold',config:{mode:'input',prompt:'QA gate'}};
  const parkedDef=L.loop('QA205b pinned '+h+'/'+source,[hold,node],[L.edge('a','start','hold'),L.edge('b','hold','work'),...(node.kind==='decision'?[L.edge('c','work','done','finish'),L.edge('d','work','done','other')]:[L.edge('c','work','done')])],def.settings);
  const id=await L.publishLoop(g.call,parkedDef);const r=await g.call(`/loops/${id}/runs`,{method:'POST',body:{input:null}});if(r.status!==202)throw new Error('park '+JSON.stringify(r));const rid=r.json.run.id;const parked=await L.waitRun(g.call,rid,['waiting'],10000);cases.push({h,m,source,id,rid,waitId:parked.waiting.waitId});
 }
 await stop(g);
 for(const c of cases){if(['inference','decision','loop'].includes(c.source)){const rows=(await L.sql(dir,'SELECT id,definition FROM loop_versions WHERE loop_id=?',[c.id])).rows;for(const r of rows){const d=JSON.parse(r.definition);if(c.source==='loop')d.settings.defaults.byHarness[c.h].effort='none';else if(c.source==='decision')d.nodes.find(n=>n.id==='work').config.effort.value='none';else d.nodes.find(n=>n.id==='work').config.effort='none';await L.sql(dir,'UPDATE loop_versions SET definition=? WHERE id=?',[JSON.stringify(d),r.id]);}}
  else{const p=JSON.parse((await L.sql(dir,'SELECT pinned FROM runs WHERE id=?',[c.rid])).rows[0].pinned);p.defaults.owner=c.source==='owner'?defaults(c.h,c.m,'none'):{byHarness:{}};if(c.source==='process')p.defaults.process=defaults(c.h,c.m,'none');await L.sql(dir,'UPDATE runs SET pinned=? WHERE id=?',[JSON.stringify(p),c.rid]);}}
 g=await L.startGateway({dir,port:6370,label:'regression-runtime',env:f.env,rec});gs.push(g);
 for(const c of cases){const before=f.requests().length;await g.call('/runs/'+c.rid+'/input',{method:'POST',body:{waitId:c.waitId,input:null}});const d=await L.waitRun(g.call,c.rid,['failed','succeeded'],10000);const details=d.failure?.details;rec.check('pinned none refuses with one details shape '+c.h+'/'+c.source,d.status==='failed'&&d.failure?.code==='EVALUATION_INVALID_CONFIGURATION'&&details?.code==='EFFORT_UNSUPPORTED'&&details.path==='effort'&&!Array.isArray(details)&&(!['loop','owner','process'].includes(c.source)||(details.level===c.source&&details.harness===c.h))&&f.requests().length===before,{failure:d.failure,cliDelta:f.requests().length-before});}
 await g.call('/settings',{method:'PUT',body:{defaults:{byHarness:{}}}});
 // Q205-2: exact documented message, exit code, no stack and no listener.
 for(const[h,m]of[['codex','gpt-5.5'],['claude','claude-haiku-5-5']]){
  const sd=L.makeStore('startup-'+h),sf=L.fake(sd);const s=await L.startGateway({dir:sd,port:6371,label:'startup-'+h,env:{...sf.env,GG_DEFAULTS:JSON.stringify(defaults(h,m,'none'))},rec});gs.push(s);
  const log=s.readLog().trim();let listener=false;try{await fetch(s.origin+'/healthz',{signal:AbortSignal.timeout(1000)});listener=true;}catch{}
  const expected=`GraphGoblin did not start: Invalid GG_DEFAULTS (EVALUATION_INVALID_CONFIGURATION).\n  ${h}: EFFORT_UNSUPPORTED at effort (model "${m}", effort "none"): The default reasoning effort is not supported by its model.\nNo stored data was changed. Set GG_DEFAULTS to a model and effort the model catalog lists, or remove it, then start again.`;
  rec.check('Q205-2 exact clean startup refusal '+h,s.exitCode()===1&&log.replaceAll('\r\n','\n')===expected&&!/^\s+at /m.test(log)&&!listener,{exit:s.exitCode(),listener,log});s.copyLog('startup-'+h+'-gateway.log.txt');
 }
 const infer=L.inferenceNode('infer',{model:'gpt-6-luna',effort:'none'}),pick=L.llmDecisionNode('pick',{model:'gpt-6-luna',effort:'none'});
 const ed=L.loop('QA205b editor',[infer,pick],[L.edge('a','start','infer'),L.edge('b','infer','pick'),L.edge('c','pick','done','finish'),L.edge('d','pick','done','other')],{defaults:defaults('codex','gpt-6-luna','none')});ed.nodes.forEach((n,i)=>{n.ui={x:i*290,y:80};});const editor=(await L.createLoop(g.call,ed)).json.loop.id;
 L.state.api={dir,editor,runs,origin:g.origin,pid:g.pid};L.saveState();fs.writeFileSync(path.join(L.OUT,'regression-responses.json'),L.redact(JSON.stringify(response,null,2))+'\n');rec.log('READY FOR EDGE');
 await L.waitFor(()=>fs.existsSync(path.join(dir,'stop.txt')),{timeoutMs:1800000,intervalMs:500});
}catch(e){rec.check('regression exception',false,String(e.stack??e));}finally{for(const g of gs)if(g.exitCode()===null)await stop(g);rec.finish({store:dir});}
