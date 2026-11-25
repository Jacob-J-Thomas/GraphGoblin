#!/usr/bin/env node
// GraphGoblin #456: independent owner-native behavior QA driver for the macOS launcher.
// Status: PREPARED, NOT RUN. Authored without execution by Claude Code (claude-opus-5-5, xhigh)
// as independent QA harness preparation. Not a review and claims no pass. Root binds the final
// candidate and artifact hashes, syntax-checks and inspects this file, then admits one execution
// over its bounded SSH transport. README.md and case-map.json beside this file are authoritative.
// Preparation 03: copy of preparation 02 with the built-asset response bound listed in correction-handoff.md.
//
//   node gg456-native-qa.mjs run     --binding FILE [--run-id HEX8] [--on-stop drain|leave] [--include-node-move]
//   node gg456-native-qa.mjs observe --manifest FILE --out NEW_DIR [--repeat N] [--interval-ms MS]
//   node gg456-native-qa.mjs drain   --manifest FILE --out NEW_DIR --pid PID --birth "LSTART"
//   node gg456-native-qa.mjs digest  --checkout DIR
//
// Invariants: Node built-ins only. Every child receives an explicit environment, never this
// process's. Nothing is ever signalled. A gateway is stopped only through the ordinary drain,
// authorized by its own control token after a fresh PID, birth, fingerprint and lease match.
// Ports 4747 and 4748 are listed, never connected. The default app, store and production logs
// are only stat-ed or listed. A successful fixture is retained; no cleanup is performed.

import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { constants as fsConstants, createReadStream } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, open, readFile, readdir, realpath, rename, symlink, writeFile } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { userInfo } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const SCHEMA = 'gg456-independent-native-qa/1';
const BINDING_SCHEMA = 'gg456-independent-native-qa-binding/1';
const MANIFEST_SCHEMA = 'gg456-independent-native-qa-fixture/1';
const FORBIDDEN_PORTS = new Set([4747, 4748]);
const SYS_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
const BOUND = { probe: 10_000, helper: 15_000, headless: 75_000, install: 600_000, ready: 30_000, release: 30_000, http: 3_000 };
const CAP = { stream: 64 * 1024, probe: 4 * 1024 * 1024, http: 2 * 1024 * 1024, asset: 4 * 1024 * 1024, excerpt: 256 * 1024, evidence: 96 * 1024 * 1024 };
const LEASES = ['graphgoblin.lock', 'graphgoblin.db.graphgoblin.lock'];
const LOG_CAPS = { 'gateway.log': 4 * 1024 * 1024, 'gateway.log.1': 4 * 1024 * 1024, 'launcher.log': 256 * 1024, 'launcher.log.1': 256 * 1024 };
const GATEWAY_ENV = ['HOME', 'PATH', 'LANG', 'TMPDIR', 'GG_HOST', 'GG_PORT', 'GG_DATA_DIR', 'GG_WEB_DIST', 'GG_GOBLIN_DIST',
  'GG_DB_URL', 'GG_REQUIRE_API_KEY', 'GG_OLLAMA_ENABLED', 'GG_MACOS_LAUNCHER_LOG_ADMISSION'];
const ENV_ALLOW = new Set([...GATEWAY_ENV, 'GG_CODEX_BINARY', 'GG_CLAUDE_BINARY']);
const EXIT = { 'open-management-running': 0, 'runtime-unavailable': 11, 'port-in-use': 20, 'store-blocked': 21 };
const INSTALLED_TEXT = 'GraphGoblin was installed in Applications.\n';
const STAGE_PREFIX = '.graphgoblin-launcher-stage-';
const WAIT_SECONDS = 45;
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/u;
const D_NAME = 'QA data \u00fc %41 #1';
const TOOLS = { ps: '/bin/ps', lsof: '/usr/sbin/lsof', plutil: '/usr/bin/plutil', xattr: '/usr/bin/xattr',
  getconf: '/usr/bin/getconf', swVers: '/usr/bin/sw_vers', bash: '/bin/bash' };
const SELF = fileURLToPath(import.meta.url);

// ---------------------------------------------------------------- utilities
class Stop extends Error {}
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hex = (text) => Buffer.from(text, 'utf8').toString('hex');
const now = () => Number(process.hrtime.bigint() / 1_000_000n);
const iso = () => new Date().toISOString();
const replacer = (_key, item) => (typeof item === 'bigint' ? item.toString() : item);
const json = (value) => JSON.stringify(value, replacer);
const ident = (st) => ({ device: BigInt.asUintN(64, st.dev).toString(), inode: BigInt.asUintN(64, st.ino).toString() });
const sameIdent = (a, b) => Boolean(a && b) && String(a.device) === String(b.device) && String(a.inode) === String(b.inode);
const octal = (st) => (st.mode & 0o7777n).toString(8);
const kindOf = (st) => (st.isFile() ? 'file' : st.isDirectory() ? 'dir' : st.isSymbolicLink() ? 'symlink' : 'other');
const birthOf = (text) => text.replace(/ +/gu, ' ').trim();
const stopMessage = (error) => String(error instanceof Stop ? error.message : error?.stack ?? error).slice(0, 4000);
const sameName = (a, b) => a.normalize('NFC').toLowerCase() === b.normalize('NFC').toLowerCase();

async function lstatOrNull(path) {
  try {
    return await lstat(path, { bigint: true });
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null;
    throw error;
  }
}
async function realpathOrNull(path) {
  try { return await realpath(path); } catch { return null; }
}
function sha256File(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path, { flags: fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW })
      .on('error', reject).on('data', (chunk) => hash.update(chunk)).on('end', () => resolve(hash.digest('hex')));
  });
}
async function readBounded(path, cap, position = 0) {
  const handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const buffer = Buffer.alloc(cap);
    const { bytesRead } = await handle.read(buffer, 0, cap, position);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}
async function excerpt(path, cap) {
  const st = await lstat(path, { bigint: true });
  const size = Number(st.size);
  if (size <= 2 * cap) return readBounded(path, size);
  return Buffer.concat([await readBounded(path, cap), Buffer.from(`\n[QA excerpt omitted ${size - 2 * cap} bytes]\n`),
    await readBounded(path, cap, size - cap)]);
}
const tokenHits = (bytes, token) => (token ? bytes.toString('utf8').split(token).length - 1 : 0);

// ps renders non-printable bytes with vis(3); only GG_DATA_DIR needs decoding for comparison.
function unvis(text) {
  if (!text.includes('\\')) return text;
  const out = [];
  const chars = Array.from(text);
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] !== '\\') { out.push(...Buffer.from(chars[i])); continue; }
    const rest = chars.slice(i + 1, i + 5).join('');
    let match;
    if ((match = /^M-\^(.)/u.exec(rest))) out.push(0x80 | (match[1] === '?' ? 0x7f : match[1].charCodeAt(0) & 0x1f));
    else if ((match = /^M-(.)/u.exec(rest))) out.push(0x80 | match[1].charCodeAt(0));
    else if ((match = /^\^(.)/u.exec(rest))) out.push(match[1] === '?' ? 0x7f : match[1].charCodeAt(0) & 0x1f);
    else if ((match = /^([0-7]{3})/u.exec(rest))) out.push(parseInt(match[1], 8));
    else { out.push(0x5c); continue; }
    i += Array.from(match[0]).length;
  }
  return Buffer.from(out).toString('utf8');
}

// ---------------------------------------------------------------- evidence and stages
async function save(ctx, name, data) {
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(typeof data === 'string' ? data : JSON.stringify(data, replacer, 2) + '\n');
  ctx.evidenceBytes += bytes.length;
  if (ctx.evidenceBytes > CAP.evidence) throw new Stop('evidence byte cap exceeded');
  await writeFile(join(ctx.evidence, name), bytes, { mode: 0o600, flag: 'wx' });
  return { file: name, bytes: bytes.length, sha256: sha256(bytes) };
}

async function stage(ctx, id, cases, body) {
  ctx.tick();
  const record = { id, cases, startedAt: iso(), checks: [], notes: {}, status: 'running' };
  ctx.stages.push(record);
  ctx.current = record;
  const start = now();
  try {
    await body(record);
    record.status = record.checks.every((item) => item.ok) ? 'criteria-met' : 'criteria-not-met';
  } catch (error) {
    record.status = 'stopped';
    record.error = stopMessage(error);
    throw error;
  } finally {
    record.elapsedMs = now() - start;
    record.finishedAt = iso();
    if (ctx.evidence) await save(ctx, `stage-${id}.json`, record).catch(() => {});
  }
}
function check(ctx, id, ok, detail, hard) {
  const entry = { id, ok: Boolean(ok), hard };
  if (detail !== undefined) entry.detail = detail;
  ctx.current.checks.push(entry);
  if (!entry.ok && hard) throw new Stop(`${ctx.current.id}: ${id}`);
  return entry.ok;
}
const must = (ctx, id, ok, detail) => check(ctx, id, ok, detail, true);
const want = (ctx, id, ok, detail) => check(ctx, id, ok, detail, false);
const note = (ctx, key, value) => { ctx.current.notes[key] = value; };

// ---------------------------------------------------------------- bounded processes
async function runProcess(ctx, label, exe, args, options) {
  ctx.tick();
  const { cwd = '/', env, timeout = BOUND.probe, cap = CAP.stream, persist = true } = options;
  const file = options.file ?? ctx.fileProbes;
  if (!env) throw new Error('an explicit child environment is required');
  const name = String(++ctx.seq).padStart(4, '0') + '-' + label.replace(/[^A-Za-z0-9_.-]/gu, '_');
  const startedAt = iso();
  const start = now();
  const child = spawn(exe, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const parts = { stdout: [], stderr: [] };
  const received = { stdout: 0, stderr: 0 };
  const eof = { stdout: false, stderr: false };
  let exit = null;
  let spawnError = null;
  for (const stream of ['stdout', 'stderr']) {
    child[stream].on('data', (chunk) => {
      const room = cap - received[stream];
      if (room > 0) parts[stream].push(chunk.subarray(0, room));
      received[stream] += chunk.length;
    });
    child[stream].once('end', () => { eof[stream] = true; });
  }
  child.once('exit', (code, signal) => { exit = { code, signal, ms: now() - start }; });
  const timedOut = await new Promise((resolve) => {
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
    // At the bound nothing is signalled: pipes are released and the child stays recorded as uncertain.
    const timer = setTimeout(() => { child.stdout.destroy(); child.stderr.destroy(); child.unref(); finish(true); }, timeout);
    child.once('close', () => finish(false));
    child.once('error', (error) => { spawnError = error.code ?? error.name; setTimeout(() => finish(false), 100); });
  });
  const stdout = Buffer.concat(parts.stdout);
  const stderr = Buffer.concat(parts.stderr);
  const record = { name, label, exe, args, cwd, env: options.recordEnv === false ? Object.keys(env) : env, pid: child.pid ?? null,
    startedAt, elapsedMs: now() - start, exit, spawnError, timedOut, eof, received,
    overflow: { stdout: received.stdout > cap, stderr: received.stderr > cap },
    stdoutSha256: sha256(stdout), stderrSha256: sha256(stderr), rawPersisted: persist && file };
  if (file && ctx.evidence) {
    if (persist) {
      await save(ctx, name + '.stdout', stdout);
      await save(ctx, name + '.stderr', stderr);
    }
    await save(ctx, name + '.json', record);
  }
  return { ...record, stdout, stderr };
}
const clean = (r) => Boolean(r.exit) && r.exit.signal === null && !r.timedOut && !r.spawnError &&
  r.eof.stdout && r.eof.stderr && !r.overflow.stdout && !r.overflow.stderr;

function envelope(r, code, port) {
  const expected = JSON.stringify(port === undefined ? { version: 1, code } : { version: 1, code, port }) + '\n';
  const stdout = r.stdout.toString('utf8');
  return { ok: clean(r) && r.exit.code === EXIT[code] && stdout === expected && r.stderr.length === 0,
    exit: r.exit, stdout: stdout.slice(0, 512), stderrBytes: r.stderr.length, elapsedMs: r.elapsedMs, timedOut: r.timedOut };
}

// ---------------------------------------------------------------- loopback HTTP (QA ports only)
function qaPort(port) {
  if (!Number.isInteger(port) || port < 49152 || port > 65535 || FORBIDDEN_PORTS.has(port)) throw new Stop('refusing non-QA port ' + port);
}
function http(port, path, { method = 'GET', body, headers = {}, cap = CAP.http, timeout = BOUND.http } = {}) {
  qaPort(port);
  return new Promise((resolve, reject) => {
    const framing = body === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) };
    const req = request({ host: '127.0.0.1', port, path, method, agent: false, signal: AbortSignal.timeout(timeout),
      headers: { 'cache-control': 'no-cache', ...framing, ...headers } });
    req.once('error', reject);
    req.once('response', (res) => {
      const chunks = [];
      let count = 0;
      res.on('data', (chunk) => {
        count += chunk.length;
        if (count > cap) res.destroy(new Error('response exceeded the QA cap'));
        else chunks.push(chunk);
      });
      res.once('error', reject);
      res.once('end', () => resolve({ status: res.statusCode, raw: res.rawHeaders, bytes: Buffer.concat(chunks) }));
    });
    req.end(body);
  });
}
function headerValues(raw, name) {
  const values = [];
  for (let i = 0; i + 1 < raw.length; i += 2) if (raw[i].toLowerCase() === name) values.push(raw[i + 1]);
  return values;
}
async function health(port) {
  const r = await http(port, '/healthz', { cap: 4096 });
  const one = (name) => { const values = headerValues(r.raw, name); return { value: values.length === 1 ? values[0] : null, count: values.length }; };
  const instance = one('x-graphgoblin-instance');
  const pid = one('x-graphgoblin-pid');
  const phase = one('x-graphgoblin-phase');
  const length = one('content-length');
  return { status: r.status, body: r.bytes.toString('utf8'), instance: instance.value,
    pid: /^[1-9][0-9]*$/u.test(pid.value ?? '') ? Number(pid.value) : null, phase: phase.value,
    single: instance.count <= 1 && pid.count <= 1 && phase.count <= 1, exactLength: Number(length.value) === r.bytes.length };
}
async function portState(port) {
  try {
    const h = await health(port);
    return { state: 'answered', pid: h.pid, phase: h.phase, instance: h.instance };
  } catch (error) {
    return { state: error?.code === 'ECONNREFUSED' ? 'refused' : 'error', code: error?.code ?? error?.name ?? 'unknown' };
  }
}
async function api(port, method, path, body, headers) {
  const r = await http(port, path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers });
  let parsed = null;
  try { parsed = JSON.parse(r.bytes.toString('utf8')); } catch { /* recorded as null */ }
  return { status: r.status, json: parsed };
}

// ---------------------------------------------------------------- read-only process, socket and file probes
const PS_ONE = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\w{3} +\w{3} +\d{1,2} \d\d:\d\d:\d\d \d{4})\s+(.*)$/u;
const PS_ALL = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\w{3} +\w{3} +\d{1,2} \d\d:\d\d:\d\d \d{4})\s+(.*)$/u;

async function psOne(ctx, pid, label, file) {
  const r = await runProcess(ctx, label, TOOLS.ps, ['-ww', '-o', 'pid=,ppid=,pgid=,uid=,stat=,tty=,lstart=,command=', '-p', String(pid)],
    { env: ctx.probeEnv, cap: CAP.probe, file });
  if (!r.timedOut && r.exit?.code === 1 && r.stdout.length === 0) return null;
  if (!clean(r) || r.exit.code !== 0) throw new Stop('process inspection failed for ' + pid);
  const m = PS_ONE.exec(r.stdout.toString('utf8').trimEnd());
  if (!m) throw new Stop('process row not parseable for ' + pid);
  return { pid: Number(m[1]), ppid: Number(m[2]), pgid: Number(m[3]), uid: Number(m[4]), stat: m[5], tty: m[6], birth: birthOf(m[7]), command: m[8] };
}

// Raw process tables are never persisted: unrelated argv can carry secrets. Only QA rows are kept.
async function processRows(ctx, label, { ppid = null, file } = {}) {
  const r = await runProcess(ctx, label, TOOLS.ps, ['-A', '-ww', '-o', 'pid=,ppid=,uid=,lstart=,command='],
    { env: ctx.probeEnv, cap: CAP.probe, persist: false, file });
  if (!clean(r) || r.exit.code !== 0) throw new Stop('process table unavailable');
  const rows = [];
  for (const line of r.stdout.toString('utf8').split('\n')) {
    const m = PS_ALL.exec(line);
    if (!m || Number(m[3]) !== ctx.uid) continue;
    const row = { pid: Number(m[1]), ppid: Number(m[2]), birth: birthOf(m[4]), command: m[5] };
    if (row.pid === process.pid || row.pid === process.ppid) continue;
    if (row.ppid === ppid) rows.push({ pid: row.pid, ppid: row.ppid, birth: row.birth, command: basename(row.command.split(' ')[0]), child: true });
    else if (ctx.watch.some((part) => row.command.includes(part))) rows.push(row);
  }
  return rows;
}
const isGateway = (ctx, row) => !row.child && row.command.endsWith(' ' + ctx.entry);
const isHelper = (ctx, row) => !row.child && row.command.includes(ctx.helper);
const isLauncher = (ctx, row) => !row.child && ctx.launcherMarks.some((mark) => row.command.includes(mark));
const gatewayRows = async (ctx, label) => (await processRows(ctx, label, { file: false })).filter((row) => isGateway(ctx, row));

// The environment text is filtered in memory: names always, values only for the allow-list.
async function processEnvironment(ctx, pid, command, label) {
  const r = await runProcess(ctx, label, TOOLS.ps, ['-E', '-ww', '-o', 'command=', '-p', String(pid)],
    { env: ctx.probeEnv, cap: 256 * 1024, persist: false });
  if (!clean(r) || r.exit.code !== 0) throw new Stop('environment inspection failed');
  const text = r.stdout.toString('utf8').replace(/\n$/u, '');
  const hits = ctx.token ? text.split(ctx.token).length - 1 : 0;
  if (!text.startsWith(command)) return { observable: false, reason: 'command prefix differs', tokenHits: hits, rawSha256: sha256(r.stdout) };
  const tail = text.slice(command.length);
  const marks = [...tail.matchAll(/ ([A-Za-z_][A-Za-z0-9_]*)=/gu)];
  const names = [];
  const allow = {};
  const other = {};
  marks.forEach((mark, i) => {
    const value = tail.slice(mark.index + mark[0].length, i + 1 < marks.length ? marks[i + 1].index : tail.length);
    names.push(mark[1]);
    if (ENV_ALLOW.has(mark[1])) allow[mark[1]] = value;
    else other[mark[1]] = { sha256: sha256(value), token: Boolean(ctx.token) && value.includes(ctx.token) };
  });
  return { observable: names.length > 0, names, allow, other, duplicates: names.filter((n, i) => names.indexOf(n) !== i), tokenHits: hits, rawSha256: sha256(r.stdout) };
}

async function lsofTcp(ctx, port, state, label, file) {
  const args = ['-nP', `-iTCP:${port}`, ...(state ? [`-sTCP:${state}`] : []), '-F', 'pcn'];
  const r = await runProcess(ctx, label, TOOLS.lsof, args, { env: ctx.probeEnv, cap: CAP.probe, file });
  if (!r.timedOut && r.exit?.code === 1 && r.stdout.length === 0) return [];
  if (!clean(r) || r.exit.code !== 0) throw new Stop('socket inspection failed on ' + port);
  const out = [];
  let pid = null;
  let command = null;
  for (const line of r.stdout.toString('utf8').split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (line.startsWith('c')) command = line.slice(1);
    else if (line.startsWith('n')) out.push({ pid, command, address: line.slice(1) });
  }
  return out;
}
async function openFiles(ctx, pid, label) {
  const r = await runProcess(ctx, label, TOOLS.lsof, ['-nP', '-a', '-p', String(pid), '-d', 'cwd,txt,0-2', '-F', 'fn'],
    { env: ctx.probeEnv, cap: CAP.probe });
  if (!clean(r) || r.exit.code !== 0) throw new Stop('open-file inspection failed for ' + pid);
  const files = {};
  let fd = null;
  for (const line of r.stdout.toString('utf8').split('\n')) {
    if (line.startsWith('f')) fd = line.slice(1);
    else if (line.startsWith('n') && fd !== null) (files[fd] ??= []).push(line.slice(1));
  }
  return files;
}
async function foreignConnections(ctx, port, exclude, durationMs, label) {
  const found = new Map();
  const start = now();
  while (now() - start < durationMs) {
    for (const entry of await lsofTcp(ctx, port, 'ESTABLISHED', label, false)) {
      if (!exclude.includes(entry.pid)) found.set(entry.pid, entry.command);
    }
    await pause(500);
  }
  return [...found].map(([pid, command]) => ({ pid, command }));
}

async function leaseRecord(ctx, path, st) {
  const safe = st.isFile() && st.uid === BigInt(ctx.uid) && st.nlink === 1n && (st.mode & 0o077n) === 0n && st.size <= 4096n;
  if (!safe) return { kind: kindOf(st), safe: false, mode: octal(st) };
  const bytes = await readBounded(path, 4096);
  let pid = null;
  try { pid = JSON.parse(bytes.toString('utf8')).pid ?? null; } catch { pid = 'unparseable'; }
  return { kind: 'file', safe: true, pid, sha256: sha256(bytes), mode: octal(st), ...ident(st) };
}
async function leaseState(ctx) {
  const out = {};
  for (const name of LEASES) {
    const path = join(ctx.dataDir, name);
    const st = await lstatOrNull(path);
    const guard = await lstatOrNull(path + '.reclaim');
    out[name] = st === null ? null : await leaseRecord(ctx, path, st);
    out[name + '.reclaim'] = guard === null ? null : { kind: kindOf(guard), ...ident(guard) };
  }
  return out;
}
const leasesFree = (lease) => Object.values(lease).every((value) => value === null);
const leasesHeldBy = (lease, pid) => LEASES.every((n) => lease[n]?.pid === pid && lease[n + '.reclaim'] === null);

async function storeSnapshot(ctx) {
  const st = await lstatOrNull(ctx.dataDir);
  if (st === null) return { present: false };
  return { present: true, ...ident(st), names: (await readdir(ctx.dataDir)).sort().map(hex), leases: await leaseState(ctx) };
}

const EMPTY_DIGEST = createHash('sha256').digest('hex');
async function dirSummary(path, keep) {
  const st = await lstatOrNull(path);
  if (st === null) return { present: false, kept: [], otherDigest: EMPTY_DIGEST };
  if (!st.isDirectory()) return { present: true, kind: kindOf(st), ...ident(st), kept: [], otherDigest: 'not-a-directory' };
  const kept = [];
  const other = createHash('sha256');
  const names = (await readdir(path)).sort();
  for (const name of names) {
    const entry = await lstatOrNull(join(path, name));
    const item = entry === null ? { gone: true } : { kind: kindOf(entry), ...ident(entry), size: entry.size.toString(), mtimeNs: entry.mtimeNs.toString(), mode: octal(entry) };
    if (keep(name)) kept.push({ nameHex: hex(name), name, ...item });
    else other.update(json({ name, ...item }) + '\n');
  }
  return { present: true, ...ident(st), mode: octal(st), count: names.length, otherDigest: other.digest('hex'), kept };
}
async function entrySummary(path) {
  const st = await lstatOrNull(path);
  return st === null ? { present: false } : { present: true, kind: kindOf(st), ...ident(st), size: st.size.toString(),
    mtimeNs: st.mtimeNs.toString(), ctimeNs: st.ctimeNs.toString(), mode: octal(st) };
}
// Owner resources are stat-ed or listed only. Names are kept only for GraphGoblin-related entries.
async function ownerSnapshot(ctx, label) {
  const lib = join(ctx.home, 'Library');
  const app = join(ctx.home, 'Applications', 'GraphGoblin.app');
  const graphgoblin = (name) => /^graphgoblin/iu.test(name.normalize('NFC')) || name.startsWith(STAGE_PREFIX);
  const all = () => true;
  return {
    at: iso(),
    protectedPorts: { 4747: await lsofTcp(ctx, 4747, 'LISTEN', label + '-4747'), 4748: await lsofTcp(ctx, 4748, 'LISTEN', label + '-4748') },
    applications: await dirSummary(join(ctx.home, 'Applications'), graphgoblin),
    defaultApp: { bundle: await entrySummary(app), plist: await entrySummary(join(app, 'Contents', 'Info.plist')),
      executable: await entrySummary(join(app, 'Contents', 'MacOS', 'GraphGoblin')),
      config: await entrySummary(join(app, 'Contents', 'Resources', 'launcher.json')) },
    defaultStore: await entrySummary(join(ctx.home, '.graphgoblin')),
    productionLogs: await dirSummary(join(lib, 'Logs', 'GraphGoblin', 'Launcher'), all),
    instanceLogs: await dirSummary(join(lib, 'Logs', 'GraphGoblin', 'LauncherInstances'), all),
    receipts: await dirSummary(join(lib, 'Application Support', 'GraphGoblin', 'LauncherInstalls'), all),
    locks: await dirSummary(join(lib, 'Application Support', 'GraphGoblin', 'LauncherLocks'), all),
    crashReports: await dirSummary(join(lib, 'Logs', 'DiagnosticReports'), (name) => /^graphgoblin/iu.test(name)),
  };
}
function diffKept(before, after) {
  const index = (summary) => new Map((summary.kept ?? []).map((entry) => [entry.nameHex, json(entry)]));
  const b = index(before);
  const a = index(after);
  return { added: [...a.keys()].filter((k) => !b.has(k)), removed: [...b.keys()].filter((k) => !a.has(k)),
    changed: [...a.keys()].filter((k) => b.has(k) && a.get(k) !== b.get(k)),
    otherChanged: before.otherDigest !== after.otherDigest, presence: [before.present, after.present] };
}
const onlyQa = (d, allowed) => d.removed.length === 0 && !d.otherChanged && [...d.added, ...d.changed].every((h) => allowed.includes(h));
const created = (before, after) => !before.present && after.present;

async function logDirState(ctx, id) {
  const root = join(ctx.home, 'Library', 'Logs', 'GraphGoblin', 'LauncherInstances', id);
  const st = await lstatOrNull(root);
  if (st === null) return { root, present: false, files: {} };
  const files = {};
  for (const name of (await readdir(root)).sort()) {
    const e = await lstat(join(root, name), { bigint: true });
    const entry = { kind: kindOf(e), uid: Number(e.uid), nlink: Number(e.nlink), mode: octal(e), size: Number(e.size), ...ident(e), managed: name in LOG_CAPS };
    if (e.isFile() && e.size <= BigInt(LOG_CAPS['gateway.log'])) {
      const bytes = await readBounded(join(root, name), Number(e.size));
      entry.sha256 = sha256(bytes);
      entry.tokenHits = tokenHits(bytes, ctx.token);
      if (name.startsWith('launcher.log')) entry.text = bytes.toString('utf8');
    }
    files[name] = entry;
  }
  return { root, present: true, kind: kindOf(st), uid: Number(st.uid), mode: octal(st), ...ident(st), files };
}
const withoutText = (state) => ({ ...state, files: Object.fromEntries(Object.entries(state.files).map(([n, f]) => [n, { ...f, text: undefined, lines: f.text?.split('\n').filter(Boolean).slice(-20) }])) });
function newLauncherLines(before, after) {
  const was = before.files['launcher.log']?.text ?? '';
  const is = after.files['launcher.log']?.text ?? '';
  if (!is.startsWith(was)) return { rotated: true, lines: is.split('\n').filter(Boolean).slice(-5) };
  return { rotated: false, lines: is.slice(was.length).split('\n').filter(Boolean) };
}

// ---------------------------------------------------------------- product interfaces (bound in case-map.json C2-C6)
function fileUri(path) {
  const uri = 'file://' + encodeURI(path).replace(/[?#]/gu, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  if (fileURLToPath(uri) !== path) throw new Stop('QA file URI encoder self-check failed');
  return uri;
}
function expectedEnv(ctx, port, node = ctx.node) {
  return { HOME: ctx.home, PATH: dirname(node) + ':' + SYS_PATH, LANG: 'en_US.UTF-8', TMPDIR: ctx.userTemp, GG_HOST: '127.0.0.1',
    GG_PORT: String(port), GG_DATA_DIR: ctx.dataDir, GG_WEB_DIST: ctx.webDist, GG_GOBLIN_DIST: ctx.goblinDist,
    GG_DB_URL: fileUri(join(ctx.dataDir, 'graphgoblin.db')), GG_REQUIRE_API_KEY: 'false', GG_OLLAMA_ENABLED: 'false' };
}
async function helperLine(ctx, label, port, args = []) {
  const r = await runProcess(ctx, label, ctx.node, [ctx.helper, ...args], { cwd: ctx.checkout, env: expectedEnv(ctx, port), timeout: BOUND.helper });
  return { ok: clean(r) && r.exit.code === 0 && r.stderr.length === 0, text: r.stdout.toString('utf8') };
}
function install(ctx, label, script, name, dataDir, port, node = ctx.node) {
  qaPort(port);
  return runProcess(ctx, label, TOOLS.bash, [script, '--app-name', name, '--node', node, '--data-dir', dataDir, '--port', String(port), '--disable-ollama'],
    { cwd: dirname(dirname(script)), env: ctx.installEnv, timeout: BOUND.install });
}
function headless(ctx, label, app, env = ctx.launchEnv) {
  return runProcess(ctx, label, join(app, 'Contents', 'MacOS', 'GraphGoblin'), ['--ensure-gateway'], { env, timeout: BOUND.headless });
}

async function shells(ctx, port) {
  const out = [];
  for (const [route, dir] of [['/app/', ctx.webDist], ['/goblin/', ctx.goblinDist]]) {
    const built = await readFile(join(dir, 'index.html'));
    const served = await http(port, route);
    const asset = [...built.toString('utf8').matchAll(/\b(?:src|href)="([^"]+)"/gu)].map((m) => m[1])
      .find((value) => value.startsWith(route + 'assets/') && /\.(?:css|js)$/u.test(value));
    let assetMatch = null;
    if (asset && basename(asset) === asset.slice((route + 'assets/').length)) {
      const builtAsset = await readFile(join(dir, 'assets', basename(asset)));
      // The served asset is capped at its exact built length, which must itself stay within the fixed CAP.asset.
      if (builtAsset.length > CAP.asset) throw new Stop(`built asset ${asset} has ${builtAsset.length} bytes, above the ${CAP.asset}-byte QA asset bound`);
      const servedAsset = await http(port, asset, { cap: builtAsset.length });
      assetMatch = servedAsset.status === 200 && sha256(servedAsset.bytes) === sha256(builtAsset);
    }
    out.push({ route, status: served.status, shellMatch: served.status === 200 && sha256(served.bytes) === sha256(built),
      contentType: headerValues(served.raw, 'content-type')[0] ?? null, asset: asset ?? null, assetMatch });
  }
  return out;
}

async function witness(ctx, port, label, expected = {}) {
  const first = await health(port);
  must(ctx, label + ':health-shape', first.status === 200 && first.body === '{"status":"ok"}' && first.single && first.exactLength &&
    /^[0-9a-f]{64}$/u.test(first.instance ?? '') && first.pid !== null, { status: first.status, phase: first.phase, pid: first.pid });
  if (expected.instance) must(ctx, label + ':instance', first.instance === expected.instance, { observed: first.instance, expected: expected.instance });
  const proc = await psOne(ctx, first.pid, label + '-ps');
  must(ctx, label + ':process', proc !== null && proc.uid === ctx.uid && proc.command === (expected.command ?? ctx.gatewayCommand), { proc });
  const sockets = await lsofTcp(ctx, port, 'LISTEN', label + '-listen');
  must(ctx, label + ':single-loopback-listener', sockets.length === 1 && sockets[0].pid === first.pid && sockets[0].address === `127.0.0.1:${port}`, { sockets });
  const lease = await leaseState(ctx);
  must(ctx, label + ':lease-holder', leasesHeldBy(lease, first.pid), { lease });
  const second = await health(port);
  must(ctx, label + ':stable-identity', second.pid === first.pid && second.instance === first.instance, { pid: second.pid, phase: second.phase });
  return { port, pid: first.pid, birth: proc.birth, instance: first.instance, phase: second.phase, ppid: proc.ppid, pgid: proc.pgid,
    stat: proc.stat, tty: proc.tty, command: proc.command, leases: Object.fromEntries(LEASES.map((n) => [n, lease[n].sha256])) };
}
const sameOwner = (a, b) => a.pid === b.pid && a.birth === b.birth && a.instance === b.instance && LEASES.every((n) => a.leases[n] === b.leases[n]);

// Ordinary authenticated drain only: never force, never signal. Failure preserves everything.
async function drainVerified(ctx, owner, label, boundMs = BOUND.release) {
  const fresh = await witness(ctx, owner.port, label + '-pre', { instance: owner.instance, command: owner.command });
  must(ctx, label + ':registered-owner', sameOwner(fresh, owner), { fresh, owner });
  const state = await api(owner.port, 'GET', '/system/shutdown');
  must(ctx, label + ':shutdown-state', state.status === 200 && state.json?.phase === 'running' && typeof state.json?.controlToken === 'string',
    { status: state.status, phase: state.json?.phase });
  const recheck = await health(owner.port);
  must(ctx, label + ':same-incarnation', recheck.pid === owner.pid && recheck.instance === owner.instance);
  const drain = await api(owner.port, 'POST', '/system/shutdown', { action: 'drain' }, { 'x-graphgoblin-shutdown-token': state.json.controlToken });
  must(ctx, label + ':drain-accepted', drain.status === 202, { status: drain.status, phase: drain.json?.phase });
  const series = [];
  const start = now();
  let released = false;
  let forcing = null;
  while (now() - start < boundMs) {
    ctx.tick();
    const seen = await portState(owner.port);
    if (series.length === 0 || series.at(-1).state !== seen.state || series.at(-1).phase !== seen.phase) series.push({ ms: now() - start, ...seen });
    if (['forcing', 'force-failed'].includes(seen.phase)) forcing = seen.phase;
    if (seen.state === 'refused') {
      const proc = await psOne(ctx, owner.pid, label + '-exit-poll', false);
      if ((proc === null || proc.birth !== owner.birth) && leasesFree(await leaseState(ctx))) { released = true; break; }
    }
    await pause(250);
  }
  must(ctx, label + ':never-forcing', forcing === null, { forcing });
  must(ctx, label + ':released', released, { series });
  const store = await helperLine(ctx, label + '-store-state', ctx.ports.p, ['--store-state']);
  must(ctx, label + ':store-free', store.ok && store.text === '{"state":"free"}\n', { text: store.text.slice(0, 200) });
  return { shutdown: { phase: state.json.phase, activeRunIds: state.json.activeRunIds ?? null, unconfirmedRunIds: state.json.unconfirmedRunIds ?? null,
    choices: state.json.choices ?? null, graceMs: state.json.graceMs ?? null }, series, elapsedMs: now() - start };
}

async function readInstalled(ctx, name, label) {
  const applications = join(ctx.home, 'Applications');
  const path = join(applications, name);
  const appsStat = await lstat(applications, { bigint: true });
  const bundle = await lstat(path, { bigint: true });
  const tree = {};
  for (const rel of ['.', 'Contents', 'Contents/MacOS', 'Contents/Resources']) {
    const st = await lstatOrNull(join(path, rel));
    tree[rel] = st === null ? null : { kind: kindOf(st), uid: Number(st.uid), mode: octal(st), names: st.isDirectory() ? (await readdir(join(path, rel))).sort() : [] };
  }
  const files = {};
  let machO = false;
  let configText = '';
  for (const rel of ['Contents/Info.plist', 'Contents/MacOS/GraphGoblin', 'Contents/Resources/launcher.json']) {
    const st = await lstat(join(path, rel), { bigint: true });
    const bytes = st.isFile() && st.size <= 64n * 1024n * 1024n ? await readBounded(join(path, rel), Number(st.size)) : Buffer.alloc(0);
    files[rel] = { kind: kindOf(st), uid: Number(st.uid), mode: octal(st), nlink: Number(st.nlink), size: Number(st.size), sha256: sha256(bytes) };
    if (rel.endsWith('GraphGoblin')) machO = bytes.subarray(0, 8).equals(Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0, 0, 0x01])) && bytes.subarray(12, 16).equals(Buffer.from([2, 0, 0, 0]));
    if (rel.endsWith('launcher.json')) configText = bytes.toString('utf8');
  }
  const plistRead = await runProcess(ctx, label + '-plist', TOOLS.plutil, ['-convert', 'json', '-o', '-', join(path, 'Contents', 'Info.plist')], { env: ctx.probeEnv });
  const plist = clean(plistRead) && plistRead.exit.code === 0 ? JSON.parse(plistRead.stdout.toString('utf8')) : null;
  const xattrRead = await runProcess(ctx, label + '-xattr', TOOLS.xattr, ['-r', path], { env: ctx.probeEnv });
  const id = typeof plist?.GraphGoblinInstallationID === 'string' ? plist.GraphGoblinInstallationID : null;
  let receipt = null;
  if (id !== null && /^[0-9a-f]{32}$/u.test(id)) {
    const receiptPath = join(ctx.home, 'Library', 'Application Support', 'GraphGoblin', 'LauncherInstalls', id + '.json');
    const st = await lstatOrNull(receiptPath);
    if (st?.isFile() && st.size <= 16384n) {
      const bytes = await readBounded(receiptPath, Number(st.size));
      receipt = { path: receiptPath, ...ident(st), mode: octal(st), uid: Number(st.uid), nlink: Number(st.nlink), sha256: sha256(bytes), text: bytes.toString('utf8') };
      try { receipt.object = JSON.parse(receipt.text); } catch { receipt.object = null; }
    }
  }
  let config = null;
  try { config = JSON.parse(configText); } catch { /* checked by the caller */ }
  return { name, nameHex: hex(name), path, applications: ident(appsStat), bundle: ident(bundle), bundleKind: kindOf(bundle), tree, files, machO,
    plist, id, config, configText, receipt, xattr: clean(xattrRead) ? xattrRead.stdout.toString('utf8').split('\n').filter(Boolean) : null };
}
function checkInstalled(ctx, inst, exp, tag) {
  const p = (id) => `${tag}:${id}`;
  const t = inst.tree;
  must(ctx, p('bundle-physical'), inst.bundleKind === 'dir' && t['.']?.uid === ctx.uid, { kind: inst.bundleKind });
  want(ctx, p('bundle-inventory'), json(t['.'].names) === json(['Contents']) && json(t.Contents?.names) === json(['Info.plist', 'MacOS', 'Resources']) &&
    json(t['Contents/MacOS']?.names) === json(['GraphGoblin']) && json(t['Contents/Resources']?.names) === json(['launcher.json']), t);
  want(ctx, p('files-owned-single-link'), Object.values(inst.files).every((f) => f.kind === 'file' && f.uid === ctx.uid && f.nlink === 1 &&
    (parseInt(f.mode, 8) & 0o022) === 0), inst.files);
  want(ctx, p('arm64-executable'), inst.machO);
  want(ctx, p('no-quarantine'), Array.isArray(inst.xattr) && !inst.xattr.some((line) => line.includes('com.apple.quarantine')), { xattr: inst.xattr });
  must(ctx, p('installation-id'), /^[0-9a-f]{32}$/u.test(inst.id ?? '') && (!exp.id || inst.id === exp.id), { id: inst.id, expected: exp.id ?? null });
  must(ctx, p('bundle-identifier'), inst.plist?.CFBundleIdentifier === 'com.graphgoblin.launcher.instance.' + inst.id && inst.plist?.CFBundleExecutable === 'GraphGoblin',
    { bundleIdentifier: inst.plist?.CFBundleIdentifier });
  want(ctx, p('regular-app-plist'), inst.plist && !('LSUIElement' in inst.plist) && !('LSBackgroundOnly' in inst.plist), { keys: Object.keys(inst.plist ?? {}).sort() });
  const cfg = inst.config ?? {};
  want(ctx, p('config-closed-keys'), json(Object.keys(cfg).sort()) === json(['checkout', 'dataDirectory', 'node', 'ollamaEnabled', 'port', 'requireAPIKey', 'version']),
    { keys: Object.keys(cfg).sort() });
  must(ctx, p('config-values'), cfg.version === 1 && cfg.checkout === ctx.checkout && cfg.node === exp.node && cfg.port === exp.port &&
    typeof cfg.dataDirectory === 'string' && cfg.dataDirectory.normalize('NFC') === exp.dataDir.normalize('NFC'),
    { checkout: cfg.checkout, node: cfg.node, port: cfg.port, dataDirectoryHex: typeof cfg.dataDirectory === 'string' ? hex(cfg.dataDirectory) : null });
  want(ctx, p('config-options'), cfg.requireAPIKey === false && cfg.ollamaEnabled === false);
  must(ctx, p('no-canary-in-config'), !ctx.token || !inst.configText.includes(ctx.token));
  const r = inst.receipt;
  must(ctx, p('receipt-private'), r !== null && r.uid === ctx.uid && r.nlink === 1 && (parseInt(r.mode, 8) & 0o077) === 0, r && { mode: r.mode });
  const o = r.object ?? {};
  must(ctx, p('receipt-binding'), o.version === 1 && o.id === inst.id && o.name === exp.name && sameIdent(o.applications, inst.applications) &&
    sameIdent(o.installed?.bundle, inst.bundle) && o.installed?.executable === inst.files['Contents/MacOS/GraphGoblin'].sha256 &&
    o.installed?.plist === inst.files['Contents/Info.plist'].sha256 && o.installed?.configuration === inst.files['Contents/Resources/launcher.json'].sha256,
    { receipt: o, observedBundle: inst.bundle });
  must(ctx, p('receipt-settled'), json(Object.keys(o).sort()) === json(['applications', 'id', 'installed', 'name', 'version']), { keys: Object.keys(o).sort() });
}
const strip = (inst) => ({ ...inst, configText: undefined, receipt: inst.receipt && { ...inst.receipt, text: undefined } });
// ~/Applications may be absent (ENOENT) only before the first QA install; the public installer creates its own
// physical destination and this driver never does. Otherwise, as the installer requires, it and (when absent) its
// parent must be user-owned physical directories without group or other write. Every other error is raised.
const ownedDirectory = (st, uid) => st.isDirectory() && Number(st.uid) === uid && (st.mode & 0o022n) === 0n;
async function applicationsEntries(ctx, preinstall = false) {
  const applications = join(ctx.home, 'Applications');
  let st;
  try {
    st = await lstat(applications, { bigint: true });
  } catch (error) {
    if (!preinstall || error?.code !== 'ENOENT') throw error;
    if (!ownedDirectory(await lstat(ctx.home, { bigint: true }), ctx.uid)) throw new Stop('home is not a user-owned directory without group or other write');
    return [];
  }
  if (!ownedDirectory(st, ctx.uid)) throw new Stop('~/Applications is not a user-owned physical directory without group or other write');
  return readdir(applications);
}
async function matchingApps(ctx, name, preinstall = false) {
  return (await applicationsEntries(ctx, preinstall)).filter((entry) => sameName(entry, name)).map(hex);
}
async function stageResidue(ctx, preinstall = false) {
  return (await applicationsEntries(ctx, preinstall)).filter((entry) => entry.startsWith(STAGE_PREFIX)).sort();
}

// ---------------------------------------------------------------- fixtures
function canaryEnvironment(ctx) {
  const t = ctx.token;
  const bad = `/nonexistent-${t}`;
  // HOME is deliberately absent. Every value is synthetic; none is a real secret. GG_HOST is a distinct
  // literal loopback address, so even an inherited-host regression stays local.
  return { PATH: `${bad}/bin`, NODE_OPTIONS: `--require=${bad}/inject.cjs`, DYLD_FALLBACK_LIBRARY_PATH: `${bad}/lib`,
    HTTP_PROXY: `http://${t}.invalid:9`, HTTPS_PROXY: `http://${t}.invalid:9`, ALL_PROXY: `http://${t}.invalid:9`, NO_PROXY: `${t}.invalid`,
    LANG: `${t}/not-a-locale`, LC_ALL: t, TMPDIR: `${bad}/tmp`, GG_HOST: '127.0.0.2', GG_PORT: String(ctx.ports.p2),
    GG_DATA_DIR: `${bad}/data`, GG_DB_URL: `file://${bad}/x.db`, GG_WEB_DIST: `${bad}/web`, GG_GOBLIN_DIST: `${bad}/goblin`,
    GG_REQUIRE_API_KEY: 'true', GG_OLLAMA_ENABLED: 'true', GG_MASTER_KEY: `not-a-key-${t}`, GG_SHUTDOWN_GRACE_MS: '1', GG_LOG_LEVEL: t,
    GG_QA_CANARY: t, GG_MACOS_LAUNCHER_LOG_ADMISSION: JSON.stringify({ version: 1, root: `${bad}/logs`, device: '1', inode: '1' }) };
}
function waitLoop(ctx) {
  return { schemaVersion: 4, name: `QA wait ${ctx.runId}`, description: 'Provider-free #456 QA fixture: manual trigger, durable timer, quiet exit.',
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', ui: { x: 0, y: 0 }, config: { type: 'manual', exposeTo: ['ui', 'api', 'mcp'] } },
      { id: 'pause', kind: 'wait', label: 'Pause', ui: { x: 260, y: 0 }, config: { mode: 'duration', seconds: WAIT_SECONDS } },
      { id: 'done', kind: 'exit', label: 'Done', ui: { x: 520, y: 0 }, config: { outcome: 'success', returns: 'none', destinations: [] } },
    ],
    edges: [
      { id: 'start-pause', from: { node: 'start', port: 'out' }, to: { node: 'pause', port: 'in' } },
      { id: 'pause-done', from: { node: 'pause', port: 'out' }, to: { node: 'done', port: 'in' } },
    ] };
}
async function pollRun(ctx, port, runId, done, boundMs) {
  const series = [];
  const start = now();
  let last = null;
  while (now() - start < boundMs) {
    ctx.tick();
    const r = await api(port, 'GET', `/runs/${runId}`);
    const status = r.status === 200 ? r.json?.status ?? null : 'http-' + r.status;
    if (status !== last) { series.push({ ms: now() - start, status, waitingKind: r.json?.waiting?.kind ?? null }); last = status; }
    if (done(status)) return { final: status, series };
    await pause(1000);
  }
  return { final: last, series, timedOut: true };
}
async function gatewayChildren(ctx, pid, label) {
  return (await processRows(ctx, label, { ppid: pid })).filter((row) => row.child).map((row) => ({ pid: row.pid, name: row.command }));
}
async function openListener(port) {
  qaPort(port);
  const state = { mode: 'plain-health', counts: {}, server: null, impostor: null };
  state.server = createServer((req, res) => {
    if ((req.url ?? '').startsWith('/healthz')) state.counts[state.mode] = (state.counts[state.mode] ?? 0) + 1;
    const body = '{"status":"ok"}';
    const headers = { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) };
    if (state.mode === 'foreign-identity') {
      Object.assign(headers, { 'x-graphgoblin-instance': state.impostor, 'x-graphgoblin-pid': String(process.pid), 'x-graphgoblin-phase': 'running' });
    }
    res.writeHead(200, headers);
    res.end(body);
  });
  await new Promise((resolve, reject) => { state.server.once('error', reject); state.server.listen({ host: '127.0.0.1', port, exclusive: true }, resolve); });
  return state;
}
function closeListener(state) {
  return new Promise((resolve) => { state.server.close(() => resolve()); state.server.closeAllConnections?.(); });
}
async function startContender(ctx) {
  const dir = join(ctx.scope, 'contender');
  await mkdir(dir, { mode: 0o700 });
  // The clean gateway environment with the exact byte-encoded GG_DB_URL. Without it the API falls back to
  // an unescaped file URI for the '%41 #1' store and can open a different SQLite path. No log admission.
  const env = expectedEnv(ctx, ctx.ports.p2);
  const out = await open(join(dir, 'stdout.log'), 'wx', 0o600);
  const err = await open(join(dir, 'stderr.log'), 'wx', 0o600);
  const child = spawn(ctx.node, [ctx.entry], { cwd: ctx.checkout, env, stdio: ['ignore', out.fd, err.fd] });
  await out.close();
  await err.close();
  const contender = { child, env, dir, pid: child.pid ?? null, startedAt: iso(), exit: null, spawnError: null, owner: null };
  contender.exited = new Promise((resolve) => {
    child.once('exit', (code, signal) => { contender.exit = { code, signal, at: iso() }; resolve(contender.exit); });
    child.once('error', (error) => { contender.spawnError = error.code ?? error.name; resolve(null); });
  });
  ctx.contender = contender;
  await save(ctx, 'contender-start.json', { argv: [ctx.node, ctx.entry], cwd: ctx.checkout, env, pid: contender.pid, startedAt: contender.startedAt });
  const start = now();
  while (now() - start < BOUND.ready && contender.exit === null && contender.spawnError === null) {
    const seen = await portState(ctx.ports.p2);
    if (seen.state === 'answered' && seen.pid === contender.pid && seen.phase === 'running') return contender;
    await pause(250);
  }
  must(ctx, 'contender-ready', false, { exit: contender.exit, spawnError: contender.spawnError });
  return contender;
}
async function contenderOutputs(ctx) {
  const out = [];
  for (const name of ['stdout.log', 'stderr.log']) {
    const path = join(ctx.contender.dir, name);
    const st = await lstat(path, { bigint: true });
    const bytes = await readBounded(path, Math.min(Number(st.size), 8 * 1024 * 1024));
    out.push({ name, size: Number(st.size), sha256: sha256(bytes), tokenHits: tokenHits(bytes, ctx.token) });
  }
  return out;
}

// ---------------------------------------------------------------- launcher source digest (root binds the same rule)
async function launcherDigest(checkout) {
  const files = [];
  async function walk(rel) {
    for (const name of (await readdir(join(checkout, rel))).sort()) {
      const path = rel + '/' + name;
      const st = await lstat(join(checkout, path));
      if (st.isSymbolicLink()) throw new Stop('symlink in launcher source: ' + path);
      if (st.isDirectory()) await walk(path);
      else if (st.isFile()) files.push(path);
      else throw new Stop('unexpected launcher source entry: ' + path);
    }
  }
  await walk('apps/macos-launcher');
  files.push('scripts/install-macos-launcher.sh');
  files.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  const lines = [];
  for (const path of files) lines.push(sha256(await readFile(join(checkout, path))) + '  ' + path + '\n');
  return { rule: 'sha256 of sorted "<sha256>  <posix path>\\n" lines for apps/macos-launcher/** and scripts/install-macos-launcher.sh', digest: sha256(lines.join('')), files: files.length };
}
async function topListing(checkout) {
  return { root: (await readdir(checkout)).sort(), launcher: (await readdir(join(checkout, 'apps', 'macos-launcher'))).sort() };
}

// ---------------------------------------------------------------- run mode
async function baseContext(budgetMs) {
  const user = userInfo();
  const home = await realpath(user.homedir);
  const ctx = { uid: user.uid, user: user.username, home, seq: 0, evidence: null, evidenceBytes: 0, stages: [], current: null,
    fileProbes: true, deadline: now() + budgetMs, token: null, watch: [], launcherMarks: [],
    probeEnv: { PATH: SYS_PATH, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', HOME: home } };
  ctx.tick = () => { if (now() > ctx.deadline) throw new Stop('total time bound exceeded'); };
  return ctx;
}

async function admit(flags) {
  const problems = [];
  const need = (ok, message) => { if (!ok) problems.push(message); return Boolean(ok); };
  let binding = null;
  try { binding = JSON.parse(await readFile(flags['--binding'], 'utf8')); } catch (error) { problems.push('binding unreadable: ' + (error?.code ?? 'invalid JSON')); }
  const minutes = Number.isInteger(binding?.maxMinutes) && binding.maxMinutes >= 15 && binding.maxMinutes <= 90 ? binding.maxMinutes : 45;
  const ctx = await baseContext(minutes * 60_000);
  ctx.binding = binding;
  ctx.onStop = flags['--on-stop'] ?? 'drain';
  ctx.includeNodeMove = flags['--include-node-move'] === true;
  need(['drain', 'leave'].includes(ctx.onStop), '--on-stop must be drain or leave');
  if (binding) {
    need(binding.schema === BINDING_SCHEMA, 'binding schema');
    need(binding.final === true && typeof binding.boundBy === 'string' && binding.boundBy.length > 0, 'binding is not final; the preparation baseline is not executable');
    for (const key of ['head', 'tree', 'base']) need(/^[0-9a-f]{40}$/u.test(binding.candidate?.[key] ?? ''), 'candidate.' + key);
    need(/^[0-9a-f]{64}$/u.test(binding.driverSha256 ?? ''), 'driverSha256');
    need(/^[0-9a-f]{64}$/u.test(binding.launcherSourceDigest ?? ''), 'launcherSourceDigest');
    need(/^[0-9a-f]{64}$/u.test(binding.node?.sha256 ?? '') && /^22\.\d+\.\d+$/u.test(binding.node?.version ?? '') && typeof binding.node?.path === 'string', 'node binding');
    need(Number.isInteger(binding.owner?.uid) && typeof binding.owner?.user === 'string', 'owner binding');
    need(typeof binding.checkout === 'string' && binding.checkout.startsWith('/'), 'checkout binding');
    need(binding.files && Object.keys(binding.files).length > 0 && Object.values(binding.files).every((v) => /^[0-9a-f]{64}$/u.test(v)), 'built file hashes');
    need(binding.ports === null || binding.ports === undefined || (Array.isArray(binding.ports) && binding.ports.length === 2), 'ports must be null or [P, P2]');
  }
  if (problems.length === 0) await platformAdmission(ctx, flags, need);
  if (problems.length > 0) {
    process.stdout.write(JSON.stringify({ schema: SCHEMA, status: 'admission-refused', problems, effects: 'none' }) + '\n');
    process.exitCode = 2;
    return null;
  }
  return ctx;
}

async function platformAdmission(ctx, flags, need) {
  const b = ctx.binding;
  ctx.admission = { at: iso(), binding: b };
  need(process.platform === 'darwin' && process.arch === 'arm64', 'platform must be darwin arm64');
  need(ctx.uid === b.owner.uid && ctx.user === b.owner.user, 'owner uid or user differs');
  ctx.driverSha256 = await sha256File(SELF);
  need(ctx.driverSha256 === b.driverSha256, 'driver bytes differ from the bound driver');
  ctx.node = await realpath(process.execPath);
  need(ctx.node === b.node.path && process.versions.node === b.node.version, 'the driver must run under the bound Node');
  need(await sha256File(ctx.node) === b.node.sha256, 'node hash differs');
  for (const tool of Object.values(TOOLS)) need((await lstatOrNull(tool)) !== null, 'tool missing: ' + tool);
  if (!need(await realpathOrNull(b.checkout) === b.checkout, 'checkout must be present at its physical path')) return;
  ctx.checkout = b.checkout;
  for (const [rel, hash] of Object.entries(b.files)) need(await sha256File(join(b.checkout, rel)).catch(() => null) === hash, 'built file differs: ' + rel);
  const digest = await launcherDigest(b.checkout).catch((error) => ({ digest: null, error: stopMessage(error) }));
  need(digest.digest === b.launcherSourceDigest, 'launcher source digest differs');
  ctx.preflight = { digest, top: await topListing(b.checkout), files: b.files };
  const os = await runProcess(ctx, 'sw-vers', TOOLS.swVers, ['-productVersion'], { env: ctx.probeEnv, file: false });
  ctx.osVersion = os.stdout.toString('utf8').trim();
  need(clean(os) && os.exit.code === 0 && Number(ctx.osVersion.split('.')[0]) >= 15, 'macOS 15 or later');
  if (b.owner.os) need(ctx.osVersion === b.owner.os, 'macOS version differs from the binding');
  const temp = await runProcess(ctx, 'user-temp', TOOLS.getconf, ['DARWIN_USER_TEMP_DIR'], { env: ctx.probeEnv, file: false });
  ctx.userTemp = clean(temp) && temp.exit.code === 0 ? await realpathOrNull(temp.stdout.toString('utf8').trim()) : null;
  need(ctx.userTemp !== null, 'per-user temporary directory unavailable');

  const runId = flags['--run-id'] ?? b.runId ?? randomBytes(4).toString('hex');
  if (!need(/^[0-9a-f]{8}$/u.test(runId), 'run id must be 8 lowercase hex')) return;
  ctx.runId = runId;
  ctx.token = 'ggcanary' + randomBytes(6).toString('hex');
  ctx.names = { a: `GraphGoblin QA \u00fc-${runId}.app`, b: `GraphGoblin QA \u00fc-${runId}-b.app`, caseVariant: `GraphGoblin qa \u00dc-${runId}.app` };
  ctx.launcherMarks = [`-${runId}.app/Contents/MacOS/GraphGoblin`, `-${runId}-b.app/Contents/MacOS/GraphGoblin`];
  ctx.scope = join(ctx.home, 'Library', 'Caches', `graphgoblin-456-qa-${runId}`);
  ctx.checkoutLink = join(ctx.scope, 'links', 'QA checkout \u00fc \u6f22');
  ctx.linkScript = join(ctx.checkoutLink, 'scripts', 'install-macos-launcher.sh');
  ctx.canonicalScript = join(ctx.checkout, 'scripts', 'install-macos-launcher.sh');
  ctx.dataInput = join(ctx.scope, 'data', D_NAME);
  ctx.dataDir = ctx.dataInput;
  ctx.dataAlias = join(ctx.scope, 'links', 'data alias \u00fc');
  ctx.entry = join(ctx.checkout, 'apps', 'api', 'dist', 'main.js');
  ctx.helper = join(ctx.checkout, 'apps', 'api', 'dist', 'instance-identity.js');
  ctx.webDist = join(ctx.checkout, 'apps', 'web', 'dist');
  ctx.goblinDist = join(ctx.checkout, 'apps', 'web', 'dist-goblin');
  ctx.gatewayCommand = ctx.node + ' ' + ctx.entry;
  ctx.watch = [ctx.checkout + '/apps/', ctx.scope + '/', ...ctx.launcherMarks];
  ctx.launchEnv = { HOME: ctx.home, PATH: SYS_PATH, LANG: 'en_US.UTF-8' };
  ctx.installEnv = { HOME: ctx.home, PATH: SYS_PATH, LANG: 'en_US.UTF-8' };
  ctx.app = {};
  need((await lstatOrNull(join(ctx.home, 'Library', 'Caches'))) !== null, 'Library/Caches missing');
  need((await lstatOrNull(ctx.scope)) === null, 'QA scope already exists');
  const appsClear = await Promise.all([matchingApps(ctx, ctx.names.a, true), matchingApps(ctx, ctx.names.b, true)])
    .then(([a, bb]) => a.length === 0 && bb.length === 0, (error) => { need(false, '~/Applications refused: ' + (error instanceof Stop ? error.message : error?.code ?? 'error')); return null; });
  if (appsClear !== null) need(appsClear, 'a QA app name already exists');
  need((await gatewayRows(ctx, 'pre-gateways')).length === 0, 'a gateway from the bound checkout is already running');

  const fixed = Array.isArray(b.ports) ? b.ports : null;
  const chosen = [];
  for (let attempt = 0; chosen.length < 2 && attempt < (fixed ? 2 : 40); attempt++) {
    const port = fixed ? fixed[chosen.length] : 49152 + randomInt(65536 - 49152);
    if (!Number.isInteger(port) || port < 49152 || port > 65535 || FORBIDDEN_PORTS.has(port) || chosen.includes(port)) { if (fixed) break; continue; }
    const used = await lsofTcp(ctx, port, null, 'port-check', false);
    if (used.length === 0 && (await portState(port)).state === 'refused') chosen.push(port);
    else if (fixed) break;
  }
  if (!need(chosen.length === 2, 'two free QA ports in 49152-65535 were not available')) return;
  ctx.ports = { p: chosen[0], p2: chosen[1] };
  Object.assign(ctx.admission, { driverSha256: ctx.driverSha256, node: ctx.node, osVersion: ctx.osVersion, userTemp: ctx.userTemp, runId,
    names: Object.fromEntries(Object.entries(ctx.names).map(([k, v]) => [k, { value: v, hex: hex(v) }])), scope: ctx.scope,
    dataInput: { value: ctx.dataInput, hex: hex(ctx.dataInput) }, ports: ctx.ports, preflight: ctx.preflight, canaryToken: ctx.token,
    onStop: ctx.onStop, includeNodeMove: ctx.includeNodeMove });
}

async function stageScope(ctx) {
  await mkdir(ctx.scope, { mode: 0o700 });
  for (const name of ['evidence', 'links', 'data']) await mkdir(join(ctx.scope, name), { mode: 0o700 });
  ctx.evidence = join(ctx.scope, 'evidence');
  await stage(ctx, 'S0-scope-and-owner-snapshot', ['O0'], async () => {
    await save(ctx, 'admission.json', ctx.admission);
    const scope = await lstat(ctx.scope, { bigint: true });
    must(ctx, 'scope-private-physical', scope.isDirectory() && (await realpath(ctx.scope)) === ctx.scope && (scope.mode & 0o077n) === 0n, { mode: octal(scope) });
    ctx.scopeIdent = ident(scope);
    await symlink(ctx.checkout, ctx.checkoutLink);
    must(ctx, 'checkout-link-resolves', (await realpath(ctx.checkoutLink)) === ctx.checkout);
    ctx.s0 = await ownerSnapshot(ctx, 's0');
    ctx.s0Residue = await stageResidue(ctx, true);
    await save(ctx, 'owner-snapshot-s0.json', ctx.s0);
    note(ctx, 'ports', ctx.ports);
    note(ctx, 'stageResidueAtStart', ctx.s0Residue.length);
  });
}

async function stageInstallA(ctx) {
  await stage(ctx, 'S1-install-a-odd-checkout', ['O1', 'O2'], async () => {
    const r = await install(ctx, 'install-a', ctx.linkScript, ctx.names.a, ctx.dataInput, ctx.ports.p);
    must(ctx, 'installer-exit-zero', clean(r) && r.exit.code === 0, { exit: r.exit, timedOut: r.timedOut });
    want(ctx, 'installer-output', r.stdout.toString('utf8') === INSTALLED_TEXT && r.stderr.length === 0);
    const a = await readInstalled(ctx, ctx.names.a, 'a');
    checkInstalled(ctx, a, { name: ctx.names.a, port: ctx.ports.p, dataDir: ctx.dataInput, node: ctx.node }, 'a');
    want(ctx, 'link-spelling-not-saved', !a.configText.includes('QA checkout'));
    note(ctx, 'dataDirectoryBytesEqualInput', a.config.dataDirectory === ctx.dataInput);
    ctx.app.a = a;
    ctx.dataDir = a.config.dataDirectory;
    await save(ctx, 'installed-a.json', strip(a));
    must(ctx, 'single-a-entry', json(await matchingApps(ctx, ctx.names.a)) === json([hex(ctx.names.a)]));
    must(ctx, 'no-new-stage-residue', json(await stageResidue(ctx)) === json(ctx.s0Residue));
    const s = await ownerSnapshot(ctx, 's1');
    const apps = diffKept(ctx.s0.applications, s.applications);
    must(ctx, 'applications-only-a', json(apps.added) === json([hex(ctx.names.a)]) && apps.removed.length === 0 && apps.changed.length === 0, apps);
    must(ctx, 'receipts-only-a', onlyQa(diffKept(ctx.s0.receipts, s.receipts), [hex(a.id + '.json')]), diffKept(ctx.s0.receipts, s.receipts));
    must(ctx, 'default-resources-not-created', !created(ctx.s0.defaultApp.bundle, s.defaultApp.bundle) && !created(ctx.s0.defaultStore, s.defaultStore) &&
      !created(ctx.s0.productionLogs, s.productionLogs));
    want(ctx, 'checkout-listing-unchanged-by-installer', json(await topListing(ctx.checkout)) === json(ctx.preflight.top));
    want(ctx, 'launcher-source-unchanged-by-installer', (await launcherDigest(ctx.checkout)).digest === ctx.binding.launcherSourceDigest);
  });
}

async function stageColdCanary(ctx) {
  await stage(ctx, 'S2-cold-env-canary-launch', ['O3', 'O6'], async () => {
    const P = ctx.ports.p;
    must(ctx, 'precondition-port-refused', (await portState(P)).state === 'refused');
    must(ctx, 'precondition-store-absent', (await lstatOrNull(ctx.dataDir)) === null);
    must(ctx, 'precondition-no-gateway', (await gatewayRows(ctx, 'pre-cold')).length === 0);
    const canary = canaryEnvironment(ctx);
    const launched = await headless(ctx, 'cold-canary', ctx.app.a.path, canary);
    must(ctx, 'envelope-open-management-running', envelope(launched, 'open-management-running', P).ok, envelope(launched, 'open-management-running', P));
    want(ctx, 'within-60s-budget', launched.elapsedMs < 60_000, { elapsedMs: launched.elapsedMs });
    must(ctx, 'no-canary-in-launcher-output', !launched.stdout.includes(ctx.token) && !launched.stderr.includes(ctx.token));
    const owner = await witness(ctx, P, 'cold');
    ctx.owner = owner;
    ctx.instance = owner.instance;
    const fp = await helperLine(ctx, 'independent-fingerprint', P);
    must(ctx, 'fingerprint-equals-independent-config', fp.ok && fp.text === owner.instance + '\n', { helper: fp.text.trim(), served: owner.instance });
    want(ctx, 'parent-is-launchd', owner.ppid === 1, { ppid: owner.ppid });
    want(ctx, 'session-and-group-leader', owner.stat.includes('s') && owner.pgid === owner.pid, { stat: owner.stat, pgid: owner.pgid });
    want(ctx, 'no-controlling-terminal', owner.tty === '??', { tty: owner.tty });
    const files = await openFiles(ctx, owner.pid, 'cold-files');
    want(ctx, 'stdio-dev-null', ['0', '1', '2'].every((fd) => json(files[fd]) === json(['/dev/null'])), files);
    must(ctx, 'cwd-canonical-checkout', json(files.cwd) === json([ctx.checkout]), { cwd: files.cwd });
    want(ctx, 'runtime-is-bound-node', (files.txt ?? []).includes(ctx.node));
    const env = await processEnvironment(ctx, owner.pid, owner.command, 'cold-env');
    await save(ctx, 'cold-gateway-environment.filtered.json', env);
    must(ctx, 'no-canary-token-in-gateway-process', env.tokenHits === 0, { tokenHits: env.tokenHits });
    if (want(ctx, 'environment-observable', env.observable, { reason: env.reason ?? null })) {
      const canaryOnly = Object.keys(canary).filter((name) => !GATEWAY_ENV.includes(name));
      must(ctx, 'no-canary-only-names', !env.names.some((name) => canaryOnly.includes(name)), { names: env.names });
      want(ctx, 'closed-name-set', env.duplicates.length === 0 && json([...env.names].sort()) === json([...GATEWAY_ENV].sort()), { names: env.names });
      must(ctx, 'saved-options-override-canaries', env.allow.GG_HOST === '127.0.0.1' && env.allow.GG_PORT === String(P) &&
        env.allow.GG_REQUIRE_API_KEY === 'false' && env.allow.GG_OLLAMA_ENABLED === 'false',
        { GG_HOST: env.allow.GG_HOST, GG_PORT: env.allow.GG_PORT, GG_REQUIRE_API_KEY: env.allow.GG_REQUIRE_API_KEY, GG_OLLAMA_ENABLED: env.allow.GG_OLLAMA_ENABLED });
      const expected = expectedEnv(ctx, P);
      const mismatched = ['HOME', 'PATH', 'LANG', 'TMPDIR', 'GG_WEB_DIST', 'GG_GOBLIN_DIST'].filter((n) => env.allow[n] !== expected[n]);
      want(ctx, 'deterministic-values', mismatched.length === 0, { mismatched, observed: Object.fromEntries(mismatched.map((n) => [n, env.allow[n] ?? null])) });
      want(ctx, 'data-dir-value', env.allow.GG_DATA_DIR === ctx.dataDir || unvis(env.allow.GG_DATA_DIR ?? '') === ctx.dataDir, { rawHex: hex(env.allow.GG_DATA_DIR ?? '') });
      const uri = env.allow.GG_DB_URL ?? '';
      let decoded = null;
      try { decoded = fileURLToPath(uri); } catch { decoded = null; }
      must(ctx, 'database-uri-exact', uri.startsWith('file://') && !/[?#]/u.test(uri) && decoded === join(ctx.dataDir, 'graphgoblin.db'), { uri, decodedHex: decoded && hex(decoded) });
      let admission = null;
      try { admission = JSON.parse(env.allow.GG_MACOS_LAUNCHER_LOG_ADMISSION ?? ''); } catch { admission = null; }
      const root = join(ctx.home, 'Library', 'Logs', 'GraphGoblin', 'LauncherInstances', ctx.app.a.id);
      const rootStat = await lstatOrNull(root);
      want(ctx, 'log-admission-bound-to-instance-directory', admission?.version === 1 && admission.root === root && rootStat !== null && sameIdent(admission, ident(rootStat)), { admission });
    }
    const dataEntries = await readdir(join(ctx.scope, 'data'));
    must(ctx, 'single-store-directory', dataEntries.length === 1 && dataEntries[0].normalize('NFC') === D_NAME, { entriesHex: dataEntries.map(hex) });
    must(ctx, 'database-inside-store', (await lstatOrNull(join(ctx.dataDir, 'graphgoblin.db')))?.isFile() === true);
    const key = await lstatOrNull(join(ctx.dataDir, 'master.key'));
    want(ctx, 'local-key-private', key?.isFile() === true && Number(key.uid) === ctx.uid && (key.mode & 0o077n) === 0n, key && { mode: octal(key), size: Number(key.size) });
    const storeNames = (await readdir(ctx.dataDir)).sort();
    note(ctx, 'storeNames', storeNames);
    must(ctx, 'no-canary-in-store-names', !storeNames.some((name) => name.includes(ctx.token)));
    const served = await shells(ctx, P);
    want(ctx, 'both-shells-served', served.every((s) => s.shellMatch && s.assetMatch === true), served);
    const leftover = (list) => list.some((r) => isHelper(ctx, r) || isLauncher(ctx, r));
    let rows = await processRows(ctx, 'post-cold-rows', { file: false });
    const start = now();
    while (leftover(rows) && now() - start < 3000) {
      await pause(250);
      rows = await processRows(ctx, 'post-cold-rows', { file: false });
    }
    want(ctx, 'no-helper-or-launcher-left', !rows.some((r) => isHelper(ctx, r) || isLauncher(ctx, r)), rows);
    must(ctx, 'single-gateway', json(rows.filter((r) => isGateway(ctx, r)).map((r) => r.pid)) === json([owner.pid]), rows);
    const browser = await foreignConnections(ctx, P, [owner.pid, process.pid], 5000, 'cold-established');
    want(ctx, 'headless-opened-no-browser', browser.length === 0, browser);
    const logs = await logDirState(ctx, ctx.app.a.id);
    note(ctx, 'logDirectory', withoutText(logs));
    note(ctx, 'launcherLogAfterSuccess', 'launcher.log' in logs.files);
    must(ctx, 'no-canary-in-logs', Object.values(logs.files).every((f) => !f.tokenHits));
    want(ctx, 'log-directory-private', logs.present && logs.mode === '700' && Object.values(logs.files).every((f) => f.managed && f.kind === 'file' && f.mode === '600' && f.nlink === 1));
  });
}

async function stageSpellingUpdate(ctx) {
  await stage(ctx, 'S3-spelling-alias-update', ['O5'], async () => {
    const P = ctx.ports.p;
    const nfd = ctx.names.a.normalize('NFD');
    must(ctx, 'nfd-spelling-differs-bytewise', hex(nfd) !== hex(ctx.names.a));
    const upper = await lstatOrNull(join(ctx.home, 'Applications', ctx.names.a.toUpperCase()));
    const caseInsensitive = upper !== null && sameIdent(ident(upper), ctx.app.a.bundle);
    note(ctx, 'applicationsCaseInsensitive', caseInsensitive);
    const variants = [['nfd', nfd], ...(caseInsensitive ? [['case', ctx.names.caseVariant]] : [])];
    let current = ctx.app.a;
    for (const [tag, spelling] of variants) {
      const r = await install(ctx, 'install-a-' + tag, ctx.linkScript, spelling, ctx.dataInput, P);
      note(ctx, tag + ':installer', { exit: r.exit, timedOut: r.timedOut, stderrBytes: r.stderr.length });
      must(ctx, tag + ':single-bundle-original-spelling', json(await matchingApps(ctx, ctx.names.a)) === json([hex(ctx.names.a)]));
      const after = await readInstalled(ctx, ctx.names.a, 'a-' + tag);
      await save(ctx, `installed-a-${tag}.json`, strip(after));
      // Both spellings keep the exact 'GraphGoblin ' prefix (the case variant runs only on a proven case-insensitive
      // volume), so each must be a successful managed replacement. A refusal is unmet, never an accepted outcome;
      // whether it left the installation unchanged is recorded before the hard check stops the stage.
      const updated = clean(r) && r.exit.code === 0;
      if (!updated) note(ctx, tag + ':refusal-left-installation-unchanged', sameIdent(after.bundle, current.bundle) && after.receipt?.sha256 === current.receipt.sha256);
      must(ctx, tag + ':managed-update', updated, { exit: r.exit, timedOut: r.timedOut });
      want(ctx, tag + ':installer-output', r.stdout.toString('utf8') === INSTALLED_TEXT && r.stderr.length === 0);
      checkInstalled(ctx, after, { name: ctx.names.a, port: P, dataDir: ctx.dataInput, node: ctx.node, id: ctx.app.a.id }, 'a-' + tag);
      must(ctx, tag + ':new-generation', !sameIdent(after.bundle, current.bundle), { before: current.bundle, after: after.bundle });
      current = after;
      must(ctx, tag + ':no-new-stage-residue', json(await stageResidue(ctx)) === json(ctx.s0Residue));
      const w = await witness(ctx, P, 'after-' + tag, { instance: ctx.instance });
      must(ctx, tag + ':gateway-undisturbed', sameOwner(w, ctx.owner) && w.phase === 'running', { pid: w.pid, phase: w.phase });
    }
    ctx.app.a = current;
    ctx.dataDir = current.config.dataDirectory;
    const warm = await headless(ctx, 'warm-after-update', current.path);
    must(ctx, 'warm-envelope', envelope(warm, 'open-management-running', P).ok, envelope(warm, 'open-management-running', P));
    must(ctx, 'warm-same-gateway', sameOwner(await witness(ctx, P, 'warm', { instance: ctx.instance }), ctx.owner));
  });
}

async function stageWaitRunDrain(ctx) {
  await stage(ctx, 'S4-wait-run-graceful-drain-and-retention', ['O7', 'G5-native-part'], async () => {
    const P = ctx.ports.p;
    const definition = waitLoop(ctx);
    const made = await api(P, 'POST', '/loops', { definition });
    must(ctx, 'loop-created', made.status === 201 && ULID.test(made.json?.loop?.id ?? ''), { status: made.status, code: made.json?.code ?? null, issues: made.json?.issues ?? null });
    const loopId = made.json.loop.id;
    const started = await api(P, 'POST', `/loops/${loopId}/runs`, { allowDraft: true });
    must(ctx, 'run-admitted', started.status === 202 && ULID.test(started.json?.run?.id ?? ''), { status: started.status, code: started.json?.code ?? null });
    const runId = started.json.run.id;
    ctx.data = { loopId, runId, loopName: definition.name, waitSeconds: WAIT_SECONDS, startedAt: iso() };
    const waiting = await pollRun(ctx, P, runId, (s) => s === 'waiting', 15_000);
    must(ctx, 'run-active-waiting', waiting.final === 'waiting', waiting);
    const children = await gatewayChildren(ctx, ctx.owner.pid, 'gateway-children');
    note(ctx, 'gatewayChildrenBeforeDrain', children);
    must(ctx, 'no-provider-process', children.every((c) => !/codex|claude|ollama/iu.test(c.name)), children);
    const previous = ctx.owner;
    const drained = await drainVerified(ctx, previous, 'drain-with-waiting-run');
    ctx.owner = null;
    note(ctx, 'drain', drained);
    // Durable timers do not hold drain (docs/07), so intermediate phases may be too brief to observe.
    note(ctx, 'intermediatePhasesObserved', drained.series.filter((s) => s.phase && s.phase !== 'running').map((s) => s.phase));
    want(ctx, 'waiting-run-not-unconfirmed', !(drained.shutdown.unconfirmedRunIds ?? []).includes(runId), drained.shutdown);
    const relaunch = await headless(ctx, 'cold-after-drain', ctx.app.a.path);
    must(ctx, 'relaunch-envelope', envelope(relaunch, 'open-management-running', P).ok, envelope(relaunch, 'open-management-running', P));
    const owner = await witness(ctx, P, 'relaunch', { instance: ctx.instance });
    ctx.owner = owner;
    must(ctx, 'new-gateway-incarnation', owner.pid !== previous.pid || owner.birth !== previous.birth, { previous: previous.pid, current: owner.pid });
    const retained = await api(P, 'GET', `/runs/${runId}`);
    must(ctx, 'run-retained-across-restart', retained.status === 200 && retained.json?.id === runId && ['waiting', 'running', 'succeeded'].includes(retained.json?.status),
      { status: retained.status, runStatus: retained.json?.status ?? null });
    const finished = await pollRun(ctx, P, runId, (s) => ['succeeded', 'failed', 'cancelled', 'exhausted'].includes(s), (WAIT_SECONDS + 60) * 1000);
    want(ctx, 'run-completed-after-restart', finished.final === 'succeeded', finished);
    const loops = await api(P, 'GET', '/loops');
    want(ctx, 'loop-retained', loops.status === 200 && (loops.json?.items ?? []).some((item) => item.id === loopId && item.runCount >= 1));
    const after = await gatewayChildren(ctx, owner.pid, 'gateway-children-after');
    must(ctx, 'no-provider-process-after-restart', after.every((c) => !/codex|claude|ollama/iu.test(c.name)), after);
    note(ctx, 'idleDrain', await drainVerified(ctx, owner, 'drain-idle'));
    ctx.owner = null;
  });
}

async function stageSecondInstallConcurrent(ctx) {
  await stage(ctx, 'S5-second-install-concurrent-aliased-store', ['O10'], async () => {
    const P = ctx.ports.p;
    await symlink(ctx.dataDir, ctx.dataAlias);
    must(ctx, 'alias-resolves-to-store', (await realpath(ctx.dataAlias)) === (await realpath(ctx.dataDir)));
    const r = await install(ctx, 'install-b', ctx.canonicalScript, ctx.names.b, ctx.dataAlias, P);
    must(ctx, 'installer-exit-zero', clean(r) && r.exit.code === 0, { exit: r.exit, timedOut: r.timedOut });
    want(ctx, 'installer-output', r.stdout.toString('utf8') === INSTALLED_TEXT && r.stderr.length === 0);
    const b = await readInstalled(ctx, ctx.names.b, 'b');
    await save(ctx, 'installed-b.json', strip(b));
    checkInstalled(ctx, b, { name: ctx.names.b, port: P, dataDir: ctx.dataInput, node: ctx.node }, 'b');
    const spellings = { a: hex(ctx.app.a.config.dataDirectory), b: hex(b.config.dataDirectory), alias: hex(ctx.dataAlias) };
    must(ctx, 'alias-saved-as-canonical-store', b.config.dataDirectory.normalize('NFC') === ctx.app.a.config.dataDirectory.normalize('NFC') &&
      b.config.dataDirectory !== ctx.dataAlias, spellings);
    want(ctx, 'store-spelling-bytes-identical', b.config.dataDirectory === ctx.app.a.config.dataDirectory, spellings);
    must(ctx, 'distinct-installation-identity', b.id !== ctx.app.a.id && b.plist.CFBundleIdentifier !== ctx.app.a.plist.CFBundleIdentifier);
    want(ctx, 'identical-saved-configuration', b.files['Contents/Resources/launcher.json'].sha256 === ctx.app.a.files['Contents/Resources/launcher.json'].sha256);
    ctx.app.b = b;
    must(ctx, 'precondition-port-refused', (await portState(P)).state === 'refused');
    must(ctx, 'precondition-store-free', leasesFree(await leaseState(ctx)));
    must(ctx, 'precondition-no-gateway', (await gatewayRows(ctx, 'pre-concurrent')).length === 0);
    const polls = [];
    const seen = new Map();
    let polling = true;
    let pollError = null;
    const start = now();
    const poller = (async () => {
      while (polling) {
        try {
          const rows = (await processRows(ctx, 'concurrent-poll', { file: false })).filter((row) => isGateway(ctx, row));
          polls.push({ ms: now() - start, gateways: rows.map((row) => row.pid) });
          for (const row of rows) seen.set(row.pid, row.birth);
        } catch (error) { pollError = stopMessage(error); polling = false; }
        await pause(200);
      }
    })();
    let results;
    try {
      results = await Promise.all([headless(ctx, 'concurrent-a1', ctx.app.a.path), headless(ctx, 'concurrent-a2', ctx.app.a.path), headless(ctx, 'concurrent-b1', b.path)]);
    } finally {
      polling = false;
      await poller;
    }
    await save(ctx, 'concurrent-gateway-polls.json', { polls, pollError });
    for (const [i, result] of results.entries()) must(ctx, `envelope-${i}`, envelope(result, 'open-management-running', P).ok, envelope(result, 'open-management-running', P));
    must(ctx, 'poller-healthy', pollError === null && polls.length > 0, { pollError, polls: polls.length });
    must(ctx, 'never-more-than-one-gateway', polls.every((p) => p.gateways.length <= 1) && seen.size === 1, { distinct: [...seen.keys()] });
    const owner = await witness(ctx, P, 'concurrent', { instance: ctx.instance });
    ctx.owner = owner;
    must(ctx, 'observed-gateway-is-owner', seen.has(owner.pid) && seen.get(owner.pid) === owner.birth);
    const logs = { a: await logDirState(ctx, ctx.app.a.id), b: await logDirState(ctx, b.id) };
    note(ctx, 'gatewayLogOwner', { a: logs.a.files['gateway.log']?.size ?? null, b: logs.b.files['gateway.log']?.size ?? null });
    const rows = await processRows(ctx, 'post-concurrent-rows', { file: false });
    want(ctx, 'no-helper-or-launcher-left', !rows.some((row) => isHelper(ctx, row) || isLauncher(ctx, row)), rows);
    want(ctx, 'headless-opened-no-browser', (await foreignConnections(ctx, P, [owner.pid, process.pid], 5000, 'concurrent-established')).length === 0);
    note(ctx, 'drain', await drainVerified(ctx, owner, 'drain-concurrent'));
    ctx.owner = null;
  });
}

async function stageForeignListeners(ctx) {
  await stage(ctx, 'S6-foreign-listeners', ['O11'], async () => {
    const P = ctx.ports.p;
    must(ctx, 'precondition-port-refused', (await portState(P)).state === 'refused');
    ctx.listener = await openListener(P);
    ctx.listener.impostor = sha256('qa-foreign-identity-' + ctx.token);
    must(ctx, 'impostor-differs-from-fixture', ctx.listener.impostor !== ctx.instance);
    const storeBefore = await storeSnapshot(ctx);
    for (const [mode, app] of [['plain-health', ctx.app.a], ['foreign-identity', ctx.app.b]]) {
      ctx.listener.mode = mode;
      const logBefore = await logDirState(ctx, app.id);
      const r = await headless(ctx, 'foreign-' + mode, app.path);
      const probes = ctx.listener.counts[mode] ?? 0;
      must(ctx, mode + ':envelope-port-in-use', envelope(r, 'port-in-use', P).ok, envelope(r, 'port-in-use', P));
      want(ctx, mode + ':prompt-refusal', r.elapsedMs < 60_000, { elapsedMs: r.elapsedMs });
      want(ctx, mode + ':launcher-probed-listener', probes > 0, { probes });
      const self = await health(P);
      const sockets = await lsofTcp(ctx, P, 'LISTEN', mode + '-listen');
      must(ctx, mode + ':qa-listener-untouched', self.status === 200 && ctx.listener.server.listening && sockets.length === 1 && sockets[0].pid === process.pid, { sockets });
      must(ctx, mode + ':store-untouched', json(await storeSnapshot(ctx)) === json(storeBefore));
      must(ctx, mode + ':no-gateway', (await gatewayRows(ctx, mode + '-rows')).length === 0);
      const added = newLauncherLines(logBefore, await logDirState(ctx, app.id));
      note(ctx, mode + ':launcherRecord', added);
      want(ctx, mode + ':launcher-record', !added.rotated && json(added.lines) === json(['stage=checking outcome=port-in-use']), added);
      must(ctx, mode + ':no-canary-in-record', added.lines.every((line) => !line.includes(ctx.token)));
    }
    await closeListener(ctx.listener);
    ctx.listener = null;
    must(ctx, 'qa-listener-closed', (await portState(P)).state === 'refused');
  });
}

async function stageShellHeldStore(ctx) {
  await stage(ctx, 'S7-shell-held-store', ['O8'], async () => {
    const P = ctx.ports.p;
    must(ctx, 'precondition-ports-refused', (await portState(P)).state === 'refused' && (await portState(ctx.ports.p2)).state === 'refused');
    must(ctx, 'precondition-store-free', leasesFree(await leaseState(ctx)));
    const logsBefore = { a: await logDirState(ctx, ctx.app.a.id), b: await logDirState(ctx, ctx.app.b.id) };
    const contender = await startContender(ctx);
    const owner = await witness(ctx, ctx.ports.p2, 'contender');
    must(ctx, 'contender-is-registered-child', owner.pid === contender.pid, { child: contender.pid, served: owner.pid });
    contender.owner = owner;
    const held = await helperLine(ctx, 'store-state-held', P, ['--store-state']);
    let heldState = null;
    try { heldState = JSON.parse(held.text); } catch { heldState = null; }
    must(ctx, 'store-held-by-writer-lease', held.ok && heldState?.state === 'held' &&
      LEASES.some((n) => String(heldState.path).normalize('NFC') === join(ctx.dataDir, n).normalize('NFC')),
      { state: heldState?.state ?? null, pathHex: heldState?.path ? hex(heldState.path) : null });
    const watch = [];
    let watching = true;
    let watchError = null;
    const start = now();
    const watcher = (async () => {
      while (watching) {
        try {
          const p = await portState(P);
          const gateways = (await gatewayRows(ctx, 'held-poll')).map((row) => row.pid);
          watch.push({ ms: now() - start, p: p.state, gateways });
        } catch (error) { watchError = stopMessage(error); watching = false; }
        await pause(500);
      }
    })();
    let r;
    try { r = await headless(ctx, 'store-blocked', ctx.app.a.path); } finally { watching = false; await watcher; }
    await save(ctx, 'store-blocked-watch.json', { watch, watchError });
    must(ctx, 'envelope-store-blocked', envelope(r, 'store-blocked').ok, envelope(r, 'store-blocked'));
    want(ctx, 'elapsed-60-to-63s', r.elapsedMs >= 60_000 && r.elapsedMs <= 63_000, { elapsedMs: r.elapsedMs });
    must(ctx, 'elapsed-at-most-65s', r.elapsedMs <= 65_000, { elapsedMs: r.elapsedMs });
    must(ctx, 'watcher-healthy', watchError === null && watch.length > 0, { watchError });
    must(ctx, 'never-served-on-p', watch.every((w) => w.p !== 'answered'));
    must(ctx, 'no-launcher-spawned-gateway', watch.every((w) => w.gateways.every((pid) => pid === owner.pid)));
    must(ctx, 'contender-unchanged', sameOwner(await witness(ctx, ctx.ports.p2, 'contender-after', { instance: owner.instance }), owner));
    const logsAfter = { a: await logDirState(ctx, ctx.app.a.id), b: await logDirState(ctx, ctx.app.b.id) };
    must(ctx, 'shell-output-separate-from-managed-logs', ['a', 'b'].every((k) => logsBefore[k].files['gateway.log']?.sha256 === logsAfter[k].files['gateway.log']?.sha256));
    // After the unchanged 60 s admission/observation deadline the launcher writes its failure diagnostic in a
    // separate best-effort tail of at most 250 ms. This bounded fixture never approaches rotation.
    const record = newLauncherLines(logsBefore.a, logsAfter.a);
    note(ctx, 'launcherRecord', record);
    must(ctx, 'launcher-record-no-spawn-failed-or-canary', record.lines.every((line) => !line.includes('child=spawn-failed') && !line.includes(ctx.token)), record);
    must(ctx, 'launcher-record-store-blocked', !record.rotated && json(record.lines) === json(['stage=waiting-for-store outcome=store-blocked']), record);
    const outputs = await contenderOutputs(ctx);
    note(ctx, 'contenderOutputs', outputs);
    must(ctx, 'no-canary-in-shell-output', outputs.every((o) => o.tokenHits === 0));
    note(ctx, 'drain', await drainVerified(ctx, owner, 'drain-contender'));
    const exit = await Promise.race([contender.exited, pause(15_000).then(() => 'not-observed')]);
    want(ctx, 'contender-exit-zero', exit !== 'not-observed' && exit?.code === 0 && exit.signal === null, { exit });
    ctx.contender = null;
  });
}

async function stageMovedRuntime(ctx) {
  await stage(ctx, 'S8-moved-runtime-disposable-copy', ['O9b'], async () => {
    const P = ctx.ports.p;
    const dir = join(ctx.scope, 'runtime');
    await mkdir(dir, { mode: 0o700 });
    const copy = join(dir, 'node');
    await copyFile(ctx.node, copy, fsConstants.COPYFILE_EXCL);
    await chmod(copy, 0o700);
    must(ctx, 'copy-identical', (await sha256File(copy)) === ctx.binding.node.sha256);
    const first = await install(ctx, 'install-b-node-copy', ctx.canonicalScript, ctx.names.b, ctx.dataAlias, P, copy);
    must(ctx, 'install-with-copy', clean(first) && first.exit.code === 0, { exit: first.exit });
    const withCopy = await readInstalled(ctx, ctx.names.b, 'b-node-copy');
    checkInstalled(ctx, withCopy, { name: ctx.names.b, port: P, dataDir: ctx.dataInput, node: copy, id: ctx.app.b.id }, 'b-node-copy');
    const moved = copy + '.moved';
    await rename(copy, moved);
    const refusal = await headless(ctx, 'moved-runtime', withCopy.path);
    must(ctx, 'envelope-runtime-unavailable', envelope(refusal, 'runtime-unavailable').ok, envelope(refusal, 'runtime-unavailable'));
    must(ctx, 'no-spawn', leasesFree(await leaseState(ctx)) && (await gatewayRows(ctx, 'moved-rows')).length === 0 && (await portState(P)).state === 'refused');
    await rename(moved, copy);
    const restored = await headless(ctx, 'restored-runtime', withCopy.path);
    must(ctx, 'restored-envelope', envelope(restored, 'open-management-running', P).ok, envelope(restored, 'open-management-running', P));
    const owner = await witness(ctx, P, 'copy-runtime', { command: copy + ' ' + ctx.entry });
    ctx.owner = owner;
    want(ctx, 'runtime-path-changes-fingerprint', owner.instance !== ctx.instance);
    note(ctx, 'drain', await drainVerified(ctx, owner, 'drain-copy-runtime'));
    ctx.owner = null;
    const back = await install(ctx, 'install-b-bound-node', ctx.canonicalScript, ctx.names.b, ctx.dataAlias, P);
    must(ctx, 'reinstall-bound-node', clean(back) && back.exit.code === 0, { exit: back.exit });
    const b = await readInstalled(ctx, ctx.names.b, 'b-restored');
    checkInstalled(ctx, b, { name: ctx.names.b, port: P, dataDir: ctx.dataInput, node: ctx.node, id: ctx.app.b.id }, 'b-restored');
    ctx.app.b = b;
    await save(ctx, 'installed-b-restored.json', strip(b));
  });
}

async function stageFixture(ctx) {
  await stage(ctx, 'S9-stopped-fixture-and-manifest', ['X1-observation', 'GUI-fixture'], async () => {
    const { p: P, p2: P2 } = ctx.ports;
    must(ctx, 'ports-refused', (await portState(P)).state === 'refused' && (await portState(P2)).state === 'refused');
    must(ctx, 'no-qa-process', (await processRows(ctx, 'final-rows')).length === 0);
    must(ctx, 'store-leases-free', leasesFree(await leaseState(ctx)));
    const store = await helperLine(ctx, 'final-store-state', P, ['--store-state']);
    must(ctx, 'store-free', store.ok && store.text === '{"state":"free"}\n');
    const apps = {};
    for (const role of ['a', 'b']) {
      const inst = await readInstalled(ctx, ctx.names[role], 'final-' + role);
      checkInstalled(ctx, inst, { name: ctx.names[role], port: P, dataDir: ctx.dataInput, node: ctx.node, id: ctx.app[role].id }, 'final-' + role);
      must(ctx, role + ':unchanged-since-last-readback', sameIdent(inst.bundle, ctx.app[role].bundle) && inst.receipt.sha256 === ctx.app[role].receipt.sha256);
      apps[role] = inst;
    }
    const logs = {};
    for (const role of ['a', 'b']) {
      logs[role] = await logDirState(ctx, apps[role].id);
      for (const [name, f] of Object.entries(logs[role].files)) {
        if (f.kind === 'file') await save(ctx, `final-log-${role}-${name}.excerpt`, await excerpt(join(logs[role].root, name), CAP.excerpt));
      }
      want(ctx, role + ':logs-private-bounded', !logs[role].present || (logs[role].mode === '700' && Object.entries(logs[role].files)
        .every(([name, f]) => f.managed && f.kind === 'file' && f.mode === '600' && f.nlink === 1 && f.size <= LOG_CAPS[name])), withoutText(logs[role]));
      must(ctx, role + ':no-canary-in-logs', Object.values(logs[role].files).every((f) => !f.tokenHits));
    }
    const lockDir = join(ctx.home, 'Library', 'Application Support', 'GraphGoblin', 'LauncherLocks');
    const anchors = [['directory', ctx.dataDir], ['database', join(ctx.dataDir, 'graphgoblin.db')], ['port', String(P)]].map(([scope, value]) => scope + '-' + sha256(Buffer.from(value)));
    const preexisting = new Set((ctx.s0.locks.kept ?? []).map((e) => e.name));
    const anchorState = [];
    for (const name of anchors) anchorState.push({ name, preexisting: preexisting.has(name), ...(await entrySummary(join(lockDir, name))) });
    const s = await ownerSnapshot(ctx, 'final');
    await save(ctx, 'owner-snapshot-final.json', s);
    const qa = { applications: [hex(ctx.names.a), hex(ctx.names.b)], receipts: [hex(apps.a.id + '.json'), hex(apps.b.id + '.json')],
      instanceLogs: [hex(apps.a.id), hex(apps.b.id)], locks: anchors.map(hex) };
    for (const [key, allowed] of Object.entries(qa)) want(ctx, 'owner-diff-only-qa:' + key, onlyQa(diffKept(ctx.s0[key], s[key]), allowed), diffKept(ctx.s0[key], s[key]));
    must(ctx, 'default-resources-not-created', !created(ctx.s0.defaultApp.bundle, s.defaultApp.bundle) && !created(ctx.s0.defaultStore, s.defaultStore) && !created(ctx.s0.productionLogs, s.productionLogs));
    want(ctx, 'default-resources-unchanged', json(ctx.s0.defaultApp) === json(s.defaultApp) && json(ctx.s0.defaultStore) === json(s.defaultStore) && json(ctx.s0.productionLogs) === json(s.productionLogs));
    want(ctx, 'protected-port-listeners-unchanged', json(ctx.s0.protectedPorts) === json(s.protectedPorts), { before: ctx.s0.protectedPorts, after: s.protectedPorts });
    want(ctx, 'no-graphgoblin-crash-report', diffKept(ctx.s0.crashReports, s.crashReports).added.length === 0, diffKept(ctx.s0.crashReports, s.crashReports));
    const data = await lstat(ctx.dataDir, { bigint: true });
    const entry = (role) => {
      const inst = apps[role];
      const log = logs[role];
      return { name: inst.name, nameHex: inst.nameHex, path: inst.path, id: inst.id, bundleIdentifier: inst.plist.CFBundleIdentifier, bundle: inst.bundle,
        executableSha256: inst.files['Contents/MacOS/GraphGoblin'].sha256, plistSha256: inst.files['Contents/Info.plist'].sha256,
        configSha256: inst.files['Contents/Resources/launcher.json'].sha256,
        receipt: { path: inst.receipt.path, device: inst.receipt.device, inode: inst.receipt.inode, sha256: inst.receipt.sha256 },
        logDirectory: log.present ? { path: log.root, present: true, device: log.device, inode: log.inode } : { path: log.root, present: false } };
    };
    const cleanupItems = [
      ...['a', 'b'].map((role) => ({ kind: 'app-bundle', path: apps[role].path, ...apps[role].bundle, receiptSha256: apps[role].receipt.sha256 })),
      ...['a', 'b'].map((role) => ({ kind: 'receipt', path: apps[role].receipt.path, device: apps[role].receipt.device, inode: apps[role].receipt.inode, sha256: apps[role].receipt.sha256 })),
      ...['a', 'b'].filter((role) => logs[role].present).map((role) => ({ kind: 'log-directory', path: logs[role].root, device: logs[role].device, inode: logs[role].inode })),
      ...anchorState.filter((a) => !a.preexisting && a.present).map((a) => ({ kind: 'lock-anchor', path: join(lockDir, a.name), device: a.device, inode: a.inode })),
      { kind: 'qa-scope (copy evidence out first)', path: ctx.scope, ...ctx.scopeIdent },
    ];
    const manifest = {
      schema: MANIFEST_SCHEMA, state: 'stopped-verified', createdAt: iso(), runId: ctx.runId, canaryToken: ctx.token, notAPass: true,
      candidate: ctx.binding.candidate, build: ctx.binding.build ?? null, launcherSourceDigest: ctx.binding.launcherSourceDigest, driverSha256: ctx.driverSha256,
      owner: { uid: ctx.uid, user: ctx.user, home: ctx.home, osVersion: ctx.osVersion },
      checkout: ctx.checkout, checkoutLink: ctx.checkoutLink, node: ctx.node, entry: ctx.entry, helper: ctx.helper, webDist: ctx.webDist, goblinDist: ctx.goblinDist,
      userTemp: ctx.userTemp, gatewayCommand: ctx.gatewayCommand, instance: ctx.instance, expectedGatewayEnvironment: GATEWAY_ENV,
      scope: { path: ctx.scope, ...ctx.scopeIdent }, evidence: ctx.evidence,
      dataDirectory: { path: ctx.dataDir, hex: hex(ctx.dataDir), ...ident(data) }, dataAlias: { path: ctx.dataAlias, target: ctx.dataDir },
      ports: ctx.ports, apps: [{ role: 'A', ...entry('a') }, { role: 'B', ...entry('b') }], launcherMarks: ctx.launcherMarks,
      data: ctx.data ?? null, lockAnchors: anchorState,
      deferredCleanup: { executed: false, rule: 'Only after the GUI cases and evidence copy-out, with no QA process running; re-verify each identity and hash immediately before removal; never remove pre-existing anchors, LaunchServices registrations or anything not listed.',
        items: cleanupItems },
      pendingGui: ['G0 console admission (preflight-02 recorded accessibility false, screen capture unknown)', 'G2 Finder double-click cold', 'G3 warm', 'G4 Finder alias',
        'G5 Dock pin, in-app stop, cold Dock click; run history uses data.loopId/runId', 'G6 same-path replacement with pin', 'G7 progress, Hide, reopen, store-blocked, pre-spawn Quit and repeated Quit (needs a root-started contender)',
        'G8 port-in-use window, keys, Show Log in Finder (needs a root-started foreign listener)', 'G9 pin and alias removal'],
    };
    await save(ctx, 'fixture-manifest.json', manifest);
    ctx.manifestFile = join(ctx.evidence, 'fixture-manifest.json');
    note(ctx, 'manifest', ctx.manifestFile);
    // Candidate checkout integrity after every public install. A change is a product finding, recorded after the manifest.
    for (const [rel, hash] of Object.entries(ctx.binding.files)) want(ctx, 'built-file-unchanged:' + rel, (await sha256File(join(ctx.checkout, rel))) === hash);
    want(ctx, 'launcher-source-unchanged', (await launcherDigest(ctx.checkout)).digest === ctx.binding.launcherSourceDigest);
    want(ctx, 'checkout-listing-unchanged', json(await topListing(ctx.checkout)) === json(ctx.preflight.top));
  });
}

async function finish(ctx, failure) {
  if (ctx.listener) { await closeListener(ctx.listener).catch(() => {}); ctx.listener = null; }
  const recovery = [];
  if (failure && ctx.onStop === 'drain' && ctx.evidence) {
    ctx.deadline = Math.max(ctx.deadline, now()) + 180_000;
    for (const owner of [ctx.owner, ctx.contender?.owner].filter(Boolean)) {
      try {
        await stage(ctx, 'R-recovery-drain-' + owner.port, ['recovery'], async () => { note(ctx, 'owner', owner); await drainVerified(ctx, owner, 'recovery'); });
        recovery.push({ port: owner.port, pid: owner.pid, drained: true });
      } catch (error) {
        recovery.push({ port: owner.port, pid: owner.pid, drained: false, reason: stopMessage(error) });
      }
    }
  }
  const unmet = ctx.stages.flatMap((s) => s.checks.filter((c) => !c.ok).map((c) => `${s.id}/${c.id}`));
  const status = failure ? 'stopped' : unmet.length ? 'completed-with-unmet-criteria' : 'completed-all-criteria-met';
  const result = { schema: SCHEMA, status, notAPass: true, runId: ctx.runId, candidate: ctx.binding?.candidate, scope: ctx.scope, evidence: ctx.evidence,
    failure: failure ? stopMessage(failure) : null, unmet, recovery, onStop: ctx.onStop,
    contender: ctx.contender ? { pid: ctx.contender.pid, verified: Boolean(ctx.contender.owner), exit: ctx.contender.exit } : null,
    registeredGatewayAtStop: ctx.owner ? { port: ctx.owner.port, pid: ctx.owner.pid, birth: ctx.owner.birth } : null,
    stages: ctx.stages.map((s) => ({ id: s.id, cases: s.cases, status: s.status, elapsedMs: s.elapsedMs })),
    fixtureManifest: ctx.manifestFile ?? null, evidenceBytes: ctx.evidenceBytes, finishedAt: iso() };
  if (ctx.evidence) await save(ctx, 'result.json', result).catch(() => {});
  process.stdout.write(JSON.stringify({ schema: SCHEMA, status, evidence: ctx.evidence, unmet: unmet.length, failure: result.failure }) + '\n');
  process.exitCode = status === 'completed-all-criteria-met' ? 0 : 1;
  ctx.contender?.child?.unref();
}

async function runMode(flags) {
  const ctx = await admit(flags);
  if (!ctx) return;
  let failure = null;
  try {
    await stageScope(ctx);
    await stageInstallA(ctx);
    await stageColdCanary(ctx);
    await stageSpellingUpdate(ctx);
    await stageWaitRunDrain(ctx);
    await stageSecondInstallConcurrent(ctx);
    await stageForeignListeners(ctx);
    await stageShellHeldStore(ctx);
    if (ctx.includeNodeMove) await stageMovedRuntime(ctx);
    await stageFixture(ctx);
  } catch (error) {
    failure = error;
  }
  await finish(ctx, failure);
}

// ---------------------------------------------------------------- observe and drain (manifest-bound follow-up)
async function fixtureContext(flags, budgetMs) {
  const manifest = JSON.parse(await readFile(flags['--manifest'], 'utf8'));
  if (manifest.schema !== MANIFEST_SCHEMA || manifest.state !== 'stopped-verified') throw new Stop('not a verified fixture manifest');
  const ctx = await baseContext(budgetMs);
  if (ctx.uid !== manifest.owner.uid || ctx.home !== manifest.owner.home) throw new Stop('the manifest belongs to another owner');
  qaPort(manifest.ports.p);
  qaPort(manifest.ports.p2);
  Object.assign(ctx, { manifest, checkout: manifest.checkout, node: manifest.node, entry: manifest.entry, helper: manifest.helper,
    webDist: manifest.webDist, goblinDist: manifest.goblinDist, dataDir: manifest.dataDirectory.path, ports: manifest.ports,
    token: manifest.canaryToken, instance: manifest.instance, userTemp: manifest.userTemp, scope: manifest.scope.path,
    gatewayCommand: manifest.gatewayCommand, launcherMarks: manifest.launcherMarks, fileProbes: false });
  ctx.watch = [ctx.checkout + '/apps/', ctx.scope + '/', ...ctx.launcherMarks];
  const out = flags['--out'];
  if (!out.startsWith('/') || out.startsWith(ctx.checkout + '/') || out.startsWith(join(ctx.home, 'Applications') + '/')) throw new Stop('output directory not admissible');
  await mkdir(out, { mode: 0o700 });
  ctx.evidence = await realpath(out);
  return ctx;
}

async function observeOnce(ctx, label) {
  const m = ctx.manifest;
  const observation = { at: iso(), listeners: { p: await lsofTcp(ctx, m.ports.p, 'LISTEN', label + '-p'), p2: await lsofTcp(ctx, m.ports.p2, 'LISTEN', label + '-p2') } };
  if (observation.listeners.p.length > 0) {
    const h = await health(m.ports.p).catch((error) => ({ error: error?.code ?? 'error' }));
    observation.gateway = { health: { status: h.status ?? null, pid: h.pid ?? null, phase: h.phase ?? null, fixtureInstance: h.instance === m.instance, error: h.error ?? null } };
    if (h.pid && observation.listeners.p.some((l) => l.pid === h.pid)) {
      const proc = await psOne(ctx, h.pid, label + '-ps', false);
      observation.gateway.process = proc;
      if (proc && proc.uid === ctx.uid && proc.command === m.gatewayCommand) {
        observation.gateway.environment = await processEnvironment(ctx, proc.pid, proc.command, label + '-env');
        observation.gateway.files = await openFiles(ctx, proc.pid, label + '-files');
      }
    }
  }
  const rows = await processRows(ctx, label + '-rows');
  observation.launchers = rows.filter((r) => isLauncher(ctx, r));
  observation.gatewaysFromCheckout = rows.filter((r) => isGateway(ctx, r));
  observation.helpers = rows.filter((r) => isHelper(ctx, r));
  observation.establishedOnP = await lsofTcp(ctx, m.ports.p, 'ESTABLISHED', label + '-established');
  observation.leases = await leaseState(ctx);
  observation.apps = [];
  for (const app of m.apps) {
    const st = await lstatOrNull(app.path);
    const receipt = await lstatOrNull(app.receipt.path);
    observation.apps.push({ role: app.role, present: st !== null, sameBundle: st !== null && sameIdent(ident(st), app.bundle),
      receiptSame: receipt !== null && sameIdent(ident(receipt), app.receipt), log: withoutText(await logDirState(ctx, app.id)) });
  }
  observation.crashReports = (await dirSummary(join(ctx.home, 'Library', 'Logs', 'DiagnosticReports'), (n) => /^graphgoblin/iu.test(n))).kept ?? [];
  return observation;
}

async function observeMode(flags) {
  const repeat = Math.min(240, Math.max(1, Number.parseInt(flags['--repeat'] ?? '1', 10) || 1));
  const interval = Math.max(250, Number.parseInt(flags['--interval-ms'] ?? '1000', 10) || 1000);
  const ctx = await fixtureContext(flags, repeat * (interval + 15_000) + 60_000);
  const series = [];
  let failure = null;
  try {
    for (let i = 0; i < repeat; i++) {
      series.push(await observeOnce(ctx, 'observe-' + i));
      if (i + 1 < repeat) await pause(interval);
    }
  } catch (error) {
    failure = stopMessage(error);
  }
  await save(ctx, 'observation.json', { schema: SCHEMA, mode: 'observe', readOnly: true, manifestRunId: ctx.manifest.runId, failure, series });
  process.stdout.write(JSON.stringify({ schema: SCHEMA, mode: 'observe', samples: series.length, failure, evidence: ctx.evidence }) + '\n');
  process.exitCode = failure ? 1 : 0;
}

async function drainMode(flags) {
  const ctx = await fixtureContext(flags, 5 * 60_000);
  const pid = Number(flags['--pid']);
  const birth = birthOf(flags['--birth']);
  let failure = null;
  let outcome = null;
  try {
    await stage(ctx, 'D-verified-fixture-drain', ['GUI-support'], async () => {
      must(ctx, 'pid-argument', Number.isInteger(pid) && pid > 1);
      const fresh = await witness(ctx, ctx.ports.p, 'fixture', { instance: ctx.instance, command: ctx.gatewayCommand });
      must(ctx, 'named-incarnation', fresh.pid === pid && fresh.birth === birth, { fresh: { pid: fresh.pid, birth: fresh.birth } });
      const env = await processEnvironment(ctx, fresh.pid, fresh.command, 'fixture-env');
      if (want(ctx, 'environment-observable', env.observable)) {
        must(ctx, 'fixture-port-and-store', env.allow.GG_PORT === String(ctx.ports.p) && (env.allow.GG_DATA_DIR === ctx.dataDir || unvis(env.allow.GG_DATA_DIR ?? '') === ctx.dataDir));
      }
      outcome = await drainVerified(ctx, fresh, 'fixture', 60_000);
      note(ctx, 'drain', outcome);
    });
  } catch (error) {
    failure = stopMessage(error);
  }
  process.stdout.write(JSON.stringify({ schema: SCHEMA, mode: 'drain', status: failure ? 'not-drained-state-preserved' : 'drained-verified', failure, evidence: ctx.evidence }) + '\n');
  process.exitCode = failure ? 1 : 0;
}

// ---------------------------------------------------------------- entry
function parseArgs(argv) {
  const [mode, ...rest] = argv;
  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    const key = rest[i];
    if (!/^--[a-z-]+$/u.test(key) || key in flags) throw new Stop('bad or repeated flag ' + key);
    if (key === '--include-node-move') { flags[key] = true; continue; }
    if (i + 1 >= rest.length) throw new Stop('missing value for ' + key);
    flags[key] = rest[++i];
  }
  return { mode, flags };
}

async function main() {
  const allowed = { run: ['--binding', '--run-id', '--on-stop', '--include-node-move'], observe: ['--manifest', '--out', '--repeat', '--interval-ms'],
    drain: ['--manifest', '--out', '--pid', '--birth'], digest: ['--checkout'] };
  const required = { run: ['--binding'], observe: ['--manifest', '--out'], drain: ['--manifest', '--out', '--pid', '--birth'], digest: ['--checkout'] };
  let parsed;
  try { parsed = parseArgs(process.argv.slice(2)); } catch (error) { parsed = { error: stopMessage(error) }; }
  const { mode, flags = {} } = parsed;
  if (parsed.error || !allowed[mode] || Object.keys(flags).some((f) => !allowed[mode].includes(f)) || required[mode].some((f) => !(f in flags))) {
    process.stdout.write(JSON.stringify({ schema: SCHEMA, status: 'usage', error: parsed.error ?? 'unknown mode, flag or missing required flag', modes: allowed }) + '\n');
    process.exitCode = 64;
    return;
  }
  if (mode === 'run') await runMode(flags);
  else if (mode === 'observe') await observeMode(flags);
  else if (mode === 'drain') await drainMode(flags);
  else process.stdout.write(JSON.stringify(await launcherDigest(flags['--checkout'])) + '\n');
}

main().catch((error) => {
  process.stdout.write(JSON.stringify({ schema: SCHEMA, status: 'internal-error', error: stopMessage(error) }) + '\n');
  process.exitCode = 3;
});
