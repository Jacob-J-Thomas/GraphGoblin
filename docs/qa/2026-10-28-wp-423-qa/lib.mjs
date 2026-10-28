// QA-only driver for the built public HTTP API. No product imports or database edits.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
export const OUT = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(OUT, '../../..');
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export function redact(value) {
  let s = String(value);
  const home = os.homedir();
  for (const v of [home.replaceAll('\\', '\\\\\\\\'), home.replaceAll('\\', '\\\\'), home, home.replaceAll('\\', '/')]) s = s.split(v).join('%USERPROFILE%');
  return s.split(os.hostname()).join('%COMPUTERNAME%').replace(/S-1-\d+(?:-\d+)+/g, '<SID>');
}
export function write(name, value) { fs.writeFileSync(path.join(OUT,name), redact(typeof value === 'string' ? value : JSON.stringify(value,null,2))+'\n'); }
export const log = (name, value) => { const line = redact(JSON.stringify({at:new Date().toISOString(),name,value})); fs.appendFileSync(path.join(OUT,'scenarios.log.txt'),line+'\n'); console.log(line); };
export const checks = [];
export function check(name, ok, value) { checks.push({name,ok:!!ok,value}); log(ok?'PASS '+name:'FAIL '+name,value); }
export async function until(fn, ms=30000) { const end=Date.now()+ms; while(Date.now()<end){const v=await fn();if(v)return v;await sleep(100);}throw Error('QA wait deadline'); }
export function store(name) { return fs.mkdtempSync(path.join(os.tmpdir(),'gg-qa423-'+name+'-')); }
export function cli(dir, binary) {
  const d=path.join(dir,'fake'); fs.mkdirSync(d);
  fs.copyFileSync(binary,path.join(d,'codex.exe')); fs.copyFileSync(binary,path.join(d,'claude.exe'));
  return {dir:d, env:{GG_CODEX_BINARY:path.join(d,'codex.exe'),GG_CLAUDE_BINARY:path.join(d,'claude.exe')}, set:(n,v)=>fs.writeFileSync(path.join(d,n),String(v)), requests:()=>fs.existsSync(path.join(d,'requests.log.txt'))?fs.readFileSync(path.join(d,'requests.log.txt'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[]};
}
export async function gateway(dir, port, env, label) {
  if(port<6390||port>6399)throw Error('port outside allocation');
  const clean=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^GG_|^JEV_API_KEY$|^NODE_OPTIONS$|^NODE_V8_COVERAGE$/i.test(k)));
  const child=spawn(process.execPath,[path.join(ROOT,'apps/api/dist/main.js')],{cwd:ROOT,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...clean,GG_DATA_DIR:dir,GG_HOST:'127.0.0.1',GG_PORT:String(port),GG_REQUIRE_API_KEY:'false',GG_WEB_DIST:path.join(ROOT,'apps/web/dist'),GG_TEST_PORT_START:'7660',GG_TEST_PORT_COUNT:'30',...env}});
  let logs='',exit=null; child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);child.on('exit',(code,signal)=>exit={code,signal});
  const g={pid:child.pid,origin:`http://127.0.0.1:${port}`,exit:()=>exit,logs:()=>logs,save:()=>write(label+'-gateway.log.txt',logs),waitExit:async(ms=30000)=>until(()=>exit,ms),call:async(p,method='GET',body)=>{const r=await fetch(`http://127.0.0.1:${port}`+p,{method,headers:body===undefined?{}:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)});const t=await r.text();let json;try{json=JSON.parse(t)}catch{json=t}return {status:r.status,json};},stop:async()=>{if(!exit){await g.call('/system/shutdown','POST',{action:'drain'}).catch(()=>{});await g.waitExit(30000).catch(()=>{});}g.save();log('gateway ended',{label,pid:child.pid,exit});return exit;}};
  await until(()=>{if(exit)throw Error('startup exit '+redact(logs));return logs.includes('GraphGoblin API listening');},60000);
  log('gateway started',{label,pid:child.pid,port,store:dir,inheritedGgVariables:0,jevKey:false});return g;
}
export async function publish(g,def) { const c=await g.call('/loops','POST',{definition:def});if(c.status!==201)throw Error('create '+JSON.stringify(c));const id=c.json.loop.id;const p=await g.call(`/loops/${id}/publish`,'POST');if(p.status>=300)throw Error('publish '+JSON.stringify(p));return id; }
export async function start(g,id) { const r=await g.call(`/loops/${id}/runs`,'POST',{});if(r.status!==202)throw Error('start '+JSON.stringify(r));return r.json.run.id; }
export async function events(g,id) { return (await g.call(`/runs/${id}/events?limit=1000`)).json.items; }
export async function end(g,id,ms=30000) { return until(async()=>{const r=(await g.call(`/runs/${id}`)).json;return ['succeeded','failed','cancelled'].includes(r.status)&&r;},ms); }
export async function snapshot(g,id,name) { const run=(await g.call(`/runs/${id}`)).json;const ev=await events(g,id);const sessions=(await g.call(`/runs/${id}/sessions`)).json;write(name+'.json',{run,events:ev,sessions});return {run,ev,sessions}; }
export const trigger={id:'start',kind:'trigger',label:'Start',config:{type:'manual'}};
export const done={id:'done',kind:'exit',label:'Done',config:{}};
export const edge=(id,from,port,to)=>({id,from:{node:from,port},to:{node:to}});
export function inference(name,extra={}) {return {schemaVersion:4,name,settings:{},nodes:[trigger,{id:'infer',kind:'inference',label:'Infer',config:{harness:'codex',model:'gpt-6-luna',effort:'low',harnessOptions:{sandbox:'workspace-write',approval:'never'},prompt:{template:'QA423 synthetic task'},...extra}},done],edges:[edge('a','start','out','infer'),edge('b','infer','out','done')]};}
export function configs(argv) {return argv.flatMap((v,i)=>v==='--config'?[argv[i+1]]:[]);}
export const defaults=['plugins','apps','memories','hooks','multi_agent','goals'].map(n=>`features.${n}=false`).concat('notify=[]');
export function isolation(name,listing,turn,names=[],override={}) {
  const expected=[...names.map(n=>`mcp_servers.${n}.enabled=${override.server===n?'true':'false'}`),...defaults.map(v=>override.plugins&&v==='features.plugins=false'?'features.plugins=true':v)];
  const cfg=configs(turn?.argv??[]);
  check(name+' isolation and order',JSON.stringify(cfg.slice(0,expected.length))===JSON.stringify(expected),{expected,actual:cfg});
  check(name+' listing flags/cwd',listing?.argv.slice(0,3).join(' ')==='mcp list --json'&&configs(listing.argv).includes('features.plugins=false')&&configs(listing.argv).includes('features.apps=false')&&turn.argv[turn.argv.indexOf('--cd')+1].replaceAll('\\','/')===listing.cwd.replaceAll('\\','/'),{listing,turnWorkingDirectory:turn?.argv[turn.argv.indexOf('--cd')+1]});
  check(name+' thread policy',cfg.at(-1)==='approval_policy="never"'&&cfg.includes('model_reasoning_effort="low"')&&cfg.includes('web_search="disabled"')&&turn?.argv[turn.argv.indexOf('--sandbox')+1]===(turn.argv.includes('--output-schema')?'read-only':'workspace-write'),cfg);
}
export function environment() {write('environment.json',{head:execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim(),branch:execFileSync('git',['branch','--show-current'],{cwd:ROOT,encoding:'utf8'}).trim(),node:process.version,executable:process.execPath,os:os.type()+' '+os.release(),arch:process.arch,ports:[6390,6399],GG_TEST_PORT_START:7660,GG_TEST_PORT_COUNT:30,realProviderTurns:0});}
