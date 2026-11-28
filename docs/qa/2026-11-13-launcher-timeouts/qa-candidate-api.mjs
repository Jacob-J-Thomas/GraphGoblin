import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, writeFile, access } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout as wait } from 'node:timers/promises';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const base = await mkdtemp(join(root, '.tmp', 'qa-candidate-api-'));
const data = join(base,'store');
const entry = join(root,'apps/api/dist/instance-identity.js');
const source = join(root,'apps/windows-launcher/Launcher.cs');
const exe = join(base,'GraphGoblin.exe');
const configPath = join(base,'launcher.json');
const probeExe = join(base, 'FakeWindows/System32/WindowsPowerShell/v1.0/powershell.exe');
const probeSource = join(base,'Probe.cs');
const probeLog = join(base,'probe.log');
const injectSource = join(base,'inject.cjs');
const compiler = join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
const sha = (buffer) => createHash('sha256').update(buffer).digest('hex');
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(
  ([name]) => !name.toUpperCase().startsWith('GG_') && !['JEV_API_KEY','NODE_OPTIONS','NODE_DEBUG'].includes(name.toUpperCase()),
));
const evidence = {
  gitHead:(await execute('git',['rev-parse','HEAD'],{cwd:root})).stdout.trim(),
  launcherSourceSha256:sha(await readFile(source)),
  builtHelperSha256:sha(await readFile(entry)),
  node:process.version,
};
await Promise.all([mkdir(data),mkdir(dirname(probeExe),{recursive:true})]);
const fixtureNames = ['graphgoblin.lock.reclaim','graphgoblin.lock','graphgoblin.db.graphgoblin.lock.reclaim','graphgoblin.db.graphgoblin.lock'];
for (const name of fixtureNames) {
  const token=randomUUID();
  const file=join(data,name);
  const guarded=name.endsWith('.reclaim');
  if(guarded) await mkdir(file);
  await writeFile(guarded?join(file,token+'.json'):file,JSON.stringify({
    pid:process.pid, windowsCreationTime:'133000000000000000', token,
  }));
}
const port = await (async () => {
  const server=createServer();
  await new Promise((resolve, reject) => {
    server.once('error',reject);
    server.listen(0,'127.0.0.1',resolve);
  });
  const port=server.address().port;
  await new Promise((resolve,reject)=>server.close((error)=>error?reject(error):resolve()));
  return port;
})();
const config = {
  Repo:resolve(root), Node:process.execPath, DataDir:data, Port:port, StartupTimeoutSeconds:60,
  WindowTimeoutSeconds:1, Environment:{GG_OLLAMA_ENABLED:'false',GG_LOG_LEVEL:'info'},
};
await writeFile(configPath,JSON.stringify(config));
await writeFile(injectSource,'process.env.SystemRoot=process.env.QA_FIXTURE_SYSTEM_ROOT;\n');
await writeFile(probeSource, [
  'using System; using System.IO; using System.Threading; using System.Text.RegularExpressions;',
  'static class Probe {',
  ' public static int Main(string[] args) {',
  '  string log = Environment.GetEnvironmentVariable("QA_PROBE_LOG");',
  '  var match = Regex.Match(args[args.Length-1], @"ProcessId = (\\d+)");',
  '  if (!match.Success) return 2;',
  '  string target = match.Groups[1].Value;',
  '  File.AppendAllText(log, DateTime.UtcNow.ToString("O") + " start " + target + "\\n");',
  '  if (target == Environment.GetEnvironmentVariable("QA_DELAYED_PID")) Thread.Sleep(4100);',
  '  Console.WriteLine("134000000000000000");',
  '  File.AppendAllText(log, DateTime.UtcNow.ToString("O") + " finish " + target + "\\n");',
  '  return 0;',
  ' }',
  '}',
].join('\n'));
await Promise.all([
  execute(compiler,['/nologo','/target:winexe','/platform:x64','/reference:System.Windows.Forms.dll','/reference:System.Web.Extensions.dll','/out:'+exe,source],{windowsHide:true,env:cleanEnv}),
  execute(compiler,['/nologo','/target:exe','/platform:x64','/out:'+probeExe,probeSource],{windowsHide:true,env:cleanEnv}),
]);
const env={
  ...cleanEnv,
  NODE_OPTIONS:'--require "'+injectSource.replaceAll(String.fromCharCode(92),'/')+'"',
  QA_FIXTURE_SYSTEM_ROOT:join(base,'FakeWindows'),
  QA_PROBE_LOG:probeLog,
  QA_DELAYED_PID:String(process.pid),
};
const { stdout:expectedIdentity }=await execute(process.execPath,[entry],{
  cwd:root,windowsHide:true,timeout:10_000,env:{
    ...env,GG_DATA_DIR:data,GG_PORT:String(port),GG_HOST:'127.0.0.1',
    GG_WEB_DIST:join(root,'apps/web/dist'),...config.Environment,
  },
});
assert.match(expectedIdentity.trim(),/^[a-f0-9]{64}$/);
const origin='http://127.0.0.1:'+port;
async function ready() {
  const response=await fetch(origin+'/healthz',{signal:AbortSignal.timeout(2000)});
  assert.equal(response.status,200);
  return {
    pid:Number(response.headers.get('X-GraphGoblin-Pid')),
    expectedMatch:response.headers.get('X-GraphGoblin-Instance')===expectedIdentity.trim(),
    phase:response.headers.get('X-GraphGoblin-Phase'),
  };
}
async function drain() {
  const health=await ready();
  assert.equal(health.expectedMatch,true,'refusing drain to an unrecognized fixture gateway');
  const response=await fetch(origin+'/system/shutdown',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({action:'drain'}),signal:AbortSignal.timeout(3000),
  });
  assert.ok(response.ok);
  for(let step=0;step<100;step++) {
    await wait(150);
    try { await ready(); } catch(error) { if(error instanceof TypeError) return true; throw error; }
  }
  throw new Error('Disposable gateway did not exit after managed drain.');
}
const start=performance.now();
try {
  const result=await execute(exe,['--config',configPath,'--ensure-gateway'],{
    env,cwd:root,windowsHide:true,timeout:78_000,
  });
  evidence.launcher={elapsed:Math.round(performance.now()-start),...result,exit:0};
  const health=await ready();
  assert.equal(health.expectedMatch,true);
  assert.equal(health.phase,'running');
  assert.ok(health.pid>0);
  evidence.disposableGateway={
    health, web:(await fetch(origin+'/app/',{signal:AbortSignal.timeout(3000)})).status,
    goblin:(await fetch(origin+'/goblin/',{signal:AbortSignal.timeout(3000)})).status,
  };
  assert.equal(evidence.disposableGateway.web,200);
  assert.equal(evidence.disposableGateway.goblin,200);
  const lines=(await readFile(probeLog,'utf8')).trim().split('\n');
  assert.ok(lines.length>=18);
  evidence.wmiProbes=lines.map((line)=>line.slice(0,line.lastIndexOf(' ') + 1)+(line.endsWith(' '+process.pid) ? 'fixture-parent' : 'disposable-gateway'));
} finally {
  if(await ready().then((health)=>health.expectedMatch,()=>false)) evidence.managedDrain=await drain();
}
assert.equal(evidence.managedDrain,true);
const files=await readdir(data);
assert.ok(files.includes('graphgoblin.db'));
evidence.ownershipFilesAfterDrain=files.filter((file)=>file.includes('.lock'));
assert.deepEqual(evidence.ownershipFilesAfterDrain,[]);
console.log(JSON.stringify(evidence,null,2));
