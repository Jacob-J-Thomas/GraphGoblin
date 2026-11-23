// Independent behavior QA #448 native fixture driver (Claude Opus 5.5, separate from author/reviewer).
// Drives the BUILT candidate: `node apps/api/dist/main.js --preflight` (offline CLI) and ordinary
// `node apps/api/dist/main.js` startup, plus public built-module methods. Every store is a private
// synthetic scratch copy; children get a scratch-only environment (USERPROFILE/HOME/APPDATA/TEMP),
// fake local Codex/Claude probe CLIs and a fake local Ollama recorder. No owner store, owner port,
// owner credentials, provider or model turn is used.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const REPO = 'G:\\ggq\\gg-i4-448-qa\\GraphGoblin';
const Q = 'C:\\Users\\98jak\\graphgoblin-qa\\2026-11-17-five-intents\\i4-448-independent-01';
const RUN_LABEL = process.argv[2] ?? 'run-01';
const OBS = join(Q, 'observations', RUN_LABEL);
const RAW = join(OBS, 'raw');
const API_MAIN = join(REPO, 'apps', 'api', 'dist', 'main.js');
const OWNER_PORTS = new Set([4747, 4748, 11434]);
const SYSROOT = process.env.SystemRoot ?? 'C:\\Windows';
const STAMP = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '');
const ROOT = join(tmpdir(), `gg-448-qa-indep-${STAMP}`);
const NONCE = createHash('sha256').update(ROOT + process.pid + Date.now()).digest('hex').slice(0, 16);
// Private synthetic 32-byte key; not a secret, never an owner key.
const SYNTH_KEY = Buffer.alloc(32, 0x48).toString('base64');

if (existsSync(OBS)) throw new Error(`observation folder already exists: ${OBS}`);
mkdirSync(RAW, { recursive: true });
if (existsSync(ROOT)) throw new Error(`scratch root exists: ${ROOT}`);
mkdirSync(ROOT, { recursive: true });
writeFileSync(join(ROOT, '.qa448-owned'), `${NONCE}\n`);

const mod = (path) => import(pathToFileURL(join(REPO, path)).href);
const infra = await mod('packages/infrastructure/dist/sqlite/index.js');
const domain = await mod('packages/domain/dist/index.js');
const apiPreflight = await mod('apps/api/dist/preflight.js');
const apiConfig = await mod('apps/api/dist/config.js');

const sha = (data) => createHash('sha256').update(data).digest('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const transcript = [];
function log(...parts) {
  const line = `[${new Date().toISOString()}] ${parts.join(' ')}`;
  transcript.push(line);
  console.log(line);
}

// ------------------------------------------------------------------ fixtures: fake CLIs + Ollama
const BIN = join(ROOT, 'bin');
mkdirSync(BIN);
const FAKE_CLAUDE = join(BIN, 'claude.exe');
const FAKE_CODEX = join(BIN, 'codex-fake.mjs');
const FAKE_LOG = join(BIN, 'invocations.jsonl');
const compile = spawnSync(
  join(SYSROOT, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
  [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    `Add-Type -Path '${join(Q, 'driver', 'qa448-fake-claude.cs')}' -OutputAssembly '${FAKE_CLAUDE}' -OutputType ConsoleApplication`,
  ],
  { encoding: 'utf8', windowsHide: true, timeout: 120_000 },
);
if (compile.status !== 0 || !existsSync(FAKE_CLAUDE))
  throw new Error(`fake claude compile failed: ${compile.status} ${compile.stderr}`);
copyFileSync(join(Q, 'driver', 'qa448-fake-codex.mjs'), FAKE_CODEX);
const selfTest = {
  claudeVersion: spawnSync(FAKE_CLAUDE, ['--version'], { encoding: 'utf8', windowsHide: true }),
  claudeTurn: spawnSync(FAKE_CLAUDE, ['--print', 'hello'], { encoding: 'utf8', windowsHide: true }),
  codexVersion: spawnSync(process.execPath, [FAKE_CODEX, '--version'], { encoding: 'utf8', windowsHide: true }),
  codexTurn: spawnSync(process.execPath, [FAKE_CODEX, 'exec', '--json', 'hi'], { encoding: 'utf8', windowsHide: true }),
};
const fakeSelfTest = Object.fromEntries(
  Object.entries(selfTest).map(([k, r]) => [k, { status: r.status, stdout: r.stdout.trim(), stderr: r.stderr.trim() }]),
);
if (existsSync(FAKE_LOG)) {
  copyFileSync(FAKE_LOG, join(RAW, 'fake-cli-selftest.jsonl'));
  unlinkSync(FAKE_LOG);
}
log('fake CLI self-test', JSON.stringify(fakeSelfTest));
const fakeHashes = {
  'claude.exe': sha(readFileSync(FAKE_CLAUDE)),
  'codex-fake.mjs': sha(readFileSync(FAKE_CODEX)),
};

const ollamaRequests = [];
const ollama = http.createServer((req, res) => {
  ollamaRequests.push({ method: req.method, url: req.url, utc: new Date().toISOString() });
  if (req.method === 'GET' && req.url === '/api/tags') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"models":[]}');
    return;
  }
  if (req.method === 'GET' && req.url === '/api/version') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"version":"0.0.0-qa448"}');
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end('{}');
});
await new Promise((resolve) => ollama.listen(0, '127.0.0.1', resolve));
const OLLAMA_PORT = ollama.address().port;
if (OWNER_PORTS.has(OLLAMA_PORT)) throw new Error('recorder got an owner port');
const OLLAMA_URL = `http://127.0.0.1:${OLLAMA_PORT}`;
log('fake Ollama recorder', OLLAMA_URL);

async function freePort() {
  for (;;) {
    const port = await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address();
        server.close(() => resolve(port));
      });
    });
    if (!OWNER_PORTS.has(port)) return port;
  }
}

// ------------------------------------------------------------------ measurement
const HOME = join(ROOT, 'home');
for (const d of [HOME, join(HOME, 'AppData', 'Roaming'), join(HOME, 'AppData', 'Local'), join(ROOT, 'tmp')])
  mkdirSync(d, { recursive: true });

function childEnv(extra) {
  return {
    // Built from nothing: no owner variables are inherited.
    SystemRoot: SYSROOT,
    windir: SYSROOT,
    SystemDrive: SYSROOT.slice(0, 2),
    ComSpec: join(SYSROOT, 'System32', 'cmd.exe'),
    PATHEXT: '.COM;.EXE;.BAT;.CMD',
    PATH: [
      dirname(process.execPath),
      join(SYSROOT, 'System32'),
      SYSROOT,
      join(SYSROOT, 'System32', 'Wbem'),
      join(SYSROOT, 'System32', 'WindowsPowerShell', 'v1.0'),
    ].join(';'),
    TEMP: join(ROOT, 'tmp'),
    TMP: join(ROOT, 'tmp'),
    USERPROFILE: HOME,
    HOME,
    APPDATA: join(HOME, 'AppData', 'Roaming'),
    LOCALAPPDATA: join(HOME, 'AppData', 'Local'),
    GG_HOST: '127.0.0.1',
    GG_LOG_LEVEL: 'info',
    GG_SWAGGER_UI: 'false',
    GG_WEB_DIST: '',
    GG_GOBLIN_DIST: '',
    GG_OLLAMA_ENABLED: 'true',
    GG_OLLAMA_URL: OLLAMA_URL,
    GG_CODEX_BINARY: FAKE_CODEX,
    GG_CLAUDE_BINARY: FAKE_CLAUDE,
    GG_MASTER_KEY: SYNTH_KEY,
    ...extra,
  };
}
function publicEnv(env) {
  return Object.fromEntries(
    Object.entries(env)
      .filter(([k]) => k.startsWith('GG_') || ['USERPROFILE', 'HOME', 'TEMP', 'APPDATA', 'LOCALAPPDATA'].includes(k))
      .map(([k, v]) => [k, k === 'GG_MASTER_KEY' ? 'synthetic-32-bytes-0x48' : v]),
  );
}

function fileFacts(dbFile) {
  const out = {};
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    const path = dbFile + suffix;
    if (!existsSync(path)) out[suffix || 'db'] = null;
    else {
      const bytes = readFileSync(path);
      out[suffix || 'db'] = { size: bytes.length, sha256: sha(bytes) };
    }
  }
  return out;
}
function listing(dir) {
  if (!existsSync(dir)) return null;
  const out = [];
  const walk = (d, depth) => {
    for (const name of readdirSync(d).sort()) {
      const path = join(d, name);
      const s = statSync(path);
      const rel = relative(dir, path).replaceAll('\\', '/');
      out.push(s.isDirectory() ? `${rel}/` : `${rel} (${s.size})`);
      if (s.isDirectory() && depth < 4) walk(path, depth + 1);
    }
  };
  walk(dir, 0);
  return out;
}
const names = (list) => (list ?? []).map((entry) => entry.replace(/ \(\d+\)$/, ''));

let measureSeq = 0;
function normalizeValue(value) {
  if (value instanceof Uint8Array) return { hex: Buffer.from(value).toString('hex') };
  if (typeof value === 'bigint') return value.toString();
  return value;
}
/** Logical view through an independent native SQLite (node:sqlite) on a private copy, never the subject. */
function logical(dbFile, { withWal = true } = {}) {
  if (!existsSync(dbFile)) return { exists: false };
  const dir = join(ROOT, 'measure', String(++measureSeq).padStart(4, '0'));
  mkdirSync(dir, { recursive: true });
  const copy = join(dir, 'm.db');
  copyFileSync(dbFile, copy);
  if (withWal && existsSync(`${dbFile}-wal`)) copyFileSync(`${dbFile}-wal`, `${copy}-wal`);
  let db;
  try {
    db = new DatabaseSync(copy);
    const master = db
      .prepare('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name')
      .all()
      .map((r) => ({ ...r }));
    const tables = master.filter((r) => r.type === 'table').map((r) => r.name);
    const perTable = {};
    for (const table of tables) {
      const rows = db
        .prepare(`SELECT * FROM "${table.replaceAll('"', '""')}"`)
        .all()
        .map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, normalizeValue(v)])));
      const lines = rows.map((row) => JSON.stringify(row)).sort();
      perTable[table] = { count: rows.length, sha256: sha(lines.join('\n')) };
    }
    const has = (t) => tables.includes(t);
    const catalog = has('model_catalog')
      ? db
          .prepare(
            'SELECT harness, model, source, display_name, efforts, default_effort, enabled FROM model_catalog ORDER BY harness, model',
          )
          .all()
          .map((r) => ({ ...r }))
      : null;
    const migrations = has('__drizzle_migrations')
      ? { ...db.prepare('SELECT COUNT(*) AS count, MAX(created_at) AS maxCreatedAt FROM __drizzle_migrations').get() }
      : null;
    const marker = has('gg_upgrade_state')
      ? db.prepare('SELECT * FROM gg_upgrade_state').all().map((r) => ({ ...r }))
      : null;
    const pragma = (name) => Object.values(db.prepare(`PRAGMA ${name}`).get() ?? {})[0];
    const schemaHash = sha(JSON.stringify(master));
    const dataHash = sha(JSON.stringify(perTable));
    return {
      exists: true,
      withWal,
      schemaHash,
      dataHash,
      logicalHash: sha(schemaHash + dataHash),
      tableCount: tables.length,
      perTable,
      catalog,
      catalogCount: catalog?.length ?? null,
      catalogHash: catalog ? sha(JSON.stringify(catalog)) : null,
      migrations,
      marker,
      pragmas: {
        user_version: pragma('user_version'),
        schema_version: pragma('schema_version'),
        page_count: pragma('page_count'),
        journal_mode: pragma('journal_mode'),
      },
    };
  } catch (error) {
    return { exists: true, withWal, error: String(error) };
  } finally {
    db?.close();
  }
}
function storeState(dbFile, dirs = {}) {
  return {
    files: fileFacts(dbFile),
    logical: logical(dbFile),
    ...(existsSync(`${dbFile}-wal`) ? { baseOnly: logical(dbFile, { withWal: false }) } : {}),
    listings: Object.fromEntries(Object.entries(dirs).map(([k, d]) => [k, listing(d)])),
  };
}
const catalogRow = (state, harness, model) =>
  state.logical?.catalog?.find((r) => r.harness === harness && r.model === model) ?? null;

// ------------------------------------------------------------------ cases and checks
const results = [];
function newCase(id, kind, purpose, extra = {}) {
  const c = { id, kind, purpose, ...extra, checks: [], startedUtc: new Date().toISOString() };
  results.push(c);
  log('CASE', id, '-', purpose);
  return c;
}
function canon(value) {
  if (Array.isArray(value)) return value.map(canon);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canon(value[k])]));
  return value === undefined ? null : value;
}
function check(c, name, expected, actual, pass = JSON.stringify(canon(expected)) === JSON.stringify(canon(actual))) {
  c.checks.push({ name, expected, actual, pass: Boolean(pass) });
  if (!pass) log('  CHECK FAIL', c.id, name, 'expected', JSON.stringify(expected), 'actual', JSON.stringify(actual));
}
function finish(c) {
  c.pass = c.checks.length > 0 && c.checks.every((k) => k.pass);
  c.finishedUtc = new Date().toISOString();
  writeFileSync(join(OBS, `${c.id}.json`), JSON.stringify(c, null, 2) + '\n');
  log('  RESULT', c.id, c.pass ? 'PASS' : 'FAIL', `(${c.checks.filter((k) => k.pass).length}/${c.checks.length})`);
}
function fakeLines() {
  if (!existsSync(FAKE_LOG)) return [];
  return readFileSync(FAKE_LOG, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

// ------------------------------------------------------------------ owned child processes
const owned = [];
function launch(name, argv, env, cwd) {
  const child = spawn(process.execPath, [API_MAIN, ...argv], {
    cwd,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const p = { name, argv, pid: child.pid, child, stdout: '', stderr: '', startedAt: Date.now() };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (d) => (p.stdout += d));
  child.stderr.on('data', (d) => (p.stderr += d));
  child.on('error', (error) => (p.spawnError = String(error)));
  p.closed = new Promise((resolve) =>
    child.on('close', (code, signal) => {
      p.exit = { code, signal };
      p.endedAt = Date.now();
      resolve(p.exit);
    }),
  );
  owned.push(p);
  return p;
}
async function waitClosed(p, ms) {
  const outcome = await Promise.race([p.closed.then(() => 'closed'), sleep(ms).then(() => 'timeout')]);
  if (outcome === 'timeout') {
    p.timedOut = true;
    log('  TIMEOUT: terminating owned pid', p.pid, p.name);
    p.child.kill();
    await Promise.race([p.closed, sleep(15_000)]);
  }
  return p.exit;
}
function saveRaw(c, p) {
  writeFileSync(join(RAW, `${c.id}.stdout.txt`), p.stdout);
  writeFileSync(join(RAW, `${c.id}.stderr.txt`), p.stderr);
  c.raw = { stdout: `raw/${c.id}.stdout.txt`, stderr: `raw/${c.id}.stderr.txt`, class: 'private-synthetic-raw' };
}

function parsePreflight(text) {
  const lines = text.split(/\r?\n/);
  const header = lines.findIndex((l) => /^\s+STATUS\s+CHECK\s+DETAIL/.test(l));
  if (header < 0) return { rows: [], summary: lines.find((l) => /failed,/.test(l)) ?? null };
  const h = lines[header];
  const ci = h.indexOf('CHECK');
  const di = h.indexOf('DETAIL');
  const rows = [];
  for (const line of lines.slice(header + 1)) {
    if (!line.trim()) break;
    rows.push({ status: line.slice(2, ci).trim(), label: line.slice(ci, di).trim(), detail: line.slice(di).trim() });
  }
  return { rows, summary: lines.find((l) => /failed, \d+ warning/.test(l)) ?? null };
}

// ------------------------------------------------------------------ CLI preflight case
async function preflightCase(id, purpose, { dbFile, dataDir, dbUrl, defaults, expectExit, expectRows, watchDirs, variant, expectAbsent = [] }) {
  const c = newCase(id, 'built-cli-preflight', purpose, { variant, defaults });
  const caseDir = join(ROOT, 'cases', id);
  mkdirSync(caseDir, { recursive: true });
  const env = childEnv({
    GG_DATA_DIR: dataDir,
    ...(dbUrl ? { GG_DB_URL: dbUrl } : {}),
    GG_DEFAULTS: JSON.stringify(defaults),
    GG_PORT: String(await freePort()),
  });
  c.env = publicEnv(env);
  const dirs = { caseDir, ...(watchDirs ?? {}) };
  c.before = storeState(dbFile, dirs);
  const fakeBefore = fakeLines().length;
  const ollamaBefore = ollamaRequests.length;
  const p = launch(id, ['--preflight'], env, caseDir);
  c.pid = p.pid;
  await waitClosed(p, 120_000);
  c.exit = p.exit;
  c.timedOut = Boolean(p.timedOut);
  c.durationMs = (p.endedAt ?? Date.now()) - p.startedAt;
  saveRaw(c, p);
  c.after = storeState(dbFile, dirs);
  c.fakeInvocations = fakeLines().slice(fakeBefore);
  c.ollamaRequests = ollamaRequests.slice(ollamaBefore);
  const parsed = parsePreflight(p.stdout);
  c.report = parsed;
  check(c, 'not timed out', false, c.timedOut);
  check(c, 'exit code', expectExit, p.exit?.code);
  for (const [label, status, detail] of expectRows) {
    const row = parsed.rows.find((r) => r.label === label);
    check(
      c,
      `row "${label}" ${status}${detail ? ' ' + detail : ''}`,
      { status, detail: detail ? String(detail) : '(any)' },
      { status: row?.status ?? null, detail: row ? (detail ? (detail.test(row.detail) ? String(detail) : row.detail) : '(any)') : null },
    );
  }
  const b = c.before.files;
  const a = c.after.files;
  check(c, 'DB bytes unchanged', b.db, a.db);
  check(c, 'WAL bytes/presence unchanged', b['-wal'], a['-wal']);
  check(c, 'no rollback journal created', null, a['-journal']);
  c.shm = { before: b['-shm'], after: a['-shm'], changed: JSON.stringify(b['-shm']) !== JSON.stringify(a['-shm']), note: 'SQLite readers may update -shm; allowed' };
  if (c.before.logical.error) {
    check(c, 'store still unreadable to an independent reader (same error)', c.before.logical.error, c.after.logical.error);
  } else if (c.before.logical.exists) {
    check(c, 'logical hash unchanged', c.before.logical.logicalHash, c.after.logical.logicalHash);
    check(c, 'catalog rows unchanged', c.before.logical.catalogHash, c.after.logical.catalogHash);
    check(c, 'catalog rowcount unchanged', c.before.logical.catalogCount, c.after.logical.catalogCount);
    check(c, 'migration ledger unchanged', c.before.logical.migrations, c.after.logical.migrations);
    check(c, 'format marker unchanged', c.before.logical.marker, c.after.logical.marker);
    check(c, 'schema_version/user_version unchanged',
      [c.before.logical.pragmas?.schema_version, c.before.logical.pragmas?.user_version],
      [c.after.logical.pragmas?.schema_version, c.after.logical.pragmas?.user_version]);
  } else {
    check(c, 'store still absent', false, existsSync(dbFile));
  }
  for (const [k, list] of Object.entries(c.before.listings)) {
    check(c, `listing "${k}" names unchanged (excluding -shm)`,
      names(list).filter((n) => !n.endsWith('-shm')),
      names(c.after.listings[k]).filter((n) => !n.endsWith('-shm')));
  }
  for (const path of expectAbsent) check(c, `still absent: ${relative(ROOT, path)}`, false, existsSync(path));
  check(c, 'fake CLIs saw probes only (no turn)', 0, c.fakeInvocations.filter((i) => i.kind === 'refused-non-probe').length);
  finish(c);
  return c;
}

// ------------------------------------------------------------------ ordinary startup case
async function http_(port, method, path, body) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: res.status, headers: { pid: res.headers.get('x-graphgoblin-pid') }, json, ...(json === undefined ? { text: text.slice(0, 4000) } : {}) };
}
async function startGateway(c, env, cwd) {
  const port = await freePort();
  const p = launch(c.id, [], { ...env, GG_PORT: String(port) }, cwd);
  c.pid = p.pid;
  c.port = port;
  const deadline = Date.now() + 120_000;
  let listening = false;
  while (Date.now() < deadline) {
    if (p.exit) break;
    if (p.stdout.includes('"msg":"GraphGoblin API listening"')) {
      listening = true;
      break;
    }
    await sleep(100);
  }
  if (!listening && !p.exit) {
    p.timedOut = true;
    p.child.kill();
    await Promise.race([p.closed, sleep(15_000)]);
  }
  return { p, port, listening };
}
async function stopGateway(c, g) {
  const r = await http_(g.port, 'POST', '/system/shutdown', { action: 'drain' });
  c.shutdownResponse = { status: r.status, phase: r.json?.phase };
  await waitClosed(g.p, 90_000);
}
const loopDefinition = (harness, model, effort) => ({
  schemaVersion: 4,
  name: `QA448 ${harness} ${model} ${effort}`,
  settings: { defaults: { byHarness: {} } },
  nodes: [
    { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' }, ui: { x: 0, y: 80 } },
    {
      id: 'infer',
      kind: 'inference',
      label: 'Infer',
      config: {
        harness,
        model,
        effort,
        prompt: { template: 'QA448 synthetic prompt; must never reach a provider' },
        harnessOptions: { sandbox: 'read-only', approval: 'never' },
      },
      ui: { x: 260, y: 80 },
    },
    { id: 'done', kind: 'exit', label: 'Done', config: {}, ui: { x: 520, y: 80 } },
  ],
  edges: [
    { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'infer' } },
    { id: 'b', from: { node: 'infer', port: 'out' }, to: { node: 'done' } },
  ],
});

/** Public API probes: preserved disabled row, publication refusal and execution-time refusal. */
async function disabledExecutionProbe(c, port, harness, model, effort, enabledControl) {
  const out = {};
  const created = await http_(port, 'POST', '/loops', { definition: loopDefinition(harness, model, effort) });
  out.create = { status: created.status, loopId: created.json?.loop?.id, draftVersionId: created.json?.loop?.draftVersionId };
  check(c, 'POST /loops draft admitted (MODEL_DISABLED is not a draft-admission refusal)', true, created.status >= 200 && created.status < 300);
  const loopId = created.json?.loop?.id;
  const validate = await http_(port, 'POST', `/loops/${loopId}/validate`, { definition: loopDefinition(harness, model, effort) });
  out.validate = { status: validate.status, publishable: validate.json?.publishable, issues: validate.json?.issues };
  const codes = (validate.json?.issues ?? []).map((i) => `${i.code}:${i.severity}`);
  check(c, 'validate reports MODEL_DISABLED as warning (unavailable, not invalid)', true, codes.includes('MODEL_DISABLED:warning'));
  check(c, 'validate reports no harness readiness issue (fakes ready)', 0, codes.filter((x) => x.startsWith('HARNESS_READINESS')).length);
  check(c, 'validate publishable=false', false, validate.json?.publishable);
  const publish = await http_(port, 'POST', `/loops/${loopId}/publish`);
  out.publish = { status: publish.status, code: publish.json?.code, body: publish.json };
  check(c, 'publish refused 422 LOOP_INVALID', [422, 'LOOP_INVALID'], [publish.status, publish.json?.code]);
  check(c, 'publish refusal carries MODEL_DISABLED', true, JSON.stringify(publish.json ?? {}).includes('MODEL_DISABLED'));
  const fakeBefore = fakeLines().length;
  const run = await http_(port, 'POST', `/loops/${loopId}/runs`, {
    input: null,
    versionId: created.json?.loop?.draftVersionId,
    allowDraft: true,
  });
  out.runStart = { status: run.status, runId: run.json?.run?.id, body: run.json ?? run.text };
  let record;
  if (run.json?.run?.id) {
    for (let i = 0; i < 300; i++) {
      const r = await http_(port, 'GET', `/runs/${run.json.run.id}`);
      record = r.json;
      if (record?.failure || ['failed', 'succeeded', 'cancelled', 'interrupted'].includes(record?.status)) break;
      await sleep(100);
    }
  }
  out.run = { status: record?.status, failure: record?.failure };
  check(c, 'draft run admitted 202 (execution reaches the catalog gate)', 202, run.status);
  check(c, 'run refused at execution with MODEL_DISABLED', true, JSON.stringify(record?.failure ?? {}).includes('MODEL_DISABLED'));
  check(c, 'run failure code EVALUATION_UNAVAILABLE', 'EVALUATION_UNAVAILABLE', record?.failure?.code);
  const afterRun = fakeLines().slice(fakeBefore);
  out.fakeInvocationsDuringRun = afterRun;
  check(c, 'no fake CLI turn attempted during run', 0, afterRun.filter((i) => i.kind === 'refused-non-probe').length);
  const control = await http_(port, 'POST', `/loops/${loopId}/validate`, { definition: loopDefinition(...enabledControl) });
  out.enabledControl = { model: enabledControl, publishable: control.json?.publishable, issues: control.json?.issues };
  check(c, 'enabled control model has no MODEL_DISABLED', false, JSON.stringify(control.json?.issues ?? []).includes('MODEL_DISABLED'));
  c.publicProbe = { class: 'public-response', ...out };
}

async function startupCase(id, purpose, { dbFile, dataDir, dbUrl, defaults, variant, expect }) {
  const c = newCase(id, 'built-ordinary-startup', purpose, { variant, defaults });
  const caseDir = join(ROOT, 'cases', id);
  mkdirSync(caseDir, { recursive: true });
  const env = childEnv({ GG_DATA_DIR: dataDir, ...(dbUrl ? { GG_DB_URL: dbUrl } : {}), GG_DEFAULTS: JSON.stringify(defaults) });
  c.env = publicEnv(env);
  c.before = storeState(dbFile, { storeDir: dirname(dbFile), dataDir });
  const fakeBefore = fakeLines().length;
  const ollamaBefore = ollamaRequests.length;
  const g = await startGateway(c, env, caseDir);
  c.listening = g.listening;
  if (expect.refusal) {
    if (!g.p.exit) await waitClosed(g.p, 60_000);
    c.exit = g.p.exit;
    check(c, 'startup refused (not listening)', false, g.listening);
    check(c, 'exit code 1', 1, g.p.exit?.code);
    check(c, 'stderr names EVALUATION_INVALID_CONFIGURATION', true, g.p.stderr.includes('EVALUATION_INVALID_CONFIGURATION'));
    check(c, `stderr names ${expect.refusal}`, true, g.p.stderr.includes(expect.refusal));
  } else {
    check(c, 'gateway listening', true, g.listening);
    if (g.listening) {
      const health = await http_(g.port, 'GET', '/healthz');
      check(c, 'healthz answered by this owned child pid', String(g.p.pid), health.headers.pid);
      const catalog = await http_(g.port, 'GET', '/model-catalog');
      const items = catalog.json?.items ?? [];
      c.publicCatalog = { class: 'public-response', status: catalog.status, count: items.length, items };
      for (const [harness, model, enabled] of expect.catalog) {
        const row = items.find((i) => i.harness === harness && i.model === model);
        check(c, `GET /model-catalog ${harness}/${model} enabled=${enabled}`, enabled, row?.enabled ?? null);
      }
      const md = await http_(g.port, 'GET', '/system/model-defaults');
      check(c, 'GET /system/model-defaults equals GG_DEFAULTS', defaults, md.json);
      if (expect.containerPreflight) {
        const pf = await http_(g.port, 'GET', '/system/preflight');
        c.containerPreflight = { class: 'public-response', status: pf.status, checks: pf.json?.checks };
        for (const [cid, status] of expect.containerPreflight) {
          check(c, `GET /system/preflight ${cid}=${status}`, status, pf.json?.checks?.find((k) => k.id === cid)?.status ?? null);
        }
      }
      if (expect.disabledProbe) await disabledExecutionProbe(c, g.port, ...expect.disabledProbe);
      await stopGateway(c, g);
    }
    c.exit = g.p.exit;
    check(c, 'drained exit code 0', 0, g.p.exit?.code);
    check(c, 'not timed out', false, Boolean(g.p.timedOut));
  }
  c.durationMs = (g.p.endedAt ?? Date.now()) - g.p.startedAt;
  saveRaw(c, g.p);
  c.after = storeState(dbFile, { storeDir: dirname(dbFile), dataDir });
  c.fakeInvocations = fakeLines().slice(fakeBefore);
  c.ollamaRequests = ollamaRequests.slice(ollamaBefore);
  check(c, 'fake CLIs saw probes only (no turn)', 0, c.fakeInvocations.filter((i) => i.kind === 'refused-non-probe').length);
  if (expect.refusal) {
    check(c, 'refusal: DB bytes unchanged', c.before.files.db, c.after.files.db);
    check(c, 'refusal: WAL bytes/presence unchanged', c.before.files['-wal'], c.after.files['-wal']);
    check(c, 'refusal: logical hash unchanged', c.before.logical.logicalHash, c.after.logical.logicalHash);
  } else {
    const b = c.before.logical;
    const a = c.after.logical;
    for (const [harness, model, enabled] of expect.storedAfter) {
      check(c, `stored after start ${harness}/${model} enabled=${enabled}`, enabled, catalogRow(c.after, harness, model)?.enabled ?? null);
    }
    check(c, 'catalog rowcount after = before + seeded', b.catalogCount + expect.seeded, a.catalogCount);
    const changedEnabled = (b.catalog ?? [])
      .filter((r) => catalogRow(c.after, r.harness, r.model)?.enabled !== r.enabled)
      .map((r) => `${r.harness}/${r.model}`);
    check(c, 'no pre-existing row changed enabled state', [], changedEnabled);
    check(c, 'migration ledger unchanged (store already current)', b.migrations, a.migrations);
    check(c, 'format marker unchanged', b.marker, a.marker);
  }
  finish(c);
  return c;
}

// ------------------------------------------------------------------ variant derivation
const D_TARGET = {
  byHarness: {
    codex: { model: 'gpt-6.1-terra', effort: 'medium' },
    claude: { model: 'claude-opus-5-5', effort: 'high' },
  },
};
const DEL_CODEX = "DELETE FROM model_catalog WHERE harness = 'codex' AND model = 'gpt-6.1-terra'";
const DEL_CLAUDE = "DELETE FROM model_catalog WHERE harness = 'claude' AND model = 'claude-opus-5-5'";
const variants = {};
function deriveVariant(name, statements, { walOnly = false } = {}) {
  const c = newCase(`V-${name}`, 'fixture-variant', `derive ${name} from the golden store with a test-owned node:sqlite connection`);
  const dir = join(ROOT, 'variants', name);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'gateway.db');
  copyFileSync(variants.golden, file);
  const db = new DatabaseSync(file);
  c.statements = [];
  let subject = file;
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    c.journalMode = Object.values(db.prepare('PRAGMA journal_mode').get())[0];
    if (walOnly) db.exec('PRAGMA wal_autocheckpoint = 0');
    for (const sql of statements) {
      const r = db.prepare(sql).run();
      c.statements.push({ sql, changes: Number(r.changes) });
    }
    if (walOnly) {
      // Snapshot base + committed WAL while the holder is open: the copy's change lives only in its WAL.
      const snap = join(ROOT, 'variants', `${name}-snapshot`);
      mkdirSync(snap);
      for (const s of ['', '-wal', '-shm']) copyFileSync(file + s, join(snap, `gateway.db${s}`));
      subject = join(snap, 'gateway.db');
    } else {
      c.checkpoint = { ...db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() };
    }
  } finally {
    db.close();
    c.closed = true;
  }
  c.holderAfterClose = fileFacts(file);
  c.subject = subject;
  c.subjectState = storeState(subject);
  for (const s of c.statements) check(c, `statement affected rows: ${s.sql}`, true, s.changes >= 1);
  check(c, 'holder closed; its WAL removed or empty after close', true, !c.holderAfterClose['-wal'] || c.holderAfterClose['-wal'].size === 0);
  if (walOnly) {
    check(c, 'snapshot WAL present and non-empty', true, (c.subjectState.files['-wal']?.size ?? 0) > 0);
  } else {
    check(c, 'subject has no WAL', null, c.subjectState.files['-wal']);
  }
  variants[name] = subject;
  finish(c);
  return subject;
}
function place(variant, target) {
  mkdirSync(dirname(target), { recursive: true });
  for (const s of ['', '-wal', '-shm']) if (existsSync(variant + s)) copyFileSync(variant + s, target + s);
  return target;
}

// ================================================================== run
const started = new Date().toISOString();
log('scratch root', ROOT, 'nonce', NONCE);

// G0: golden store from an actual first-run ordinary startup (store absent).
{
  const dataDir = join(ROOT, 'golden', 'data');
  const dbFile = join(dataDir, 'graphgoblin.db');
  await startupCase('G0-first-run-startup', 'first-run ordinary startup creates and seeds a current store (golden)', {
    dbFile,
    dataDir,
    defaults: D_TARGET,
    variant: 'absent',
    expect: {
      catalog: [['codex', 'gpt-6.1-terra', true], ['claude', 'claude-opus-5-5', true]],
      storedAfter: [['codex', 'gpt-6.1-terra', 1], ['claude', 'claude-opus-5-5', 1]],
      seeded: NaN,
      containerPreflight: [['database', 'ok'], ['default-model', 'ok'], ['default-model.claude', 'ok']],
    },
  });
  const g = results.at(-1);
  // A fresh store has no "before" rows; replace the NaN arithmetic check with explicit facts.
  g.checks = g.checks.filter((k) => !k.name.startsWith('catalog rowcount') && !k.name.startsWith('migration ledger') && !k.name.startsWith('format marker') && !k.name.startsWith('no pre-existing'));
  check(g, 'store absent before', false, g.before.logical.exists);
  check(g, 'golden store created', true, g.after.logical.exists);
  check(g, 'golden marker format 4 complete', [4, 'complete'], [g.after.logical.marker?.[0]?.format_version, g.after.logical.marker?.[0]?.status]);
  check(g, 'golden ledger has 30 shipped migrations', 30, g.after.logical.migrations?.count);
  finish(g);
  const golden = join(ROOT, 'variants', 'golden', 'gateway.db');
  mkdirSync(dirname(golden), { recursive: true });
  copyFileSync(dbFile, golden);
  for (const s of ['-wal', '-shm']) if (existsSync(dbFile + s)) copyFileSync(dbFile + s, golden + s);
  variants.golden = golden;
  g.goldenCopyFiles = fileFacts(golden);
  if (existsSync(`${golden}-wal`)) {
    // Fold a retained WAL into the private golden copy with a test-owned connection (recorded).
    const db = new DatabaseSync(golden);
    try {
      g.goldenWalFold = { ...db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() };
    } finally {
      db.close();
    }
    g.goldenAfterFold = fileFacts(golden);
    writeFileSync(join(OBS, `${g.id}.json`), JSON.stringify(g, null, 2) + '\n');
  }
}

deriveVariant('missing', [DEL_CODEX, DEL_CLAUDE]);
deriveVariant('walonly', [DEL_CODEX, DEL_CLAUDE], { walOnly: true });
deriveVariant('dis-codex', ["UPDATE model_catalog SET enabled = 0 WHERE harness = 'codex' AND model = 'gpt-6.1-terra'", DEL_CLAUDE]);
deriveVariant('dis-claude', ["UPDATE model_catalog SET enabled = 0 WHERE harness = 'claude' AND model = 'claude-opus-5-5'", DEL_CODEX]);
deriveVariant('meta', [
  "UPDATE model_catalog SET efforts = '[\"high\"]', display_name = 'QA448 stored Opus metadata' WHERE harness = 'claude' AND model = 'claude-opus-5-5'",
  DEL_CODEX,
]);
deriveVariant('unsupported', ['UPDATE gg_upgrade_state SET format_version = 3 WHERE id = 1']);

// Pending: a genuine current-format store migrated only to 0028 through the built product migrator.
{
  const c = newCase('V-pending', 'fixture-variant', 'current-format store migrated to 0028 (one shipped migration pending) via a test-owned product connection');
  const prefix = join(ROOT, 'prefix-migrations');
  cpSync(join(REPO, 'packages', 'infrastructure', 'drizzle'), prefix, { recursive: true });
  const journalPath = join(prefix, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
  const dropped = journal.entries.pop();
  writeFileSync(journalPath, JSON.stringify(journal, null, 2));
  unlinkSync(join(prefix, `${dropped.tag}.sql`));
  c.droppedMigration = dropped.tag;
  const file = join(ROOT, 'variants', 'pending', 'gateway.db');
  mkdirSync(dirname(file), { recursive: true });
  const handle = infra.openDatabase({ url: pathToFileURL(file).href, migrationsFolder: prefix });
  try {
    await handle.migrate();
    await handle.client.execute('PRAGMA wal_checkpoint(TRUNCATE)');
  } finally {
    handle.close();
    c.closed = true;
  }
  c.subjectState = storeState(file);
  check(c, 'dropped the last shipped migration', '0029_ollama_context_profile', dropped.tag);
  check(c, 'ledger has 29 entries', 29, c.subjectState.logical.migrations?.count);
  check(c, 'marker format 4 complete', [4, 'complete'], [c.subjectState.logical.marker?.[0]?.format_version, c.subjectState.logical.marker?.[0]?.status]);
  variants.pending = file;
  finish(c);
}
// Garbage: not a SQLite database.
{
  const file = join(ROOT, 'variants', 'garbage', 'gateway.db');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, Buffer.from('QA448 synthetic bytes: this is not a SQLite database.\n'.repeat(160)));
  variants.garbage = file;
}

const ext = (id) => join(ROOT, 'cases', id, 'external store', 'gateway.db');
const absentData = (id) => join(ROOT, 'cases', id, 'data');
const urlOf = (file) => pathToFileURL(file).href;
const READY = [['Database', 'ok', /^reachable and migrated$/], ['Harness codex', 'ok'], ['Harness claude', 'ok']];
const CODEX_OK = (model) => ['Default model', 'ok', new RegExp(`^${model.replaceAll('.', '\\.')} \\(codex\\) is in the model catalog$`)];
const CLAUDE_OK = ['Claude default model', 'ok', /^Exact Claude model and effort are configured$/];

async function pf(id, purpose, variant, defaults, expectExit, rows, { inside = false, absent = false } = {}) {
  if (absent) {
    const dbFile = join(ROOT, 'cases', id, 'never created', 'gateway.db');
    mkdirSync(join(ROOT, 'cases', id), { recursive: true });
    return preflightCase(id, purpose, {
      dbFile, dataDir: absentData(id), dbUrl: urlOf(dbFile), defaults, expectExit, expectRows: rows, variant,
      expectAbsent: [dirname(dbFile), absentData(id)],
    });
  }
  if (inside) {
    const dataDir = join(ROOT, 'cases', id, 'data');
    const dbFile = place(variants[variant], join(dataDir, 'graphgoblin.db'));
    return preflightCase(id, purpose, { dbFile, dataDir, defaults, expectExit, expectRows: rows, variant, watchDirs: { dataDir } });
  }
  const dbFile = place(variants[variant], ext(id));
  return preflightCase(id, purpose, {
    dbFile, dataDir: absentData(id), dbUrl: urlOf(dbFile), defaults, expectExit, expectRows: rows, variant,
    watchDirs: { storeDir: dirname(dbFile) }, expectAbsent: [absentData(id)],
  });
}

// ------------------------------------------------------------------ built CLI preflight cases
await pf('P01', 'missing Codex+Claude seeds, external percent-encoded path: admitted in memory', 'missing', D_TARGET, 0, [...READY, CODEX_OK('gpt-6.1-terra'), CLAUDE_OK]);
await pf('P02', 'missing Codex+Claude seeds, store inside GG_DATA_DIR: admitted in memory', 'missing', D_TARGET, 0, [...READY, ['Data directory', 'ok'], CODEX_OK('gpt-6.1-terra'), CLAUDE_OK], { inside: true });
await pf('P03', 'rows missing only in the current WAL: admitted, DB+WAL bytes untouched, no checkpoint', 'walonly', D_TARGET, 0, [...READY, CODEX_OK('gpt-6.1-terra'), CLAUDE_OK]);
await pf('P04', 'Codex default row exists disabled (same seed id) + Claude seed missing: Codex WARN, exit 0', 'dis-codex', D_TARGET, 0, [...READY, ['Default model', 'WARN', /^gpt-6\.1-terra is in the model catalog but disabled$/], CLAUDE_OK]);
await pf('P05', 'Claude default row exists disabled (same seed id) + Codex seed missing: Claude FAIL, exit 1', 'dis-claude', D_TARGET, 1, [...READY, CODEX_OK('gpt-6.1-terra'), ['Claude default model', 'FAIL', /^The configured Claude model is disabled$/]]);
await pf('P06', 'unknown Codex model on missing-seed store: FAIL', 'missing', { byHarness: { codex: { model: 'gpt-qa448-unknown', effort: 'medium' } } }, 1, [...READY, ['Default model', 'FAIL', /"gpt-qa448-unknown" is not in the model catalog/]]);
await pf('P07', 'wrong harness: Codex default names the (missing) Claude seed: FAIL', 'missing', { byHarness: { codex: { model: 'claude-opus-5-5', effort: 'high' } } }, 1, [...READY, ['Default model', 'FAIL', /"claude-opus-5-5" is not in the model catalog/]]);
await pf('P08', 'wrong family: Claude default names the (missing) Codex seed: FAIL', 'missing', { byHarness: { codex: { model: 'gpt-6-luna', effort: 'low' }, claude: { model: 'gpt-6.1-terra', effort: 'medium' } } }, 1, [...READY, CODEX_OK('gpt-6-luna'), ['Claude default model', 'FAIL', /^The configured Claude model is not in the catalog$/]]);
await pf('P09', 'unsupported Claude effort on projected seed: FAIL', 'missing', { byHarness: { codex: { model: 'gpt-6.1-terra', effort: 'medium' }, claude: { model: 'claude-opus-5-5', effort: 'none' } } }, 1, [...READY, CODEX_OK('gpt-6.1-terra'), ['Claude default model', 'FAIL', /^Configure an explicit supported Claude reasoning effort$/]]);
await pf('P10', 'stored Claude metadata (efforts [high]) wins over shipped seed: low FAILs', 'meta', { byHarness: { codex: { model: 'gpt-6.1-terra', effort: 'medium' }, claude: { model: 'claude-opus-5-5', effort: 'low' } } }, 1, [...READY, CODEX_OK('gpt-6.1-terra'), ['Claude default model', 'FAIL', /^Configure an explicit supported Claude reasoning effort$/]]);
await pf('P11', 'stored Claude metadata (efforts [high]) admits high', 'meta', D_TARGET, 0, [...READY, CODEX_OK('gpt-6.1-terra'), CLAUDE_OK]);
await pf('P12', 'existing policy: Codex preflight checks membership/enabled only (gpt-5.5 effort none)', 'missing', { byHarness: { codex: { model: 'gpt-5.5', effort: 'none' } } }, 0, [...READY, CODEX_OK('gpt-5.5')]);
await pf('P13', 'first run, store absent: shipped catalog, nothing created', 'absent', D_TARGET, 0, [['Database', 'WARN', /does not exist yet/], ['Default model', 'ok', /is in the default catalog seeded on first start/], CLAUDE_OK], { absent: true });
await pf('P14', 'first run, store absent, unknown model: FAIL, nothing created', 'absent', { byHarness: { codex: { model: 'gpt-qa448-unknown', effort: 'medium' } } }, 1, [['Database', 'WARN', /does not exist yet/], ['Default model', 'FAIL', /is not in the default catalog seeded on first start/]], { absent: true });
await pf('P15', 'unsupported store (format 3): Database FAIL, bytes unchanged', 'unsupported', D_TARGET, 1, [['Database', 'FAIL', /The store is format 3; this build reads only format 4\. Start refuses this store and converts nothing/]]);
await pf('P16', 'unreadable store (not SQLite): Database FAIL, bytes unchanged', 'garbage', D_TARGET, 1, [['Database', 'FAIL']]);
await pf('P17', 'pending migration store: Database WARN, shipped catalog, bytes unchanged', 'pending', D_TARGET, 0, [['Database', 'WARN', /^1 migration\(s\) pending; they are applied on the next start$/], ['Default model', 'ok', /is in the default catalog seeded on first start/], CLAUDE_OK]);

// ------------------------------------------------------------------ public-method cases (built modules)
async function storedList(file) {
  const client = infra.openReadOnlyDatabaseClient(file);
  try {
    return await new infra.SqliteModelCatalog(infra.databaseView(client)).list();
  } finally {
    client.close();
  }
}
{
  const c = newCase('M01', 'built-public-method', 'projectStartupModelCatalog keeps the stored disabled row and appends only the missing seed');
  const file = place(variants['dis-codex'], join(ROOT, 'cases', 'M01', 'gateway.db'));
  const before = fileFacts(file);
  const stored = await storedList(file);
  const frozen = JSON.stringify(stored);
  const projected = infra.projectStartupModelCatalog(stored);
  const terra = projected.filter((e) => e.harness === 'codex' && e.model === 'gpt-6.1-terra');
  const opus = projected.filter((e) => e.harness === 'claude' && e.model === 'claude-opus-5-5');
  c.observed = { storedCount: stored.length, projectedCount: projected.length, terra, opus, shippedCount: infra.DEFAULT_MODEL_CATALOG.length };
  check(c, 'codex/gpt-6.1-terra appears once, disabled (stored wins)', [1, false], [terra.length, terra[0]?.enabled]);
  check(c, 'claude/claude-opus-5-5 appended once, enabled (seed)', [1, true], [opus.length, opus[0]?.enabled]);
  check(c, 'stored rows first, unchanged order', frozen, JSON.stringify(projected.slice(0, stored.length)));
  check(c, 'projected count = stored + 1 missing seed', stored.length + 1, projected.length);
  check(c, 'input not mutated', frozen, JSON.stringify(stored));
  check(c, 'idempotent', JSON.stringify(projected), JSON.stringify(infra.projectStartupModelCatalog(projected)));
  check(c, 'boot validator: no invalid issue for disabled Codex default', [], domain.validateHarnessDefaults({ loopDefaults: { byHarness: {} }, ownerDefaults: { byHarness: {} }, processDefaults: D_TARGET, catalog: projected }));
  const res = domain.resolveHarnessModel({ harness: 'codex', loopDefaults: { byHarness: {} }, ownerDefaults: { byHarness: {} }, processDefaults: D_TARGET, catalog: projected });
  check(c, 'execution resolution: unavailable MODEL_DISABLED', ['unavailable', 'MODEL_DISABLED'], [res.status, res.code]);
  check(c, 'read-only listing left DB bytes unchanged', before.db, fileFacts(file).db);
  finish(c);
}
{
  const c = newCase('M02', 'built-public-method', 'counterfactual: same missing-seed store through built runPreflight with candidate vs stored-only catalog source');
  const file = place(variants.missing, join(ROOT, 'cases', 'M02', 'gateway.db'));
  const before = fileFacts(file);
  const config = apiConfig.loadConfig({ GG_DATA_DIR: join(ROOT, 'cases', 'M02', 'data'), GG_DB_URL: urlOf(file), GG_MASTER_KEY: SYNTH_KEY, GG_DEFAULTS: JSON.stringify(D_TARGET), GG_OLLAMA_ENABLED: 'false', GG_OLLAMA_URL: OLLAMA_URL });
  const ready = (id) => ({ id, preflight: async () => ({ state: 'ready', ok: true, problems: [] }) });
  const sources = await apiPreflight.configPreflightSources(config, { harnesses: { codex: ready('codex'), claude: ready('claude') } });
  let candidate;
  let storedOnly;
  try {
    candidate = await apiPreflight.runPreflight(sources);
    const storedRows = await storedList(file);
    storedOnly = await apiPreflight.runPreflight({ ...sources, catalog: async () => storedRows });
    c.boot = {
      storedOnly: domain.validateHarnessDefaults({ loopDefaults: { byHarness: {} }, ownerDefaults: { byHarness: {} }, processDefaults: D_TARGET, catalog: storedRows }).map((i) => `${i.harness}:${i.resolution.code}`),
      projected: domain.validateHarnessDefaults({ loopDefaults: { byHarness: {} }, ownerDefaults: { byHarness: {} }, processDefaults: D_TARGET, catalog: infra.projectStartupModelCatalog(storedRows) }).map((i) => `${i.harness}:${i.resolution.code}`),
    };
  } finally {
    sources.close();
  }
  const status = (r, id) => r.checks.find((k) => k.id === id)?.status;
  c.observed = { candidate: candidate.checks, storedOnly: storedOnly.checks };
  check(c, 'candidate source: default-model ok, default-model.claude ok, report ok', ['ok', 'ok', true], [status(candidate, 'default-model'), status(candidate, 'default-model.claude'), candidate.ok]);
  check(c, 'stored-only counterfactual: both fail, report not ok', ['fail', 'fail', false], [status(storedOnly, 'default-model'), status(storedOnly, 'default-model.claude'), storedOnly.ok]);
  check(c, 'boot validator stored-only would refuse both (discrimination)', ['codex:MODEL_NOT_IN_CATALOG', 'claude:MODEL_NOT_IN_CATALOG'], c.boot.storedOnly);
  check(c, 'boot validator with projection: no issues', [], c.boot.projected);
  check(c, 'DB bytes unchanged', before.db, fileFacts(file).db);
  check(c, 'WAL absent before and after', [null, null], [before['-wal'], fileFacts(file)['-wal']]);
  finish(c);
}

// ------------------------------------------------------------------ ordinary startup cases (separate copies)
const sExt = (id, variant) => {
  const dbFile = place(variants[variant], ext(id));
  return { dbFile, dataDir: absentData(id), dbUrl: urlOf(dbFile), variant };
};
await startupCase('S01', 'parity: same missing-seed store + same GG_DEFAULTS boots and seeds normally (external path)', {
  ...sExt('S01', 'missing'),
  defaults: D_TARGET,
  expect: {
    catalog: [['codex', 'gpt-6.1-terra', true], ['claude', 'claude-opus-5-5', true]],
    storedAfter: [['codex', 'gpt-6.1-terra', 1], ['claude', 'claude-opus-5-5', 1]],
    seeded: 2,
    containerPreflight: [['database', 'ok'], ['default-model', 'ok'], ['default-model.claude', 'ok']],
  },
});
{
  const dataDir = join(ROOT, 'cases', 'S02', 'data');
  const dbFile = place(variants.walonly, join(dataDir, 'graphgoblin.db'));
  await startupCase('S02', 'parity: WAL-only missing rows inside GG_DATA_DIR boot and seed normally', {
    dbFile, dataDir, defaults: D_TARGET, variant: 'walonly',
    expect: {
      catalog: [['codex', 'gpt-6.1-terra', true], ['claude', 'claude-opus-5-5', true]],
      storedAfter: [['codex', 'gpt-6.1-terra', 1], ['claude', 'claude-opus-5-5', 1]],
      seeded: 2,
    },
  });
}
const s03 = await startupCase('S03', 'disabled Codex default boots (structurally valid), row stays disabled, execution refused', {
  ...sExt('S03', 'dis-codex'),
  defaults: D_TARGET,
  expect: {
    catalog: [['codex', 'gpt-6.1-terra', false], ['claude', 'claude-opus-5-5', true]],
    storedAfter: [['codex', 'gpt-6.1-terra', 0], ['claude', 'claude-opus-5-5', 1]],
    seeded: 1,
    disabledProbe: ['codex', 'gpt-6.1-terra', 'medium', ['codex', 'gpt-6-luna', 'low']],
  },
});
const s04 = await startupCase('S04', 'disabled Claude default boots (structurally valid), row stays disabled, execution refused', {
  ...sExt('S04', 'dis-claude'),
  defaults: D_TARGET,
  expect: {
    catalog: [['codex', 'gpt-6.1-terra', true], ['claude', 'claude-opus-5-5', false]],
    storedAfter: [['codex', 'gpt-6.1-terra', 1], ['claude', 'claude-opus-5-5', 0]],
    seeded: 1,
    disabledProbe: ['claude', 'claude-opus-5-5', 'high', ['claude', 'claude-sonnet-5-5', 'high']],
  },
});
const refusal = (id, purpose, variant, defaults, code) =>
  startupCase(id, purpose, { ...sExt(id, variant), defaults, expect: { refusal: code } });
await refusal('S05', 'unknown Codex model refused before writes', 'missing', { byHarness: { codex: { model: 'gpt-qa448-unknown', effort: 'medium' } } }, 'codex: MODEL_NOT_IN_CATALOG');
await refusal('S06', 'Codex default naming the missing Claude seed: MODEL_HARNESS_MISMATCH (projection visible to boot)', 'missing', { byHarness: { codex: { model: 'claude-opus-5-5', effort: 'high' } } }, 'codex: MODEL_HARNESS_MISMATCH');
await refusal('S07', 'Claude default naming the missing Codex seed: MODEL_HARNESS_MISMATCH', 'missing', { byHarness: { codex: { model: 'gpt-6-luna', effort: 'low' }, claude: { model: 'gpt-6.1-terra', effort: 'medium' } } }, 'claude: MODEL_HARNESS_MISMATCH');
await refusal('S08', 'unsupported Claude effort none on projected seed: EFFORT_UNSUPPORTED', 'missing', { byHarness: { codex: { model: 'gpt-6.1-terra', effort: 'medium' }, claude: { model: 'claude-opus-5-5', effort: 'none' } } }, 'claude: EFFORT_UNSUPPORTED');
await refusal('S09', 'stored Claude metadata efforts [high] wins at boot admission: low refused', 'meta', { byHarness: { codex: { model: 'gpt-6.1-terra', effort: 'medium' }, claude: { model: 'claude-opus-5-5', effort: 'low' } } }, 'claude: EFFORT_UNSUPPORTED');
await refusal('S10', 'existing policy: boot checks Codex effort (gpt-5.5 none) unlike preflight', 'missing', { byHarness: { codex: { model: 'gpt-5.5', effort: 'none' } } }, 'codex: EFFORT_UNSUPPORTED');
{
  const c = await startupCase('S11', 'unsupported store (format 3) refused by startup without writes', {
    ...sExt('S11', 'unsupported'), defaults: D_TARGET, expect: { refusal: 'The store is format 3' },
  });
  // The store refusal is not a GG_DEFAULTS refusal; drop the defaults-specific check.
  c.checks = c.checks.filter((k) => k.name !== 'stderr names EVALUATION_INVALID_CONFIGURATION');
  finish(c);
}

// M03: public repository/domain methods on the post-start stores of S03/S04.
{
  const c = newCase('M03', 'built-public-method', 'after ordinary startup: disabled rows still refused by SqliteModelCatalog.isAllowed and resolveHarnessModel');
  for (const [s, harness, model, effort, other] of [
    [s03, 'codex', 'gpt-6.1-terra', 'medium', ['claude', 'claude-opus-5-5', 'high']],
    [s04, 'claude', 'claude-opus-5-5', 'high', ['codex', 'gpt-6.1-terra', 'medium']],
  ]) {
    const dbFile = s.id === 'S03' ? ext('S03') : ext('S04');
    const copy = join(ROOT, 'cases', 'M03', s.id, 'gateway.db');
    place(dbFile, copy);
    const client = infra.openReadOnlyDatabaseClient(copy);
    try {
      const repo = new infra.SqliteModelCatalog(infra.databaseView(client));
      const list = await repo.list();
      check(c, `${s.id}: isAllowed(${harness},${model},${effort}) false`, false, await repo.isAllowed(harness, model, effort));
      check(c, `${s.id}: isAllowed(${other.join(',')}) true (seeded counterpart)`, true, await repo.isAllowed(...other));
      const r = domain.resolveHarnessModel({ harness, loopDefaults: { byHarness: {} }, ownerDefaults: { byHarness: {} }, processDefaults: D_TARGET, catalog: list });
      check(c, `${s.id}: resolveHarnessModel unavailable MODEL_DISABLED`, ['unavailable', 'MODEL_DISABLED'], [r.status, r.code]);
      check(c, `${s.id}: validateHarnessDefaults (boot) no invalid issue`, [], domain.validateHarnessDefaults({ loopDefaults: { byHarness: {} }, ownerDefaults: { byHarness: {} }, processDefaults: D_TARGET, catalog: list }));
    } finally {
      client.close();
    }
  }
  finish(c);
}

// M04: native close/cleanup inspection of test-owned connections (libsql product driver and node:sqlite).
{
  const c = newCase('M04', 'native-cleanup-probe', 'unlink immediately after closing a test-owned writer connection, record EBUSY if any');
  c.attempts = [];
  const tryUnlink = async (label, file) => {
    const out = [];
    for (const delay of [0, 250, 1000]) {
      if (delay) await sleep(delay);
      const pending = ['-wal', '-shm', ''].map((s) => file + s).filter((f) => existsSync(f));
      if (!pending.length) break;
      for (const f of pending) {
        try {
          unlinkSync(f);
          out.push({ delayMs: delay, file: basename(f), ok: true });
        } catch (error) {
          out.push({ delayMs: delay, file: basename(f), ok: false, code: error.code });
        }
      }
    }
    c.attempts.push({ label, results: out, remaining: ['', '-wal', '-shm'].filter((s) => existsSync(file + s)) });
  };
  const libsqlFile = place(variants.golden, join(ROOT, 'cases', 'M04', 'libsql', 'gateway.db'));
  const handle = infra.openDatabase({ url: urlOf(libsqlFile) });
  await handle.client.execute('PRAGMA journal_mode = WAL');
  await handle.client.execute('UPDATE model_catalog SET enabled = enabled');
  c.libsqlBeforeClose = fileFacts(libsqlFile);
  handle.close();
  await tryUnlink('libsql openDatabase writer, close() then immediate unlink', libsqlFile);
  const nodeFile = place(variants.golden, join(ROOT, 'cases', 'M04', 'node-sqlite', 'gateway.db'));
  const db = new DatabaseSync(nodeFile);
  db.exec('UPDATE model_catalog SET enabled = enabled');
  c.nodeBeforeClose = fileFacts(nodeFile);
  db.close();
  await tryUnlink('node:sqlite writer, close() then immediate unlink', nodeFile);
  const roFile = place(variants.walonly, join(ROOT, 'cases', 'M04', 'readonly', 'gateway.db'));
  const ro = infra.openReadOnlyDatabaseClient(roFile);
  await ro.execute('SELECT COUNT(*) FROM model_catalog');
  ro.close();
  await tryUnlink('libsql read-only client on WAL store, close() then immediate unlink', roFile);
  for (const a of c.attempts) {
    const failures = a.results.filter((r) => !r.ok);
    c.checks.push({ name: `${a.label}: recorded (EBUSY count ${failures.length}; remaining ${a.remaining.length})`, expected: 'recorded', actual: { failures, remaining: a.remaining }, pass: true });
    check(c, `${a.label}: all files removable within 1.25 s`, [], a.remaining);
  }
  finish(c);
}

// ------------------------------------------------------------------ wrap-up
ollama.close();
const alive = owned.filter((p) => p.exit === undefined).map((p) => ({ pid: p.pid, name: p.name }));
const summary = {
  runLabel: RUN_LABEL,
  started,
  finished: new Date().toISOString(),
  scratchRoot: ROOT,
  scratchNonce: NONCE,
  node: process.version,
  sqliteVersionNode: new DatabaseSync(':memory:').prepare('select sqlite_version() v').get().v,
  apiMain: API_MAIN,
  apiMainSha256: sha(readFileSync(API_MAIN)),
  fakeHashes,
  fakeSelfTest,
  ollamaRecorder: OLLAMA_URL,
  ollamaRequestCount: ollamaRequests.length,
  ollamaRequestUrls: [...new Set(ollamaRequests.map((r) => `${r.method} ${r.url}`))],
  ownedChildren: owned.map((p) => ({ name: p.name, pid: p.pid, argv: p.argv, exit: p.exit, timedOut: Boolean(p.timedOut) })),
  ownedChildrenStillRunning: alive,
  fakeInvocationKinds: fakeLines().reduce((m, i) => ({ ...m, [`${i.cli}:${i.kind}`]: (m[`${i.cli}:${i.kind}`] ?? 0) + 1 }), {}),
  cases: results.map((c) => ({ id: c.id, kind: c.kind, purpose: c.purpose, pass: c.pass, checks: c.checks.length, failed: c.checks.filter((k) => !k.pass).map((k) => k.name) })),
  totals: {
    cases: results.length,
    passed: results.filter((c) => c.pass).length,
    failed: results.filter((c) => !c.pass).length,
    checks: results.reduce((n, c) => n + c.checks.length, 0),
    failedChecks: results.reduce((n, c) => n + c.checks.filter((k) => !k.pass).length, 0),
  },
};
if (existsSync(FAKE_LOG)) copyFileSync(FAKE_LOG, join(RAW, 'fake-cli-invocations.jsonl'));
writeFileSync(join(RAW, 'ollama-recorder-requests.json'), JSON.stringify(ollamaRequests, null, 2) + '\n');
writeFileSync(join(OBS, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
writeFileSync(join(OBS, 'transcript.log'), transcript.join('\n') + '\n');
log('TOTALS', JSON.stringify(summary.totals));
log('owned children still running:', JSON.stringify(alive));
process.exitCode = summary.totals.failed === 0 && alive.length === 0 ? 0 : 1;
