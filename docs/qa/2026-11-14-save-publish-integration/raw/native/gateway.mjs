import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// COPIED from save-publish-237-readback-diagnostic/gateway.mjs (sha256 5acd0212...) and modified
// for the DIRTY #237+#209 integration candidate: HEAD e12b81ec with MERGE_HEAD 2367b15b and an
// uncommitted working resolution. Instead of a clean tree and a Git-object mapping, it requires
// the binding written by bind.mjs immediately before (identity, working-file source hashes and
// every built file) and asserts the same identity and source bytes when it closes.
// Usage: node gateway.mjs <worktree> <HEAD> <MERGE_HEAD> <source-paths.json> <binding-before.json>
const worktree = await realpath(process.argv[2]);
const expected = process.argv[3];
const expectedMerge = process.argv[4];
const evidence = await realpath(dirname(fileURLToPath(import.meta.url)));
assert(relative(worktree, evidence).startsWith('..'));
const digest = (value) => createHash('sha256').update(value).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: worktree, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
const identity = () => ({ head: git('rev-parse','HEAD'), mergeHead: git('rev-parse','MERGE_HEAD'),
  tree: git('rev-parse','HEAD^{tree}'), status: git('status','--porcelain=v1'), index: digest(git('ls-files','-s')) });
const start = identity();
assert.equal(start.head, expected);
assert.equal(start.mergeHead, expectedMerge);
const bound = JSON.parse(await readFile(process.argv[6], 'utf8'));
for (const key of ['head', 'mergeHead', 'tree', 'status', 'index'])
  assert.equal(bound[key], start[key], 'Binding is for another candidate state: ' + key);
const dist = join(worktree,'apps','web','dist');
const apiEntry = join(worktree,'apps','api','dist','main.js');
const sourceFields = JSON.parse(await readFile(process.argv[5], 'utf8'));
assert(Array.isArray(sourceFields) && sourceFields.length > 0, 'Affected source paths required');
for (const file of sourceFields) assert(!relative(worktree, join(worktree,file)).startsWith('..'));
const sourceHashes = Object.fromEntries(await Promise.all(sourceFields.map(async f => [f, digest(await readFile(join(worktree,f)))])));
assert.deepEqual(sourceHashes, bound.sourceHashes, 'Working sources changed since binding');
const buildFiles = ['index.html', ...(await readdir(join(dist,'assets'))).filter(f => /\.(?:css|js)$/.test(f)).map(f => 'assets/'+f)];
const buildHashes = Object.fromEntries(await Promise.all(buildFiles.map(async f => [f, digest(await readFile(join(dist,f)))])));
for (const [file, hash] of Object.entries(buildHashes))
  assert.equal(bound.built['apps/web/dist/' + file], hash, 'Built web file changed since binding: ' + file);
const apiEntryHash = digest(await readFile(apiEntry));
assert.equal(bound.built['apps/api/dist/main.js'], apiEntryHash, 'Built API entry changed since binding');
const scratch = await mkdtemp(join(evidence,'gateway-store-'));
for (const k of Object.keys(process.env)) {
  if (/^GG_|^(?:JEV_API_KEY|CODEX_HOME|CLAUDE_CONFIG_DIR|OLLAMA_HOST)$/i.test(k)) delete process.env[k];
}
Object.assign(process.env, {
  GG_DATA_DIR: scratch, GG_HOST: '127.0.0.1', GG_PORT: '0', GG_REQUIRE_API_KEY: 'false',
  GG_WEB_DIST: dist, GG_GOBLIN_DIST: '', GG_SWAGGER_UI: 'false', GG_OLLAMA_ENABLED: 'false',
  GG_LOG_LEVEL: 'error',
  GG_CODEX_BINARY: join(scratch, 'no-codex-provider.exe'),
  GG_CLAUDE_BINARY: join(scratch, 'no-claude-provider.exe'),
  CODEX_HOME: join(scratch, 'empty-codex-home'),
  CLAUDE_CONFIG_DIR: join(scratch, 'empty-claude-config'),
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
  const startRecord = { ...start, scratch, url, pid:process.pid, node:process.version, sourceHashes,
    buildHashes, served, apiEntryHash, binding: { observedAt: bound.observedAt,
      builtFileCount: bound.builtFileCount, builtManifestSha256: bound.builtManifestSha256 } };
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
