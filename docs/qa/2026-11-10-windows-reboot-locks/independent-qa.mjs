import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const repo = 'C:/Users/98jak/.codex/worktrees/windows-reboot-lock-recovery/GraphGoblin';
const evidence = 'C:/Users/98jak/graphgoblin-qa/2026-11-10-launcher-recovery';
const execute = promisify(execFile);
const lockApi = await import(pathToFileURL(join(repo, 'apps/api/dist/data-dir-lock.js')));
const identityApi = await import(pathToFileURL(join(repo, 'apps/api/dist/windows-process-identity.js')));
const base = await mkdtemp(join(evidence, 'independent-process-'));
const outcomes = [];
const fixture = spawn(process.execPath, ['-e', 'process.stdin.resume(); process.stdin.on("end",()=>process.exit(0));'], { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
const ended = new Promise((resolve) => fixture.once('exit', resolve));
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GG_') && key.toUpperCase() !== 'JEV_API_KEY'));
const helper = async (dir, db, overrides={}) => (await execute(process.execPath, overrides.SystemRoot ? ['--input-type=module', '-e', 'const entry=process.argv[1]; process.env.SystemRoot=process.argv[2]; process.argv=[process.execPath,entry,"--store-state"]; await import((await import("node:url")).pathToFileURL(entry));', join(repo, 'apps/api/dist/instance-identity.js'), overrides.SystemRoot] : [join(repo, 'apps/api/dist/instance-identity.js'), '--store-state'], {
 cwd: repo, windowsHide: true, timeout: 15000,
 env: { ...cleanEnv, GG_DATA_DIR: dir, GG_DB_URL: 'file:' + db.replaceAll('\\','/') }
})).stdout.trim();
async function snapshot(dir) {
 const result = {};
 for (const item of await readdir(dir, {withFileTypes: true})) {
  if (item.isDirectory()) result[item.name] = await snapshot(join(dir,item.name));
  else result[item.name] = createHash('sha256').update(await readFile(join(dir,item.name))).digest('hex');
 }
 return result;
}
async function record(name, action) {
 const start = Date.now();
 await action();
 outcomes.push({name, result:'PASS', durationMs:Date.now()-start});
 process.stdout.write(JSON.stringify(outcomes.at(-1))+'\n');
}
try {
 assert.equal(process.version, 'v22.23.4');
 const actual = await identityApi.windowsProcessIdentity(fixture.pid);
 assert.match(actual, /^[1-9][0-9]{16,18}$/);
 const stale = (BigInt(actual)-10000000n).toString();
 const own = await identityApi.ownWindowsProcessIdentity();
 assert.match(own, /^[1-9][0-9]{16,18}$/);
 const oldRecord = JSON.stringify({pid:fixture.pid, windowsCreationTime:stale, token:'independent-old-owner'});
 const liveRecord = JSON.stringify({pid:fixture.pid, windowsCreationTime:actual, token:'independent-live-owner'});
 await record('different OS identity reclaims data/database locks and both guards; read-only helper preserves every byte', async()=>{
  const dir=join(base,'reused'); await mkdir(dir); const db=join(dir,'external.db');
  await writeFile(db,'preserved database sentinel');
  await writeFile(join(dir,'other.txt'),'preserved unrelated file');
  const files=['graphgoblin.lock','graphgoblin.lock.reclaim','external.db.graphgoblin.lock','external.db.graphgoblin.lock.reclaim'];
  for (const file of files) await writeFile(join(dir,file),oldRecord);
  const before=await snapshot(dir);
  assert.equal(await helper(dir,db),'free');
  assert.deepEqual(await snapshot(dir),before);
  const dataLock=await lockApi.acquireDataDirLock(dir);
  const dbLock=await lockApi.acquireDatabaseLock(db);
  for (const file of ['graphgoblin.lock','external.db.graphgoblin.lock']) {
   const row=JSON.parse(await readFile(join(dir,file),'utf8'));
   assert.equal(row.pid,process.pid); assert.equal(row.windowsCreationTime,own); assert.notEqual(row.token,'independent-old-owner');
  }
  await Promise.all([dataLock.release(),dbLock.release()]);
  assert.deepEqual((await readdir(dir)).sort(),['external.db','other.txt']);
  assert.equal(await readFile(db,'utf8'),'preserved database sentinel');
  assert.equal(await readFile(join(dir,'other.txt'),'utf8'),'preserved unrelated file');
  assert.equal(fixture.exitCode,null); process.kill(fixture.pid,0);
 });
 await record('matching live identity protects each main lock and reclamation guard', async()=>{
  for (const name of ['graphgoblin.lock','graphgoblin.lock.reclaim','external.db.graphgoblin.lock','external.db.graphgoblin.lock.reclaim']) {
   const dir=join(base,'held-'+name); await mkdir(dir); const db=join(dir,'external.db');
   await writeFile(join(dir,name),liveRecord);
   const before=await snapshot(dir);
   assert.equal(await helper(dir,db),'held');
   assert.deepEqual(await snapshot(dir),before);
   if(name.startsWith('external')) await assert.rejects(lockApi.acquireDatabaseLock(db),/another GraphGoblin process holds/);
   else await assert.rejects(lockApi.acquireDataDirLock(dir),/another GraphGoblin process holds/);
   assert.deepEqual(await snapshot(dir),before);
  }
 });
 await record('PID-only and malformed identities stay held and byte-preserved', async()=>{
  for(const identity of [undefined,null,0,'invalid']) {
   const dir=join(base,'malformed-'+String(identity)); await mkdir(dir); const db=join(dir,'external.db');
   await writeFile(join(dir,'graphgoblin.lock'),JSON.stringify({pid:fixture.pid,windowsCreationTime:identity}));
   const before=await snapshot(dir);
   assert.equal(await helper(dir,db),'held');
   await assert.rejects(lockApi.acquireDataDirLock(dir),/another GraphGoblin process holds/);
   assert.deepEqual(await snapshot(dir),before);
  }
 });
 await record('unavailable Windows identity cannot reclaim a live PID with a different recorded identity', async()=>{
  const dir=join(base,'unavailable'); await mkdir(dir); const db=join(dir,'external.db');
  await writeFile(join(dir,'graphgoblin.lock'),oldRecord);
  const before=await snapshot(dir);
  const missing=join(base,'absent-system-root');
  assert.equal(await helper(dir,db,{SystemRoot:missing}),'held');
  const original=process.env.SystemRoot;
  process.env.SystemRoot=missing;
  try {
   assert.equal((await lockApi.dataDirLockState(dir)).state,'held');
   await assert.rejects(lockApi.acquireDataDirLock(dir),/another GraphGoblin process holds/);
  } finally { if(original===undefined) delete process.env.SystemRoot; else process.env.SystemRoot=original; }
  assert.deepEqual(await snapshot(dir),before);
 });
 await record('new writer refuses missing identity provider before creating ownership files', async()=>{
  const dir=join(base,'unknown-self'); await mkdir(dir);
  const module=pathToFileURL(join(repo,'apps/api/dist/data-dir-lock.js')).href;
  const script='process.env.SystemRoot=process.argv[3]; const {acquireDataDirLock}=await import(process.argv[1]); try {await acquireDataDirLock(process.argv[2]); process.exitCode=9;} catch(error) {process.stdout.write(error.message); }';
  const result=await execute(process.execPath,['--input-type=module','-e',script,module,dir,join(base,'absent-system-root')],{windowsHide:true,timeout:10000,env:cleanEnv});
  assert.match(result.stdout,/Cannot establish Windows process identity/);
  assert.deepEqual(await readdir(dir),[]);
 });
 await record('same-process concurrent acquisition admits exactly one contender', async()=>{
  const dir=join(base,'concurrent'); await mkdir(dir); await writeFile(join(dir,'graphgoblin.lock'),oldRecord);
  const contenders=await Promise.allSettled(Array.from({length:6},()=>lockApi.acquireDataDirLock(dir)));
  assert.equal(contenders.filter(x=>x.status==='fulfilled').length,1);
  for (const row of contenders) if(row.status==='fulfilled') await row.value.release(); else assert.match(String(row.reason),/another GraphGoblin process holds/);
  assert.deepEqual(await readdir(dir),[]);
 });
 assert.equal(fixture.exitCode,null); process.kill(fixture.pid,0);
 await writeFile(join(evidence,'independent-qa-results.json'),JSON.stringify({runtime:process.version,base,fixturePid:fixture.pid,actualIdentity:actual,outcomes},null,2));
} finally {
 fixture.stdin.end();
 await Promise.race([ended,new Promise((_,reject)=>setTimeout(()=>reject(new Error('QA fixture failed to exit after EOF')),5000))]);
}
