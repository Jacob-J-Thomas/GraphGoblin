import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {FakeHarness} from 'file:///G:/ggq/gg-fu-preflight-20261124/GraphGoblin/packages/engine/dist/testing/index.js';
import {openDatabase} from 'file:///G:/ggq/gg-fu-preflight-20261124/GraphGoblin/packages/infrastructure/dist/sqlite/index.js';
const results=[];
for(const mode of ['base','candidate']) {
  const {runPreflightCli}=await import(mode==='base'?new URL('./baseline-preflight.mjs',import.meta.url):'file:///G:/ggq/gg-fu-preflight-20261124/GraphGoblin/apps/api/dist/preflight.js');
  const folder=await mkdtemp(join(fileURLToPath(new URL('.',import.meta.url)),`${mode}-driver-control-`));
  const file=join(folder,'gateway.db');
  const h=openDatabase({url:pathToFileURL(file).href});
  try {await h.migrate();await h.client.execute('UPDATE gg_upgrade_state SET format_version=3');await h.client.execute('PRAGMA wal_checkpoint(TRUNCATE)');} finally{h.close();}
  await new Promise(r=>setTimeout(r,100));
  let output='';
  const code=await runPreflightCli({env:{GG_DATA_DIR:join(folder,'data'),GG_DB_URL:pathToFileURL(file).href,GG_MASTER_KEY:Buffer.alloc(32,9).toString('base64'),GG_OLLAMA_ENABLED:'false'},harnesses:{codex:new FakeHarness()},write:t=>{output+=t;}});
  assert.equal(code,1);
  const exclusive=()=>{try{execFileSync(join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; $f=[IO.File]::Open($env:GG_REVIEW_PROBE_FILE,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None); try { 'exclusive-open-ok' } finally { $f.Dispose() }"],{encoding:'utf8',timeout:10000,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{SystemRoot:process.env.SystemRoot,GG_REVIEW_PROBE_FILE:file}});return {ok:true};}catch(e){return{ok:false,status:e.status,message:String(e.stderr).split('\n')[0]};}};
  const beforeGc=exclusive();globalThis.gc();await new Promise(r=>setTimeout(r,100));const afterGc=exclusive();
  assert.equal(afterGc.ok,true);
  results.push({mode,code,beforeGc,afterGc,defaultModelLine:output.split('\n').find(l=>l.includes('Default model'))});
}
await writeFile(new URL('driver-control-results.json',import.meta.url),JSON.stringify({runtime:process.version,results},null,2)+'\n');
console.log(JSON.stringify({runtime:process.version,results}));
