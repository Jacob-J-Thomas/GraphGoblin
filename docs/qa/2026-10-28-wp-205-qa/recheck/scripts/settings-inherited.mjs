import path from'node:path';import{createRequire}from'node:module';import*as L from'./qa.mjs';
const require=createRequire(path.join(L.ROOT,'apps/web/package.json'));const{chromium}=require('@playwright/test');const rec=new L.Recorder('settings-inherited');let b;
const description=e=>e.evaluate(el=>(el.getAttribute('aria-describedby')??'').split(/\s+/).map(id=>document.getElementById(id)?.textContent??'').join(' '));
try{
 const call=L.makeCall(L.state.api.origin);await call('/settings',{method:'PUT',body:{defaults:{byHarness:{}}}});
 b=await chromium.launch({channel:'msedge',headless:true});const p=await b.newPage({viewport:{width:1440,height:1050}});await p.goto(L.state.api.origin+'/app/settings');const e=p.getByLabel('Default effort',{exact:true}),m=p.getByLabel('Default model',{exact:true});await e.waitFor();
 await e.selectOption('low');await L.waitFor(async()=>((await call('/settings')).json.defaults.byHarness.codex?.effort)==='low');await L.catalogEfforts(L.state.api.dir,'codex','gpt-6-luna',L.scale.slice(1));
 const response=p.waitForResponse(r=>r.url().endsWith('/settings')&&r.request().method()==='PUT'&&r.request().postDataJSON()?.defaults?.byHarness?.codex?.effort==='none'&&!r.request().postDataJSON()?.defaults?.byHarness?.codex?.model);
 await e.selectOption('none');const r=await response;await p.getByRole('alert').filter({hasText:'Not saved.'}).waitFor();const text=await description(e);
 rec.check('server-default model: HTTP400 names refused none on field',await m.inputValue()===''&&r.status()===400&&text.includes('Effort none is not supported by GPT-6 Luna'),{status:r.status(),request:r.request().postDataJSON(),body:await r.json(),description:text});await p.getByRole('region',{name:'codex defaults'}).screenshot({path:path.join(L.OUT,'settings-inherited-refusal.png')});
 await L.catalogEfforts(L.state.api.dir,'codex','gpt-6-luna',L.scale);
 // Existing unsupported owner selection: read, retain, explain, repair through real autosave.
 await L.sql(L.state.api.dir,"UPDATE settings SET value=? WHERE key='defaults'",[JSON.stringify({byHarness:{codex:{model:'gpt-5.5',effort:'none'}}})]);await p.reload();await L.waitFor(async()=>await e.inputValue()==='none');
 const kept={value:await e.inputValue(),label:await e.locator('option:checked').innerText(),description:await description(e)};rec.check('stored Settings none kept and explained',kept.label==='none (not supported by this model)'&&kept.description.includes('Effort none is not supported by GPT-5.5'),kept);await p.getByRole('region',{name:'codex defaults'}).screenshot({path:path.join(L.OUT,'settings-kept-unsupported.png')});
 await e.selectOption('low');await L.waitFor(async()=>((await call('/settings')).json.defaults.byHarness.codex?.effort)==='low');rec.check('low repairs Settings and clears explanation',!(await description(e)).includes('not supported'),await call('/settings'));await call('/settings',{method:'PUT',body:{defaults:{byHarness:{}}}});
}catch(e){rec.check('settings-inherited exception',false,String(e.stack??e));}finally{await b?.close();rec.finish();}
