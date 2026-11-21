import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import net from 'node:net';
import { pathToFileURL } from 'node:url';

const q = dirname(new URL(import.meta.url).pathname).replace(/^\/(\w:)/, '$1');
const repo = 'G:/ggq/gg-i4-442-qa/GraphGoblin';
const root = join(q, 'public-fixture');
const stateFile = join(root, 'state.json'), callsFile = join(root, 'calls.jsonl');
const home = join(root, 'home'), temp = join(root, 'temp');
for (const p of [root, home, temp]) await mkdir(p, { recursive: true });
await writeFile(callsFile, '');
const env = Object.fromEntries(Object.entries(process.env).filter(([k,v]) => v !== undefined && /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC)$/i.test(k)));
Object.assign(env, {
  HOME: home, USERPROFILE: home, CODEX_HOME: home, APPDATA: home, LOCALAPPDATA: home,
  XDG_CONFIG_HOME: home, TEMP: temp, TMP: temp,
  GG_DATA_DIR: join(root, 'store'), GG_REQUIRE_API_KEY: 'true', GG_LOG_LEVEL: 'silent',
  GG_MASTER_KEY: randomBytes(32).toString('base64'), GG_CODEX_BINARY: join(q, 'fixture-cli.mjs'),
  GG_CLAUDE_BINARY: join(root, 'absent-claude.exe'), GG_OLLAMA_ENABLED: 'false',
  GG_WEB_DIST: '', GG_GOBLIN_DIST: '', GG442_QA_STATE: stateFile, GG442_QA_CALLS: callsFile,
});
const main = join(repo, 'apps/api/dist/main.js');
const expectedArgs = [['--version'], ['exec','--help'], ['exec','resume','--help'], ['login','status']];
const notice = 'Loaded plugin tools are not verified by this check. Inspect codex plugin list --json and codex mcp list --json in the worker directory; neither proves every enabled plugin loaded. Verify the expected tool in the worker before relying on it.';
const records = [], processes = [], failures = [];
let gateway, gatewayExit;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function fileSnapshot(base) {
  const out = {};
  async function walk(p) {
    for (const f of await readdir(p, { withFileTypes: true }).catch(e => e.code === 'ENOENT' ? [] : Promise.reject(e))) {
      const full = join(p, f.name);
      if (f.isDirectory()) await walk(full); else out[full.slice(base.length+1)] = hash(await readFile(full));
    }
  }
  await walk(base); return out;
}
async function calls() { return (await readFile(callsFile, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse); }
async function mode(value) { await writeFile(stateFile, JSON.stringify({ mode: value })); }
async function run(label, args, overrides={}) {
  const child = spawn(process.execPath, [main,...args], { env: {...env,...overrides}, cwd: repo, windowsHide: true, stdio: ['ignore','pipe','pipe'] });
  const row = {label, pid: child.pid, command: process.execPath, args:[main,...args], started:new Date().toISOString()}; processes.push(row);
  let stdout='',stderr=''; child.stdout.on('data', b=>stdout+=b); child.stderr.on('data', b=>stderr+=b);
  const timer=setTimeout(()=>child.kill(),20000);
  const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',(code,signal)=>Object.assign(row,{exitCode:code,signal,exited:new Date().toISOString()}));child.on('close',resolve);});
  clearTimeout(timer);
  const result={code,stdout,stderr};
  await writeFile(join(q,label+'.json'),JSON.stringify({...row,...result},null,2)+'\n');
  return result;
}
async function check(label, fn) {
  try { const detail = await fn(); records.push({label,status:'PASS',detail}); }
  catch(error) { failures.push(label); records.push({label,status:'FAIL',error:{message:error.message,stack:error.stack}}); }
  await writeFile(join(q,'public-results.json'),JSON.stringify({repo,source:'5b0d806c75d409c33a57ea54ffda45e2f89bc500',records,processes,failures},null,2)+'\n');
  console.log(label+': '+records.at(-1).status);
}
async function cliCase(name, currentMode, expectedCode, count, overrides={}) {
  await mode(currentMode); const before=(await calls()).length;
  const snapshot=await fileSnapshot(env.GG_DATA_DIR);
  const result=await run('cli-'+name,['--preflight'],overrides);
  const delta=(await calls()).slice(before);
  assert.equal(result.code,expectedCode);
  assert.equal(result.stdout.includes(notice),expectedCode===0);
  assert.equal((result.stdout.match(/Codex plugins/g)||[]).length,expectedCode===0?1:0);
  assert.deepEqual(delta.map(r=>r.args),expectedArgs.slice(0,count));
  assert.deepEqual(await fileSnapshot(env.GG_DATA_DIR),snapshot);
  return {exitCode:result.code,argv:delta.map(r=>r.args),storeHashesUnchanged:true};
}
try {
  await check('CLI ready warning exit0',()=>cliCase('ready','ready',0,4));
  await check('CLI unauthenticated exit1 no notice',()=>cliCase('auth','auth',1,4));
  await check('CLI incompatible exit1 no notice',()=>cliCase('incompatible','incompatible',1,2));
  await check('CLI unknown failure exit1 no notice',()=>cliCase('unknown','unknown',1,1));
  await check('CLI missing binary exit1 no notice',()=>cliCase('missing','ready',1,0,{GG_CODEX_BINARY:join(root,'missing-codex.exe')}));

  // Built public method controls for maps the production composition root does not expose.
  const {runPreflight,configPreflightSources}=await import(pathToFileURL(join(repo,'apps/api/dist/preflight.js')));
  const {loadConfig}=await import(pathToFileURL(join(repo,'apps/api/dist/config.js')));
  for (const harnesses of [{},{claude:{preflight:async()=>({state:'ready',ok:true,version:'2.1.287',authenticated:true,authMethod:'claude.ai',problems:[]})}}]) {
    await check(Object.keys(harnesses).length?'built method nonCodex ready no notice':'built method absent Codex no notice',async()=>{
      const sources=await configPreflightSources(loadConfig(env),{harnesses});
      try { const report=await runPreflight(sources); assert(!report.checks.some(r=>r.id==='plugins.codex')); return report; }
      finally{sources.close();}
    });
  }

  await mode('ready');
  const admin=await run('key-create-admin',['--create-api-key','QA disposable']); assert.equal(admin.code,0);
  const limited=await run('key-create-limited',['--create-api-key','QA loops only','--scopes','loops:read']);assert.equal(limited.code,0);
  const tokenFrom=text=>text.match(/^  (\S+)$/m)?.[1];
  const token=tokenFrom(admin.stdout), limitedToken=tokenFrom(limited.stdout); assert(token&&limitedToken);
  // Raw token output is deliberately not retained: fixture-only credentials are hashed in manifests.
  for (const label of ['key-create-admin','key-create-limited']) {
    const path=join(q,label+'.json');const raw=JSON.parse(await readFile(path,'utf8'));
    raw.stdout=raw.stdout.replace(/^  \S+$/m,'  <DISPOSABLE_QA_TOKEN_REDACTED>');await writeFile(path,JSON.stringify(raw,null,2)+'\n');
  }
  const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});}); assert(![4747,4748,11434].includes(port));
  gateway=spawn(process.execPath,[main],{cwd:repo,env:{...env,GG_PORT:String(port)},windowsHide:true,stdio:['ignore','pipe','pipe']});
  const gateRow={label:'gateway',pid:gateway.pid,command:process.execPath,args:[main],started:new Date().toISOString(),port}; processes.push(gateRow);
  let out='',err='';gateway.stdout.on('data',b=>out+=b);gateway.stderr.on('data',b=>err+=b);
  gatewayExit=new Promise(resolve=>gateway.on('exit',(code,signal)=>{Object.assign(gateRow,{exitCode:code,signal,exited:new Date().toISOString()});resolve(code);}));
  const base=`http://127.0.0.1:${port}`;
  async function request(path,key=token,options={}) {
    const before=(await calls()).length;
    const r=await fetch(base+path,{...options,headers:{...(key?{Authorization:`Bearer ${key}`} : {}),...options.headers},signal:AbortSignal.timeout(10000)});
    const raw=await r.text();let body;try{body=JSON.parse(raw);}catch{body=raw;}
    const delta=(await calls()).slice(before);
    const result={status:r.status,body,argv:delta.map(r=>r.args),calls:delta};
    records.push({label:`HTTP ${options.method||'GET'} ${path}`,status:'OBSERVED',detail:result}); return result;
  }
  let alive=false;
  for(let i=0;i<100;i++){try{const h=await fetch(base+'/healthz',{signal:AbortSignal.timeout(500)});if(h.status===200){alive=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
  assert(alive,'Gateway startup');
  for(const path of ['/system/preflight','/harness/preflight']) {
    for(const [label,key,status] of [['missing',undefined,401],['wrong','qa-wrong-token',401],['insufficient',limitedToken,403]]) {
      await check(`${path} ${label} authorization`,async()=>{const r=await request(path,key===undefined?null:key);assert.equal(r.status,status);assert.equal(r.argv.length,0);return r;});
    }
  }
  async function successSystem() {
    const r=await request('/system/preflight');assert.equal(r.status,200);assert.equal(r.body.ok,true);
    assert.deepEqual(r.body.checks.filter(c=>c.id==='plugins.codex'),[{id:'plugins.codex',label:'Codex plugins',status:'warn',message:notice}]);
    const codex=r.body.checks.find(c=>c.id==='harness.codex');assert.equal(codex.state,'ready');assert.equal(codex.status,'ok');
    assert.deepEqual(r.argv,expectedArgs);return r;
  }
  await check('HTTP system ready plus one warning',successSystem);
  await check('HTTP harness exact ready authentication shape',async()=>{
    const r=await request('/harness/preflight');assert.equal(r.status,200);
    assert.deepEqual(r.body.items.find(c=>c.harness==='codex'),{harness:'codex',state:'ready',ok:true,version:'0.160.0',authenticated:true,problems:[]});
    assert.deepEqual(r.argv,expectedArgs);assert(!JSON.stringify(r.body).includes(notice));return r;
  });
  await mode('auth');
  await check('HTTP system auth failure omits warning',async()=>{
    const r=await request('/system/preflight');assert.equal(r.status,200);assert.equal(r.body.ok,false);
    assert(!r.body.checks.some(c=>c.id==='plugins.codex'));assert.equal(r.body.checks.find(c=>c.id==='harness.codex').state,'auth');assert.deepEqual(r.argv,expectedArgs);return r;
  });
  await check('HTTP harness auth facts preserved',async()=>{
    const r=await request('/harness/preflight');assert.equal(r.status,200);
    const c=r.body.items.find(c=>c.harness==='codex');assert.equal(c.state,'auth');assert.equal(c.ok,false);assert.equal(c.authenticated,false);assert(c.problems.length>0);assert(!JSON.stringify(r.body).includes(notice));assert.deepEqual(r.argv,expectedArgs);return r;
  });
  await mode('ready');await check('HTTP explicit retry after sign-in repair',successSystem);
  const s=await request('/system/shutdown');
  const stop=await request('/system/shutdown',token,{method:'POST',headers:{'content-type':'application/json','x-graphgoblin-shutdown-token':s.body.controlToken},body:JSON.stringify({action:'drain'})});
  assert.equal(stop.status,202);
  const exited=await Promise.race([gatewayExit,new Promise(resolve=>setTimeout(()=>resolve('timeout'),10000))]);assert.equal(exited,0);
  await writeFile(join(q,'gateway-output.json'),JSON.stringify({stdout:out,stderr:err},null,2)+'\n');
  await check('no additional native inventory/provider commands',async()=>{const all=await calls();assert(all.every(c=>expectedArgs.some(a=>JSON.stringify(a)===JSON.stringify(c.args))));assert((await readdir(temp)).length===0);return {nativeCalls:all.length,workerCommands:0,inventoryCommands:0,providerRequests:0,probeTempClean:true};});
} catch(error) {
  failures.push('harness');records.push({label:'harness',status:'FAIL',error:{message:error.message,stack:error.stack}});
} finally {
  if(gateway&&gateway.exitCode===null){gateway.kill();await Promise.race([gatewayExit,new Promise(resolve=>setTimeout(resolve,5000))]);records.push({label:'cleanup fallback',status:'OBSERVED',detail:'Only exact owned child handle killed after harness failure'});}
  await writeFile(join(q,'public-results.json'),JSON.stringify({repo,source:'5b0d806c75d409c33a57ea54ffda45e2f89bc500',node:process.version,records,processes,failures},null,2)+'\n');
  console.log(JSON.stringify({checks:records.filter(r=>r.status==='PASS').length,failures}));process.exitCode=failures.length?1:0;
}
