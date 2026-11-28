import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FakeHarness } from 'file:///G:/ggq/gg-fu-preflight-20261124/GraphGoblin/packages/engine/dist/testing/index.js';
import { openDatabase } from 'file:///G:/ggq/gg-fu-preflight-20261124/GraphGoblin/packages/infrastructure/dist/sqlite/index.js';
import { runPreflightCli, configPreflightSources, runPreflight } from 'file:///G:/ggq/gg-fu-preflight-20261124/GraphGoblin/apps/api/dist/preflight.js';
import { loadConfig } from 'file:///G:/ggq/gg-fu-preflight-20261124/GraphGoblin/apps/api/dist/config.js';
const evidence = new URL('.', import.meta.url);
const root = await mkdtemp(join(new URL(evidence).pathname.replace(/^\/(.:)/,'$1'), 'closure-fixtures-'));
const sha = b => createHash('sha256').update(b).digest('hex');
const results=[];
for(const state of ['unsupported','corrupt']) {
  const folder=join(root,state); await mkdir(folder);
  const dbFile=join(folder,'gateway.db');
  if(state==='corrupt') await writeFile(dbFile, Buffer.alloc(4096,'x'));
  else {
    const h=openDatabase({url:pathToFileURL(dbFile).href});
    try { await h.migrate(); await h.client.execute('UPDATE gg_upgrade_state SET format_version=3'); await h.client.execute('PRAGMA wal_checkpoint(TRUNCATE)'); }
    finally { h.close(); }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const snapshot=async()=>Object.fromEntries(await Promise.all((await readdir(folder)).filter(n=>n==='gateway.db'||n==='gateway.db-wal').map(async n=>{const bytes=await readFile(join(folder,n)); return [n,{sha256:sha(bytes),bytes:bytes.length}];})));
  const before=await snapshot();
  const env={GG_DATA_DIR:join(folder,'data'),GG_DB_URL:pathToFileURL(dbFile).href,GG_MASTER_KEY:Buffer.alloc(32,9).toString('base64'),GG_OLLAMA_ENABLED:'false',GG_DEFAULTS:JSON.stringify({byHarness:{codex:{model:'gpt-6-luna',effort:'low'},claude:{model:'claude-opus-5-5',effort:'high'}}})};
  const options={env,harnesses:{codex:new FakeHarness(),claude:new FakeHarness([],'claude')},write:()=>{}};
  const codes=[];
  for(let repeat=0;repeat<3;repeat++) codes.push(await runPreflightCli(options));
  assert.deepEqual(codes,[1,1,1]);
  const sources=await configPreflightSources(loadConfig(env),{harnesses:options.harnesses});
  let report; try { report=await runPreflight(sources); await assert.rejects(sources.catalog()); } finally {sources.close();}
  assert.equal(report.ok,false);
  for(const id of ['default-model','default-model.claude']) assert.deepEqual(report.checks.filter(c=>c.id===id).map(c=>({status:c.status,message:c.message.includes('not checked until the database is current and readable')})),[{status:'warn',message:true}]);
  const after=await snapshot();
  for(const [name,data] of Object.entries(before)) assert.deepEqual(after[name],data);
  for(const [name,data] of Object.entries(after)) if(!before[name]) assert.equal(name==='gateway.db-wal'&&data.bytes===0,true);
  globalThis.gc?.();
  await new Promise(resolve => setTimeout(resolve, 100));
  const exclusive=[];
  for(const name of Object.keys(after)) {
    execFileSync(join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference=\'Stop\'; $f=[IO.File]::Open($env:GG_REVIEW_PROBE_FILE,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None); try { 'exclusive-open-ok' } finally { $f.Dispose() }"],{encoding:'utf8',timeout:10000,windowsHide:true,env:{SystemRoot:process.env.SystemRoot,GG_REVIEW_PROBE_FILE:join(folder,name)}});
    exclusive.push(name);
  }
  results.push({state,codes,dbUnchanged:true,existingWalUnchanged:true,exclusiveOpenAfterClose:exclusive,defaultChecks:report.checks.filter(c=>c.id==='default-model'||c.id==='default-model.claude'),before,after});
}
await writeFile(new URL('closure-probe-results.json',evidence),JSON.stringify({runtime:process.version,fixtureRoot:root,results},null,2)+'\n');
console.log(JSON.stringify({runtime:process.version,cases:results.map(({state,codes,exclusiveOpenAfterClose})=>({state,codes,exclusiveOpenAfterClose})),passed:true}));


