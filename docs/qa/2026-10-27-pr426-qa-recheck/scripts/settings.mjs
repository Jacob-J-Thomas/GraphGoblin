import path from 'node:path';
import * as L from './lib.mjs';
const rec=new L.Recorder('settings');
const stores=[],gateways=[];
let browser;
const values=select=>select.locator('option').evaluateAll(options=>options.map(o=>o.value));
const description=select=>select.evaluate(el=>(el.getAttribute('aria-describedby')??'').split(/\s+/).map(id=>document.getElementById(id)?.textContent??'').join(' ').trim());
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
try {
  browser=await L.launchEdge();
  for(const scenario of [
    {name:'process-luna',defaults:undefined,expected:['low','medium','high','xhigh','max']},
    {name:'process-gpt55',defaults:{byHarness:{codex:{model:'gpt-5.5',effort:'low'}}},expected:['low','medium','high','xhigh']},
    {name:'process-unconfigured',defaults:{byHarness:{}},expected:['low','medium','high','xhigh']},
  ]) {
    const dir=L.makeStore('settings-'+scenario.name);stores.push(dir);
    const fake=L.fakeCli(dir);
    const g=await L.startGateway({dir,port:6718,label:scenario.name,env:{...fake.env,...(scenario.defaults?{GG_DEFAULTS:JSON.stringify(scenario.defaults)}:{})},rec});gateways.push(g);
    const page=await browser.newPage({viewport:{width:1440,height:1050}});
    await page.goto(g.origin+'/app/settings');
    const effort=page.getByLabel('Default effort',{exact:true});
    const model=page.getByLabel('Default model',{exact:true});
    await effort.waitFor({timeout:20_000});
    await L.waitFor(async()=>same(await values(effort),['',...scenario.expected]),{timeoutMs:10_000});
    const catalog=(await g.call('/model-catalog')).json.items.filter(i=>i.harness==='codex');
    const processDefaults=(await g.call('/system/model-defaults')).json;
    const effective=processDefaults.byHarness?.codex?.model;
    const expected=effective?catalog.find(i=>i.model===effective).efforts:catalog[0].efforts.filter(e=>catalog.every(i=>i.efforts.includes(e)));
    const offered=await values(effort);
    rec.check(`${scenario.name}: server-default list equals effective process model or intersection, without minimal`,await model.inputValue()==='' && same(offered,['',...expected]) && same(expected,scenario.expected) && !offered.includes('minimal'),{processDefaults,expected,offered});
    await page.getByRole('region',{name:'codex defaults'}).screenshot({path:path.join(L.OUT,`settings-${scenario.name}.png`)});
    if(scenario.name==='process-luna') {
      const change=async allow=>L.withDb(dir,db=>db.execute({sql:"UPDATE model_catalog SET efforts = ? WHERE harness = 'codex' AND model = 'gpt-6-luna'",args:[JSON.stringify([...(allow?['minimal']:[]),'low','medium','high','xhigh','max'])]}));
      for(const explicit of [false,true]) {
        if(explicit) {await model.selectOption('gpt-6-luna');await L.waitFor(async()=>((await g.call('/settings')).json.defaults?.byHarness?.codex?.model)==='gpt-6-luna');}
        await change(true);
        await page.reload();
        await L.waitFor(async()=>(await values(effort)).includes('minimal'),{timeoutMs:10_000});
        await change(false);
        const putPromise=page.waitForResponse(r=>r.url().endsWith('/settings') && r.request().method()==='PUT');
        await effort.selectOption('minimal');
        const put=await putPromise;
        const alert=page.getByRole('alert').filter({hasText:'Not saved.'});
        await alert.waitFor({timeout:10_000});
        const text=await alert.innerText();
        const desc=await description(effort);
        const expectedMessage='Not saved. Effort minimal is not supported by GPT-6 Luna. Choose a supported effort or Default.';
        rec.check(`refusal (${explicit?'explicit model':'server default'}): real PUT 400 names minimal on the effort field`,put.status()===400 && text===expectedMessage && desc.includes(expectedMessage) && (await page.getByText(/invalid harness defaults/).count())===0,{status:put.status(),body:await put.json(),text,description:desc});
        await page.getByRole('region',{name:'codex defaults'}).screenshot({path:path.join(L.OUT,`settings-refused-${explicit?'explicit':'inherited'}.png`)});
        await change(true);
        const stored=await g.call('/settings',{method:'PUT',body:{defaults:{byHarness:{codex:{...(explicit?{model:'gpt-6-luna'}:{}),effort:'minimal'}}}}});
        await change(false);
        await page.reload();
        await L.waitFor(async()=>await effort.inputValue()==='minimal');
        const kept={value:await effort.inputValue(),text:await effort.locator('option:checked').innerText(),description:await description(effort)};
        rec.check(`stored minimal (${explicit?'explicit model':'server default'}): kept and explained`,stored.status===200 && kept.text==='minimal (not supported by this model)' && kept.description.includes('Effort minimal is not supported by GPT-6 Luna. Choose a supported effort or Default.'),kept);
        await page.getByRole('region',{name:'codex defaults'}).screenshot({path:path.join(L.OUT,`settings-kept-${explicit?'explicit':'inherited'}.png`)});
        await effort.selectOption('low');
        await L.waitFor(async()=>((await g.call('/settings')).json.defaults?.byHarness?.codex?.effort)==='low');
        rec.check(`stored minimal (${explicit?'explicit model':'server default'}): selecting low saves and clears explanation`,(await g.call('/settings')).json.defaults?.byHarness?.codex?.effort==='low' && !(await description(effort)).includes('not supported'),await description(effort));
      }
    }
    rec.check(`${scenario.name}: no fake provider turns`,fake.requests().length===0,fake.requests());
    await page.close();
    rec.check(`${scenario.name}: gateway drains to exit 0`,await g.stop()===0,g.exitCode());
    g.copyLog(`settings-${scenario.name}-gateway.log.txt`);
  }
} catch(error) {rec.check('settings scenario completed without exception',false,String(error.stack??error));}
finally {
  await browser?.close().catch(()=>{});
  for(const g of gateways) {await g.stop();g.copyLog(`settings-${g.label}-gateway.log.txt`);}
  rec.finish();for(const dir of stores)L.cleanupStore(dir,rec);
}
