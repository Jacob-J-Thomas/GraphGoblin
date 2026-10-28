import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import * as L from './lib.mjs';
const tools=fs.readFileSync(path.join(L.OUT,'tools-path.local.txt'),'utf8').trim();
// Keep this short-lived handoff file until the regression driver consumes it.
const dir=L.store('rejections'),cli=L.cli(dir,path.join(tools,'codex.exe'));
const telemetry=path.join(dir,'prototype.log.txt');
const targets=[];
let g;
const listing=names=>cli.set('listing.json',JSON.stringify(names.map(name=>({name,enabled:true,transport:{type:'stdio',command:'qa423b'}}))));
async function execute(name,overrides){
  const before=cli.requests().length;
  const definition=L.inference(name,overrides===undefined?{}:{harnessOptions:{sandbox:'workspace-write',approval:'never',configOverrides:overrides}});
  L.write(name+'-input.json',definition);
  const loop=await L.publish(g,definition);const id=await L.start(g,loop);await L.end(g,id);const snap=await L.snapshot(g,id,name);const requests=cli.requests().slice(before);L.write(name+'-requests.log.txt',requests.map(JSON.stringify).join('\n'));
  return {id,...snap,requests};
}
async function cleanTurn(label){
  listing(['toString','node_repl']);const result=await execute(label);
  L.check(label+' second ordinary turn succeeds',result.run.status==='succeeded',result.run);
  const calls=result.requests;L.isolation(label,calls.find(q=>q.kind==='listing'),calls.find(q=>q.kind==='turn'),['toString','node_repl']);
  const samples=fs.readFileSync(telemetry,'utf8').trim().split('\n').map(JSON.parse);
  L.check(label+' gateway Object.prototype unchanged',samples.every(s=>!s.changed.length&&!s.removed.length),{sampleCount:samples.length,last:samples.at(-1)});
}
try{
  L.environment();
  g=await L.gateway(dir,6396,{...cli.env,NODE_OPTIONS:'--import '+pathToFileURL(path.join(L.OUT,'prototype-observer.mjs')).href,QA423B_PROTOTYPE_RECORD:telemetry},'rejections');
  // Before/after public turns supplement read-only descriptor observations in the gateway itself.
  await cleanTurn('ordinary-baseline');
  for(const [label,name] of [['proto','__proto__'],['constructor','constructor'],['prototype','prototype'],['space','team docs'],['quote','say"hi"']]){
    listing([name]);const r=await execute('listed-'+label);const f=r.run.failure;
    L.check('listed '+label+' refuses before submission',r.run.status==='failed'&&f?.code==='HARNESS_TURN_FAILED'&&f?.inference?.submission==='definitely-not-submitted'&&f?.resumable===true&&!r.requests.some(q=>q.kind==='turn'),{failure:f,execCalls:r.requests.filter(q=>q.kind==='turn').length});
    targets.push({name:'listed-'+label,id:r.id,code:'HARNESS_TURN_FAILED',cause:name,allowed:true});
    // Exercise public Resume while the bad listing remains: it must repeat no turn.
    const before=cli.requests().filter(q=>q.kind==='turn').length;
    const resumed=await g.call(`/runs/${r.id}/resume`,'POST',{observedSeq:r.run.lastEventSeq});await L.end(g,r.id);const after=await L.snapshot(g,r.id,'listed-'+label+'-resume');
    L.check('listed '+label+' Resume offered but still no exec',resumed.status===200&&after.run.failure?.inference?.submission==='definitely-not-submitted'&&cli.requests().filter(q=>q.kind==='turn').length===before,{response:resumed,run:after.run});
    await cleanTurn('after-listed-'+label);
  }
  // JSON serialization preserves the reserved segments; no JS __proto__ literal assignment.
  const overrides=[
    ['dotted-proto',{'probe.__proto__.qa423bLeak':'pollution-sentinel'}],
    ['nested-proto',JSON.parse('{"mcp_servers":{"__proto__":{"enabled":true}}}')],
    ['constructor-server',{mcp_servers:{constructor:{enabled:true}}}],
    ['prototype-feature',{features:{prototype:true}}],
    ['space',{'team docs':true}],
    ['quote',{'say"hi"':true}],
    ['empty-segment',{'features..plugins':true}],
    ['array-table',{arbitrary:[{'bad key':true}]}],
    ['array-nested-proto',{arbitrary:[{'nested.__proto__.qa423bLeak':true}]}],
  ];
  for(const [label,config] of overrides){
    listing(['node_repl']);const r=await execute('override-'+label,config);const f=r.run.failure;
    L.check('override '+label+' pinned refusal before submission',r.run.status==='failed'&&f?.code==='HARNESS_TURN_FAILED'&&f?.details?.adapterCode==='HARNESS_INVALID_CONFIGURATION'&&f?.inference?.submission==='definitely-not-submitted'&&f?.resumable===false&&!r.requests.some(q=>q.kind==='turn'),{failure:f,execCalls:r.requests.filter(q=>q.kind==='turn').length});
    const resume=await g.call(`/runs/${r.id}/resume`,'POST',{observedSeq:r.run.lastEventSeq});L.check('override '+label+' Resume refused',resume.status===409,resume);
    targets.push({name:'override-'+label,id:r.id,code:'HARNESS_TURN_FAILED',adapter:'HARNESS_INVALID_CONFIGURATION',allowed:false});
    await cleanTurn('after-override-'+label);
  }
  for(const [label,config,override] of [
    ['ordinary-reenable',{'mcp_servers.toString.enabled':true,approval_policy:'on-request'},{server:'toString'}],
    ['ordinary-plugins',{features:{plugins:true}},{plugins:true}],
  ]){
    listing(['toString','node_repl']);const r=await execute(label,config);L.check(label+' succeeds',r.run.status==='succeeded',r.run);L.isolation(label,r.requests.find(q=>q.kind==='listing'),r.requests.find(q=>q.kind==='turn'),['toString','node_repl'],override);
  }
  // Browser state is read from the built inspector, with no product-state or JS-global edits.
  const req=createRequire(path.join(L.ROOT,'apps/web/package.json'));const testReq=createRequire(req.resolve('@playwright/test/package.json'));const {chromium}=(await import(pathToFileURL(testReq.resolve('playwright')).href)).default;
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    for(const t of targets){
      await page.goto(g.origin+'/app/runs/'+t.id);await page.getByText('Failed: HARNESS_TURN_FAILED',{exact:false}).first().waitFor({timeout:15000});await L.sleep(100);
      // Read the exact run record as well: pinned adapterCode is nested there.
      const details=page.getByText('Exact run record',{exact:true});if(await details.count())await details.click();
      const text=await page.locator('body').innerText();L.write('inspector-'+t.name+'.log.txt',text);
      const causeVisible=t.cause?(text.includes(t.cause)||text.includes(JSON.stringify(t.cause))):text.includes('override')&&text.includes('key');
      const resume=page.getByRole('button',{name:'Resume',exact:true});const enabled=await resume.count()>0&&await resume.isEnabled();
      L.check('inspector '+t.name+' cause and Resume policy',text.includes(t.code)&&causeVisible&&enabled===t.allowed&&(!t.adapter||text.includes(t.adapter)),{id:t.id,causeVisible,resumeEnabled:enabled,adapterVisible:!t.adapter||text.includes(t.adapter)});
      if(t.name==='listed-proto'||t.name==='override-dotted-proto')await page.screenshot({path:path.join(L.OUT,'inspector-'+t.name+'.png'),fullPage:true});
    }
  }finally{await browser.close();L.log('rejection QA browser closed',{});}
}catch(error){L.check('rejection driver completed',false,String(error.stack));}
finally{
  await g?.stop();
  if(fs.existsSync(telemetry))L.write('gateway-prototype.log.txt',fs.readFileSync(telemetry,'utf8'));
  L.write('rejections-results.json',{checks:L.checks,passed:L.checks.filter(c=>c.ok).length,failed:L.checks.filter(c=>!c.ok).length,process:g?{pid:g.pid,exit:g.exit()}:null,store:dir,targets,realProviderTurns:0});
}
