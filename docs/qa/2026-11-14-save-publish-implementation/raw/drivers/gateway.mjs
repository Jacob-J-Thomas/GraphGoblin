// Isolated native gateway for #237 evidence: the checkout's BUILT API (apps/api/dist/main.js)
// serving the checkout's BUILT web app, on an ephemeral loopback port, over a fresh file SQLite
// data directory inside the run directory. No provider binary, credential or owner store is used.
//
// node gateway.mjs <worktree> <expectedHead> <runDir> <clean|dirty>
// Prints `GG_QA_READY <url>`; closing or writing to stdin shuts it down.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const [worktreeArg, expectedHead, runDirArg, treeMode] = process.argv.slice(2);
const worktree = await realpath(worktreeArg);
await mkdir(runDirArg, { recursive: true });
const runDir = await realpath(runDirArg);
assert(relative(worktree, runDir).startsWith('..'), 'run directory must be outside the checkout');
const git = (...args) => execFileSync('git', args, { cwd: worktree, encoding: 'utf8' }).trim();
const digest = (value) => createHash('sha256').update(value).digest('hex');

async function files(root) {
  const out = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out.push(full);
    }
  }
  await walk(root);
  return out.sort();
}

/** Every runtime-loaded build output, digested per file and as one sorted manifest digest. */
async function buildManifest() {
  const roots = ['apps/web/dist', 'apps/api/dist'];
  for (const pkg of await readdir(join(worktree, 'packages'))) roots.push(`packages/${pkg}/dist`);
  const lines = [];
  const perRoot = {};
  for (const root of roots) {
    let list;
    try {
      list = await files(join(worktree, root));
    } catch {
      continue;
    }
    perRoot[root] = list.length;
    for (const file of list)
      lines.push(`${relative(worktree, file).replaceAll('\\', '/')} ${digest(await readFile(file))}`);
  }
  return { perRoot, files: lines.length, digest: digest(lines.join('\n')), lines };
}

function sourceIdentity() {
  const status = git('status', '--porcelain=v1', '--untracked-files=all');
  return {
    head: git('rev-parse', 'HEAD'),
    tree: git('rev-parse', 'HEAD^{tree}'),
    status,
    // The exact uncommitted source (tracked diff plus untracked files), for a candidate build.
    diffSha256: digest(git('diff', 'HEAD', '--binary')),
    untracked: git('ls-files', '--others', '--exclude-standard'),
  };
}

const start = sourceIdentity();
assert.equal(start.head, expectedHead);
if (treeMode === 'clean') assert.equal(start.status, '', 'baseline requires a clean checkout');
const build = await buildManifest();
await writeFile(join(runDir, 'build-manifest.txt'), build.lines.join('\n') + '\n');
const scratch = join(runDir, 'gateway-store');
await mkdir(scratch, { recursive: true });
const dist = join(worktree, 'apps', 'web', 'dist');
const apiEntry = join(worktree, 'apps', 'api', 'dist', 'main.js');
for (const key of Object.keys(process.env))
  if (/^GG_|^(?:JEV_API_KEY|CODEX_HOME|CLAUDE_CONFIG_DIR|OLLAMA_HOST|ANTHROPIC_|OPENAI_)/i.test(key))
    delete process.env[key];
Object.assign(process.env, {
  GG_DATA_DIR: scratch,
  GG_HOST: '127.0.0.1',
  GG_PORT: '0',
  GG_REQUIRE_API_KEY: 'false',
  GG_WEB_DIST: dist,
  GG_GOBLIN_DIST: '',
  GG_SWAGGER_UI: 'false',
  GG_OLLAMA_ENABLED: 'false',
  GG_LOG_LEVEL: 'error',
  GG_CODEX_BINARY: join(scratch, 'no-codex-provider.exe'),
  GG_CLAUDE_BINARY: join(scratch, 'no-claude-provider.exe'),
  CODEX_HOME: join(scratch, 'empty-codex-home'),
  CLAUDE_CONFIG_DIR: join(scratch, 'empty-claude-config'),
});
const { main } = await import(pathToFileURL(apiEntry).href);
const { app } = await main();
try {
  const address = app.server.address();
  assert.equal(address.address, '127.0.0.1');
  assert(![4747, 4748].includes(address.port), 'owner ports are never used');
  const url = `http://127.0.0.1:${address.port}`;
  const healthy = await fetch(`${url}/healthz`);
  assert.equal(healthy.ok, true);
  assert.equal(healthy.headers.get('x-graphgoblin-pid'), String(process.pid));
  // The served shell and assets are byte-identical to the checkout's build.
  const served = {};
  const index = await (await fetch(`${url}/app/`)).arrayBuffer();
  served['apps/web/dist/index.html'] = digest(Buffer.from(index));
  for (const name of await readdir(join(dist, 'assets'))) {
    if (!/\.(?:js|css)$/.test(name)) continue;
    const response = await fetch(`${url}/app/assets/${name}`);
    assert.equal(response.ok, true);
    served[`apps/web/dist/assets/${name}`] = digest(Buffer.from(await response.arrayBuffer()));
  }
  for (const [file, hash] of Object.entries(served))
    assert(build.lines.includes(`${file} ${hash}`), `served ${file} differs from the build`);
  const record = {
    ...start,
    node: process.version,
    pid: process.pid,
    url,
    scratch,
    build: { perRoot: build.perRoot, files: build.files, digest: build.digest },
    served,
    startedAt: new Date().toISOString(),
  };
  await writeFile(join(runDir, 'gateway.json'), JSON.stringify(record, null, 2) + '\n');
  console.log(`GG_QA_READY ${url}`);
  await new Promise((done) => {
    process.stdin.on('data', () => done());
    process.stdin.once('end', done);
    process.stdin.once('close', done);
    process.stdin.resume();
  });
} finally {
  await app.close();
  const after = sourceIdentity();
  const buildAfter = await buildManifest();
  const unchanged =
    after.head === start.head &&
    after.status === start.status &&
    after.diffSha256 === start.diffSha256 &&
    buildAfter.digest === build.digest;
  await writeFile(
    join(runDir, 'gateway-closed.json'),
    JSON.stringify(
      {
        head: after.head,
        status: after.status,
        diffSha256: after.diffSha256,
        buildDigest: buildAfter.digest,
        sourceAndBuildUnchanged: unchanged,
        listening: app.server.listening,
        pid: process.pid,
        closedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
  );
  process.exit(unchanged ? 0 : 3);
}
