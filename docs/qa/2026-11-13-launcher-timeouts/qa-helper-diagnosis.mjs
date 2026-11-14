import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, writeFile, access } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve, dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const base = await mkdtemp(join(root, '.tmp', 'qa-helper-fixtures-'));
const entry = join(root, 'apps/api/dist/instance-identity.js');
const fullBundle = join(root, 'packages/infrastructure/dist/sqlite/index.js');
const directDb = join(root, 'packages/infrastructure/dist/sqlite/db.js');
const configModule = join(root, 'apps/api/dist/config.js');
const lockModule = join(root, 'apps/api/dist/data-dir-lock.js');
const canonicalModule = join(root, 'apps/api/dist/canonical-path.js');
const nativeSource = join(base, 'Baseline.cs');
const nativeBinary = join(base, 'Baseline.exe');
const compiler = join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
const probeExe = join(base, 'FakeWindows/System32/WindowsPowerShell/v1.0/powershell.exe');
const probeSource = join(base, 'Probe.cs');
const probeLog = join(base, 'probe.log');
const injectSource = join(base, 'inject.cjs');
const disposables = join(base, 'empty');
const fixture = join(base, 'stale');
const configurationPath = join(base, 'launcher.json');
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => !key.toUpperCase().startsWith('GG_') && !['NODE_OPTIONS','JEV_API_KEY'].includes(key.toUpperCase()),
  ),
);
const baseEnv = {
  ...env,
  GG_DATA_DIR: disposables,
  GG_HOST: '127.0.0.1',
  GG_PORT: '0',
  GG_WEB_DIST: join(root, 'apps/web/dist'),
  GG_OLLAMA_ENABLED: 'false',
};
const evidence = {
  base: (await execute('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim(),
  node: process.version,
  fixture: base.slice(root.length),
  cleanImportAndHelper: {},
};

function hash(contents) {
  return createHash('sha256').update(contents).digest('hex');
}
async function measured(command, args, opts) {
  const start = performance.now();
  try {
    const { stdout, stderr } = await execute(command, args, {
      cwd: root,
      env,
      windowsHide: true,
      timeout: 30_000,
      ...opts,
    });
    return { ms: Math.round(performance.now()-start), code: 0, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (error) {
    return { ms: Math.round(performance.now()-start), code: error.code, killed: error.killed, signal: error.signal, stdout: error.stdout?.trim(), stderr: error.stderr?.trim() };
  }
}
async function port() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const result = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return result;
}

await Promise.all([entry, fullBundle, directDb, configModule, lockModule, canonicalModule, join(root,'apps/web/dist/index.html')].map((file) => access(file)));
await Promise.all([mkdir(disposables), mkdir(fixture), mkdir(dirname(probeExe), {recursive:true})]);
const fixtureNames = ['graphgoblin.lock.reclaim','graphgoblin.lock','graphgoblin.db.graphgoblin.lock.reclaim','graphgoblin.db.graphgoblin.lock'];
const fixturePaths = [];
for (const name of fixtureNames) {
  const token = randomUUID();
  const file = join(fixture, name);
  const guarded = name.endsWith('.reclaim');
  if (guarded) await mkdir(file);
  const owner = guarded ? join(file, token+'.json') : file;
  await writeFile(owner, JSON.stringify({pid:process.pid, windowsCreationTime:'133000000000000000', token}));
  fixturePaths.push(owner);
}
async function snapshot() {
  return await Promise.all(fixturePaths.map(async (file) => hash(await readFile(file))));
}
const before = await snapshot();
const baseline = await execute('git',['show','b3b5e187:apps/windows-launcher/Launcher.cs'],{cwd:root});
await writeFile(nativeSource, baseline.stdout);
await writeFile(probeSource, [
  'using System; using System.IO; using System.Threading;',
  'static class Probe {',
  ' public static int Main() {',
  '  string log = Environment.GetEnvironmentVariable("QA_PROBE_LOG");',
  '  File.AppendAllText(log, DateTime.UtcNow.ToString("O") + " start " + System.Diagnostics.Process.GetCurrentProcess().Id + "\\n");',
  '  Thread.Sleep(int.Parse(Environment.GetEnvironmentVariable("QA_PROBE_DELAY")));',
  '  Console.WriteLine("134000000000000000");',
  '  File.AppendAllText(log, DateTime.UtcNow.ToString("O") + " finish " + System.Diagnostics.Process.GetCurrentProcess().Id + "\\n");',
  '  return 0;',
  ' }',
  '}',
].join('\n'));
await writeFile(injectSource,'process.env.SystemRoot = process.env.QA_FIXTURE_SYSTEM_ROOT;\n');
await Promise.all([
  execute(compiler, ['/nologo','/target:winexe','/platform:x64','/reference:System.Windows.Forms.dll','/reference:System.Web.Extensions.dll','/out:'+nativeBinary,nativeSource],{windowsHide:true}),
  execute(compiler, ['/nologo','/target:exe','/platform:x64','/out:'+probeExe,probeSource],{windowsHide:true}),
]);
const imports = [
  ['node-empty',['--input-type=module','-e','']],
  ['config-and-lock-leaves',['--input-type=module','-e','await Promise.all('+JSON.stringify([configModule,lockModule,canonicalModule].map((file)=>pathToFileURL(file).href))+'.map(file=>import(file)))']],
  ['sqlite-db-module',['--input-type=module','-e','await import('+JSON.stringify(pathToFileURL(directDb).href)+')']],
  ['sqlite-barrel',['--input-type=module','-e','await import('+JSON.stringify(pathToFileURL(fullBundle).href)+')']],
  ['helper-identity',[entry]],
  ['helper-empty-store-state',[entry,'--store-state']],
];
for (const [name] of imports) evidence.cleanImportAndHelper[name]=[];
for (let repeat=0; repeat<4; repeat++) {
  for (const [name,args] of imports) {
    const result = await measured(process.execPath,args,{env:baseEnv});
    assert.equal(result.code,0,JSON.stringify(result));
    evidence.cleanImportAndHelper[name].push(result.ms);
  }
}
assert.deepEqual(await readdir(disposables), []);
evidence.realWmiFourStale = await measured(process.execPath,[entry,'--store-state'],{env:{...baseEnv,GG_DATA_DIR:fixture}});
assert.deepEqual(JSON.parse(evidence.realWmiFourStale.stdout), {state:'free'});
evidence.fourStaleFixtureFilesByteIdentical = true;
assert.deepEqual(await snapshot(),before);
const testEnv = {
  ...baseEnv,
  GG_DATA_DIR:fixture,
  NODE_OPTIONS:'--require "'+injectSource.replaceAll(String.fromCharCode(92),'/')+'"',
  QA_FIXTURE_SYSTEM_ROOT:join(base,'FakeWindows'),
  QA_PROBE_LOG:probeLog,
  QA_PROBE_DELAY:'4100',
};
evidence.syntheticFourSlowSuccessfulWmiProbes = await measured(process.execPath,[entry,'--store-state'],{env:testEnv});
assert.equal(evidence.syntheticFourSlowSuccessfulWmiProbes.code,0, JSON.stringify(evidence.syntheticFourSlowSuccessfulWmiProbes));
assert.deepEqual(JSON.parse(evidence.syntheticFourSlowSuccessfulWmiProbes.stdout),{state:'free'});
assert.ok(evidence.syntheticFourSlowSuccessfulWmiProbes.ms>15_000);
evidence.directSlowProbeActivity=(await readFile(probeLog,'utf8')).trim().split('\n');
assert.equal(evidence.directSlowProbeActivity.length,8);
const launcherConfig = {
  Repo:resolve(root),
  Node:process.execPath,
  DataDir:fixture,
  Port:await port(),
  Environment:{GG_OLLAMA_ENABLED:'false'},
  StartupTimeoutSeconds:60,
  WindowTimeoutSeconds:2,
};
await writeFile(configurationPath,JSON.stringify(launcherConfig));
await writeFile(probeLog,'');
evidence.baselineLauncherFourSlowSuccessfulWmiProbes = await measured(
  nativeBinary,['--config',configurationPath,'--ensure-gateway'],{env:testEnv},
);
assert.equal(evidence.baselineLauncherFourSlowSuccessfulWmiProbes.code,1);
assert.match(evidence.baselineLauncherFourSlowSuccessfulWmiProbes.stderr,/read-only identity\/ownership check/);
assert.ok(evidence.baselineLauncherFourSlowSuccessfulWmiProbes.ms < evidence.syntheticFourSlowSuccessfulWmiProbes.ms+2_500);
evidence.baselineSlowProbeActivity=(await readFile(probeLog,'utf8')).trim().split('\n');
assert.ok(evidence.baselineSlowProbeActivity.filter((line)=>line.includes(' start ')).length>=3);
assert.deepEqual(await snapshot(), before);
evidence.nativeGatewayLogAbsent = await access(join(base,'gateway.log')).then(()=>false, (e)=>{
  if(e.code==='ENOENT') return true;
  throw e;
});
assert.equal(evidence.nativeGatewayLogAbsent,true);
const timeoutProbeLog=join(base,'timeout-probe.log');
const commonTimeoutEnv={...testEnv,QA_PROBE_DELAY:'7000',QA_PROBE_LOG:timeoutProbeLog};
await writeFile(probeLog,'');
evidence.singleForeignWmiTimeout = await measured(process.execPath,[entry,'--store-state'],{env:commonTimeoutEnv});
const refused = JSON.parse(evidence.singleForeignWmiTimeout.stdout);
assert.equal(refused.state,'held');
assert.match(refused.detail,/timed out after 5000 ms/);
evidence.singleForeignWmiTimeout.stdout={...refused,path:'fixture/graphgoblin.lock.reclaim'};
evidence.timeoutProbeActivity=(await readFile(timeoutProbeLog,'utf8')).trim().split('\n');
assert.equal(evidence.timeoutProbeActivity.length,1);
assert.deepEqual(await snapshot(), before);
console.log(JSON.stringify(evidence,null,2));
