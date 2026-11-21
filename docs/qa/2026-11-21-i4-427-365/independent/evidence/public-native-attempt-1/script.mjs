// Independent QA. Real built API/engine/SQLite + SDK/native CLI; synthetic loopback provider.
// Login/preflight is deliberately controlled-ready, because this fixture uses no owner login.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const built='G:/ggq/gg-i4-362-qa/GraphGoblin';
const out=dirname(fileURLToPath(import.meta.url));
const attempt=process.env.GG_QA_ATTEMPT||'public-native-attempt-1';
const root=join(out,attempt);await mkdir(root,{recursive:false});
const home=join(root,'home'), work=join(root,'work'), store=join(root,'store');
await Promise.all([mkdir(home),mkdir(work),mkdir(store)]);
const from=(p)=>import(pathToFileURL(join(built,p)).href);
const {CodexHarness}=await from('packages/adapter-codex/dist/harness.js');
const {runCli}=await from('packages/adapter-codex/dist/cli.js');
const {FakeHarness,singleNodeLoop}=await from('packages/engine/dist/testing/index.js');
const {createContainer}=await from('apps/api/dist/container.js');
const {loadConfig}=await from('apps/api/dist/config.js');
const {buildApp}=await from('apps/api/dist/app.js');
const {createMcpServer}=await from('apps/mcp/dist/server.js');
const reqMcp=createRequire(pathToFileURL(join(built,'apps/mcp/dist/server.js')));
const {Client}=await import(pathToFileURL(reqMcp.resolve('@modelcontextprotocol/sdk/client/index.js')).href);
const {InMemoryTransport}=await import(pathToFileURL(reqMcp.resolve('@modelcontextprotocol/sdk/inMemory.js')).href);
const env=Object.fromEntries(Object.entries(process.env).filter(([k,v])=>v!==undefined&&/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP|COMSPEC)$/i.test(k)));
Object.assign(env,{CODEX_HOME:home,HOME:home,USERPROFILE:home,APPDATA:home,LOCALAPPDATA:home,QA427_PRIVATE_ENV_MARKER:'QA427_PRIVATE_ENV_DO_NOT_EXPOSE'});
let active;const requests=[],unexpected=[],nativeCalls=[],harnessCalls=[],logs=[];
const provider=http.createServer(async(req,res)=>{
 let bytes='';for await(const c of req)bytes+=c;
 if(req.method!=='POST'||!req.url.endsWith('/responses')){unexpected.push({method:req.method,url:req.url});res.writeHead(404).end();return}
 const body=JSON.parse(bytes);const record={name:active.name,method:req.method,path:req.url,body};requests.push(record);active.requests.push(record);
 if(active.status!==200){res.writeHead(active.status,{'content-type':'application/json'}).end(JSON.stringify(active.body));return}
 const sse=(type,body)=>`event: ${type}\ndata: ${JSON.stringify({type,...body})}\n\n`;
 res.writeHead(200,{'content-type':'text/event-stream'});
 res.write(sse('response.created',{response:{id:'resp_qa427_public'}}));
 res.write(sse('response.output_item.done',{item:{type:'message',role:'assistant',id:'msg_qa427_public',content:[{type:'output_text',text:'QA427_PUBLIC_SUPPORTED_OK'}]}}));
 res.end(sse('response.completed',{response:{id:'resp_qa427_public',usage:{input_tokens:1,input_tokens_details:{cached_tokens:0},output_tokens:1,output_tokens_details:{reasoning_tokens:0},total_tokens:2}}}));
});
await new Promise(r=>provider.listen(0,'127.0.0.1',r));
const providerPort=provider.address().port;
assert(![4747,4748].includes(providerPort));
await writeFile(join(home,'config.toml'),`model_provider="qa427"\n[model_providers.qa427]\nname="QA local synthetic Responses"\nbase_url="http://127.0.0.1:${providerPort}/v1"\nwire_api="responses"\nrequest_max_retries=0\nstream_max_retries=0\n[features]\nplugins=false\n[analytics]\nenabled=false\n[feedback]\nenabled=false\n[projects.${JSON.stringify(work)}]\ntrust_level="trusted"\n`);
const native=new CodexHarness({env,cliRunner:async(...args)=>{const r=await runCli(...args);nativeCalls.push({args:args[1],code:r.code,output:r.output});return r}});
const ready=new FakeHarness([], 'codex');
const harness={id:'codex',preflight:()=>ready.preflight(),start:(...args)=>{harnessCalls.push({action:'start',model:args[0].model});return native.start(...args)},resume:(...args)=>{harnessCalls.push({action:'resume',sessionId:args[0],model:args[1].model});return native.resume(...args)}};
const logger=Object.fromEntries(['debug','info','warn','error'].map(level=>[level,(data,message)=>logs.push({level,data,message})]));
const config=loadConfig({GG_DATA_DIR:store,GG_DB_URL:`file:${join(store,'qa427.db').replaceAll('\\','/')}`,GG_OLLAMA_ENABLED:'false',GG_REQUIRE_API_KEY:'false',GG_SWAGGER_UI:'false',GG_WEB_DIST:join(built,'apps/web/dist'),GG_LOG_LEVEL:'silent',GG_MASTER_KEY:Buffer.alloc(32,27).toString('base64')});
let container,app,mcp,client;const results=[];let failure;
const save=async()=>{
 for(const [name,value] of Object.entries({results,requests,nativeCalls,harnessCalls,unexpected,logs}))await writeFile(join(root,`${name}.json`),JSON.stringify(value,null,2));
};
try {
 container=await createContainer(config,{harnesses:{codex:harness},startTimers:false,logger});await container.start();
 app=await buildApp(container,{logger:false});await app.ready();await app.listen({host:'127.0.0.1',port:0});
 const apiPort=app.server.address().port;assert(![4747,4748,providerPort].includes(apiPort));const apiUrl=`http://127.0.0.1:${apiPort}`;
 const call=async(method,path,payload)=>{const r=await fetch(apiUrl+path,{method,headers:{'content-type':'application/json'},...(payload===undefined?{}:{body:JSON.stringify(payload)})});const text=await r.text();let body;try{body=JSON.parse(text)}catch{body=text}return{status:r.status,body}};
 mcp=createMcpServer({apiUrl,pollMs:10});client=new Client({name:'independent-qa427',version:'1.0.0'});
 const [s,c]=InMemoryTransport.createLinkedPair();await mcp.connect(s);await client.connect(c);
 const tool=async(name,args)=>{const r=await client.callTool({name,arguments:args});const text=r.content.filter(c=>c.type==='text').map(c=>c.text).join('\n');let body;try{body=JSON.parse(text)}catch{body=text}return{isError:r.isError??false,body}};
 const historical="The 'gpt-5.5' model is not supported when using Codex with a ChatGPT account.";
 const error=(status,type,code,message,param)=>({type:'error',status,error:{type,code,message,...(param?{param}:{})}});
 const cases=[
  {name:'historical-account-refusal',model:'gpt-5.5',status:400,body:error(400,'invalid_request_error','model_not_found',historical),expected:'HARNESS_ARGUMENTS_REJECTED',visible:historical,resume:false},
  {name:'alternate-endpoint-refusal',model:'gpt-6-luna',status:400,body:error(400,'invalid_request_error','model_not_found','This model is unavailable on the synthetic QA endpoint. QA427_ALTERNATE','model'),expected:'HARNESS_ARGUMENTS_REJECTED',visible:'QA427_ALTERNATE',resume:false},
  {name:'supported-positive',model:'gpt-6-luna',status:200,expected:'completed'},
  {name:'code-only-lookalike',model:'gpt-6-luna',status:400,body:error(400,'other_error','model_not_found','QA427_UNKNOWN_CODE_ONLY'),expected:'HARNESS_TURN_FAILED',visible:'QA427_UNKNOWN_CODE_ONLY',resume:true},
  {name:'transient-negative',model:'gpt-6-luna',status:503,body:error(503,'server_error','service_unavailable','QA427_TEMPORARY_OUTAGE'),expected:'HARNESS_TRANSPORT_FAILED',visible:'QA427_TEMPORARY_OUTAGE',resume:true},
 ];
 for(const scenario of cases){
  active={...scenario,requests:[]};const callsBefore=harnessCalls.length;
  const definition=singleNodeLoop(`QA427 ${scenario.name}`,{id:'infer',kind:'inference',label:'Controlled local native turn',config:{model:scenario.model,effort:'low',workingDirectory:work,harnessOptions:{sandbox:'read-only',approval:'never',configOverrides:{features:{plugins:false}}},prompt:{template:'Synthetic QA427 public interface fixture. Use no tools. Reply QA427_PUBLIC_SUPPORTED_OK.'}}});
  const created=await call('POST','/loops',{definition});assert.equal(created.status,201,JSON.stringify(created));const loopId=created.body.loop.id;
  const published=await call('POST',`/loops/${loopId}/publish`);assert.equal(published.status,200,JSON.stringify(published));
  const started=await call('POST',`/loops/${loopId}/runs`,{input:null});assert.equal(started.status,202,JSON.stringify(started));const runId=started.body.run.id;
  await container.manager.waitForIdle();
  const rest=await call('GET',`/runs/${runId}`);assert.equal(rest.status,200);const run=rest.body;
  const events=await call('GET',`/runs/${runId}/events?limit=1000`);assert.equal(events.status,200);
  const mcpGet=await tool('get_run',{runId});const mcpWait=await tool('wait_for_run',{runId,timeoutSeconds:1});const mcpEvents=await tool('read_run_events',{runId,limit:1000});
  const row={name:scenario.name,loopId,runId,rest,events,mcpGet,mcpWait,mcpEvents,requests:active.requests.length,harnessCalls:harnessCalls.slice(callsBefore)};
  results.push(row);await save();
  assert.equal(active.requests.length,1,'one local model request, no fallback/retry');assert.equal(row.harnessCalls.length,1);assert.equal(row.harnessCalls[0].action,'start');assert.equal(active.requests[0].body.model,scenario.model);
  assert.equal(mcpGet.isError,false);assert.deepEqual(mcpGet.body.failure,run.failure);assert.deepEqual(mcpGet.body.recovery,run.recovery);
  assert.equal(mcpWait.isError,false);assert.equal(mcpWait.body.finished,true);assert.deepEqual(mcpWait.body.run.failure,run.failure);
  const eventItems=events.body.items??events.body;assert.equal(eventItems.filter(e=>e.type==='harness.turn').length,1);assert.equal(mcpEvents.isError,false);
  if(scenario.status===200){assert.equal(run.status,'completed');assert(!run.failure);assert.equal(run.result,'QA427_PUBLIC_SUPPORTED_OK')}
  else {
   assert.equal(run.status,'failed');assert.equal(run.failure.code,scenario.expected==='HARNESS_ARGUMENTS_REJECTED'?'HARNESS_TURN_FAILED':scenario.expected);
   if(scenario.expected==='HARNESS_ARGUMENTS_REJECTED')assert.equal(run.failure.details.adapterCode,scenario.expected);
   assert(run.failure.message.includes(scenario.visible));assert.equal(run.failure.resumable,scenario.resume);assert.equal(run.recovery.resume.allowed,scenario.resume);assert.equal(run.failure.inference.submission,'delivery-uncertain');
   const failureText=JSON.stringify(run.failure);for(const forbidden of ['QA427_PRIVATE_ENV_DO_NOT_EXPOSE',home,'Codex Exec exited','Reading prompt from stdin','node:internal',' at '])assert(!failureText.includes(forbidden),`no private transport/stack diagnostic: ${forbidden}`);
   if(!scenario.resume){
    row.resume=await call('POST',`/runs/${runId}/resume`,{observedSeq:run.recovery.observedSeq});assert.equal(row.resume.status,409);assert.equal(row.resume.body.code,'FAILURE_NOT_RESUMABLE');
    row.mcpResume=await tool('resume_run',{runId,observedSeq:run.recovery.observedSeq});assert.equal(row.mcpResume.isError,true);assert(JSON.stringify(row.mcpResume).includes('FAILURE_NOT_RESUMABLE'));
    assert.equal(active.requests.length,1,'refused Resume must not invoke provider');assert.equal(harnessCalls.length,callsBefore+1);
   } else assert(!run.failure.message.includes('The provider refused the request'));
  }
  await save();console.log(JSON.stringify({name:scenario.name,status:run.status,failure:run.failure,resume:run.recovery.resume,requests:row.requests}));
 }
 assert.deepEqual(unexpected,[]);
 const connection={apiUrl,apiPort,providerPort,root,results:results.map(r=>({name:r.name,runId:r.runId,inspector:`${apiUrl}/app/runs/${r.runId}`})),tier:'Built API/engine/SQLite/MCP and pinned SDK/native CLI. Provider controlled local; preflight controlled ready. MCP SDK InMemoryTransport over real REST. No live entitlement claim.'};
 await writeFile(join(root,'connection.json'),JSON.stringify(connection,null,2));
 console.log('READY '+JSON.stringify(connection));
 const until=Date.now()+600_000;while(Date.now()<until){try{await access(join(root,'release.txt'));break}catch{}await new Promise(r=>setTimeout(r,250))}
} catch(e){failure={name:e.name,message:e.message,stack:e.stack};await writeFile(join(root,'failure.json'),JSON.stringify(failure,null,2));console.error(JSON.stringify(failure));process.exitCode=1}
finally{
 await save();await client?.close().catch(()=>{});await mcp?.close().catch(()=>{});await app?.close();await container?.dispose();provider.closeAllConnections();await new Promise(r=>provider.close(r));
 await writeFile(join(root,'cleanup.json'),JSON.stringify({at:new Date().toISOString(),ownServersClosed:true,storeRetained:true,failure},null,2));
}
