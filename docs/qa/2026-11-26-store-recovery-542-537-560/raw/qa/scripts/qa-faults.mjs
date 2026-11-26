// Independent QA (#542/#537/#560): controlled filesystem faults through the built API's public
// startup path (`node apps/api/dist/main.js`), disposable stores under G:/ggq/tmp/rq-542-qa only.
// Usage: node qa-faults.mjs <repo> <raw-output-dir> <runs-root> [case,case,...]
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [repoArg, rawArg, runsArg, onlyArg] = process.argv.slice(2);
const repo = resolve(repoArg);
const raw = resolve(rawArg);
const runs = resolve(runsArg);
const only = onlyArg ? new Set(onlyArg.split(',')) : undefined;
const entry = join(repo, 'apps/api/dist/main.js');
const preload = pathToFileURL(resolve('G:/ggq/tmp/rq-542-qa/scripts/fault-preload.mjs')).href;
const dist = (name) => pathToFileURL(join(repo, 'apps/api/dist', name + '.js')).href;
const identity = await import(dist('windows-process-identity'));
const locks = await import(dist('data-dir-lock'));
const sqlite = await import(pathToFileURL(join(repo, 'packages/infrastructure/dist/sqlite/index.js')).href);
await fs.mkdir(raw, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const runRoot = join(runs, 'faults-' + stamp);
await fs.mkdir(runRoot, { recursive: true });

const clean = Object.fromEntries(
  Object.entries(process.env).filter(([key]) =>
    /^(SystemRoot|Windir|ComSpec|Path|PathExt|UserProfile|AppData|LocalAppData|OS)$/i.test(key),
  ),
);
clean.TEMP = clean.TMP = 'G:\\ggq\\tmp\\rq-542-qa';
const envFor = (paths, extra = {}) => ({
  ...clean,
  GG_HOST: '127.0.0.1',
  GG_PORT: '0',
  GG_DB_URL: pathToFileURL(paths.db).href,
  GG_DATA_DIR: paths.dataDir,
  GG_MASTER_KEY: Buffer.alloc(32, 8).toString('base64'),
  GG_OLLAMA_ENABLED: 'false',
  GG_OLLAMA_URL: 'http://127.0.0.1:1',
  GG_CODEX_BINARY: join(paths.caseDir, 'absent-codex.exe'),
  GG_CLAUDE_BINARY: join(paths.caseDir, 'absent-claude.exe'),
  GG_WEB_DIST: '',
  GG_GOBLIN_DIST: '',
  GG_SWAGGER_UI: 'false',
  ...extra,
});

const nativeCommand = (exe, args) => {
  const path = join(clean.SystemRoot ?? clean.SYSTEMROOT ?? 'C:\\Windows', 'System32', exe);
  const out = spawnSync(path, args, { env: clean, encoding: 'utf8', timeout: 15000, windowsHide: true });
  if (out.error) throw out.error;
  if (out.status !== 0) throw new Error(exe + ' failed: ' + out.stderr + out.stdout);
  return out.stdout;
};
const sid = /"(S-1-[0-9-]+)"/.exec(nativeCommand('whoami.exe', ['/user', '/fo', 'csv', '/nh']))?.[1];

async function shutdown(base) {
  const response = await fetch(base + '/system/shutdown', { signal: AbortSignal.timeout(5000) });
  const { controlToken } = await response.json();
  const drained = await fetch(base + '/system/shutdown', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-graphgoblin-shutdown-token': controlToken },
    body: JSON.stringify({ action: 'drain' }),
    signal: AbortSignal.timeout(5000),
  });
  return { getStatus: response.status, postStatus: drained.status };
}

/** One public startup of the built API. Shuts a listening API down through its control route. */
async function run(paths, { fault, extraEnv = {}, label = 'run', beforeShutdown } = {}) {
  const faultLog = join(paths.caseDir, label + '.fault-log.json');
  const env = envFor(paths, {
    ...extraEnv,
    ...(fault ? { RQ_FAULT: JSON.stringify(fault), RQ_FAULT_LOG: faultLog } : {}),
  });
  const args = fault ? ['--import', preload, entry] : [entry];
  const child = spawn(process.execPath, args, { cwd: repo, env, windowsHide: true });
  let stdout = '';
  let stderr = '';
  let listening;
  const ready = new Promise((done) => {
    listening = done;
  });
  const exit = new Promise((done, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => done({ code, signal }));
  });
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
    const at = stdout.match(/Server listening at (http:\/\/127\.0\.0\.1:\d+)/);
    if (at) listening(at[1]);
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  const timer = setTimeout(() => child.kill(), 60000);
  let listened = false;
  let control;
  let killed = false;
  try {
    const first = await Promise.race([ready, exit]);
    if (typeof first === 'string') {
      listened = true;
      if (beforeShutdown) await beforeShutdown(first);
      control = await shutdown(first);
    }
    const result = await exit;
    return { ...result, listened, control, stdout, stderr, faultLog: await readJson(faultLog) };
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) {
      killed = true;
      child.kill();
      await exit;
    }
    if (killed) stderr += '\n[qa harness: child killed at timeout/cleanup]';
  }
}

const readJson = (file) => fs.readFile(file, 'utf8').then(JSON.parse, () => undefined);
const exists = (p) => fs.lstat(p).then(() => true, () => false);
async function tree(dir) {
  const out = [];
  async function walk(current) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      const rel = relative(dir, full);
      if (entry.isDirectory()) {
        out.push({ path: rel, type: 'dir' });
        await walk(full);
      } else {
        const info = await fs.lstat(full);
        const row = { path: rel, type: 'file', size: info.size };
        if (/lock$|\.json$/.test(entry.name) && info.size < 4096)
          row.text = await fs.readFile(full, 'utf8').catch((e) => '<unreadable ' + e.code + '>');
        out.push(row);
      }
    }
  }
  await walk(dir);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

async function casePaths(name, dirName = 'data') {
  const caseDir = join(runRoot, name);
  await fs.mkdir(caseDir, { recursive: true });
  await fs.mkdir(join(caseDir, dirName));
  const dataDir = realpathSync.native(join(caseDir, dirName));
  const lock = join(dataDir, 'graphgoblin.lock');
  const db = join(dataDir, 'store.db');
  const dbLock = db + '.graphgoblin.lock';
  return { caseDir, dataDir, db, lock, guard: lock + '.reclaim', dbLock, dbGuard: dbLock + '.reclaim' };
}

async function exitedPid() {
  const child = spawn(process.execPath, ['-e', ''], { windowsHide: true, stdio: 'ignore' });
  await new Promise((done) => child.once('close', done));
  try {
    process.kill(child.pid, 0);
    throw new Error('exited PID still alive');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
  return child.pid;
}

async function liveHelper() {
  const child = spawn(process.execPath, ['-e', 'process.stdin.resume()'], {
    stdio: ['pipe', 'ignore', 'ignore'],
    windowsHide: true,
  });
  await new Promise((done) => child.once('spawn', done));
  const found = await identity.windowsProcessIdentity(child.pid);
  if (!found.identity) throw new Error('helper identity unavailable: ' + found.reason);
  const closed = new Promise((done) => child.once('close', done));
  return {
    pid: child.pid,
    creationTime: found.identity,
    async stop() {
      child.stdin.end();
      const timer = setTimeout(() => child.kill(), 5000);
      await closed;
      clearTimeout(timer);
    },
  };
}

async function writeMarker(directory, owner) {
  const token = randomUUID();
  await fs.mkdir(directory, { recursive: true });
  const marker = join(directory, token + '.json');
  const record = JSON.stringify({ ...owner, token });
  await fs.writeFile(marker, record, { flag: 'wx' });
  return { token, name: token + '.json', marker, record };
}

async function managedLogDir(paths) {
  const dir = join(paths.caseDir, 'private-logs');
  await fs.mkdir(dir);
  nativeCommand('icacls.exe', [
    dir, '/inheritance:r', '/grant:r', '*' + sid + ':(OI)(CI)F', '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F',
  ]);
  return dir;
}

const escape = (text) =>
  text.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
const lines = (text) => text.replace(/\r?\n$/, '').split(/\r?\n/);
const lastLine = (text) => lines(text).at(-1);
const count = (events = [], event) => events.filter((e) => e === event).length;

const results = [];
async function scenario(name, meta, body) {
  if (only && !only.has(name)) return;
  const checks = [];
  const check = (what, ok, detail) => checks.push({ what, ok: Boolean(ok), ...(detail === undefined ? {} : { detail }) });
  const record = { name, ...meta, checks };
  const started = Date.now();
  try {
    await body(check, record);
  } catch (error) {
    checks.push({ what: 'scenario completed without harness error', ok: false, detail: String(error?.stack ?? error) });
  }
  record.ms = Date.now() - started;
  record.pass = checks.every((c) => c.ok);
  results.push(record);
  await fs.writeFile(join(raw, name + '.json'), JSON.stringify(record, null, 2) + '\n');
  console.log((record.pass ? 'PASS ' : 'FAIL ') + name + (record.pass ? '' : ' ' + JSON.stringify(checks.filter((c) => !c.ok))));
}
const keep = (record, label, result) => {
  record[label] = {
    code: result.code,
    signal: result.signal,
    listened: result.listened,
    control: result.control,
    stderr: result.stderr,
    stdoutLines: lines(result.stdout).length,
    stdoutTail: result.stdout.slice(-600),
    faultLog: result.faultLog?.events,
  };
};

// ---------------------------------------------------------------- #560 exclusive lock record
const recordCases = [
  ['A1-record-write', ['write'], null, false, ['main-write', 'main-stat', 'main-close', 'main-lookup', 'main-unlink']],
  ['A2-record-write-close', ['write', 'close'], 'cleanup also failed: main-record-close (EIO)', false, ['main-write', 'main-stat', 'main-close', 'main-lookup', 'main-unlink']],
  ['A2b-record-write-close-handle-open', ['write', 'close-open'], 'cleanup also failed: main-record-close (EIO)', false, ['main-write', 'main-stat', 'main-close', 'main-lookup', 'main-unlink']],
  ['A3-record-write-unlink', ['write', 'unlink'], 'cleanup also failed: main-record-unlink (EACCES); ownership retained: lock record {lock}', true, ['main-write', 'main-stat', 'main-close', 'main-lookup', 'main-unlink']],
  ['A4-record-write-identity', ['write', 'stat'], 'cleanup also failed: main-record-identity (EIO); ownership retained: lock record {lock}', true, ['main-write', 'main-stat', 'main-close']],
  ['A5-record-close-only', ['close'], null, false, ['main-write', 'main-close', 'main-lookup', 'main-unlink']],
  ['A6-record-close-unlink', ['close', 'unlink'], 'cleanup also failed: main-record-unlink (EACCES); ownership retained: lock record {lock}', true, ['main-write', 'main-close', 'main-lookup', 'main-unlink']],
  ['A6b-record-write-lookup', ['write', 'lookup'], 'cleanup also failed: main-record-lookup (EACCES); ownership retained: lock record {lock}', true, ['main-write', 'main-stat', 'main-close', 'main-lookup']],
];
for (const [name, faults, detail, retained, sequence] of recordCases) {
  const sep = name === 'A3-record-write-unlink' ? 'data\u2028line-separator' : 'data';
  await scenario(name, { issue: '#560', system: 'data-directory lock record via shell startup', faults }, async (check, record) => {
    const paths = await casePaths(name, sep);
    const result = await run(paths, { fault: { mainRecord: { lockPath: paths.lock, faults } } });
    keep(record, 'startup', result);
    const primaryText = faults[0] === 'write' ? 'rq fixture main record write refusal' : 'rq fixture main record close refusal';
    check('exit code 1, never listened', result.code === 1 && !result.listened, result.code);
    check('primary failure printed first', result.stderr.indexOf(primaryText) >= 0 && result.stderr.indexOf(primaryText) < 40, result.stderr.slice(0, 120));
    const events = (result.faultLog?.events ?? []).filter((e) => e.startsWith('main-'));
    check('exactly one close and the expected single-attempt sequence', JSON.stringify(events.filter((e) => e !== 'main-open')) === JSON.stringify(sequence), events);
    const secondaryTexts = ['rq fixture main record close refusal', 'rq fixture main record unlink refusal', 'rq fixture main record stat refusal', 'rq fixture main record lookup refusal'].filter((t) => t !== primaryText);
    check('no cleanup error message printed', secondaryTexts.every((t) => !result.stderr.includes(t)));
    if (detail) {
      const expected = detail.replace('{lock}', escape(paths.lock));
      check('last stderr line is the one escaped detail line', lastLine(result.stderr) === expected, { last: lastLine(result.stderr), expected });
      check('detail appears exactly once', result.stderr.split('cleanup also failed').length === 2);
      check('no raw control or line-separator characters in stderr', !/[\u2028\u2029\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(result.stderr));
    } else {
      check('no cleanup detail line (cleanup settled, primary thrown unchanged)', !result.stderr.includes('cleanup also failed') && !result.stderr.includes('ownership retained'));
    }
    const recordPresent = await exists(paths.lock);
    check(retained ? 'unproven record kept on disk' : 'own record removed', recordPresent === retained);
    if (retained) record.retainedRecord = await fs.readFile(paths.lock, 'utf8');
    if (retained && faults.includes('write')) check('kept record holds the partial bytes', record.retainedRecord === '{"pid":');
    if (retained && !faults.includes('write')) check('kept record is the complete own record', JSON.parse(record.retainedRecord).token !== undefined);
    check('recovery guard released', !(await exists(paths.guard)));
    check('no database lock or staging left', !(await exists(paths.dbLock)) && (await fs.readdir(paths.dataDir)).every((n) => !n.endsWith('.tmp')));
    record.filesAfter = await tree(paths.dataDir);
    if (retained) {
      // Consequence: the retained record blocks the next ordinary start (fail closed).
      const next = await run(paths, { label: 'next-ordinary-start' });
      keep(record, 'nextOrdinaryStart', next);
      if (faults.includes('write'))
        check('next ordinary start refuses on the retained partial record (fail closed, one line)', next.code === 1 && !next.listened && /^Store ownership could not be verified \(malformed or incomplete owner record\)/.test(next.stderr) && lines(next.stderr).length === 1, next.stderr.split('\n')[0]);
      else
        check('next ordinary start reclaims the retained complete record of the exited process', next.listened && next.code === 0 && !(await exists(paths.lock)), next.stderr.slice(0, 200));
    }
  });
}

await scenario('A7-record-write-guard-release', { issue: '#560', system: 'record cleanup plus recovery-guard release failure via shell startup' }, async (check, record) => {
  const paths = await casePaths('A7-record-write-guard-release');
  const result = await run(paths, { fault: { mainRecord: { lockPath: paths.lock, faults: ['write'] }, ownMarkerUnlink: { guard: paths.guard } } });
  keep(record, 'startup', result);
  check('exit 1', result.code === 1 && !result.listened);
  check('primary first', result.stderr.startsWith('Error: rq fixture main record write refusal'), result.stderr.slice(0, 80));
  check('detail: recovery-release behind record cleanup', lastLine(result.stderr) === 'cleanup also failed: recovery-release (EPERM)', lastLine(result.stderr));
  check('guard release error text not printed', !result.stderr.includes('rq fixture own marker unlink refusal') && !result.stderr.includes('recovery-marker-unlink failed'));
  check('own record removed after identity proof', !(await exists(paths.lock)));
  const guardEntries = await fs.readdir(paths.guard).catch(() => []);
  check('guard kept with its own marker', guardEntries.length === 1, guardEntries);
  record.filesAfter = await tree(paths.dataDir);
  const next = await run(paths, { label: 'next-ordinary-start' });
  keep(record, 'nextOrdinaryStart', next);
  check('next ordinary start reclaims the exited guard and shuts down cleanly', next.listened && next.code === 0, { code: next.code, stderr: next.stderr.slice(0, 200) });
  check('store clean after shutdown', !(await exists(paths.lock)) && !(await exists(paths.guard)) && !(await exists(paths.dbLock)) && !(await exists(paths.dbGuard)));
});

await scenario('A8-database-record-flattened-with-directory-lease', { issue: '#560', system: 'database lock record failure inside createContainer, flattened with directory lease release failure' }, async (check, record) => {
  const paths = await casePaths('A8-database-record-flattened-with-directory-lease');
  const result = await run(paths, { fault: { mainRecord: { lockPath: paths.dbLock, faults: ['write', 'unlink'] }, leaseRelease: [{ name: 'directory', lockPath: paths.lock }] } });
  keep(record, 'startup', result);
  const expected = `cleanup also failed: main-record-unlink (EACCES), directory-lease-release (EACCES); ownership retained: lock record ${paths.dbLock}, data-directory lease ${paths.dataDir}`;
  check('exit 1', result.code === 1 && !result.listened);
  check('primary first', result.stderr.startsWith('Error: rq fixture main record write refusal'), result.stderr.slice(0, 80));
  check('one flattened detail line in causal order', lastLine(result.stderr) === expected, { last: lastLine(result.stderr), expected });
  check('no secondary message text', !result.stderr.includes('rq fixture lease unlink refusal') && !result.stderr.includes('rq fixture main record unlink refusal'));
  check('database record kept (partial)', (await fs.readFile(paths.dbLock, 'utf8').catch(() => undefined)) === '{"pid":');
  check('directory lease kept (release failed)', await exists(paths.lock));
  check('database guard released', !(await exists(paths.dbGuard)));
  record.filesAfter = await tree(paths.dataDir);
});

// ---------------------------------------------------------------- #560 createContainer cleanup
const badKey = { GG_MASTER_KEY: Buffer.alloc(3, 1).toString('base64') };
const keyError = 'GG_MASTER_KEY must decode to exactly 32 bytes';
const containerCases = [
  ['B0-container-primary-only', () => ({}), null, { lock: false, dbLock: false }, true],
  ['B1-container-database-close', () => ({ sqlite: { databaseClose: 'fail' } }), 'cleanup also failed: database-close (EIO); ownership retained: database lease {db}, data-directory lease {dir}', { lock: true, dbLock: true }, false],
  ['B1b-container-database-close-left-open', () => ({ sqlite: { databaseClose: 'fail-open' } }), 'cleanup also failed: database-close (EIO); ownership retained: database lease {db}, data-directory lease {dir}', { lock: true, dbLock: true }, false],
  ['B4-container-database-lease-release', (p) => ({ leaseRelease: [{ name: 'database', lockPath: p.dbLock }] }), 'cleanup also failed: database-lease-release (EACCES); ownership retained: database lease {db}', { lock: false, dbLock: true }, true],
  ['B5-container-both-lease-releases', (p) => ({ leaseRelease: [{ name: 'database', lockPath: p.dbLock }, { name: 'directory', lockPath: p.lock }] }), 'cleanup also failed: database-lease-release (EACCES), directory-lease-release (EACCES); ownership retained: database lease {db}, data-directory lease {dir}', { lock: true, dbLock: true }, true],
];
for (const [name, faultTemplate, detail, kept, releaseExpected] of containerCases) {
  await scenario(name, { issue: '#560', system: 'createContainer setup cleanup via shell startup (primary: invalid GG_MASTER_KEY after SQLite opened)' }, async (check, record) => {
    const paths = await casePaths(name);
    const fill = (text) => text.replace('{db}', () => paths.db).replace('{dir}', () => paths.dataDir);
    const fault = faultTemplate(paths);
    const result = await run(paths, { fault, extraEnv: badKey });
    keep(record, 'startup', result);
    check('exit 1', result.code === 1 && !result.listened);
    check('primary failure printed first', result.stderr.startsWith('Error: ' + keyError), result.stderr.slice(0, 80));
    if (detail) check('last line is the one detail line', lastLine(result.stderr) === fill(detail), { last: lastLine(result.stderr), expected: fill(detail) });
    else check('primary thrown unchanged, no detail', !result.stderr.includes('cleanup also failed') && !result.stderr.includes('ownership retained'));
    check('no secondary message text', !/rq fixture (database close|lease unlink) refusal/.test(result.stderr));
    const events = result.faultLog?.events ?? [];
    check('database closed exactly once', count(events, 'database-close') === 1, events);
    const releaseUnlinks = events.filter((e) => e === 'unlink:graphgoblin.lock' || e === 'unlink:store.db.graphgoblin.lock');
    if (releaseExpected) check('database lease then directory lease each released once', JSON.stringify(releaseUnlinks) === JSON.stringify(['unlink:store.db.graphgoblin.lock', 'unlink:graphgoblin.lock']), releaseUnlinks);
    else check('no lease release attempted after an unconfirmed close', releaseUnlinks.length === 0, releaseUnlinks);
    check('directory lease record ' + (kept.lock ? 'kept' : 'removed'), (await exists(paths.lock)) === kept.lock);
    check('database lease record ' + (kept.dbLock ? 'kept' : 'removed'), (await exists(paths.dbLock)) === kept.dbLock);
    check('guards released', !(await exists(paths.guard)) && !(await exists(paths.dbGuard)));
    record.filesAfter = await tree(paths.dataDir);
  });
}

async function foreignStore(paths) {
  const handle = sqlite.openDatabase({ url: pathToFileURL(paths.db).href });
  await handle.client.execute('CREATE TABLE probe (marker TEXT NOT NULL)');
  handle.close();
}

await scenario('B2-readonly-close-behind-store-refusal', { issue: '#560', system: 'read-only SQLite close behind a store refusal via shell startup' }, async (check, record) => {
  const paths = await casePaths('B2-readonly-close-behind-store-refusal');
  await foreignStore(paths);
  const before = await fs.readFile(paths.db);
  const result = await run(paths, { fault: { sqlite: { readonlyClose: 'fail' } } });
  keep(record, 'startup', result);
  const expected = `cleanup also failed: readonly-database-close (EIO); ownership retained: database lease ${paths.db}, data-directory lease ${paths.dataDir}`;
  const out = lines(result.stderr);
  check('exit 1', result.code === 1 && !result.listened);
  check('store refusal explanation printed first as before (its usual lines), no stack', out[0].startsWith('GraphGoblin did not start: this build cannot open the store in data directory ') && out.length === 10 && !/^\s+at /m.test(result.stderr) && !out.slice(0, -1).some((l) => l.includes('rq fixture')), out);
  check('one detail line last', out.at(-1) === expected, { last: out.at(-1), expected });
  check('close error text not printed', !result.stderr.includes('rq fixture read-only database close refusal'));
  check('read-only client closed once', count(result.faultLog?.events, 'readonly-database-close') === 1);
  check('both leases kept after an unconfirmed read-only close', (await exists(paths.lock)) && (await exists(paths.dbLock)));
  check('database bytes unchanged', Buffer.compare(before, await fs.readFile(paths.db)) === 0);
  record.filesAfter = await tree(paths.dataDir);
});

await scenario('B2m-managed-store-refused', { issue: '#560', system: 'managed (Windows launcher log) classification of the tagged store-refusal primary' }, async (check, record) => {
  const paths = await casePaths('B2m-managed-store-refused');
  await foreignStore(paths);
  const logDir = await managedLogDir(paths);
  const result = await run(paths, { fault: { sqlite: { readonlyClose: 'fail' } }, extraEnv: { GG_WINDOWS_LAUNCHER_LOG_DIR: logDir } });
  keep(record, 'startup', result);
  const records = (await fs.readFile(join(logDir, 'gateway.log'), 'utf8')).trim().split(/\r?\n/).map((l) => JSON.parse(l));
  record.managedRecords = records;
  check('managed exit 74 (startup failure written), no shell output', result.code === 74 && result.stdout === '' && result.stderr === '', result.code);
  check('one record: stage store, cause store-refused', records.length === 1 && records[0].stage === 'store' && records[0].cause === 'store-refused', records);
  check('no paths or fixture text in the managed record', !/store\.db|rq fixture|graphgoblin\.lock/.test(JSON.stringify(records)));
  check('both leases kept', (await exists(paths.lock)) && (await exists(paths.dbLock)));
});

await scenario('B3-readonly-close-only', { issue: '#560', system: 'read-only SQLite close failure as its own primary via shell startup' }, async (check, record) => {
  const paths = await casePaths('B3-readonly-close-only');
  const created = await run(paths, { label: 'create-current-store' });
  keep(record, 'createStore', created);
  check('ordinary start created a current store and shut down cleanly', created.listened && created.code === 0, created.code);
  const result = await run(paths, { fault: { sqlite: { readonlyClose: 'fail' } } });
  keep(record, 'startup', result);
  const expected = `ownership retained: database lease ${paths.db}, data-directory lease ${paths.dataDir}`;
  check('exit 1', result.code === 1 && !result.listened);
  check('close failure is the primary, printed first', result.stderr.startsWith('Error: rq fixture read-only database close refusal'), result.stderr.slice(0, 80));
  check('detail names retained ownership only (no cleanup step)', lastLine(result.stderr) === expected, { last: lastLine(result.stderr), expected });
  check('no mutable open after the failed read-only close', count(result.faultLog?.events, 'database-close') === 0);
  check('both leases kept', (await exists(paths.lock)) && (await exists(paths.dbLock)));
  record.filesAfter = await tree(paths.dataDir);
});

await scenario('B1m-managed-unknown-primary', { issue: '#560', system: 'managed classification of an unknown (invalid key) primary with retained leases' }, async (check, record) => {
  const paths = await casePaths('B1m-managed-unknown-primary');
  const logDir = await managedLogDir(paths);
  const result = await run(paths, { fault: { sqlite: { databaseClose: 'fail' } }, extraEnv: { ...badKey, GG_WINDOWS_LAUNCHER_LOG_DIR: logDir } });
  keep(record, 'startup', result);
  const records = (await fs.readFile(join(logDir, 'gateway.log'), 'utf8')).trim().split(/\r?\n/).map((l) => JSON.parse(l));
  record.managedRecords = records;
  check('managed exit 74, no shell output', result.code === 74 && result.stderr === '', result.code);
  check('cause store-unavailable at stage store', records.length === 1 && records[0].stage === 'store' && records[0].cause === 'store-unavailable', records);
  check('no text leak', !/GG_MASTER_KEY|rq fixture|store\.db/.test(JSON.stringify(records)));
});

// ---------------------------------------------------------------- #537 marker reads
await scenario('C1-unreadable-stale-marker-native-acl', { issue: '#537', system: 'observed recovery marker read (native ACL denial) via shell startup and read-only status' }, async (check, record) => {
  const paths = await casePaths('C1-unreadable-stale-marker-native-acl');
  const dead = await exitedPid();
  const marker = await writeMarker(paths.guard, { pid: dead });
  nativeCommand('icacls.exe', [marker.marker, '/deny', '*' + sid + ':(RD)']);
  try {
    const result = await run(paths);
    keep(record, 'startup', result);
    check('exit 1', result.code === 1 && !result.listened);
    check('labelled observed-marker-read with vetted code and marker path', result.stderr.startsWith(`Error: Store ownership observed-marker-read failed (EPERM): ${marker.marker}`), result.stderr.slice(0, 200));
    check('error carries operation, code and marker token', result.stderr.includes("operation: 'observed-marker-read'") && result.stderr.includes(`markerToken: '${marker.token}'`) && result.stderr.includes("code: 'EPERM'"));
    check('original error kept as cause', /\[cause\]: Error: EPERM/.test(result.stderr));
    let status;
    try {
      status = { value: await locks.dataDirLockState(paths.dataDir) };
    } catch (error) {
      status = { error: { message: error.message, code: error.code, operation: error.operation, markerToken: error.markerToken, causeCode: error.cause?.code } };
    }
    record.readOnlyStatus = status;
    check('read-only status fails with the same label', status.error?.operation === 'observed-marker-read' && status.error.markerToken === marker.token && status.error.causeCode === 'EPERM', status);
  } finally {
    nativeCommand('icacls.exe', [marker.marker, '/remove:d', '*' + sid]);
  }
  check('marker bytes untouched', (await fs.readFile(marker.marker, 'utf8')) === marker.record);
  check('no main lock or staging created', !(await exists(paths.lock)) && (await fs.readdir(paths.dataDir)).every((n) => !n.endsWith('.tmp')));
  record.filesAfter = await tree(paths.dataDir);
});

await scenario('C2-own-marker-read-on-release', { issue: '#537', system: 'own recovery marker read during release (controlled) via shell startup' }, async (check, record) => {
  const paths = await casePaths('C2-own-marker-read-on-release');
  const result = await run(paths, { fault: { ownMarkerRead: { guard: paths.guard, lockPath: paths.lock } } });
  keep(record, 'startup', result);
  check('exit 1', result.code === 1 && !result.listened);
  check('rollback reported first', result.stderr.startsWith(`Error: Store acquisition rolled back because reclamation cleanup failed: ${paths.lock}`), result.stderr.slice(0, 160));
  check('cause labelled recovery-marker-read with code and token', /\[cause\]: Error: Store ownership recovery-marker-read failed \(EACCES\)/.test(result.stderr) && result.stderr.includes("operation: 'recovery-marker-read'") && /markerToken: '[0-9a-f-]{36}'/.test(result.stderr));
  check('main lock rolled back', !(await exists(paths.lock)));
  const guardEntries = await fs.readdir(paths.guard).catch(() => []);
  check('own guard and marker kept (release failed)', guardEntries.length === 1);
  record.filesAfter = await tree(paths.dataDir);
});

// ---------------------------------------------------------------- #542 / #537 guard removal EPERM
async function ownRelease(name, meta, { successor, mismatch = false, schedule = 'successor', lookupFault = false }, assertions) {
  await scenario(name, meta, async (check, record) => {
    const paths = await casePaths(name);
    let helper;
    let staged;
    try {
      const fault = { guardRmdir: { guard: paths.guard, lockPath: paths.lock, when: 'release', schedule, lookupFault } };
      if (successor) {
        helper = await liveHelper();
        const creation = mismatch ? String(BigInt(helper.creationTime) + 1n) : helper.creationTime;
        staged = await writeMarker(join(paths.dataDir, 'successor-staging'), { pid: helper.pid, windowsCreationTime: creation });
        fault.guardRmdir.successorStaging = join(paths.dataDir, 'successor-staging');
        record.successor = { pid: helper.pid, creationTime: helper.creationTime, recorded: creation, token: staged.token };
      }
      let midRun;
      const result = await run(paths, {
        fault,
        beforeShutdown: async () => {
          midRun = { mainLock: await fs.readFile(paths.lock, 'utf8').catch(() => undefined), guard: await fs.readdir(paths.guard).catch(() => undefined) };
        },
      });
      keep(record, 'startup', result);
      record.whileListening = midRun;
      await assertions(check, record, { paths, result, staged, helper, midRun });
      record.filesAfter = await tree(paths.dataDir);
    } finally {
      await helper?.stop();
    }
  });
}
const guardRmdirs = (events = []) => events.filter((e) => e === 'rmdir:graphgoblin.lock.reclaim').length;
const successorIntact = async (paths, staged) =>
  (await fs.readFile(join(paths.guard, staged.name), 'utf8').catch(() => undefined)) === staged.record &&
  JSON.stringify(await fs.readdir(paths.guard)) === JSON.stringify([staged.name]);

await ownRelease('D1-own-release-verified-successor', { issue: '#542', system: 'own guard release EPERM with a verified live successor (native creation identity) via shell startup' }, { successor: true }, async (check, record, { paths, result, staged, midRun }) => {
  check('startup completed and listened (main lock kept, no rollback)', result.listened, result.stderr.slice(0, 300));
  check('clean shutdown exit 0', result.code === 0, result.code);
  check('while listening the main record was this API process', midRun?.mainLock && JSON.parse(midRun.mainLock).token !== undefined);
  check('while listening the guard held only the successor marker', JSON.stringify(midRun?.guard) === JSON.stringify([staged.name]), midRun?.guard);
  check('exactly one rmdir of the guard (single attempt, never repeated)', guardRmdirs(result.faultLog?.events) === 1 && count(result.faultLog?.events, 'guard-rmdir-fault:successor') === 1, result.faultLog?.events);
  check('successor marker never unlinked', !(result.faultLog?.events ?? []).includes('unlink:' + staged.name));
  check('successor guard and marker bytes intact after shutdown', await successorIntact(paths, staged));
  check('main lock released at shutdown', !(await exists(paths.lock)));
  check('database lock and guard released', !(await exists(paths.dbLock)) && !(await exists(paths.dbGuard)));
  check('no stderr output', result.stderr.trim() === '', result.stderr.slice(0, 300));
});

await ownRelease('D2-own-release-unchanged-guard', { issue: '#542', system: 'own guard release EPERM with the unchanged own guard present' }, { successor: false, schedule: 'same' }, async (check, record, { paths, result }) => {
  check('exit 1, no listen', result.code === 1 && !result.listened);
  check('rollback reported with recovery-directory-remove EPERM cause', result.stderr.startsWith(`Error: Store acquisition rolled back because reclamation cleanup failed: ${paths.lock}`) && /\[cause\]: Error: Store ownership recovery-directory-remove failed \(EPERM\)/.test(result.stderr), result.stderr.slice(0, 200));
  check('no probe failures (identity decision only)', !result.stderr.includes('probeFailures'));
  check('one rmdir attempt', guardRmdirs(result.faultLog?.events) === 1);
  check('main lock rolled back', !(await exists(paths.lock)));
  check('own emptied guard left in place', (await exists(paths.guard)) && (await fs.readdir(paths.guard)).length === 0);
  const next = await run(paths, { label: 'next-ordinary-start' });
  keep(record, 'nextOrdinaryStart', next);
  check('next ordinary start reclaims the empty guard and shuts down cleanly', next.listened && next.code === 0, next.stderr.slice(0, 200));
});

await ownRelease('D3-own-release-identity-mismatch', { issue: '#542', system: 'own guard release EPERM with a live successor whose recorded creation identity mismatches' }, { successor: true, mismatch: true }, async (check, record, { paths, result, staged }) => {
  check('exit 1, rolled back', result.code === 1 && !result.listened && result.stderr.startsWith('Error: Store acquisition rolled back'), result.stderr.slice(0, 160));
  check('original EPERM kept, mismatch is a decision (no probeFailures)', /\[cause\]: Error: Store ownership recovery-directory-remove failed \(EPERM\)/.test(result.stderr) && !result.stderr.includes('probeFailures'));
  check('one rmdir attempt', guardRmdirs(result.faultLog?.events) === 1);
  check('successor intact', await successorIntact(paths, staged));
  check('main lock rolled back', !(await exists(paths.lock)));
});

await ownRelease('D3b-own-release-lookup-failure', { issue: '#537', system: 'own guard release EPERM whose post-denial guard lookup fails' }, { successor: false, schedule: 'same', lookupFault: true }, async (check, record, { paths, result }) => {
  check('exit 1, rolled back', result.code === 1 && result.stderr.startsWith('Error: Store acquisition rolled back'), result.stderr.slice(0, 160));
  check('probe failure attached with closed label and vetted code', /probeFailures: \[ \{ operation: 'recovery-directory-lookup', code: 'EACCES' \} \]/.test(result.stderr), result.stderr);
  check('probe text not printed', !result.stderr.includes('rq fixture guard lookup refusal'));
  check('outer EPERM cause kept', /\[cause\]: Error: rq fixture guard removal refusal/.test(result.stderr) && result.stderr.includes("operation: 'recovery-directory-remove'"));
  check('one rmdir attempt', guardRmdirs(result.faultLog?.events) === 1);
});

async function acquisitionSuccessor(name, meta, { managed = false, lookupFault = false, schedule = 'successor' }, assertions) {
  await scenario(name, meta, async (check, record) => {
    const paths = await casePaths(name);
    let helper;
    try {
      const dead = await exitedPid();
      const stale = await writeMarker(paths.guard, { pid: dead });
      const fault = { guardRmdir: { guard: paths.guard, when: 'acquire', schedule, lookupFault } };
      let staged;
      if (schedule === 'successor') {
        helper = await liveHelper();
        staged = await writeMarker(join(paths.dataDir, 'successor-staging'), { pid: helper.pid, windowsCreationTime: helper.creationTime });
        fault.guardRmdir.successorStaging = join(paths.dataDir, 'successor-staging');
      }
      const logDir = managed ? await managedLogDir(paths) : undefined;
      const result = await run(paths, { fault, ...(managed ? { extraEnv: { GG_WINDOWS_LAUNCHER_LOG_DIR: logDir } } : {}) });
      keep(record, 'startup', result);
      if (managed) record.managedRecords = (await fs.readFile(join(logDir, 'gateway.log'), 'utf8')).trim().split(/\r?\n/).map((l) => JSON.parse(l));
      check('stale marker removed', !(await exists(stale.marker)));
      await assertions(check, record, { paths, result, staged });
      record.filesAfter = await tree(paths.dataDir);
    } finally {
      await helper?.stop();
    }
  });
}

await acquisitionSuccessor('D4-acquisition-verified-successor', { issue: '#542 / FUP091', system: 'acquisition-side guard EPERM with a verified live successor (unchanged held(path))' }, {}, async (check, record, { paths, result, staged }) => {
  const expected = `another GraphGoblin process holds ${paths.guard}; check its port/configuration; wait for the owning process to finish or stop it before retrying`;
  check('exit 1', result.code === 1 && !result.listened);
  check('exactly the ordinary one-line held(path) refusal', result.stderr.replace(/\r?\n$/, '') === expected, result.stderr);
  check('one rmdir attempt', guardRmdirs(result.faultLog?.events) === 1);
  check('successor intact', await successorIntact(paths, staged));
  check('no main lock created', !(await exists(paths.lock)));
});

await acquisitionSuccessor('D4m-managed-store-held', { issue: '#542 / FUP091', system: 'managed classification of the verified acquisition successor' }, { managed: true }, async (check, record, { paths, result, staged }) => {
  check('managed exit 74, silent shell', result.code === 74 && result.stderr === '' && result.stdout === '', result.code);
  check('cause store-held at stage store', record.managedRecords.length === 1 && record.managedRecords[0].cause === 'store-held' && record.managedRecords[0].stage === 'store', record.managedRecords);
  check('successor intact', await successorIntact(paths, staged));
});

await acquisitionSuccessor('D5-acquisition-persistent-lookup-failure', { issue: '#537', system: 'acquisition-side guard EPERM, guard unchanged, post-denial lookup fails' }, { schedule: 'same', lookupFault: true }, async (check, record, { paths, result }) => {
  check('exit 1', result.code === 1 && !result.listened);
  check('labelled recovery-directory-remove EPERM first', result.stderr.startsWith(`Error: Store ownership recovery-directory-remove failed (EPERM): ${paths.guard}`), result.stderr.slice(0, 160));
  check('probe failure label and code attached', /probeFailures: \[ \{ operation: 'recovery-directory-lookup', code: 'EACCES' \} \]/.test(result.stderr), result.stderr);
  check('probe text not printed', !result.stderr.includes('rq fixture guard lookup refusal'));
  check('original EPERM cause kept', /\[cause\]: Error: rq fixture guard removal refusal/.test(result.stderr));
  check('one rmdir attempt', guardRmdirs(result.faultLog?.events) === 1);
  check('emptied guard left, nothing else', (await exists(paths.guard)) && (await fs.readdir(paths.guard)).length === 0 && !(await exists(paths.lock)));
});

// ---------------------------------------------------------------- module-level attestation (not reachable on Windows shell startup)
await scenario('A9-attestation-failure-module-level', { issue: '#560', system: 'attested acquisition (Mac-only startup path) exercised through the exported lock API with the same fixture' }, async (check, record) => {
  const paths = await casePaths('A9-attestation-failure-module-level');
  const script = join(paths.caseDir, 'attest.mjs');
  await fs.writeFile(script, `
    const locks = await import(${JSON.stringify(dist('data-dir-lock'))});
    const out = {};
    try { await locks.acquireDataDirLock(${JSON.stringify(paths.dataDir)}, undefined, { attestLocalArtifact: true }); out.acquired = true; }
    catch (e) { out.error = { name: e.name, message: e.message, code: e.code, isTagged: e.constructor?.name }; }
    console.log(JSON.stringify(out));
  `);
  const faultLog = join(paths.caseDir, 'attest.fault-log.json');
  const out = spawnSync(process.execPath, ['--import', preload, script], {
    env: { ...clean, RQ_FAULT: JSON.stringify({ mainRecord: { lockPath: paths.lock, faults: ['stat'] } }), RQ_FAULT_LOG: faultLog },
    encoding: 'utf8', timeout: 60000, windowsHide: true,
  });
  record.stdout = out.stdout;
  record.stderr = out.stderr;
  const parsed = JSON.parse(out.stdout.trim().split('\n').at(-1));
  const events = (await readJson(faultLog))?.events.filter((e) => e.startsWith('main-') && e !== 'main-open');
  record.faultLog = events;
  check('attestation failure thrown unchanged (cleanup settled)', parsed.error?.message === 'rq fixture main record stat refusal' && parsed.error.code === 'EIO', parsed);
  check('complete record proven by exact bytes and removed once after one close', JSON.stringify(events) === JSON.stringify(['main-write', 'main-stat', 'main-close', 'main-lookup', 'main-unlink']), events);
  check('store clean', (await fs.readdir(paths.dataDir)).length === 0);
});

const summary = { node: process.version, venue: process.platform, repo, entry, runRoot, cases: results.map(({ name, issue, pass, checks }) => ({ name, issue, pass, failed: checks.filter((c) => !c.ok).map((c) => c.what) })) };
await fs.writeFile(join(raw, 'faults-summary-' + stamp + '.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ total: results.length, passed: results.filter((r) => r.pass).length }));
