import assert from 'node:assert/strict';
import cp from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const q=dirname(fileURLToPath(import.meta.url));
const repo='G:/ggq/gg-i4-442-qa/GraphGoblin';
const root='G:/ggq/gg442-independent-repair-01';
const home=join(root,'home'),work=join(root,'work'),temp=join(root,'temp');
const plugin=join(root,'plugin-source'),market=join(root,'marketplace');
for(const p of [home,work,temp,join(plugin,'.codex-plugin'),join(market,'.agents/plugins')])await mkdir(p,{recursive:true});
const env=Object.fromEntries(Object.entries(process.env).filter(([k,v])=>v!==undefined&&/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC)$/i.test(k)));
await writeFile(join(root,'gitconfig'),'');
Object.assign(env,{CODEX_HOME:home,HOME:home,USERPROFILE:home,APPDATA:home,LOCALAPPDATA:home,XDG_CONFIG_HOME:home,TEMP:temp,TMP:temp,GIT_CONFIG_GLOBAL:join(root,'gitconfig'),GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_COUNT:'4',GIT_CONFIG_KEY_0:'protocol.http.allow',GIT_CONFIG_VALUE_0:'never',GIT_CONFIG_KEY_1:'protocol.https.allow',GIT_CONFIG_VALUE_1:'never',GIT_CONFIG_KEY_2:'protocol.ssh.allow',GIT_CONFIG_VALUE_2:'never',GIT_CONFIG_KEY_3:'protocol.file.allow',GIT_CONFIG_VALUE_3:'always'});
const sdkDir=await realpath(join(repo,'packages/adapter-codex/node_modules/@openai/codex-sdk'));
const launcher=createRequire(join(sdkDir,'package.json')).resolve('@openai/codex/bin/codex.js');
const nativePackage=createRequire(launcher).resolve('@openai/codex-win32-x64/package.json');
const binary=join(dirname(nativePackage),'vendor/x86_64-pc-windows-msvc/bin/codex.exe');
const nativeHash=createHash('sha256').update(await readFile(binary)).digest('hex');
let stage='setup',active,server,firstSession;
const children=[],commands=[],requests=[],turns=[],ownership=[],failures=[];
const originalSpawn=cp.spawn;
cp.spawn=function(command,args,options){
  const child=originalSpawn.call(this,command,args,options);
  const row={stage,command,args,pid:child.pid,cwd:options?.cwd,started:new Date().toISOString(),native:command===binary};children.push(row);
  for(const [label,stream]of [['stdout',child.stdout],['stderr',child.stderr]])if(stream){
    const emit=stream.emit;stream.emit=function(event,...items){if(event==='data')appendFileSync(join(q,`repair-${stage}-${child.pid}.${label}`),items[0]);return emit.call(this,event,...items);};
  }
  child.on('exit',(code,signal)=>Object.assign(row,{exitCode:code,signal,exited:new Date().toISOString()}));
  child.on('close',(code,signal)=>Object.assign(row,{closed:true,closeCode:code,closeSignal:signal}));
  child.on('error',error=>{row.error=error.message;});return child;
};
syncBuiltinESMExports();
async function command(label,exe,args,cwd=work){
  const child=cp.spawn(exe,args,{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
  const timer=setTimeout(()=>child.kill(),20000);
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});clearTimeout(timer);
  const result={label,exe,args,cwd,code,stdout,stderr};commands.push(result);
  await save();assert.equal(code,0,`${label}: ${stderr}`);return result;
}
async function census(label){
  const script=`$taskRoot='${root.replaceAll("'","''")}'; $found=@(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne ${process.pid} -and $_.Name -notin @('powershell.exe','pwsh.exe') -and $_.CommandLine -and $_.CommandLine.Replace([char]92,[char]47).IndexOf($taskRoot,[StringComparison]::OrdinalIgnoreCase) -ge 0 } | Select-Object ProcessId,ParentProcessId,Name,CommandLine,CreationDate); ConvertTo-Json -InputObject $found -Depth 3 -Compress`;
  const child=originalSpawn('powershell.exe',['-NoProfile','-Command',script],{windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
  const code=await new Promise(resolve=>child.once('close',resolve));
  const row={label,code,stdout,stderr};ownership.push(row);await save();assert.equal(code,0);assert.deepEqual(JSON.parse(stdout.replace(/^\uFEFF/,'')),[],'Owned processes remain; stop control');return row;
}
async function save(){await writeFile(join(q,'repair-results.json'),JSON.stringify({source:'5b0d806c75d409c33a57ea54ffda45e2f89bc500',repo,root,node:process.version,sdkDir,launcher,binary,nativeHash,stage,budget:{turns:2,maxLoopbackRequests:4,turnTimeoutMs:30000,terminationAcknowledgementMs:5000,retries:0},commands,children,requests,turns,ownership,failures,appServerCommands:0,providerAccountUsed:false},null,2)+'\n');}
const event=(type,value)=>`event: ${type}\ndata: ${JSON.stringify({type,...value})}\n\n`;
try{
  await writeFile(join(plugin,'.codex-plugin/plugin.json'),JSON.stringify({name:'repair',version:'1.0.0',description:'Disposable independent missing-asset repair observation',author:{name:'Independent QA'},mcpServers:'./repair-mcp.json'}));
  await writeFile(join(market,'.agents/plugins/marketplace.json'),JSON.stringify({name:'gg442-independent',plugins:[{name:'repair',source:{source:'url',url:pathToFileURL(plugin).href},policy:{installation:'AVAILABLE',authentication:'ON_INSTALL'}}]}));
  for(const args of [['init','--initial-branch=main'],['add','.'],['-c','user.name=Independent QA','-c','user.email=qa@example.invalid','commit','-m','Missing asset fixture']])await command('fixture Git '+args[0],'git',args,plugin);
  const originalHead=await command('fixture source initial head','git',['rev-parse','HEAD'],plugin);
  await command('register local marketplace',binary,['plugin','marketplace','add',market,'--json']);
  await command('install missing asset Git fixture',binary,['plugin','add','repair@gg442-independent','--json']);
  server=http.createServer(async(req,res)=>{
    let bytes='';for await(const part of req)bytes+=part;
    if(!active||req.url!=='/v1/responses'||requests.length>=4){failures.push({kind:'unexpected-request',url:req.url,stage});res.writeHead(409).end();return;}
    const body=JSON.parse(bytes);active.requestBodies.push(body);requests.push({stage,url:req.url,remoteAddress:req.socket.remoteAddress,body});
    const nth=active.requestBodies.length;if(nth>2){failures.push({kind:'turn-request-budget',stage});res.writeHead(409).end();return;}
    const responseId=`qa442_${stage}_${nth}`;
    const item=nth===1?{type:'custom_tool_call',id:`item_${stage}`,call_id:`call_${stage}`,namespace:'functions',name:'exec',input:'const selected=ALL_TOOLS.filter(t=>t.name.startsWith("mcp__gg442repair__"));text({qa442Available:selected.map(t=>t.name)});for(const tool of selected)text(await tools[tool.name]({}));'}:{type:'message',role:'assistant',id:`msg_${stage}`,content:[{type:'output_text',text:'GG442_REPAIR_OBSERVED'}]};
    res.writeHead(200,{'content-type':'text/event-stream'});
    res.write(event('response.created',{response:{id:responseId}}));res.write(event('response.output_item.done',{item}));res.end(event('response.completed',{response:{id:responseId,usage:{input_tokens:1,input_tokens_details:{cached_tokens:0},output_tokens:1,output_tokens_details:{reasoning_tokens:0},total_tokens:2}}}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;assert(![4747,4748,11434].includes(port));
  const installedConfig=await readFile(join(home,'config.toml'),'utf8');
  await writeFile(join(home,'config.toml'),'model_provider="gg442independent"\n'+installedConfig+`\n[model_providers.gg442independent]\nname="Independent synthetic loopback fixture"\nbase_url="http://127.0.0.1:${port}/v1"\nwire_api="responses"\nrequest_max_retries=0\nstream_max_retries=0\n[analytics]\nenabled=false\n[feedback]\nenabled=false\n[projects.${JSON.stringify(work)}]\ntrust_level="trusted"\n`);
  const {CodexHarness}=await import(pathToFileURL(join(repo,'packages/adapter-codex/dist/index.js')).href);
  async function turn(label,resume){
    stage=label;active={requestBodies:[]};const childStart=children.length;
    const harness=new CodexHarness({env,codexBinary:binary,cancelGraceMs:5000});
    const request={workingDirectory:work,model:'gpt-6-luna',effort:'low',options:{sandbox:'read-only',approval:'never'},turn:{prompt:'Independent controlled local diagnostic. Observe tools and reply GG442_REPAIR_OBSERVED.'}};
    const session=resume?harness.resume(firstSession,request,AbortSignal.timeout(30000)):harness.start(request,AbortSignal.timeout(30000));
    const events=[];const consume=(async()=>{for await(const e of session.events)events.push(e);})();
    const idPromise=session.sessionId.catch(()=>undefined);let value,error;
    try{value=await session.result;}catch(e){error={message:e.message,code:e.code,name:e.name,submission:e.submission};}
    await consume;const id=await idPromise;if(!resume)firstSession=id;
    const input=active.requestBodies.at(-1)?.input??[];
    const output=input.filter(i=>i.type==='custom_tool_call_output'&&i.call_id===`call_${stage}`).flatMap(i=>Array.isArray(i.output)?i.output.map(o=>o.text):[i.output]);
    const available=output.map(text=>{try{return JSON.parse(text).qa442Available;}catch{return undefined;}}).find(Array.isArray);
    const nativeSnapshot=structuredClone(children.slice(childStart).filter(c=>c.native));
    const row={stage,id,resumedFrom:resume?firstSession:undefined,value,error,events,available,output,modelRequests:active.requestBodies.length,nativeSnapshot};turns.push(row);await save();
    assert.equal(error,undefined,'Stop on unsuccessful or unconfirmed turn');assert.equal(value.finalText,'GG442_REPAIR_OBSERVED');assert.equal(active.requestBodies.length,2);assert(Array.isArray(available),'Actual worker tool observation missing');
    assert(nativeSnapshot.length===2,'One native inventory command and one worker expected');
    assert(nativeSnapshot.every(c=>c.exitCode===0&&c.signal===null&&c.exited),'Native exit0 must be observed before result');
    await census(stage+' after completion');
    if(!resume)assert.deepEqual(available,[]);else{assert.equal(id,firstSession);assert(available.length===0||JSON.stringify(available)===JSON.stringify(['mcp__gg442repair__echo_repaired']));if(available.length)assert(output.some(t=>String(t).includes('GG442_REPAIRED_TOOL_OK')));}
    console.log(JSON.stringify({stage,id,available,modelRequests:row.modelRequests,nativeExits:nativeSnapshot.map(c=>({pid:c.pid,code:c.exitCode,signal:c.signal})),finalText:value.finalText}));return row;
  }
  await turn('missing-before-repair',false);
  stage='supported-repair';
  const toolScript=join(root,'harmless-mcp.mjs');
  await writeFile(toolScript,`import {appendFileSync} from 'node:fs';import readline from 'node:readline';const log=${JSON.stringify(join(root,'mcp-events.jsonl'))};const record=x=>appendFileSync(log,JSON.stringify({pid:process.pid,event:x})+'\\n');record('start');process.on('exit',()=>record('exit'));for await(const line of readline.createInterface({input:process.stdin})){const r=JSON.parse(line);if(r.id===undefined)continue;let result={};if(r.method==='initialize')result={protocolVersion:r.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'qa442-independent',version:'1.0.0'}};if(r.method==='tools/list'){record('tools/list');result={tools:[{name:'echo_repaired',description:'Return a harmless constant diagnostic marker',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}}]};}if(r.method==='tools/call'){record('tools/call');result={content:[{type:'text',text:'GG442_REPAIRED_TOOL_OK'}]};}process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result})+'\\n');}`);
  await writeFile(join(plugin,'repair-mcp.json'),JSON.stringify({mcpServers:{gg442repair:{command:process.execPath,args:[toolScript],startup_timeout_sec:5}}}));
  await command('fixture Git add repair','git',['add','repair-mcp.json'],plugin);
  await command('fixture Git commit repair','git',['-c','user.name=Independent QA','-c','user.email=qa@example.invalid','commit','-m','Add missing fixture MCP asset'],plugin);
  await command('fixture repaired head','git',['rev-parse','HEAD'],plugin);
  await command('supported local uninstall',binary,['plugin','remove','repair@gg442-independent','--json']);
  await command('supported local reinstall',binary,['plugin','add','repair@gg442-independent','--json']);
  await turn('same-session-after-repair',true);
  assert.equal(requests.length,4);assert.equal(turns.length,2);assert.equal(failures.length,0);
  console.log(JSON.stringify({turns:2,loopbackRequests:4,repairOutcome:turns[1].available.length?'repaired tool reloaded and called':'same-session tool availability retained absent',originalGitHead:originalHead.stdout.trim()}));
}catch(error){failures.push({kind:'harness',stage,message:error.message,stack:error.stack});console.error(error.stack);process.exitCode=1;}
finally{
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  await save();cp.spawn=originalSpawn;syncBuiltinESMExports();
  // No blind kill: a failure keeps the exact owned PID/argv packet for coordinator containment.
}
