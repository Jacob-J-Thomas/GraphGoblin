import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const worktree = await realpath(process.argv[2]);
const expected = process.argv[3];
const evidence = await realpath(dirname(fileURLToPath(import.meta.url)));
assert(relative(worktree, evidence).startsWith('..'));
const git = (...args) => execFileSync('git', args, { cwd: worktree, encoding: 'utf8' }).trim();
const identity = () => ({ head: git('rev-parse','HEAD'), tree: git('rev-parse','HEAD^{tree}'), status: git('status','--porcelain=v1') });
const start = identity();
assert.equal(start.head, expected);
assert.equal(start.status, '');
const scratch = await mkdtemp(join(evidence,'gateway-store-'));
const dist = join(worktree,'apps','web','dist');
const apiEntry = join(worktree,'apps','api','dist','main.js');
const sourceFields = [
  'apps/web/src/forms/JsonSchemaForm.tsx', 'apps/web/src/runs/new/RunLauncher.tsx',
  'apps/web/src/runs/inspector/WaitPanel.tsx', 'apps/api/src/routes/runs.ts',
];
const digest = (value) => createHash('sha256').update(value).digest('hex');
const sourceHashes = Object.fromEntries(await Promise.all(sourceFields.map(async f => [f, digest(await readFile(join(worktree,f)))])));
const buildFiles = ['index.html', ...(await readdir(join(dist,'assets'))).filter(f => /\.(?:css|js)$/.test(f)).map(f => 'assets/'+f)];
const buildHashes = Object.fromEntries(await Promise.all(buildFiles.map(async f => [f, digest(await readFile(join(dist,f)))])));
const apiEntryHash = digest(await readFile(apiEntry));
for (const k of Object.keys(process.env)) {
  if (/^GG_|^(?:JEV_API_KEY|CODEX_HOME|CLAUDE_CONFIG_DIR|OLLAMA_HOST)$/i.test(k)) delete process.env[k];
}
Object.assign(process.env, {
  GG_DATA_DIR: scratch, GG_HOST: '127.0.0.1', GG_PORT: '0', GG_REQUIRE_API_KEY: 'false',
  GG_WEB_DIST: dist, GG_GOBLIN_DIST: '', GG_SWAGGER_UI: 'false', GG_OLLAMA_ENABLED: 'false',
  GG_LOG_LEVEL: 'error',
});
await mkdir(scratch, { recursive:true });
const { main } = await import(pathToFileURL(apiEntry).href);
const { app } = await main();
try {
  const address = app.server.address();
  assert.equal(address.address,'127.0.0.1');
  assert(![4747,4748].includes(address.port));
  const url = 'http://127.0.0.1:' + address.port;
  const healthy = await fetch(url+'/healthz');
  assert.equal(healthy.headers.get('x-graphgoblin-pid'),String(process.pid));
  assert.equal(healthy.ok, true);
  const served = {};
  for (const [file, expectedDigest] of Object.entries(buildHashes)) {
    const response = await fetch(url+'/app/'+(file==='index.html'?'':file));
    assert.equal(response.ok, true);
    const actual = digest(Buffer.from(await response.arrayBuffer()));
    assert.equal(actual,expectedDigest);
    served[file] = actual;
  }
  const startRecord = { ...start, scratch, url, pid:process.pid, node:process.version, sourceHashes, buildHashes, served, apiEntryHash };
  await writeFile(join(evidence,'gateway.json'),JSON.stringify(startRecord,null,2)+'\n');
  console.log('GG_QA_READY '+url);
  await new Promise((done) => {
    process.stdin.on('data', () => { process.stdin.pause(); done(); });
    process.stdin.once('end',done);
    process.stdin.resume();
  });
} finally {
  await app.close();
  const after = identity();
  const hashesAfter = Object.fromEntries(await Promise.all(sourceFields.map(async f => [f, digest(await readFile(join(worktree,f)))])));
  assert.deepEqual(after,start);
  assert.deepEqual(hashesAfter,sourceHashes);
  await writeFile(join(evidence,'gateway-closed.json'),JSON.stringify({ ...after, pid:process.pid, listening:app.server.listening, scratch },null,2)+'\n');
}
