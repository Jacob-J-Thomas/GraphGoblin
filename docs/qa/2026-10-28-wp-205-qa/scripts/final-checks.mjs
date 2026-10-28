import fs from'node:fs';import path from'node:path';import{createRequire}from'node:module';import*as L from'./qa.mjs';
const require=createRequire(path.join(L.ROOT,'apps/web/package.json'));const{chromium}=require('@playwright/test');const rec=new L.Recorder('final-checks-final');let b;const gs=[];
try{
 b=await chromium.launch({channel:'msedge',headless:true});const p=await b.newPage({viewport:{width:1440,height:1050}});
 // Read the actual session event in the inspector, not a loop name or deadline mentioning none.
 for(const key of['codex/gpt-6-luna/none','codex/gpt-5.6-sol/none','codex/qa-unknown-family/none']){
  await p.goto(L.state.api.origin+'/app/runs/'+L.state.api.runs[key]);
  const row=p.getByRole('button').filter({hasText:'harness.session'});await row.waitFor({timeout:10000});await row.click();
  const summary=p.getByText('Exact recorded event #7',{exact:true});await summary.click();
  await p.getByText(/"effort": "none"/).waitFor({timeout:10000});
  const text=await p.locator('body').innerText();rec.check('inspector session effort none '+key,/"effort": "none"/.test(text),text);
  // Only the recorded session panel: no private workdir is present in this event.
  await p.getByText(/"effort": "none"/).scrollIntoViewIfNeeded();await p.screenshot({path:path.join(L.OUT,'session-'+key.split('/')[1]+'.png')});
 }
 for(const[name,defaults,want]of[['process-gpt55',{byHarness:{codex:{model:'gpt-5.5',effort:'low'}}},['','low','medium','high','xhigh']],['process-unset',{byHarness:{}},['','low','medium','high','xhigh']]]){
  const dir=L.makeStore(name),f=L.fake(dir);const g=await L.startGateway({dir,port:6374,label:name,env:{...f.env,GG_DEFAULTS:JSON.stringify(defaults)},rec});gs.push(g);
  await p.goto(g.origin+'/app/settings');const e=p.getByLabel('Default effort',{exact:true});await e.waitFor();await L.waitFor(async()=>(await e.locator('option').count())===want.length);
  const values=await e.locator('option').evaluateAll(os=>os.map(o=>o.value));rec.check('Settings source '+name,L.same(values,want),{process:(await g.call('/system/model-defaults')).json,values});await p.getByRole('region',{name:'codex defaults'}).screenshot({path:path.join(L.OUT,'settings-'+name+'.png')});
  await g.stop();g.copyLog(name+'-gateway.log.txt');
 }
 // Claude field explanation on a persisted unsupported selection, as with GPT-5.5.
 const call=L.makeCall(L.state.api.origin);
 const c=await L.createLoop(call,L.single('QA205 Claude field',L.inferenceNode('work',{harness:'claude',model:'claude-haiku-5-5',effort:'low'})));
 await L.sql(L.state.api.dir,`UPDATE loop_versions SET definition=replace(definition,'"effort":"low"','"effort":"none"') WHERE loop_id=?`,[c.json.loop.id]);
 await p.goto(L.state.api.origin+'/app/loops/'+c.json.loop.id+'/edit');await p.getByTestId('node-work').locator(':scope > div:has([data-kind])').click();const dialog=p.getByRole('dialog');const eff=dialog.getByLabel('Effort',{exact:true});await eff.waitFor();
 const hint=await eff.evaluate(el=>(el.getAttribute('aria-describedby')??'').split(/\s+/).map(id=>document.getElementById(id)?.textContent??'').join(' '));
 rec.check('Claude none kept and explained on effort field',await eff.inputValue()==='none'&&hint.includes('Effort none is not supported by Claude Haiku 5.5'),hint);await dialog.screenshot({path:path.join(L.OUT,'claude-field-none.png')});
 // Import is also a public save point.
 const ex=await call('/loops/'+L.state.api.editor+'/export?draft=true');rec.log('export shape',Object.keys(ex.json));
 const payload=structuredClone(ex.json);const walk=x=>{if(x&&typeof x==='object')for(const k of Object.keys(x)){if(k==='effort'&&typeof x[k]==='string')x[k]='minimal';else walk(x[k]);}};walk(payload);
 const imp=await call('/loops/import',{method:'POST',body:payload});rec.check('minimal import request refused 400',imp.status===400,imp);
 // Supplemental hand repair of the omitted event, on this disposable fixture only.
 const e=L.state.legacyEvent;await L.sql(e.dir,`UPDATE run_events SET payload=replace(payload,'"effort":"minimal"','"effort":"none"') WHERE run_id=? AND type='harness.session'`,[e.runId]);
 const g=await L.startGateway({dir:e.dir,port:6374,label:'legacy-event-repaired',env:{GG_CODEX_BINARY:path.join(e.dir,'fake/codex.exe'),GG_CLAUDE_BINARY:path.join(e.dir,'fake/claude.exe')},rec});gs.push(g);
 const read=await g.call('/runs/'+e.runId+'/events?limit=1000');rec.check('supplemental run_events hand update restores history',read.status===200&&read.json.items?.some(x=>x.type==='harness.session'&&x.effort==='none'),read);await g.stop();g.copyLog('legacy-event-repaired-gateway.log.txt');
}catch(e){rec.check('final-checks exception',false,String(e.stack??e));}finally{await b?.close();for(const g of gs)if(g.exitCode()===null)await g.stop();rec.finish();}
