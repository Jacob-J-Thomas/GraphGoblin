// Real built gateway and SDK, fake native CLIs. Only public HTTP calls except explicit stored fixtures.
import fs from 'node:fs';
import path from 'node:path';
import * as L from './qa.mjs';
const rec=new L.Recorder('api');const gateways=[];const raw=[];
const dir=L.makeStore('api');const fake=L.fake(dir);
const keep=(id,r)=>{raw.push({id,status:r.status,body:r.json});return r;};
const unsupported=r=>r.text.includes('EFFORT_UNSUPPORTED');
const defaults=(h,m,e)=>({byHarness:{[h]:{model:m,effort:e}}});
try {
 const g=await L.startGateway({dir,port:6370,env:fake.env,label:'api',rec});gateways.push(g);
 const catalog=keep('catalog',await g.call('/model-catalog')).json.items;
 rec.check('catalog: 8 Codex and 4 Claude seeded models',catalog.filter(x=>x.harness==='codex').length===8&&catalog.filter(x=>x.harness==='claude').length===4,catalog);
 for(const row of catalog)rec.check('catalog '+row.model,L.same(row.efforts,row.model==='gpt-5.5'?L.scale.slice(1,-1):row.harness==='claude'?L.scale.slice(1):L.scale),row.efforts);
 rec.check('catalog has no minimal',!JSON.stringify(catalog).includes('minimal'));
 await L.sql(dir,`INSERT INTO model_catalog (harness, model, source, display_name, efforts, default_effort, enabled) VALUES ('codex','qa-unknown-family','harness','QA unknown family',?,'low',1)`,[JSON.stringify(L.scale)]);
 const runs={};
 for(const [h,m,e] of [['codex','gpt-6-luna','none'],['codex','gpt-5.6-sol','none'],['codex','qa-unknown-family','none'],...L.scale.slice(1).map(e=>['codex','gpt-6-luna',e]),['claude','claude-haiku-5-5','low']]) {
  const label=h+'/'+m+'/'+e;const before=fake.requests().length;
  const id=await L.publishLoop(g.call,L.single('QA205 '+label,L.inferenceNode('work',{harness:h,model:m,effort:e})));
  const run=await L.run(g,id);runs[label]=run.id;
  const request=fake.requests().slice(before);const session=run.events.find(x=>x.type==='harness.session');
  const argv=fake.argv().at(-1);const exact=h==='codex'?argv?.some((x,i)=>x===`model_reasoning_effort="${e}"`&&argv[i-1]==='--config'):argv?.some((x,i)=>x===e&&argv[i-1]==='--effort');
  raw.push({id:label,run,request,argv});
  if(run.done.failure?.code==='HARNESS_TERMINATION_UNCONFIRMED')rec.observe('D-015 not observable here: '+label,{failure:run.done.failure,request,argv,session});
  else rec.check('run canonical effort, success, exact CLI argument '+label,run.done.status==='succeeded'&&session?.effort===e&&request.length===1&&request[0].effort===e&&exact,{runId:run.id,status:run.done.status,session,request,argv,failure:run.done.failure});
 }
 // Real editor fixtures: both node types and inherited defaults on GPT-6.
 const infer=L.inferenceNode('infer',{model:'gpt-6-luna',effort:'none'});
 const pick=L.llmDecisionNode('pick',{model:'gpt-6-luna',effort:'none'});
 const editor=(await L.createLoop(g.call,L.loop('QA205 editor lists',[infer,pick],[L.edge('a','start','infer'),L.edge('b','infer','pick'),L.edge('c','pick','done','finish'),L.edge('d','pick','done','other')],{defaults:defaults('codex','gpt-6-luna','none')}))).json.loop.id;
 const control=await L.createLoop(g.call,L.single('QA205 control',L.inferenceNode('work',{model:'gpt-6-luna',effort:'low'})));const cid=control.json.loop.id;
 for(const [h,m] of [['codex','gpt-5.5'],['claude','claude-haiku-5-5']]) {
  for(const source of ['inference','decision','loop']) {
   const def=source==='decision'?L.single('QA205 refused '+h,L.llmDecisionNode('work',{harness:h,model:m,effort:'none'})):L.single('QA205 refused '+h,L.inferenceNode('work',{harness:h,model:m,...(source==='inference'?{effort:'none'}:{})}),source==='loop'?{defaults:defaults(h,m,'none')}:{});
   for(const [label,url,method] of [['create','/loops','POST'],['draft',`/loops/${cid}/draft`,'PUT'],['validate',`/loops/${cid}/validate`,'POST']]) {
    const r=keep(`${h}/${source}/${label}/none`,await g.call(url,{method,body:{definition:def}}));
    rec.check('refuses none '+h+'/'+source+'/'+label,unsupported(r)&&(label==='validate'?r.status===200:r.status===400),r.json);
   }
   // A catalog which previously offered none can have valid persisted authoring data. Remove it,
   // then exercise publish and runtime refusal through the product (no engine methods called).
   const normal=catalog.find(x=>x.harness===h&&x.model===m).efforts;
   await L.catalogEfforts(dir,h,m,['none',...normal]);
   const saved=await L.createLoop(g.call,def);const id=saved.json.loop.id;
   const pub=await g.call(`/loops/${id}/publish`,{method:'POST'});
   await L.catalogEfforts(dir,h,m,normal);
   const denied=keep(`${h}/${source}/publish`,await g.call(`/loops/${id}/publish`,{method:'POST'}));
   rec.check('publish rechecks none '+h+'/'+source,denied.status===400&&unsupported(denied),denied.json);
   const before=fake.requests().length;const r=await L.run(g,id);
   raw.push({id:`${h}/${source}/pinned`,run:r});
   const d=r.done.failure?.details;
   rec.check('pinned run refuses with one details object '+h+'/'+source,pub.status===200&&r.done.status==='failed'&&r.done.failure?.code==='EVALUATION_INVALID_CONFIGURATION'&&d?.code==='EFFORT_UNSUPPORTED'&&!Array.isArray(d)&&d.path==='effort'&&fake.requests().length===before,{runId:r.id,failure:r.done.failure,cliDelta:fake.requests().length-before});
  }
  const put=keep(h+'/owner/none',await g.call('/settings',{method:'PUT',body:{defaults:defaults(h,m,'none')}}));
  rec.check('owner Settings refuses none '+h,put.status===400&&unsupported(put),put.json);
  // Pinned owner defaults, created while the catalog permitted none, then rechecked on a run.
  const normal=catalog.find(x=>x.harness===h&&x.model===m).efforts;
  await L.catalogEfforts(dir,h,m,['none',...normal]);
  await g.call('/settings',{method:'PUT',body:{defaults:defaults(h,m,'none')}});
  const id=await L.publishLoop(g.call,L.single('QA205 owner '+h,L.inferenceNode('work',{harness:h})));
  await L.catalogEfforts(dir,h,m,normal);const before=fake.requests().length;
  const r=await L.run(g,id);const d=r.done.failure?.details;
  raw.push({id:h+'/owner/pinned',run:r});
  rec.check('pinned owner none refuses '+h,d?.code==='EFFORT_UNSUPPORTED'&&d.level==='owner'&&d.harness===h&&d.path==='effort'&&!Array.isArray(d)&&fake.requests().length===before,{failure:r.done.failure,cliDelta:fake.requests().length-before});
  await g.call('/settings',{method:'PUT',body:{defaults:{byHarness:{}}}});
 }
 for(const source of ['inference','decision','loop']) {
  const def=source==='decision'?L.single('QA205 minimal',L.llmDecisionNode('work',{model:'gpt-6-luna',effort:'minimal'})):L.single('QA205 minimal',L.inferenceNode('work',{model:'gpt-6-luna',...(source==='inference'?{effort:'minimal'}:{})}),source==='loop'?{defaults:defaults('codex','gpt-6-luna','minimal')}:{});
  for(const [label,url,method] of [['create','/loops','POST'],['draft',`/loops/${cid}/draft`,'PUT'],['validate',`/loops/${cid}/validate`,'POST']]) {
   const r=keep(`minimal/${source}/${label}`,await g.call(url,{method,body:{definition:def}}));
   rec.check('minimal is 400 schema validation '+source+'/'+label,r.status===400&&r.json.code==='VALIDATION_FAILED',r.json);
  }
 }
 for(const h of ['codex','claude']) {const r=keep('minimal/settings/'+h,await g.call('/settings',{method:'PUT',body:{defaults:defaults(h,h==='codex'?'gpt-6-luna':'claude-haiku-5-5','minimal')}}));rec.check('minimal Settings schema rejects '+h,r.status===400&&r.json.code==='VALIDATION_FAILED',r.json);}
 const litellm=keep('minimal/catalog',await g.call('/model-catalog',{method:'POST',body:{model:'qa-minimal',displayName:'QA minimal',harness:'litellm',providerModel:'qa',efforts:['minimal','low'],defaultEffort:'minimal'}}));
 rec.check('minimal catalog save is 400',litellm.status===400,litellm.json);
 // Process-default invalid model/effort combination must prevent startup, and minimal is invalid schema.
 for(const [h,m,e] of [['codex','gpt-5.5','none'],['claude','claude-haiku-5-5','none'],['codex','gpt-6-luna','minimal']]) {
  const d=L.makeStore('process-'+h+'-'+e);const f=L.fake(d);
  const p=await L.startGateway({dir:d,port:6371,label:'process-'+h+'-'+e,env:{...f.env,GG_DEFAULTS:JSON.stringify(defaults(h,m,e))},rec});gateways.push(p);
  rec.check('GG_DEFAULTS startup refuses '+h+'/'+e,p.failedStart!==undefined&&(e==='none'?p.readLog().includes('EFFORT_UNSUPPORTED'):p.readLog().includes('Invalid GG_DEFAULTS')),{exit:p.exitCode(),log:p.readLog()});
 }
 L.state.api={dir,editor,runs,origin:g.origin,pid:g.pid};L.saveState();
 fs.writeFileSync(path.join(L.OUT,'api-responses.json'),L.redact(JSON.stringify(raw,null,2))+'\n');
 rec.log('READY FOR EDGE; waiting for own stop file');
 await L.waitFor(()=>fs.existsSync(path.join(dir,'stop.txt')),{timeoutMs:3600000,intervalMs:500});
}catch(e){rec.check('API driver exception',false,String(e.stack??e));}
finally {for(const g of gateways){const exit=await g.stop();rec.check('gateway ended '+g.label,exit!==null,{pid:g.pid,exit});g.copyLog(g.label+'-gateway.log.txt');}fs.writeFileSync(path.join(L.OUT,'api-responses.json'),L.redact(JSON.stringify(raw,null,2))+'\n');rec.finish({store:dir,fakeRequests:fake.requests()});}
