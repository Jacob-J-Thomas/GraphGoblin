import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const evidence='C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i4-442-discovery-01';
const repo='G:/ggq/gg-i4-442-plugin-diagnostics/GraphGoblin';
const continuation=process.argv.includes('--continue')?JSON.parse(await readFile(join(evidence,'plugin-cli-matrix-result-01.json'),'utf8')):undefined;
const root=continuation?.root??await mkdtemp('G:/ggq/gg442-plugin-cli-');
const home=join(root,'home'),work=join(root,'work');if(!continuation)await Promise.all([mkdir(home),mkdir(work)]);
const env=Object.fromEntries(Object.entries(process.env).filter(([key,value])=>value!==undefined&&/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP|COMSPEC)$/i.test(key)));
Object.assign(env,{CODEX_HOME:home,HOME:home,USERPROFILE:home,APPDATA:home,LOCALAPPDATA:home});
await writeFile(join(home,'gitconfig'),'');
Object.assign(env,{XDG_CONFIG_HOME:home,GIT_CONFIG_GLOBAL:join(home,'gitconfig'),GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_COUNT:'4',GIT_CONFIG_KEY_0:'protocol.http.allow',GIT_CONFIG_VALUE_0:'never',GIT_CONFIG_KEY_1:'protocol.https.allow',GIT_CONFIG_VALUE_1:'never',GIT_CONFIG_KEY_2:'protocol.ssh.allow',GIT_CONFIG_VALUE_2:'never',GIT_CONFIG_KEY_3:'protocol.file.allow',GIT_CONFIG_VALUE_3:'always'});
const meta=JSON.parse(await readFile(join(evidence,'cli-help-and-schema.json'),'utf8'));
const nativePackage=createRequire(meta.launcher).resolve('@openai/codex-win32-x64/package.json');
const binary=join(dirname(nativePackage),'vendor/x86_64-pc-windows-msvc/bin/codex.exe');
const spawned=[],calls=[],results=[],requests=[];let active;
const originalSpawn=childProcess.spawn;
childProcess.spawn=function(command,args,options){
 const child=originalSpawn.call(this,command,args,options);
 const row={case:active?.name,pid:child.pid,command,args,started:new Date().toISOString(),closed:false};spawned.push(row);
const prefix=join(evidence,`plugin-cli-${active?.name??'setup'}-${child.pid}`);
 for(const [key,stream] of [['stdout',child.stdout],['stderr',child.stderr]])if(stream){const emit=stream.emit;stream.emit=function(event,...eventArgs){if(event==='data'&&eventArgs[0]!==undefined)appendFileSync(prefix+'.'+key,Buffer.isBuffer(eventArgs[0])?eventArgs[0]:String(eventArgs[0]));return emit.call(this,event,...eventArgs);};}
 child.on('close',(code,signal)=>Object.assign(row,{closed:true,code,signal,ended:new Date().toISOString()}));
 child.on('exit',(code,signal)=>Object.assign(row,{exited:true,exitCode:code,exitSignal:signal,exitedAt:new Date().toISOString()}));
 child.on('error',error=>{row.spawnError=error.message;});return child;
};
syncBuiltinESMExports();
const {CodexHarness}=await import(pathToFileURL(join(repo,'packages/adapter-codex/src/harness.ts')).href);
const {runCli}=await import(pathToFileURL(join(repo,'packages/adapter-codex/src/cli.ts')).href);
const sse=(type,body)=>`event: ${type}\ndata: ${JSON.stringify({type,...body})}\n\n`;
const server=http.createServer(async(req,res)=>{
 let bytes='';for await(const part of req)bytes+=part;
 if(req.method!=='POST'||!req.url.endsWith('/responses')){res.writeHead(404).end();return;}
 const body=JSON.parse(bytes);active.requests.push(body);requests.push({case:active.name,body});
    const nth=active.requests.length,responseId=`resp_${active.name}_${nth}`;
 res.writeHead(200,{'content-type':'text/event-stream'});res.write(sse('response.created',{response:{id:responseId}}));
 const item=nth===1?{type:'custom_tool_call',id:'tool_'+active.name,call_id:'call_'+active.name,namespace:'functions',name:'exec',input:'const found=ALL_TOOLS.filter(t=>/^mcp__gg442_/.test(t.name));text({available:found.map(t=>t.name).sort()});for(const t of found)text(await tools[t.name]({}));'}:{type:'message',role:'assistant',id:`msg_${active.name}_${nth}`,content:[{type:'output_text',text:'GG442_CONTROL_OK'}]};
 res.write(sse('response.output_item.done',{item}));res.end(sse('response.completed',{response:{id:responseId,usage:{input_tokens:1,input_tokens_details:{cached_tokens:0},output_tokens:1,output_tokens_details:{reasoning_tokens:0},total_tokens:2}}}));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;assert(![4747,4748].includes(port));
async function fixtureCommand(command,args,cwd=work){const result=await new Promise((resolve,reject)=>{let stdout='',stderr='';const child=childProcess.spawn(command,args,{env,cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});const timer=setTimeout(()=>child.kill(),20000);child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);child.on('error',reject);child.on('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr});});});calls.push({setup:true,command,args,cwd,...result});assert.equal(result.code,0,result.stderr);return result;}
const pluginIds=[];
if(!continuation){
await writeFile(join(root,'mcp.mjs'),`import{appendFileSync}from'node:fs';import readline from'node:readline';const[log]=process.argv.slice(2);const record=event=>appendFileSync(log,JSON.stringify({pid:process.pid,event})+'\\n');record('started');process.on('exit',()=>record('exit'));for await(const line of readline.createInterface({input:process.stdin})){const r=JSON.parse(line);if(r.id===undefined)continue;let result={};if(r.method==='initialize')result={protocolVersion:r.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'gg442-cli',version:'1.0.0'}};if(r.method==='tools/list'){record('tools/list');result={tools:[{name:'echo_fixture',description:'Harmless constant marker',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}}]};}if(r.method==='tools/call'){record('tools/call');result={content:[{type:'text',text:'GG442_PLUGIN_OK'}]};}process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result})+'\\n');}`);
for(const provenance of ['local','git']){
 const market=join(root,'market-'+provenance);await mkdir(join(market,'.agents/plugins'),{recursive:true});const plugins=[];
 for(const variant of ['healthy','broken']){
  const plugin=join(market,'plugins',variant);await mkdir(join(plugin,'.codex-plugin'),{recursive:true});
  await writeFile(join(plugin,'.codex-plugin/plugin.json'),JSON.stringify({name:variant,version:'1.0.0',description:'Harmless CLI-only #442 fixture',author:{name:'GraphGoblin QA'},mcpServers:variant==='broken'?'./missing.json':'./.mcp.json'}));
  await writeFile(join(plugin,'.mcp.json'),JSON.stringify({mcpServers:{['gg442_'+provenance+'_'+variant]:{command:process.execPath,args:[join(root,'mcp.mjs'),join(root,'mcp.jsonl')],startup_timeout_sec:5}}}));
  let source={source:'local',path:'./plugins/'+variant};
  if(provenance==='git'){for(const args of [['init','--initial-branch=main'],['add','.'],['-c','user.name=GraphGoblin QA','-c','user.email=qa@example.invalid','commit','-m','Disposable fixture']])await fixtureCommand('git',args,plugin);source={source:'url',url:pathToFileURL(plugin).href};}
  plugins.push({name:variant,source,policy:{installation:'AVAILABLE',authentication:'ON_INSTALL'}});pluginIds.push(`${variant}@gg442-${provenance}`);
 }
 await writeFile(join(market,'.agents/plugins/marketplace.json'),JSON.stringify({name:'gg442-'+provenance,plugins}));
 await fixtureCommand(binary,['plugin','marketplace','add',market,'--json']);
 for(const variant of ['healthy','broken'])await fixtureCommand(binary,['plugin','add',`${variant}@gg442-${provenance}`,'--json']);
}
}
const priorConfig=await readFile(join(home,'config.toml'),'utf8');
const installedConfig=continuation?priorConfig.slice(priorConfig.indexOf('\n')+1,priorConfig.indexOf('\n[model_providers.gg442control]')):priorConfig;
async function configure(scenario){
 let config=installedConfig.replaceAll('enabled = true','enabled = false');
 if(!scenario.disabled){const id=(scenario.variant==='missing-asset'?'broken':'healthy')+'@gg442-'+scenario.provenance;const header=`[plugins."${id}"]`;const index=config.indexOf(header);assert(index>=0,'Public installed config has the fixture table');const before=config.slice(0,index),after=config.slice(index);config=before+after.replace('enabled = false','enabled = true');}
 config='model_provider="gg442control"\n'+config+`\n[model_providers.gg442control]\nname="Controlled loopback Responses"\nbase_url="http://127.0.0.1:${port}/v1"\nwire_api="responses"\nrequest_max_retries=0\nstream_max_retries=0\n[analytics]\nenabled=false\n[feedback]\nenabled=false\n[projects.${JSON.stringify(work)}]\ntrust_level="trusted"\n`+(scenario.feature===undefined?'':`\n[features]\nplugins=${scenario.feature}\n`)+(scenario.variant==='unknown-id'?`\n[plugins."missing@gg442-${scenario.provenance}"]\nenabled=true\n`:'');
 await writeFile(join(home,'config.toml'),config);
}
async function processSnapshotAndCleanup(caseName){
 const escaped=root.replaceAll('/','\\').replaceAll("'","''");
 const script=`$fixture='${escaped}';$owned=@(Get-CimInstance Win32_Process | Where-Object {$_.CommandLine -and $_.CommandLine.Replace('/','\\').Contains($fixture) -and $_.Name -notin @('powershell.exe','pwsh.exe')});ConvertTo-Json -InputObject @($owned | Select-Object ProcessId,ParentProcessId,Name,CommandLine) -Depth 2 -Compress;foreach($row in $owned){$current=Get-CimInstance Win32_Process -Filter "ProcessId = $($row.ProcessId)";if($current -and $current.CreationDate -eq $row.CreationDate -and $current.CommandLine.Replace('/','\\').Contains($fixture)){Stop-Process -Id $current.ProcessId -Force}}`;
 const outcome=await new Promise((resolve,reject)=>{let stdout='',stderr='';const child=originalSpawn('powershell',['-NoProfile','-Command',script],{windowsHide:true,stdio:['ignore','pipe','pipe']});child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}));});
 await writeFile(join(evidence,'plugin-cli-'+caseName+'-owned-process-check.json'),JSON.stringify(outcome,null,2)+'\n');return outcome;
}
try{
 let localFreshId=continuation?.results.find(r=>r.name==='local-healthy')?.id;
 const scenarios=[];for(const provenance of ['local','git']){for(const variant of ['healthy','missing-asset','unknown-id'])scenarios.push({name:provenance+'-'+variant,provenance,variant});scenarios.push({name:provenance+'-disabled',provenance,variant:'healthy',disabled:true},{name:provenance+'-node-off',provenance,variant:'healthy',overrides:{features:{plugins:false}}});}
 scenarios.push({name:'local-global-off',provenance:'local',variant:'healthy',feature:false},{name:'local-node-on',provenance:'local',variant:'healthy',feature:false,overrides:{features:{plugins:true}}},{name:'local-resumed',provenance:'local',variant:'healthy',resume:true});
 for(const scenario of scenarios.filter(s=>!continuation||s.name!=='local-healthy')){
  await configure(scenario);
  active={...scenario,requests:[]};const started=Date.now(),before=spawned.length;
  const harness=new CodexHarness({env,cliRunner:async(...args)=>{const result=await runCli(...args);calls.push({case:active.name,args:args[1],...result});return result;}});
  const request={workingDirectory:work,model:'gpt-6-luna',effort:'low',options:{sandbox:'read-only',approval:'never',configOverrides:scenario.overrides??{}},turn:{prompt:'Controlled local fixture. Reply GG442_CONTROL_OK.'}};
  const session=scenario.resume?harness.resume(localFreshId,request,AbortSignal.timeout(30000)):harness.start(request,AbortSignal.timeout(30000));
  const events=[];const consume=(async()=>{for await(const event of session.events)events.push(event);})();
  const idTask=session.sessionId.then(id=>id,()=>undefined);let value,error;
  try{value=await session.result;}catch(caught){error={code:caught.code,name:caught.name,message:caught.message,submission:caught.submission};}
  await consume;const id=await idTask;
  if(scenario.name==='local-healthy')localFreshId=id;
  const outputs=active.requests.at(-1)?.input?.filter(i=>i.type==='custom_tool_call_output'&&i.call_id==='call_'+scenario.name).flatMap(i=>i.output.map(o=>o.text))??[];
  const available=outputs.map(text=>{try{return JSON.parse(text).available;}catch{return undefined;}}).find(Array.isArray);
  const expected=scenario.variant==='missing-asset'||scenario.disabled||scenario.overrides?.features?.plugins===false||(scenario.feature===false&&scenario.overrides?.features?.plugins!==true)?[]:[`mcp__gg442_${scenario.provenance}_healthy__echo_fixture`];
  const terminalSpawnSnapshot=structuredClone(spawned.slice(before));
  const cleanup=await processSnapshotAndCleanup(scenario.name);
  const row={name:scenario.name,provenance:scenario.provenance==='git'?'Git-sourced/local-file-transport':'local-path-source',scenario,id,value,error,events,outputs,available,expected,elapsedMs:Date.now()-started,modelRequests:active.requests.length,terminalSpawnSnapshot,cleanup};results.push(row);
  await writeFile(join(evidence,'plugin-cli-'+scenario.name+'.json'),JSON.stringify(row,null,2)+'\n');
  console.log(JSON.stringify({name:row.name,value:row.value?.finalText,error:row.error,available,expected,modelRequests:row.modelRequests,elapsedMs:row.elapsedMs,nativeExit:row.terminalSpawnSnapshot.map(s=>({pid:s.pid,exited:s.exited,code:s.exitCode})),ownedProcesses:cleanup.stdout.trim()}));
  assert.equal(error,undefined,'Stop matrix after first unhealthy completion');assert.equal(value?.finalText,'GG442_CONTROL_OK');assert.deepEqual(available,expected);if(expected.length)assert(outputs.some(text=>text.includes('GG442_PLUGIN_OK')));assert(terminalSpawnSnapshot.every(s=>s.exited&&s.exitCode===0));assert.equal(cleanup.stdout.trim(),'[]');
 }
}finally{
 server.closeAllConnections();await new Promise(resolve=>server.close(resolve));childProcess.spawn=originalSpawn;syncBuiltinESMExports();
 await writeFile(join(evidence,continuation?'plugin-cli-matrix-continuation-result.json':'plugin-cli-matrix-result.json'),JSON.stringify({root,repo,base:'02351e2fb932b3be44e7cc3fb3943a61d568226c',node:process.version,port,continuationOf:continuation?'plugin-cli-matrix-result-01.json':undefined,results,spawned,calls,requests,appServerCalls:0,paidProviderCalls:0},null,2)+'\n');
}
