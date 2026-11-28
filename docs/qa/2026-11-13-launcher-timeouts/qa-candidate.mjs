import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const base = await mkdtemp(join(root,'.tmp','qa-candidate-fixtures-'));
const exe = join(base,'Candidate.exe');
const source = join(root,'apps/windows-launcher/Launcher.cs');
const id = 'bc'.repeat(32);
const marker = 'QA_PRIVATE_HELPER_SENTINEL';
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(
  ([name]) => !name.toUpperCase().startsWith('GG_') && !['JEV_API_KEY', 'NODE_OPTIONS','NODE_DEBUG'].includes(name.toUpperCase()),
));
const evidence={
  gitHead:(await execute('git',['rev-parse','HEAD'], {cwd:root})).stdout.trim(),
  launcherSha256:createHash('sha256').update(await readFile(source)).digest('hex'),
  node:process.version,
};
await execute(join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe'), [
  '/nologo','/target:winexe','/platform:x64','/reference:System.Windows.Forms.dll',
  '/reference:System.Web.Extensions.dll','/out:'+exe,source,
], { windowsHide:true, env:cleanEnv });
async function port() {
  const server = createServer();
  await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(0,'127.0.0.1',resolve);
  });
  const result=server.address().port;
  await new Promise((resolve,reject)=>server.close((error)=>error?reject(error):resolve()));
  return result;
}
const found = async (file) => await access(file).then(()=>true, (error)=>{
  if(error.code==='ENOENT') return false;
  throw error;
});
async function fixture(name, program, timeout) {
  const repo=join(base,name);
  const launchPort=await port();
  const startMarker=join(repo,'start-marker');
  const countPath=join(repo,'ownership-attempts');
  const configPath=join(repo,'launcher.json');
  const logPath=join(repo,'launcher.log');
  const apiDist=join(repo,'apps/api/dist');
  await Promise.all([
    mkdir(apiDist,{recursive:true}),
    mkdir(join(repo,'apps/web/dist'),{recursive:true}),
  ]);
  await Promise.all([
    writeFile(join(repo,'package.json'),'{"type":"module"}'),
    writeFile(join(repo,'apps/web/dist/index.html'),'disposable fixture'),
    writeFile(join(apiDist,'instance-identity.js'), [
      "import { readFileSync, writeFileSync } from 'node:fs';",
      'const countPath='+JSON.stringify(countPath)+';',
      'const marker='+JSON.stringify(marker)+';',
      'if (process.argv[2] !== "--store-state") { process.stdout.write('+JSON.stringify(id)+'); } else {',
      '  let count = 0;',
      '  try { count=Number(readFileSync(countPath,"utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }',
      '  count++; writeFileSync(countPath,String(count));',
      program,
      '}',
    ].join('\n')),
    writeFile(join(apiDist,'main.js'),[
      "import { readFileSync, writeFileSync } from 'node:fs';",
      "import { createServer } from 'node:http';",
      'const count=Number(readFileSync('+JSON.stringify(countPath)+',"utf8"));',
      'writeFileSync('+JSON.stringify(startMarker)+',JSON.stringify({count,pid:process.pid}));',
      'const server=createServer((req,res)=>{',
      '  res.setHeader("X-GraphGoblin-Instance",'+JSON.stringify(id)+');',
      '  res.setHeader("X-GraphGoblin-Pid",String(process.pid));',
      '  res.setHeader("X-GraphGoblin-Phase","running");',
      '  res.end("fixture");',
      '});',
      'server.listen(Number(process.env.GG_PORT),"127.0.0.1");',
      'setTimeout(()=>server.close(),7000);',
    ].join('\n')),
    writeFile(configPath,JSON.stringify({
      Repo:repo,Node:process.execPath,DataDir:join(repo,'no-store'),Port:launchPort,
      Environment:{},StartupTimeoutSeconds:timeout,WindowTimeoutSeconds:1,
    })),
  ]);
  const start=performance.now();
  let result;
  try {
    result={...(await execute(exe,['--config',configPath,'--ensure-gateway'],{ env:cleanEnv,windowsHide:true,timeout:10000 })),code:0};
  } catch(error) {
    result=error;
  }
  const elapsed=Math.round(performance.now()-start);
  assert.notEqual(result.killed,true);
  return {
    elapsed,
    exit:result.code,
    stdout:result.stdout,
    stderr:result.stderr,
    log:await found(logPath)?await readFile(logPath,'utf8'):null,
    attempts:await found(countPath)?Number(await readFile(countPath,'utf8')):0,
    createdGateway:await found(startMarker)?JSON.parse(await readFile(startMarker,'utf8')):null,
    createdStore:await found(join(repo,'no-store')),
  };
}
evidence.ownershipExitWithPrivateStderr=await fixture('ownership-exit',[
  'process.stderr.write(marker);',
  'process.stdout.write("{\\\"state\\\":\\\"free\\\"}");',
  'process.exitCode=7;',
].join('\n'),3);
assert.equal(evidence.ownershipExitWithPrivateStderr.exit,1);
assert.match(evidence.ownershipExitWithPrivateStderr.stderr,/ownership.*exit.*7/i);
assert.equal(evidence.ownershipExitWithPrivateStderr.attempts,1);
assert.equal(evidence.ownershipExitWithPrivateStderr.createdGateway,null);
assert.equal(evidence.ownershipExitWithPrivateStderr.createdStore,false);
assert.doesNotMatch(JSON.stringify(evidence.ownershipExitWithPrivateStderr),new RegExp(marker));
evidence.malformedOwnership=await fixture('malformed',
  'process.stdout.write("{"+marker+"}");',3);
assert.equal(evidence.malformedOwnership.exit,1);
assert.match(evidence.malformedOwnership.stderr,/ownership.*invalid output/i);
assert.equal(evidence.malformedOwnership.attempts,1);
assert.equal(evidence.malformedOwnership.createdGateway,null);
assert.equal(evidence.malformedOwnership.createdStore,false);
assert.doesNotMatch(JSON.stringify(evidence.malformedOwnership),new RegExp(marker));
const held='const held=JSON.stringify({state:"held",path:"disposable/store.lock",detail:"Store ownership could not be verified (fixture)"});';
evidence.staysHeld=await fixture('held',held+'\nprocess.stdout.write(held);',2);
assert.equal(evidence.staysHeld.exit,1);
assert.match(evidence.staysHeld.stderr,/Store ownership could not be verified/);
assert.match(evidence.staysHeld.stderr,/disposable\/store.lock/);
assert.equal(evidence.staysHeld.createdGateway,null);
assert.equal(evidence.staysHeld.createdStore,false);
evidence.heldThenFree=await fixture('released',[
  held,
  'process.stdout.write(count===1?held:JSON.stringify({state:"free"}));',
].join('\n'),3);
assert.equal(evidence.heldThenFree.exit,0,JSON.stringify(evidence.heldThenFree));
assert.ok(evidence.heldThenFree.attempts >= 2);
assert.equal(evidence.heldThenFree.attempts,evidence.heldThenFree.createdGateway.count);
assert.equal(evidence.heldThenFree.createdStore,false);
console.log(JSON.stringify(evidence,null,2));
