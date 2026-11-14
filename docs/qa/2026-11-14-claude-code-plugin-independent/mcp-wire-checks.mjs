import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [checkout, expected, baseline, baselineHead] = process.argv.slice(2);
const worktree = await realpath(checkout);
const base = await realpath(baseline);
const git = (root, ...args) => execFileSync('git', args, { cwd:root, encoding:'utf8' }).trim();
assert.equal(git(worktree,'rev-parse','HEAD'),expected);
assert.equal(git(worktree,'status','--porcelain'),'');
assert.equal(git(base,'rev-parse','HEAD'),baselineHead);
const initialBaseStatus=git(base,'status','--porcelain');
const scratch=await mkdtemp(join(dirname(fileURLToPath(import.meta.url)),'mcp protocol 漢 '));
const sdk=join(worktree,'apps/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client');
const { Client }=await import(pathToFileURL(join(sdk,'index.js')));
const { StdioClientTransport }=await import(pathToFileURL(join(sdk,'stdio.js')));
const { StreamableHTTPClientTransport }=await import(pathToFileURL(join(sdk,'streamableHttp.js')));
const clients=[];
const gateways=[];
const result={head:expected,base:baselineHead,versions:{node:process.version},instruments:[],scenarios:[]};
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^GG_|^JEV_API_KEY$|^NODE_OPTIONS$|^ANTHROPIC_/i.test(k)));
const withEnv={...env,GG_API_URL:'http://127.0.0.1:1'};
const mcp=(root)=>join(root,'apps/mcp/dist/main.js');
const toolNames=(items)=>items.map(({name})=>name).sort();
const draftOnly=['create_loop_draft','get_loop_draft','save_loop_draft','validate_loop_definition'];
const clear=()=>new Promise(resolve=>setTimeout(resolve,20));
async function attach(transport,purpose){
 const c=new Client({name:'independent tool protocol probe',version:'1.0.0'});
 clients.push(c);
 const record={purpose};
 result.instruments.push(record);
 const stderr=[];
 transport.stderr?.setEncoding('utf8').on('data',x=>stderr.push(x));
 await c.connect(transport);
 if(transport.pid)record.pid=transport.pid;
 record.inventory=toolNames((await c.listTools()).tools);
 record.stderr=stderr;
 return c;
}
async function nativeStdio(root,flags,purpose,configuration=withEnv){
 return attach(new StdioClientTransport({command:process.execPath,args:[mcp(root),...flags],env:configuration,cwd:scratch,stderr:'pipe'}),purpose);
}
function start(entry,args,environment=withEnv){
 const child=spawn(process.execPath,[entry,...args],{env:environment,cwd:scratch,windowsHide:true,stdio:['ignore','pipe','pipe']});
 const record={pid:child.pid,out:'',err:''};
 child.stdout.on('data',b=>record.out+=b);child.stderr.on('data',b=>record.err+=b);
 const ended=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',(code,signal)=>{record.exit={code,signal};resolve(record.exit);});});
 return {child,record,ended};
}
const keys=[];
const beforeEntries=[];
try{
 const oldClient=await nativeStdio(base,[],'baseline default stdio');
 const old=(await oldClient.listTools()).tools;
 const baseClient=await nativeStdio(worktree,[],'candidate default stdio');
 const standard=(await baseClient.listTools()).tools;
 assert.deepEqual(standard,old);
 const elevated=await nativeStdio(worktree,['--draft-tools'],'candidate opt-in stdio');
 const opted=(await elevated.listTools()).tools;
 assert.deepEqual(toolNames(opted),[...toolNames(old),...draftOnly].sort());
 assert(!opted.some(t=>t.name.includes('publish')));
 assert.equal(opted.find(t=>t.name==='get_loop_draft').annotations.readOnlyHint,true);
 assert.equal(opted.find(t=>t.name==='validate_loop_definition').annotations.readOnlyHint,true);
 assert.equal(opted.find(t=>t.name==='save_loop_draft').annotations.destructiveHint,true);
 result.scenarios.push({case:'same default inventory and exactly four draft additions',defaultCount:old.length,optInCount:opted.length});

 const denied=start(mcp(worktree),['--http','--draft-tools','--port','0']);
 assert.deepEqual(await denied.ended,{code:2,signal:null});
 assert.match(denied.record.err,/supported only on stdio/);
 result.scenarios.push({case:'combined HTTP/draft-tool mode refused before listen',pid:denied.record.pid,exit:denied.record.exit,diagnostic:denied.record.err.split('\n')[0]});

 const nativeHttp=start(mcp(worktree),['--http','--host','127.0.0.1','--port','0']);gateways.push(nativeHttp);
 let endpoint;
 for(let i=0;i<300;i++){
  endpoint=nativeHttp.record.err.match(/Streamable HTTP on (http:\/\/127\.0\.0\.1:\d+\/mcp)/)?.[1];
  if(endpoint||nativeHttp.record.exit)break;
  await clear();
 }
 assert(endpoint&&!/:474[78]\/mcp$/.test(endpoint),nativeHttp.record.err);
 const http=await attach(new StreamableHTTPClientTransport(new URL(endpoint)),'candidate default HTTP');
 assert.deepEqual((await http.listTools()).tools,old);
 result.scenarios.push({case:'actual default HTTP tool contract equivalent to baseline stdio',endpoint,pid:nativeHttp.record.pid,tools:old.length});

 // Gateway used in a separate stdio wire check for structuredContent, alongside the native
 // Claude harness's model-layer text rendering. Its public main entry owns SQLite and transport.
 for(const k of Object.keys(process.env))if(/^GG_|^JEV_API_KEY$|^NODE_OPTIONS$/i.test(k))delete process.env[k];
 Object.assign(process.env,{ GG_HOST:'127.0.0.1', GG_PORT:'0', GG_DATA_DIR:join(scratch,'store'),
   GG_REQUIRE_API_KEY:'true',GG_OLLAMA_ENABLED:'false',GG_LOG_LEVEL:'silent',GG_WEB_DIST:'',GG_GOBLIN_DIST:'' });
 const {main}=await import(pathToFileURL(join(worktree,'apps/api/dist/main.js')).href);
 const gateway=await main();
 const origin='http://127.0.0.1:'+gateway.app.server.address().port;
 assert(!/:474[78]$/.test(origin));
 result.apiOrigin=origin;
 try{
  const token=(await gateway.container.repos.apiKeys.create('local','QA typed result',['loops:write','runs:read'])).token;
  keys.push(token);
  const c=await nativeStdio(worktree,['--draft-tools'],'opt-in actual gateway wire',{...env,GG_API_URL:origin,GG_API_KEY:token});
  const definition={schemaVersion:4,name:'Typed wire loop 漢',nodes:[{id:'start',kind:'trigger',label:'Start',config:{type:'manual'}},{id:'exit',kind:'exit',label:'Exit',config:{}}],edges:[{id:'e1',from:{node:'start',port:'out'},to:{node:'exit'}}]};
  const created=await c.callTool({name:'create_loop_draft',arguments:{definition}});
  assert(!created.isError);
  assert.equal(created.structuredContent.draft.status,'draft');
  assert.deepEqual(JSON.parse(created.content[0].text),created.structuredContent);
  const id=created.structuredContent.loop.id;
  const detail=await c.callTool({name:'get_loop_draft',arguments:{loopId:id}});
  assert.match(detail.structuredContent.draftToken,/^[0-9a-f]{16}$/);
  assert.deepEqual(JSON.parse(detail.content[0].text),detail.structuredContent);
  const invalid=await c.callTool({name:'validate_loop_definition',arguments:{loopId:id,definition:{...definition,edges:[]}}});
  assert.equal(invalid.structuredContent.publishable,false);
  assert(invalid.structuredContent.issues.some(i=>i.code==='PORT_UNCONNECTED'));
  assert.deepEqual(JSON.parse(invalid.content[0].text),invalid.structuredContent);
  const wildcard=await c.callTool({name:'save_loop_draft',arguments:{loopId:id,definition,draftToken:'*'}});
  assert.equal(wildcard.isError,true);
  assert(!wildcard.structuredContent);
  assert.match(wildcard.content[0].text,/draftToken/);
  const snapshot=await (await fetch(origin+'/loops/'+id,{headers:{authorization:'Bearer '+token}})).json();
  assert.equal(snapshot.draft.definition.name,definition.name);
  assert.equal(snapshot.current,undefined);
  const runs=await (await fetch(origin+'/runs?loopId='+id,{headers:{authorization:'Bearer '+token}})).json();
  assert.deepEqual(runs.items,[]);
  result.scenarios.push({case:'native typed tool results, validator issues and invalid-token refusal',loop:id,validationCodes:invalid.structuredContent.issues.map(i=>i.code),published:false,runs:0});
 } finally { await gateway.app.close(); }
} catch(error) {
 result.failure=String(error); result.failureStack=error.stack;
 process.exitCode=1;
} finally {
 await Promise.allSettled(clients.map(c=>c.close()));
 for(const proc of gateways){
  if(!proc.record.exit)proc.child.kill();
  const exit=await proc.ended;
  result.instruments.push({purpose:'closed owned HTTP MCP',pid:proc.record.pid,exit});
 }
 assert.equal(git(worktree,'rev-parse','HEAD'),expected);
 assert.equal(git(worktree,'status','--porcelain'),'');
 assert.equal(git(base,'status','--porcelain'),initialBaseStatus);
 assert.equal(git(base,'rev-parse','HEAD'),baselineHead);
 const text=JSON.stringify(result,null,2)+'\n';
 for(const key of keys)assert(!text.includes(key));
 await writeFile(join(scratch,'observed-mcp.json'),text);
 console.log(join(scratch,'observed-mcp.json'));
}
