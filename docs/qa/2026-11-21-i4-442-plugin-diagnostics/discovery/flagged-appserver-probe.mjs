import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import readline from 'node:readline';

const evidence='C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i4-442-discovery-01';
const meta=JSON.parse(await readFile(join(evidence,'cli-help-and-schema.json'),'utf8'));
const nativePackage=createRequire(meta.launcher).resolve('@openai/codex-win32-x64/package.json');
const binary=join(dirname(nativePackage),'vendor/x86_64-pc-windows-msvc/bin/codex.exe');
const root=await mkdtemp('G:/ggq/gg442-flagged-');
const home=join(root,'home'), work=join(root,'work'), market=join(root,'market'), plugin=join(market,'plugins/fixture');
await Promise.all([mkdir(home),mkdir(work),mkdir(join(plugin,'.codex-plugin'),{recursive:true}),mkdir(join(market,'.agents/plugins'),{recursive:true})]);
await writeFile(join(home,'gitconfig'),'');
const env=Object.fromEntries(Object.entries(process.env).filter(([key,value])=>value!==undefined&&/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP|COMSPEC)$/i.test(key)));
Object.assign(env,{CODEX_HOME:home,HOME:home,USERPROFILE:home,APPDATA:home,LOCALAPPDATA:home,XDG_CONFIG_HOME:home,GIT_CONFIG_GLOBAL:join(home,'gitconfig'),GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_COUNT:'4',GIT_CONFIG_KEY_0:'protocol.http.allow',GIT_CONFIG_VALUE_0:'never',GIT_CONFIG_KEY_1:'protocol.https.allow',GIT_CONFIG_VALUE_1:'never',GIT_CONFIG_KEY_2:'protocol.ssh.allow',GIT_CONFIG_VALUE_2:'never',GIT_CONFIG_KEY_3:'protocol.file.allow',GIT_CONFIG_VALUE_3:'always'});
await writeFile(join(plugin,'.codex-plugin/plugin.json'),JSON.stringify({name:'fixture',version:'1.0.0',description:'Bounded flagged app-server probe',author:{name:'GraphGoblin QA'},mcpServers:'./.mcp.json'}));
await writeFile(join(root,'mcp.mjs'),`import readline from 'node:readline';for await(const line of readline.createInterface({input:process.stdin})){const r=JSON.parse(line);if(r.id===undefined)continue;let result={};if(r.method==='initialize')result={protocolVersion:r.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'gg442-probe',version:'1.0.0'}};if(r.method==='tools/list')result={tools:[{name:'echo_fixture',description:'Harmless fixture marker',inputSchema:{type:'object',properties:{},additionalProperties:false}}]};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result})+'\\n');}`);
await writeFile(join(plugin,'.mcp.json'),JSON.stringify({mcpServers:{gg442_fixture:{command:process.execPath,args:[join(root,'mcp.mjs')],startup_timeout_sec:5}}}));
await writeFile(join(market,'.agents/plugins/marketplace.json'),JSON.stringify({name:'gg442-flagged',plugins:[{name:'fixture',source:{source:'local',path:'./plugins/fixture'},policy:{installation:'AVAILABLE',authentication:'ON_INSTALL'}}]}));
const commands=[];
async function command(args){const row=await new Promise((resolve,reject)=>{let stdout='',stderr='';const child=spawn(binary,args,{cwd:work,env,windowsHide:true,stdio:['ignore','pipe','pipe']});child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);child.on('error',reject);child.on('close',code=>resolve({args,code,stdout,stderr}));});commands.push(row);assert.equal(row.code,0,row.stderr);return row;}
await command(['plugin','marketplace','add',market,'--json']);
await command(['plugin','add','fixture@gg442-flagged','--json']);
const args=['app-server','--disable','remote_plugin','--stdio'];
const child=spawn(binary,args,{cwd:work,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
const closed=new Promise(resolve=>child.on('close',(code,signal)=>resolve({code,signal})));
const messages=[], pending=new Map(), replies=[];let stderr='',next=1;
child.stderr.on('data',c=>stderr+=c);
readline.createInterface({input:child.stdout}).on('line',line=>{try{const message=JSON.parse(line);messages.push(message);if(pending.has(message.id)){pending.get(message.id)(message);pending.delete(message.id);}}catch{messages.push({nonJson:line});}});
async function call(method,params){const id=next++;const reply=new Promise(resolve=>pending.set(id,resolve));child.stdin.write(JSON.stringify({id,method,params})+'\n');let timer;try{return await Promise.race([reply,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('RPC timeout: '+method)),10000);})]);}finally{clearTimeout(timer);}}
let error,exit;
const watchScript=`$fixture='${root.replaceAll('/','\\').replaceAll("'","''")}';for($attempt=0;$attempt -lt 50;$attempt++){Get-CimInstance Win32_Process -Filter "Name='git.exe'" | Where-Object {$_.CommandLine -and ($_.CommandLine.Replace('/','\\').Contains($fixture))} | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress;Start-Sleep -Milliseconds 100}`;
const watcher=spawn('powershell',['-NoProfile','-Command',watchScript],{windowsHide:true,stdio:['ignore','pipe','pipe']});
let gitObservations='',watchError='';watcher.stdout.on('data',c=>gitObservations+=c);watcher.stderr.on('data',c=>watchError+=c);const watcherClosed=new Promise(resolve=>watcher.on('close',code=>resolve(code)));
try{
 replies.push(await call('initialize',{clientInfo:{name:'gg442-flagged-probe',version:'1.0.0'},capabilities:{experimentalApi:true}}));
 child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
 for(const [method,params] of [['config/read',{cwd:work,includeLayers:false}],['plugin/list',{cwds:[work],marketplaceKinds:['local'],forceRefetch:false}],['plugin/read',{marketplacePath:join(market,'.agents/plugins/marketplace.json'),pluginName:'fixture'}],['mcpServerStatus/list',{}]])replies.push({method,...await call(method,params)});
 await watcherClosed;
}catch(caught){error={message:caught.message};watcher.kill();await watcherClosed;}
finally{child.stdin.end();let timer;exit=await Promise.race([closed,new Promise(resolve=>{timer=setTimeout(()=>{child.kill();resolve({forcedStop:true});},5000);})]);clearTimeout(timer);if(exit.forcedStop)await closed;}
const result={root,binary,args,pid:child.pid,node:process.version,commands,replies,messages,stderr,error,exit,gitObservations,watchError,modelRequests:0,scope:'ONE supported remote_plugin=false app-server probe; not default remote-plugin health'};
await writeFile(join(evidence,'flagged-appserver-probe-result.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({root,args,error,exit,gitObservations,watchError,replies:replies.filter(r=>r.method).map(r=>({method:r.method,error:r.error}))}));
