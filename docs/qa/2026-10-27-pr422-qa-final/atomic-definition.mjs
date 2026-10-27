// Built product, real SQLite and HTTP. A public EventStore decorator injects one
// durable append immediately before the reviewed Resume append's CAS.
import fs from 'node:fs';
import path from 'node:path';
import { createContainer, loadConfig, buildApp } from '../../../apps/api/dist/index.js';
import { RunManager } from '../../../packages/engine/dist/index.js';
import { chromium } from '../../../apps/web/node_modules/@playwright/test/index.mjs';
import { Client } from '../../../apps/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '../../../apps/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
import * as L from './lib.mjs';
const dir=path.join(L.ROOT,'atomic-definition');fs.mkdirSync(dir,{recursive:true});
const c=await createContainer(loadConfig({GG_DATA_DIR:dir,GG_DB_URL:'file:'+path.join(dir,'graphgoblin.db'),GG_WEB_DIST:path.join(L.REPO,'apps/web/dist'),GG_REQUIRE_API_KEY:'false',GG_MASTER_KEY:Buffer.alloc(32,9).toString('base64')}),{startTimers:false});
await c.start();c.manager.stop();
const store=c.ports.events;let inject;
const events={read:(...a)=>store.read(...a),subscribe:(...a)=>store.subscribe(...a),recoveryFacts:(...a)=>store.recoveryFacts(...a),append:async(id,drafts,options)=>{
 if(inject&&drafts.some(d=>d.type==='run.resumed')){const draft=inject;inject=undefined;await store.append(id,[draft]);}
 return store.append(id,drafts,options);
}};
const manager=new RunManager({...c.ports,events},c.settings);await manager.start();
const app=await buildApp({...c,manager},{logger:false});
const api={base:'http://127.0.0.1:6660',async call(method,url,body){const r=await fetch(api.base+url,{method,headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};},async get(url){const r=await api.call('GET',url);if(r.status!==200)throw Error(JSON.stringify(r));return r.body;},async post(url,body={}){const r=await api.call('POST',url,body);if(r.status>=300)throw Error(JSON.stringify(r));return r.body;}};
const E={parked:[],definition:[]};let browser,client;
try{
 await app.listen({host:'127.0.0.1',port:6660});
 for(const type of ['signal.received','run.cancel_requested','none']){
  const r=await L.run(api,await L.publish(api,L.loop('Atomic park '+type,[L.waitNode()])));
  const waiting=await L.state(api,r.id,['waiting']);await api.post(`/runs/${r.id}/pause`);
  const paused=await L.state(api,r.id,['paused']);
  if(type!=='none')inject=type==='signal.received'?{type,name:'unrelated',payload:'interleave'}:{type,actor:{kind:'user',id:'qa-other'}};
  const response=await api.call('POST',`/runs/${r.id}/resume`,{observedSeq:paused.recovery.observedSeq});
  const after=await api.get('/runs/'+r.id);const history=await L.events(api,r.id);
  const resumed=history.filter(e=>e.type==='run.resumed');
  if(type==='none'){
   L.check('uninterleaved parked Resume retains same wait',response.status===200&&after.status==='waiting'&&JSON.stringify(after.waiting)===JSON.stringify(waiting.waiting)&&resumed.length===1,{response,waiting,after});
   await api.post(`/runs/${r.id}/input`,{waitId:waiting.waiting.waitId,input:'once'});await L.state(api,r.id,['succeeded']);
   L.check('original wait consumes input once',(await L.events(api,r.id)).filter(e=>e.type==='run.woken').length===1);
  }else L.check(type+' interleaved parked Resume refuses atomically',response.status===409&&response.body.code==='RECOVERY_STALE'&&after.status==='paused'&&resumed.length===0&&JSON.stringify(after.waiting)===JSON.stringify(waiting.waiting),{response,after,history});
  E.parked.push({type,waiting,paused,response,after,history});
 }
 const source=await L.run(api,await L.publish(api,L.loop('Damaged stored definition')));await L.state(api,source.id,['succeeded']);
 await manager.waitForIdle();const before=await api.get('/runs/'+source.id);
 const original=(await c.handle.client.execute({sql:'SELECT definition FROM loop_versions WHERE id=?',args:[source.versionId]})).rows[0].definition;
 const transport=new StdioClientTransport({command:process.execPath,args:[path.join(L.REPO,'apps/mcp/dist/main.js'),'--api-url',api.base],env:Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('GG_'))),stderr:'pipe'});
 client=new Client({name:'final-malformed-definition',version:'1'});await client.connect(transport);E.mcpPid=transport.pid;
 browser=await chromium.launch({channel:'msedge',headless:true});E.edge=browser.version();
 for(const bad of ['{}','{']){
  await c.handle.client.execute({sql:'UPDATE loop_versions SET definition=? WHERE id=?',args:[bad,source.versionId]});
  const read=await api.call('GET','/runs/'+source.id);
  const resume=await api.call('POST',`/runs/${source.id}/resume`,{observedSeq:before.recovery.observedSeq});
  const replay=await api.call('POST',`/runs/${source.id}/replay`,{nodeId:'start',observedSeq:before.recovery.observedSeq});
  L.check('stored '+bad+' HTTP remains readable; commands agree',read.status===200&&read.body.recovery.resume.code==='DEFINITION_UNAVAILABLE'&&read.body.recovery.replayDefault.code==='DEFINITION_UNAVAILABLE'&&resume.status===409&&resume.body.code==='DEFINITION_UNAVAILABLE'&&replay.status===409&&replay.body.code==='DEFINITION_UNAVAILABLE',{read,resume,replay});
  const mcp=await client.callTool({name:'get_run',arguments:{runId:source.id}});
  const mcpRun=mcp.structuredContent??JSON.parse(mcp.content.find(c=>c.type==='text').text);
  L.check('stored '+bad+' MCP recovery agrees',!mcp.isError&&JSON.stringify(mcpRun.recovery)===JSON.stringify(read.body.recovery),mcp);
  const commands=[];
  for(const name of ['resume_run','replay_run']){const r=await client.callTool({name,arguments:{runId:source.id,observedSeq:before.recovery.observedSeq,...(name==='replay_run'?{nodeId:'start'}:{})}});commands.push(r);L.check('stored '+bad+' MCP '+name+' refuses consistently',r.isError&&JSON.stringify(r).includes('DEFINITION_UNAVAILABLE'),r);}
  const page=await browser.newPage({viewport:{width:1440,height:1000}});await page.goto(api.base+'/app/runs/'+source.id);
  const button=page.getByRole('button',{name:'Resume',exact:true});await button.waitFor();
  const text=await page.locator('body').innerText();
  L.check('stored '+bad+' Edge displays run and unavailable reason',await button.isDisabled()&&text.includes('The pinned definition is unavailable or cannot execute.'),text);
  await page.screenshot({path:path.join(L.RECORD,bad==='{}'?'definition-invalid.png':'definition-malformed.png')});await page.close();
  E.definition.push({bad,read,resume,replay,mcp,commands,text});
 }
 await c.handle.client.execute({sql:'UPDATE loop_versions SET definition=? WHERE id=?',args:[original,source.versionId]});
}catch(error){E.error=L.redact(error.stack);L.check('atomic/definition driver completed',false,E.error);}
finally{await browser?.close();await client?.close();await app.close();manager.stop();await c.dispose();L.save('atomic-definition-results.json',{checks:L.checks,evidence:E});}
process.exitCode=L.checks.some(c=>!c.passed)?1:0;
