import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const evidence='C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i4-442-discovery-01';
const repo='G:/ggq/gg-i4-442-plugin-diagnostics/GraphGoblin';
const root=await mkdtemp('G:/ggq/gg442-controls-');
const home=join(root,'home'),work=join(root,'work');await Promise.all([mkdir(home),mkdir(work)]);
const env=Object.fromEntries(Object.entries(process.env).filter(([key,value])=>value!==undefined&&/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP|COMSPEC)$/i.test(key)));
Object.assign(env,{CODEX_HOME:home,HOME:home,USERPROFILE:home,APPDATA:home,LOCALAPPDATA:home});
const spawned=[],calls=[],results=[],requests=[];let active;
const originalSpawn=childProcess.spawn;
childProcess.spawn=function(command,args,options){
 const child=originalSpawn.call(this,command,args,options);
 const row={case:active?.name,pid:child.pid,command,args,started:new Date().toISOString(),closed:false};spawned.push(row);
 const prefix=join(evidence,`control-${active?.name??'setup'}-${child.pid}`);
 for(const [key,stream] of [['stdout',child.stdout],['stderr',child.stderr]])if(stream){const emit=stream.emit;stream.emit=function(event,...eventArgs){if(event==='data'&&eventArgs[0]!==undefined)appendFileSync(prefix+'.'+key,Buffer.isBuffer(eventArgs[0])?eventArgs[0]:String(eventArgs[0]));return emit.call(this,event,...eventArgs);};}
 child.on('close',(code,signal)=>Object.assign(row,{closed:true,code,signal,ended:new Date().toISOString()}));
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
 const item=active.tool&&nth===1?{type:'custom_tool_call',id:'tool_'+active.name,call_id:'call_'+active.name,namespace:'functions',name:'exec',input:'text({ marker: "GG442_TOOL_CONTROL", pluginTools: ALL_TOOLS.filter(t => /mcp__gg442/.test(t.name)).map(t => t.name) });'}:{type:'message',role:'assistant',id:`msg_${active.name}_${nth}`,content:[{type:'output_text',text:'GG442_CONTROL_OK'}]};
 res.write(sse('response.output_item.done',{item}));res.end(sse('response.completed',{response:{id:responseId,usage:{input_tokens:1,input_tokens_details:{cached_tokens:0},output_tokens:1,output_tokens_details:{reasoning_tokens:0},total_tokens:2}}}));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;assert(![4747,4748].includes(port));
await writeFile(join(home,'config.toml'),`model_provider="gg442control"\n[model_providers.gg442control]\nname="Controlled loopback Responses"\nbase_url="http://127.0.0.1:${port}/v1"\nwire_api="responses"\nrequest_max_retries=0\nstream_max_retries=0\n[features]\nplugins=false\n[analytics]\nenabled=false\n[feedback]\nenabled=false\n[projects.${JSON.stringify(work)}]\ntrust_level="trusted"\n`);
const harness=new CodexHarness({env,cliRunner:async(...args)=>{const result=await runCli(...args);calls.push({case:active.name,args:args[1],...result});return result;}});
async function processSnapshotAndCleanup(caseName){
 const escaped=root.replaceAll('/','\\').replaceAll("'","''");
 const script=`$fixture='${escaped}';$owned=@(Get-CimInstance Win32_Process | Where-Object {$_.CommandLine -and $_.CommandLine.Replace('/','\\').Contains($fixture) -and $_.Name -notin @('powershell.exe','pwsh.exe')});ConvertTo-Json -InputObject @($owned | Select-Object ProcessId,ParentProcessId,Name,CommandLine) -Depth 2 -Compress;foreach($row in $owned){$current=Get-CimInstance Win32_Process -Filter "ProcessId = $($row.ProcessId)";if($current -and $current.CreationDate -eq $row.CreationDate -and $current.CommandLine.Replace('/','\\').Contains($fixture)){Stop-Process -Id $current.ProcessId -Force}}`;
 const outcome=await new Promise((resolve,reject)=>{let stdout='',stderr='';const child=originalSpawn('powershell',['-NoProfile','-Command',script],{windowsHide:true,stdio:['ignore','pipe','pipe']});child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}));});
 await writeFile(join(evidence,caseName+'-owned-process-check.json'),JSON.stringify(outcome,null,2)+'\n');return outcome;
}
try{
 for(const scenario of [{name:'plugins-off-plain',tool:false},{name:'plugins-off-two-round',tool:true}]){
  active={...scenario,requests:[]};const started=Date.now(),before=spawned.length;
  const session=harness.start({workingDirectory:work,model:'gpt-6-luna',effort:'low',options:{sandbox:'read-only',approval:'never',configOverrides:{features:{plugins:false}}},turn:{prompt:'Controlled local fixture. Reply GG442_CONTROL_OK.'}},AbortSignal.timeout(30000));
  const events=[];const consume=(async()=>{for await(const event of session.events)events.push(event);})();
  const idTask=session.sessionId.then(id=>id,()=>undefined);let value,error;
  try{value=await session.result;}catch(caught){error={code:caught.code,name:caught.name,message:caught.message,submission:caught.submission};}
  await consume;const id=await idTask;
  const terminalSpawnSnapshot=structuredClone(spawned.slice(before));
  const cleanup=await processSnapshotAndCleanup(scenario.name);
  const row={name:scenario.name,tool:scenario.tool,id,value,error,events,elapsedMs:Date.now()-started,modelRequests:active.requests.length,terminalSpawnSnapshot,cleanup};results.push(row);
  await writeFile(join(evidence,scenario.name+'-control.json'),JSON.stringify(row,null,2)+'\n');
  console.log(JSON.stringify({name:row.name,value:row.value?.finalText,error:row.error,modelRequests:row.modelRequests,elapsedMs:row.elapsedMs,events:row.events.map(e=>e.type),nativeClosed:row.terminalSpawnSnapshot.map(s=>({pid:s.pid,closed:s.closed,code:s.code}))}));
 }
}finally{
 server.closeAllConnections();await new Promise(resolve=>server.close(resolve));childProcess.spawn=originalSpawn;syncBuiltinESMExports();
 await writeFile(join(evidence,'two-control-result.json'),JSON.stringify({root,repo,base:'02351e2fb932b3be44e7cc3fb3943a61d568226c',node:process.version,port,results,spawned,calls,requests,appServerCalls:0,paidProviderCalls:0},null,2)+'\n');
}
