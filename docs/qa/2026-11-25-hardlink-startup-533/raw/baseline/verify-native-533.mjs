import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, link, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [repoArg, evidenceArg, mode = 'baseline'] = process.argv.slice(2);
assert.ok(mode === 'baseline' || mode === 'candidate');
const repo = resolve(repoArg);
const evidence = resolve(evidenceArg);
const entry = join(repo, 'apps/api/dist/main.js');
const data = resolve(await mkdtemp(join(evidence, 'hardlink-533-')));
assert.equal(dirname(data), evidence);
const original = join(data, 'store.db');
const alias = join(data, 'alias.db');
const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  /^(SystemRoot|Windir|ComSpec|Path|PathExt|Temp|Tmp|UserProfile|AppData|LocalAppData|OS)$/i.test(key)));
const envFor = (dataDir, file) => ({
  ...clean,
  GG_HOST: '127.0.0.1',
  GG_PORT: '0',
  GG_DB_URL: pathToFileURL(file).href,
  GG_DATA_DIR: dataDir,
  GG_MASTER_KEY: Buffer.alloc(32, 8).toString('base64'),
  GG_OLLAMA_ENABLED: 'false',
  GG_OLLAMA_URL: 'http://127.0.0.1:1',
  GG_CODEX_BINARY: join(data, 'absent-codex.exe'),
  GG_CLAUDE_BINARY: join(data, 'absent-claude.exe'),
  GG_WEB_DIST: '',
  GG_GOBLIN_DIST: '',
  GG_SWAGGER_UI: 'false',
});

const run = async (env, shouldListen = false) => {
  const child = spawn(process.execPath, [entry], { cwd: repo, env, windowsHide: true });
  let stdout = '';
  let stderr = '';
  let listening;
  const ready = new Promise(done => { listening = done; });
  const exit = new Promise((done, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => done({ code, signal }));
  });
  child.stdout.on('data', chunk => {
    stdout += chunk.toString();
    const at = stdout.match(/Server listening at (http:\/\/127\.0\.0\.1:\d+)/);
    if (at) listening(at[1]);
  });
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  const timer = setTimeout(() => child.kill(), 20000);
  try {
    const first = await Promise.race([ready, exit]);
    if (typeof first !== 'string') {
      assert.equal(shouldListen, false, stdout + stderr);
      return { ...first, stdout, stderr };
    }
    assert.ok(shouldListen, 'Refusal unexpectedly started an API.');
    const response = await fetch(first + '/system/shutdown', { signal: AbortSignal.timeout(4000) });
    assert.equal(response.status, 200);
    const { controlToken } = await response.json();
    const drained = await fetch(first + '/system/shutdown', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-graphgoblin-shutdown-token': controlToken },
      body: JSON.stringify({ action: 'drain' }),
      signal: AbortSignal.timeout(4000),
    });
    assert.equal(drained.status, 202);
    await drained.json();
    return { ...(await exit), listened: true, stdout, stderr };
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await exit;
    }
  }
};

const state = async file => {
  const bytes = await readFile(file);
  return { byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
};
const noLock = async (dataDir, file) => {
  for (const path of [join(dataDir, 'graphgoblin.lock'), file + '.graphgoblin.lock'])
    for (const suffix of ['', '.reclaim'])
      await assert.rejects(access(path + suffix), { code: 'ENOENT' });
};

const nativeCommand = (exe, args) => {
  const path = join(clean.SystemRoot ?? clean.SYSTEMROOT ?? 'C:\\Windows', 'System32', exe);
  const out = spawnSync(path, args, { env: clean, encoding: 'utf8', timeout: 10000, windowsHide: true });
  assert.ifError(out.error);
  assert.equal(out.status, 0, out.stderr);
  return out.stdout;
};
try {
  const ordinaryDir = join(data, 'ordinary');
  const ordinary = await run(envFor(ordinaryDir, original), true);
  assert.equal(ordinary.code, 0);
  await noLock(ordinaryDir, original);
  await link(original, alias);
  const first = await lstat(original, { bigint: true });
  const second = await lstat(alias, { bigint: true });
  assert.equal(first.nlink, 2n);
  assert.equal(first.ino, second.ino);
  assert.equal(first.dev, second.dev);
  const before = await state(original);

  const refusals = [];
  for (const [name, file] of [['original', original], ['alias', alias]]) {
    const directory = join(data, 'refused-' + name);
    const observed = await run(envFor(directory, file));
    assert.equal(observed.code, 1);
    assert.equal(observed.stdout, '');
    assert.match(observed.stderr, /multiple hard links; use one ordinary SQLite file/);
    assert.ok(observed.stderr.includes(file), observed.stderr);
    const lines = observed.stderr.trimEnd().split(/\r?\n/);
    if (mode === 'baseline') assert.match(observed.stderr, /^\s+at /m);
    else {
      assert.equal(lines.length, 1);
      assert.doesNotMatch(lines[0], /[\p{Cc}\p{Zl}\p{Zp}]/u);
    }
    await noLock(directory, file);
    refusals.push({ name, lines: lines.length, ...observed });
  }

  const blocker = join(data, 'blocker');
  await writeFile(blocker, 'unexpected startup fixture');
  const unexpected = await run(envFor(join(blocker, 'nested'), original));
  assert.equal(unexpected.code, 1);
  assert.match(unexpected.stderr, /EEXIST|ENOTDIR/);
  assert.match(unexpected.stderr, /^\s+at /m);

  const managedPath = join(data, 'private-logs');
  await mkdir(managedPath);
  const sid = /"(S-1-[0-9-]+)"/.exec(nativeCommand('whoami.exe', ['/user', '/fo', 'csv', '/nh']))?.[1];
  assert.ok(sid);
  nativeCommand('icacls.exe', [
    managedPath, '/inheritance:r', '/grant:r', '*' + sid + ':(OI)(CI)F',
    '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F',
  ]);
  const managedDir = join(data, 'managed-data');
  const managed = await run({ ...envFor(managedDir, original), GG_WINDOWS_LAUNCHER_LOG_DIR: managedPath });
  assert.equal(managed.code, 74);
  assert.equal(managed.stdout, '');
  assert.equal(managed.stderr, '');
  const files = await readdir(managedPath);
  assert.deepEqual(files, ['gateway.log']);
  const records = (await readFile(join(managedPath, 'gateway.log'), 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(records.length, 1);
  assert.equal(records[0].stage, 'store');
  assert.equal(records[0].cause, 'store-unavailable');
  assert.doesNotMatch(JSON.stringify(records), /multiple hard links|store\.db/);
  await noLock(managedDir, original);

  const after = await state(original);
  assert.deepEqual(after, before);
  assert.deepEqual(await state(alias), before);
  await writeFile(join(evidence, mode.toUpperCase() + '-533-NATIVE.json'),
    JSON.stringify({ before, after, sameInode: true, linkCount: Number(first.nlink), ordinary,
      refusals, unexpected, managed: { ...managed, records }, locksClean: true }, null, 2) + '\n');
  console.log(JSON.stringify({mode, ordinaryExit: ordinary.code, refusalStderrLines: refusals.map(row => row.lines),
    unexpectedStack: true, managedExit: managed.code, managedCause: records[0].cause, bytesUnchanged: true,
    locksClean: true}));
} finally {
  await rm(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
