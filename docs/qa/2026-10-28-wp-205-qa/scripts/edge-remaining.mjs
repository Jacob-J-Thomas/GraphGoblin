import fs from'node:fs';import path from'node:path';import{createRequire}from'node:module';import*as L from'./qa.mjs';
const require=createRequire(path.join(L.ROOT,'apps/web/package.json'));const{chromium}=require('@playwright/test');const rec=new L.Recorder('edge-remaining');let b,p;
const rows=s=>s.locator('option').evaluateAll(os=>os.map(o=>({value:o.value,text:o.textContent})));
const desc=s=>s.evaluate(el=>(el.getAttribute('aria-describedby')??'').split(/\s+/).map(id=>document.getElementById(id)?.textContent??'').join(' '));
const shot=async name=>p.screenshot({path:path.join(L.OUT,name+'.png')});
try{
 const call=L.makeCall(L.state.api.origin);const ed=(await call('/loops/'+L.state.api.editor)).json;
 const d=ed.draft.definition;for(const[n,i]of d.nodes.map((n,i)=>[n,i]))n.ui={x:i*290,y:80};
 rec.check('separate overlapping QA fixture cards via public draft PUT',(await call('/loops/'+L.state.api.editor+'/draft',{method:'PUT',body:{definition:d}})).status===200);
 await L.sql(L.state.api.dir,`INSERT INTO model_catalog(harness,model,source,display_name,efforts,default_effort,enabled) VALUES('codex','qa-local','litellm','QA local','["none","low"]','low',1)`);
 const min=await call('/model-catalog/codex/qa-local',{method:'PUT',body:{displayName:'QA local',efforts:['minimal','low'],defaultEffort:'minimal'}});
 rec.check('actual catalog PUT rejects minimal as 400 VALIDATION_FAILED',min.status===400&&min.json.code==='VALIDATION_FAILED',min.json);
 b=await chromium.launch({channel:'msedge',headless:true});p=await b.newPage({viewport:{width:1440,height:1050}});
 await p.goto(L.state.api.origin+'/app/settings');await p.getByRole('button',{name:'Add model',exact:true}).waitFor();
 await p.getByRole('button',{name:'Add model',exact:true}).click();const form=p.getByRole('form',{name:'Add model'});
 const checkboxes=await form.getByRole('checkbox').evaluateAll(es=>es.map(e=>({value:e.value,text:e.labels?.[0]?.textContent})));
 const lists=await form.locator('select').evaluateAll(es=>es.map(e=>({label:e.labels?.[0]?.textContent,options:[...e.options].map(o=>({value:o.value,text:o.textContent}))})));
 rec.check('LiteLLM form lists none first with no reasoning, no minimal',JSON.stringify({checkboxes,lists}).includes('none (no reasoning)')&&!JSON.stringify({checkboxes,lists}).includes('minimal')&&(checkboxes.length?checkboxes[0].text?.includes('none'):lists.some(x=>x.options[0].value==='none')),{checkboxes,lists});await shot('litellm-form-none');await form.getByRole('button',{name:'Cancel'}).click();
 // Correct response matching: ignore the preceding low autosave.
 const e=p.getByLabel('Default effort',{exact:true}),m=p.getByLabel('Default model',{exact:true});await m.selectOption('gpt-6-luna');await e.selectOption('low');
 await L.waitFor(async()=>((await call('/settings')).json.defaults.byHarness.codex?.effort)==='low');
 await L.catalogEfforts(L.state.api.dir,'codex','gpt-6-luna',L.scale.slice(1));
 const response=p.waitForResponse(r=>r.url().endsWith('/settings')&&r.request().method()==='PUT'&&r.request().postDataJSON()?.defaults?.byHarness?.codex?.effort==='none');
 await e.selectOption('none');const r=await response;await p.getByRole('alert').filter({hasText:'Not saved.'}).waitFor();
 rec.check('Settings none autosave HTTP400 and associated field explanation',r.status()===400&&(await desc(e)).includes('Effort none is not supported by GPT-6 Luna'),{status:r.status(),body:await r.json(),description:await desc(e)});await shot('settings-refused-none-verified');
 await L.catalogEfforts(L.state.api.dir,'codex','gpt-6-luna',L.scale);await call('/settings',{method:'PUT',body:{defaults:{byHarness:{}}}});
 await p.goto(L.state.api.origin+'/app/loops/'+L.state.api.editor+'/edit');await p.getByTestId('node-infer').waitFor();
 for(const id of['infer','pick']){await p.getByTestId('node-'+id).locator(':scope > div:has([data-kind])').click();const dialog=p.getByRole('dialog');await dialog.waitFor();const eff=dialog.getByLabel('Effort',{exact:true}),mod=dialog.getByLabel('Model',{exact:true});let options=await rows(eff);
  rec.check(id+' none first with no reasoning',options[1]?.value==='none'&&options[1].text==='none (no reasoning)',options);await shot(id+'-none');
  await mod.selectOption('gpt-5.5');await L.waitFor(async()=>(await desc(eff)).includes('Effort none is not supported by GPT-5.5'));
  rec.check(id+' retains none with field explanation',await eff.inputValue()==='none'&&(await desc(eff)).includes('Effort none is not supported by GPT-5.5'),{rows:await rows(eff),description:await desc(eff)});await shot(id+'-refused-none');
  await mod.selectOption('gpt-6-luna');await dialog.getByRole('button',{name:'Done',exact:true}).click();
 }
 const panel=p.getByRole('complementary').filter({has:p.getByLabel('Maximum node visits',{exact:true})}).first();const le=panel.getByLabel('Effort',{exact:true});const options=await rows(le);rec.check('loop default none first with no reasoning',options[1]?.value==='none'&&options[1].text==='none (no reasoning)',options);await shot('loop-default-none');
 for(const key of['codex/gpt-6-luna/none','codex/gpt-5.6-sol/none','codex/qa-unknown-family/none']){await p.goto(L.state.api.origin+'/app/runs/'+L.state.api.runs[key]);await p.getByText('succeeded',{exact:true}).first().waitFor({timeout:10000}).catch(()=>{});const text=await p.locator('body').innerText();rec.check('inspector canonical none '+key,/none/.test(text),text);await shot('inspector-'+key.split('/')[1]);}
}catch(e){rec.check('remaining Edge exception',false,String(e.stack??e));if(p){fs.writeFileSync(path.join(L.OUT,'edge-remaining-body.log.txt'),L.redact(await p.locator('body').innerText().catch(()=>'')));await shot('edge-remaining-last').catch(()=>{});}}
finally{await b?.close();rec.finish();}
