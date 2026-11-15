import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const worktree = await realpath(process.argv[2]);
const expected = process.argv[3];
const observedMain = process.argv[5];
const evidence = await realpath(dirname(fileURLToPath(import.meta.url)));
assert(relative(worktree, evidence).startsWith('..'));
const gitOptions = { cwd: worktree, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, maxBuffer: 128 * 1024 * 1024 };
const git = (...args) => execFileSync('git', args, { ...gitOptions, encoding: 'utf8' }).trim();
const identity = () => ({ head: git('rev-parse','HEAD'), tree: git('rev-parse','HEAD^{tree}'),
  base:git('rev-parse','origin/main'),status: git('status','--porcelain=v1') });
const start = identity();
const bound = JSON.parse(await readFile(process.argv[4], 'utf8'));
assert.equal(bound.head,expected);
assert.equal(start.status,'');
assert.equal(start.head,bound.head);
assert.equal(start.tree,bound.tree);
assert.equal(start.base,observedMain);
assert.equal(bound.mapping?.id,'208-history-final-native-v1');
const dist = join(worktree,'apps','web','dist');
const apiEntry = join(worktree,'apps','api','dist','main.js');
const sourceFields = Object.keys(bound.sourceReadback);
assert(Array.isArray(sourceFields) && sourceFields.length > 0, 'Affected source paths required');
for (const file of sourceFields) assert(!relative(worktree, join(worktree,file)).startsWith('..'));
const digest = (value) => createHash('sha256').update(value).digest('hex');
for (const [file, hash] of Object.entries(bound.mapping.sourceHashes)) {
  assert.equal(digest(execFileSync('git', ['show', expected+':'+file], gitOptions)), hash,
    'Frozen candidate no longer matches the browser observation mapping: '+file);
}
async function sources() {
  return Object.fromEntries(await Promise.all(sourceFields.map(async (file)=>
    [file,digest(await readFile(join(worktree,file)))])));
}
const sourceHashes = await sources();
assert.deepEqual(sourceHashes,bound.sourceReadback);
const buildFiles = ['index.html', ...(await readdir(join(dist,'assets'))).filter(f => /\.(?:css|js)$/.test(f)).map(f => 'assets/'+f)];
const buildHashes = Object.fromEntries(await Promise.all(buildFiles.map(async f => [f, digest(await readFile(join(dist,f)))])));
const apiEntryHash = digest(await readFile(apiEntry));
assert.equal(apiEntryHash,bound.critical['apps/api/dist/main.js']);
for (const [file,hash] of Object.entries(buildHashes)) assert.equal(hash,bound.critical['apps/web/dist/'+file],file);
assert(buildHashes[bound.bundle.replace('/app/','')],'Web build is missing frozen entry bundle');
const scratch = await mkdtemp(join(evidence,'gateway-store-'));
await writeFile(join(evidence,'gateway-store-admission.json'),JSON.stringify({pid:process.pid,scratch},null,2)+'\n',{flag:'wx'});
for (const k of Object.keys(process.env)) {
  if (/^GG_|^(?:JEV_API_KEY|CODEX_HOME|CLAUDE_CONFIG_DIR|OLLAMA_HOST)$/i.test(k)) delete process.env[k];
}
Object.assign(process.env, {
  GG_DATA_DIR: scratch, GG_HOST: '127.0.0.1', GG_PORT: '0', GG_REQUIRE_API_KEY: 'false',
  GG_WEB_DIST: dist, GG_GOBLIN_DIST: '', GG_SWAGGER_UI: 'false', GG_OLLAMA_ENABLED: 'false',
  GG_LOG_LEVEL: 'error',
  GG_CODEX_BINARY: join(scratch, 'no-codex-provider.exe'),
  GG_CLAUDE_BINARY: join(scratch, 'no-claude-provider.exe'),
  CLAUDE_CONFIG_DIR: join(scratch, 'empty-claude-config'),
});
await mkdir(scratch, { recursive:true });
let app;
let checks;
let served;
try {
  const { main } = await import(pathToFileURL(apiEntry).href);
  ({app} = await main());
  const address = app.server.address();
  assert.equal(address.address,'127.0.0.1');
  assert(![4747,4748].includes(address.port));
  const url = 'http://127.0.0.1:' + address.port;
  const healthy = await fetch(url+'/healthz');
  assert.equal(healthy.headers.get('x-graphgoblin-pid'),String(process.pid));
  assert.equal(healthy.ok, true);
  checks = async () => {
    const hashes = {};
    for (const [file, expectedDigest] of Object.entries(buildHashes)) {
      const response = await fetch(url+'/app/'+(file==='index.html'?'':file),{signal:AbortSignal.timeout(5000)});
      assert.equal(response.ok, true);
      const actual = digest(Buffer.from(await response.arrayBuffer()));
      assert.equal(actual,expectedDigest,file);
      hashes[file] = actual;
    }
    return hashes;
  };
  served = await checks();
  const startRecord = { head:bound.head,tree:bound.tree,base:bound.base,actualMain:bound.actualMain,observedMain,currentWorkingSourceBound:true,
    evidenceMode:'clean corrected source',scratch,url,pid:process.pid,node:process.version,sourceHashes,
    buildHashes, served, apiEntryHash, bundle:bound.bundle, mapping: bound.mapping };
  await writeFile(join(evidence,'gateway.json'),JSON.stringify(startRecord,null,2)+'\n');
  console.log('GG_QA_READY '+url);
  await new Promise((done) => {
    process.stdin.on('data', () => { process.stdin.pause(); done(); });
    process.stdin.once('end',done);
    process.stdin.resume();
  });
} finally {
  let servedAfter;
  try {
    if (checks && served) {
      servedAfter = await checks();
      assert.deepEqual(servedAfter,served,'Served bytes changed during browser run');
    }
  } finally {
    if (app) await app.close();
    const after = identity();
    const hashesAfter = await sources();
    assert.deepEqual(after,start);
    assert.deepEqual(hashesAfter,sourceHashes);
    await writeFile(join(evidence,'gateway-closed.json'),JSON.stringify({ ...after, pid:process.pid,
      listening:app?.server.listening ?? false, serverStarted:Boolean(app), servedAfter, scratch },null,2)+'\n',{flag:'wx'});
  }
}
