// Remaining authoring checks and long-lived disposable gateway for Edge.
import fs from 'node:fs';import path from 'node:path';import * as L from './qa.mjs';
const rec=new L.Recorder('complete-api-final'),gs=[],raw=[];
const old=JSON.parse(fs.readFileSync(path.join(L.OUT,'api-result.json'),'utf8')).store;
const dir=path.join(path.dirname(L.state.main),path.basename(old.replaceAll('\\','/')));
const fake={env:{GG_CODEX_BINARY:path.join(dir,'fake/codex.exe'),GG_CLAUDE_BINARY:path.join(dir,'fake/claude.exe')}};
const defaults=(h,m,e)=>({byHarness:{[h]:{model:m,effort:e}}});
const cap=(label,r)=>{raw.push({label,status:r.status,body:r.json});return r;};
try{
 const g=await L.startGateway({dir,port:6370,label:'complete-api',env:fake.env,rec});gs.push(g);
 const c=await L.createLoop(g.call,L.single('QA205 complete control',L.inferenceNode('work',{model:'gpt-6-luna',effort:'low'})));const cid=c.json.loop.id;
 for(const [h,m]of[['codex','gpt-5.5'],['claude','claude-haiku-5-5']])for(const source of ['inference','decision','loop']){
  if(h==='codex'||source==='inference'||source==='decision')continue; // Already observed; Claude LLM decisions are not a supported shape.
  const def=e=>source==='decision'?L.single('QA205 '+h+' '+source,L.llmDecisionNode('work',{harness:h,model:m,effort:e})):L.single('QA205 '+h+' '+source,L.inferenceNode('work',{harness:h,model:m,...(source==='inference'?{effort:e}:{})}),source==='loop'?{defaults:defaults(h,m,e)}:{});
  for(const [label,url,method]of[['create','/loops','POST'],['draft',`/loops/${cid}/draft`,'PUT'],['validate',`/loops/${cid}/validate`,'POST']]){
   // Only remaining Claude cases; earlier successful Codex checks are retained.
   if(h==='codex'||source==='inference')continue;
   const r=cap(h+'/'+source+'/'+label,await g.call(url,{method,body:{definition:def('none')}}));rec.check('none authoring refusal '+h+'/'+source+'/'+label,r.text.includes('EFFORT_UNSUPPORTED')&&(label==='validate'?r.status===200:r.status===400),r.json);
  }
  // Persisted invalid draft fixture; publish's public status is 422 LOOP_INVALID, not 400.
  const low=await L.createLoop(g.call,def('low'));const id=low.json.loop.id;
  await L.sql(dir,`UPDATE loop_versions SET definition=replace(definition,'"effort":"low"','"effort":"none"') WHERE loop_id=?`,[id]);
  if(source==='decision')await L.sql(dir,`UPDATE loop_versions SET definition=replace(definition,'"effort":{"mode":"explicit","value":"low"}','"effort":{"mode":"explicit","value":"none"}') WHERE loop_id=?`,[id]);
  const r=cap(h+'/'+source+'/publish',await g.call(`/loops/${id}/publish`,{method:'POST'}));rec.check('publish none refused '+h+'/'+source,r.status===422&&r.json.code==='LOOP_INVALID'&&r.text.includes('EFFORT_UNSUPPORTED'),r.json);
 }
 for(const [h,m]of[['codex','gpt-5.5'],['claude','claude-haiku-5-5']]){const r=cap(h+'/owner/none',await g.call('/settings',{method:'PUT',body:{defaults:defaults(h,m,'none')}}));rec.check('Settings none refusal '+h,r.status===400&&r.text.includes('EFFORT_UNSUPPORTED'),r.json);}
 for(const h of ['codex','claude'])for(const source of ['inference','decision','loop']){
  if(h==='claude'&&source==='decision')continue;
  const m=h==='codex'?'gpt-6-luna':'claude-haiku-5-5';
  const def=source==='decision'?L.single('QA205 minimal',L.llmDecisionNode('work',{harness:h,model:m,effort:'minimal'})):L.single('QA205 minimal',L.inferenceNode('work',{harness:h,model:m,...(source==='inference'?{effort:'minimal'}:{})}),source==='loop'?{defaults:defaults(h,m,'minimal')}:{});
  for(const [label,url,method]of[['create','/loops','POST'],['draft',`/loops/${cid}/draft`,'PUT'],['validate',`/loops/${cid}/validate`,'POST']]){const r=cap('minimal/'+h+'/'+source+'/'+label,await g.call(url,{method,body:{definition:def}}));rec.check('minimal is 400 VALIDATION_FAILED '+h+'/'+source+'/'+label,r.status===400&&r.json.code==='VALIDATION_FAILED',r.json);}
 }
 for(const h of ['codex','claude']){const r=cap('minimal/settings/'+h,await g.call('/settings',{method:'PUT',body:{defaults:defaults(h,h==='codex'?'gpt-6-luna':'claude-haiku-5-5','minimal')}}));rec.check('minimal Settings 400 '+h,r.status===400&&r.json.code==='VALIDATION_FAILED',r.json);}
 const r=cap('minimal/catalog',await g.call('/model-catalog',{method:'POST',body:{model:'qa-minimal',displayName:'QA minimal',harness:'litellm',providerModel:'qa',efforts:['minimal','low'],defaultEffort:'minimal'}}));rec.check('minimal catalog 400',r.status===400&&r.json.code==='VALIDATION_FAILED',r.json);
 for(const [h,m,e]of[['codex','gpt-5.5','none'],['claude','claude-haiku-5-5','none'],['codex','gpt-6-luna','minimal'],['claude','claude-haiku-5-5','minimal']]){
  const d=L.makeStore('process-'+h+'-'+e),f=L.fake(d);const p=await L.startGateway({dir:d,port:6371,label:'process-'+h+'-'+e,env:{...f.env,GG_DEFAULTS:JSON.stringify(defaults(h,m,e))},rec});gs.push(p);
  const log=p.readLog();rec.check('GG_DEFAULTS startup refusal '+h+'/'+e,p.failedStart!==undefined&&(e==='none'?log.includes('EFFORT_UNSUPPORTED'):/GG_DEFAULTS/.test(log)),{exit:p.exitCode(),log});
 }
 const loops=(await g.call('/loops')).json.items;
 const initial=JSON.parse(fs.readFileSync(path.join(L.OUT,'api-responses.json'),'utf8'));
 L.state.api={dir,origin:g.origin,pid:g.pid,editor:loops.find(x=>x.name==='QA205 editor lists').id,runs:Object.fromEntries(initial.filter(x=>x.request&&x.run).map(x=>[x.id,x.run.id]))};L.saveState();
 fs.writeFileSync(path.join(L.OUT,'complete-api-responses.json'),L.redact(JSON.stringify(raw,null,2))+'\n');rec.log('READY FOR EDGE');
 await L.waitFor(()=>fs.existsSync(path.join(dir,'stop.txt')),{timeoutMs:3600000,intervalMs:500});
}catch(e){rec.check('complete driver exception',false,String(e.stack??e));}
finally{for(const g of gs){rec.check('ended '+g.label,await g.stop()!==null,{pid:g.pid,exit:g.exitCode()});g.copyLog(g.label+'-gateway.log.txt');}fs.writeFileSync(path.join(L.OUT,'complete-api-responses.json'),L.redact(JSON.stringify(raw,null,2))+'\n');rec.finish();}
