// Completes the initial driver's scenarios: preserve a draft for publish; park accepted runs
// before catalog revocation so runtime refusals are genuinely pinned, including Claude.
import fs from 'node:fs';import path from 'node:path';import * as L from './qa.mjs';
const rec=new L.Recorder('refusals');const gs=[];const raw=[];
const old=JSON.parse(fs.readFileSync(path.join(L.OUT,'api-result.json'),'utf8')).store;
const dir=path.join(path.dirname(L.state.main),path.basename(old.replaceAll('\\','/')));
const fake={cli:path.join(dir,'fake'),env:{GG_CODEX_BINARY:path.join(dir,'fake/codex.exe'),GG_CLAUDE_BINARY:path.join(dir,'fake/claude.exe')},requests:()=>fs.readFileSync(path.join(dir,'fake/requests.jsonl'),'utf8').trim().split('\n').map(JSON.parse)};
const defaults=(h,m,e)=>({byHarness:{[h]:{model:m,effort:e}}});
const response=(label,r)=>{raw.push({label,status:r.status,body:r.json});return r;};
const refused=r=>r.text.includes('EFFORT_UNSUPPORTED');
try{
 const g=await L.startGateway({dir,port:6370,label:'refusals',env:fake.env,rec});gs.push(g);
 const catalog=(await g.call('/model-catalog')).json.items;
 const control=await L.createLoop(g.call,L.single('QA205 save point control',L.inferenceNode('work',{model:'gpt-6-luna',effort:'low'})));const cid=control.json.loop.id;
 for(const [h,m]of[['codex','gpt-5.5'],['claude','claude-haiku-5-5']]){
  const normal=catalog.find(x=>x.model===m).efforts;
  for(const source of ['inference','decision','loop','owner','process']){
   await L.catalogEfforts(dir,h,m,['none',...normal]);
   const inherited=source==='loop'||source==='owner'||source==='process';
   if(source==='owner')await g.call('/settings',{method:'PUT',body:{defaults:defaults(h,m,'none')}});
   const node=source==='decision'?L.llmDecisionNode('work',{harness:h,model:m,effort:'none'}):L.inferenceNode('work',{harness:h,...(inherited?{}:{model:m,effort:'none'})});
   const settings=source==='loop'?{defaults:defaults(h,m,'none')}:{};
   // Process pinned runtime is tested on its own gateway below; authoring process defaults are
   // startup refusal on both harnesses. Other sources park on the public input-wait node.
   if(source==='process'){await L.catalogEfforts(dir,h,m,normal);continue;}
   const def=L.single('QA205 '+h+' '+source,node,settings);
   if(source!=='owner'){
    const c=await L.createLoop(g.call,def);await L.catalogEfforts(dir,h,m,normal);
    const p=response(h+'/'+source+'/publish',await g.call(`/loops/${c.json.loop.id}/publish`,{method:'POST'}));
    rec.check('publish refuses retained draft none '+h+'/'+source,p.status===400&&refused(p),p.json);
    for(const [label,url,method]of[['create','/loops','POST'],['draft',`/loops/${cid}/draft`,'PUT'],['validate',`/loops/${cid}/validate`,'POST']]){
     const r=response(h+'/'+source+'/'+label,await g.call(url,{method,body:{definition:def}}));rec.check('none refuses '+h+'/'+source+'/'+label,refused(r)&&(label==='validate'?r.status===200:r.status===400),r.json);
    }
    await L.catalogEfforts(dir,h,m,['none',...normal]);
   }
   const wait={id:'hold',kind:'wait',label:'Hold',config:{mode:'input',prompt:'QA gate'}};
   const pinned=L.loop('QA205 parked '+h+' '+source,[wait,node],[L.edge('a','start','hold'),L.edge('b','hold','work'),...(node.kind==='decision'?[L.edge('c','work','done','finish'),L.edge('d','work','done','other')]:[L.edge('c','work','done')])],settings);
   const id=await L.publishLoop(g.call,pinned);
   const start=await g.call(`/loops/${id}/runs`,{method:'POST',body:{input:null}});if(start.status!==202)throw new Error('park start '+JSON.stringify(start));const rid=start.json.run.id;
   const parked=await L.waitRun(g.call,rid,['waiting'],10000);
   await L.catalogEfforts(dir,h,m,normal);const before=fake.requests().length;
   const answer=await g.call(`/runs/${rid}/input`,{method:'POST',body:{waitId:parked.waiting.waitId,input:null}});
   const done=await L.waitRun(g.call,rid,['failed','succeeded'],10000);const d=done.failure?.details;
   rec.check('pinned runtime none refuses '+h+'/'+source,answer.status===200&&done.status==='failed'&&done.failure.code==='EVALUATION_INVALID_CONFIGURATION'&&d?.code==='EFFORT_UNSUPPORTED'&&d.path==='effort'&&!Array.isArray(d)&&(!inherited||d.level===source)&&fake.requests().length===before,{runId:rid,failure:done.failure,cliDelta:fake.requests().length-before});
   raw.push({label:h+'/'+source+'/pinned',start,answer,done});
   if(source==='owner')await g.call('/settings',{method:'PUT',body:{defaults:{byHarness:{}}}});
  }
  const r=response(h+'/Settings/none',await g.call('/settings',{method:'PUT',body:{defaults:defaults(h,m,'none')}}));rec.check('Settings none refuses '+h,r.status===400&&refused(r),r.json);
 }
 for(const source of ['inference','decision','loop']){
  const def=source==='decision'?L.single('QA205 minimal',L.llmDecisionNode('work',{model:'gpt-6-luna',effort:'minimal'})):L.single('QA205 minimal',L.inferenceNode('work',{model:'gpt-6-luna',...(source==='inference'?{effort:'minimal'}:{})}),source==='loop'?{defaults:defaults('codex','gpt-6-luna','minimal')}:{});
  for(const [label,url,method]of[['create','/loops','POST'],['draft',`/loops/${cid}/draft`,'PUT'],['validate',`/loops/${cid}/validate`,'POST']]){const r=response('minimal/'+source+'/'+label,await g.call(url,{method,body:{definition:def}}));rec.check('minimal 400 VALIDATION_FAILED '+source+'/'+label,r.status===400&&r.json.code==='VALIDATION_FAILED',r.json);}
 }
 for(const h of ['codex','claude']){const r=response('minimal/Settings/'+h,await g.call('/settings',{method:'PUT',body:{defaults:defaults(h,h==='codex'?'gpt-6-luna':'claude-haiku-5-5','minimal')}}));rec.check('minimal Settings 400 '+h,r.status===400&&r.json.code==='VALIDATION_FAILED',r.json);}
 const r=response('minimal/catalog',await g.call('/model-catalog',{method:'POST',body:{model:'qa-minimal',displayName:'QA minimal',harness:'litellm',providerModel:'qa',efforts:['minimal','low'],defaultEffort:'minimal'}}));rec.check('minimal catalog 400',r.status===400&&r.json.code==='VALIDATION_FAILED',r.json);
 for(const [h,m,e]of[['codex','gpt-5.5','none'],['claude','claude-haiku-5-5','none'],['codex','gpt-6-luna','minimal']]){
  const d=L.makeStore('process-'+h+'-'+e),f=L.fake(d);const p=await L.startGateway({dir:d,port:6371,label:'process-'+h+'-'+e,env:{...f.env,GG_DEFAULTS:JSON.stringify(defaults(h,m,e))},rec});gs.push(p);
  const log=p.readLog();rec.check('GG_DEFAULTS startup refuses '+h+'/'+e,p.failedStart!==undefined&&(e==='none'?log.includes('EFFORT_UNSUPPORTED'):/GG_DEFAULTS/.test(log)),{exit:p.exitCode(),log});
 }
 const loops=(await g.call('/loops')).json.items;const editor=loops.find(x=>x.name==='QA205 editor lists').id;
 const initial=JSON.parse(fs.readFileSync(path.join(L.OUT,'api-responses.json'),'utf8'));
 const runs=Object.fromEntries(initial.filter(x=>x.request&&x.run).map(x=>[x.id,x.run.id]));
 L.state.api={dir,editor,runs,origin:g.origin,pid:g.pid};L.saveState();
 fs.writeFileSync(path.join(L.OUT,'refusals-responses.json'),L.redact(JSON.stringify(raw,null,2))+'\n');
 rec.log('READY FOR EDGE');await L.waitFor(()=>fs.existsSync(path.join(dir,'stop.txt')),{timeoutMs:3600000,intervalMs:500});
}catch(e){rec.check('refusals driver exception',false,String(e.stack??e));}
finally{for(const g of gs){const exit=await g.stop();rec.check('ended '+g.label,exit!==null,{pid:g.pid,exit});g.copyLog(g.label+'-gateway.log.txt');}fs.writeFileSync(path.join(L.OUT,'refusals-responses.json'),L.redact(JSON.stringify(raw,null,2))+'\n');rec.finish({store:dir});}
