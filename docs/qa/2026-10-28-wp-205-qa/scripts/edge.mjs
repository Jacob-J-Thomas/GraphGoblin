// Independent real-Edge driver, following the explicitly permitted PR426 QA driver pattern.
import fs from 'node:fs';import path from 'node:path';import{createRequire}from'node:module';import*as L from'./qa.mjs';
const require=createRequire(path.join(L.ROOT,'apps/web/package.json'));const{chromium}=require('@playwright/test');
const rec=new L.Recorder('edge');let browser;let page;
const rows=async select=>select.locator('option').evaluateAll(os=>os.map(o=>({value:o.value,text:o.textContent})));
const desc=select=>select.evaluate(el=>(el.getAttribute('aria-describedby')??'').split(/\s+/).map(id=>document.getElementById(id)?.textContent??'').join(' '));
const shot=async name=>page.screenshot({path:path.join(L.OUT,name+'.png')});
const close=async()=>page.getByRole('dialog').getByRole('button',{name:'Done',exact:true}).click();
const open=async id=>{await page.getByTestId('node-'+id).locator(':scope > div:has([data-kind])').click();const d=page.getByRole('dialog');await d.waitFor();return d;};
try{
 browser=await chromium.launch({channel:'msedge',headless:true});rec.log('Edge version',browser.version());
 page=await browser.newPage({viewport:{width:1440,height:1050}});const g={call:L.makeCall(L.state.api.origin)};
 await page.goto(L.state.api.origin+'/app/settings');
 const effort=page.getByLabel('Default effort',{exact:true}),model=page.getByLabel('Default model',{exact:true});await effort.waitFor();
 await L.waitFor(async()=>(await rows(effort)).length===7,{timeoutMs:10000});
 let r=await rows(effort);rec.check('Settings server model lists none first as no reasoning',r[1]?.value==='none'&&r[1].text==='none (no reasoning)'&&!JSON.stringify(r).includes('minimal'),r);await shot('settings-none');
 await model.selectOption('gpt-5.5');await L.waitFor(async()=>!(await rows(effort)).some(x=>x.value==='none'));
 rec.check('Settings selected GPT5.5 uses its own effort list',L.same((await rows(effort)).map(x=>x.value),['','low','medium','high','xhigh']),await rows(effort));
 await model.selectOption('gpt-6-luna');await L.waitFor(async()=>(await rows(effort)).some(x=>x.value==='none'));
 await effort.selectOption('none');await L.waitFor(async()=>((await g.call('/settings')).json.defaults.byHarness.codex?.effort)==='none');
 rec.check('Settings saves supported none through real PUT',(await g.call('/settings')).json.defaults.byHarness.codex.effort==='none');
 // Current UI has none, server catalog loses it: the real Settings autosave must name the refusal.
 await L.catalogEfforts(L.state.api.dir,'codex','gpt-6-luna',L.scale.slice(1));
 await effort.selectOption('low');await L.waitFor(async()=>((await g.call('/settings')).json.defaults.byHarness.codex?.effort)==='low');
 const put=page.waitForResponse(r=>r.url().endsWith('/settings')&&r.request().method()==='PUT');await effort.selectOption('none');const p=await put;
 await page.getByRole('alert').filter({hasText:'Not saved.'}).waitFor();
 const explanation=await desc(effort);rec.check('Settings refused PUT has on-field effort explanation',p.status()===400&&explanation.includes('Effort none is not supported by GPT-6 Luna'),{status:p.status(),body:await p.json(),description:explanation});await shot('settings-refused-none');
 await L.catalogEfforts(L.state.api.dir,'codex','gpt-6-luna',L.scale);await g.call('/settings',{method:'PUT',body:{defaults:{byHarness:{}}}});
 // LiteLLM form is in Settings; preserve the actual controls for followup if labels differ.
 const lite=page.getByRole('region',{name:/Model catalog/i});
 rec.log('Settings button labels',await page.getByRole('button').allTextContents());
 await page.goto(L.state.api.origin+'/app/loops/'+L.state.api.editor+'/edit');await page.getByTestId('node-infer').waitFor();
 for(const id of ['infer','pick']){
  const d=await open(id);const e=d.getByLabel('Effort',{exact:true});const m=d.getByLabel('Model',{exact:true});r=await rows(e);
  rec.check(id+' effort none first/no reasoning',r[1]?.value==='none'&&r[1].text==='none (no reasoning)',r);await shot(id+'-none');
  await m.selectOption('gpt-5.5');await L.waitFor(async()=>((await e.locator('option:checked').innerText()).includes('not supported')));
  const text=await desc(e);rec.check(id+' retains unsupported none and explains on field',await e.inputValue()==='none'&&text.includes('Effort none is not supported by GPT-5.5'),{rows:await rows(e),description:text});await shot(id+'-refused-none');
  await m.selectOption('gpt-6-luna');await close();
 }
 const panel=page.getByRole('complementary').filter({has:page.getByLabel('Maximum node visits',{exact:true})}).first();
 const loopEffort=panel.getByLabel('Effort',{exact:true});r=await rows(loopEffort);rec.check('loop defaults lists none first/no reasoning',r[1]?.value==='none'&&r[1].text==='none (no reasoning)',r);await shot('loop-default-none');
 for(const key of ['codex/gpt-6-luna/none','codex/gpt-5.6-sol/none','codex/qa-unknown-family/none']){
  await page.goto(L.state.api.origin+'/app/runs/'+L.state.api.runs[key]);await page.getByRole('heading',{name:/Run /}).first().waitFor({timeout:10000}).catch(()=>{});
  const text=await page.locator('body').innerText();rec.check('inspector displays canonical none '+key,/none/.test(text),text);await shot('inspector-'+key.split('/')[1]);
 }
}catch(e){rec.check('Edge driver exception',false,String(e.stack??e));if(page){fs.writeFileSync(path.join(L.OUT,'edge-last-body.log.txt'),L.redact(await page.locator('body').innerText().catch(()=>'')));await shot('edge-last-state').catch(()=>{});}}
finally{await browser?.close();rec.finish();}
