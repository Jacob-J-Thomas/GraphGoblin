#!/usr/bin/env node
// Offline controls for the preparation 04 S4/S5 oracle corrections. Node 22 built-ins only.
// CONTROLLED, NOT NATIVE ACCEPTANCE. It evaluates the exact declaration bytes of drivers 03 and 04, including the
// whole S4 stage, drainVerified and the S5 stage, against an in-process 127.0.0.1 fake API that models the documented
// route contracts (POST /loops, POST /loops/{id}/runs, GET /runs/{id}, GET|POST /system/shutdown, GET /loops,
// /healthz). Only the native probes are controlled stubs: witness, process row, leases, store helper, port state,
// gateway children, headless launcher, installer, bundle readback and filesystem links. No product, gateway,
// installer, SSH, provider, remote host or network beyond 127.0.0.1.
//
//   node offline-oracle-controls.mjs <driver03.mjs> <driver04.mjs> <QA05 receipt evidence dir>
//
// Exit 0 only when every expectation holds.

import { createHash, randomBytes, randomInt } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { basename, join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { isDeepStrictEqual } from 'node:util';

const [driver03Path, driver04Path, evidenceDir] = process.argv.slice(2);
if (!driver03Path || !driver04Path || !evidenceDir) { process.stderr.write('usage: driver03 driver04 qa05-evidence-dir\n'); process.exit(64); }
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

// ---------------------------------------------------------------- source guard
const text = { d03: await readFile(driver03Path, 'utf8'), d04: await readFile(driver04Path, 'utf8') };
const lines = { d03: text.d03.split('\n'), d04: text.d04.split('\n') };
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
// 1-based lines from `diff -U0 driver03 driver04` (correction-handoff.md). Every other byte must be identical.
const D03_REPLACED = [7, 573, 1073, 1076, 1088, 1124];
const D04_CHANGED = [7, 29, ...range(543, 554), 566, 586, 588, ...range(662, 665), ...range(715, 736), ...range(1114, 1116), ...range(1119, 1121),
  ...range(1133, 1135), 1144, 1145, 1173, 1174];
const without = (list, drop) => list.filter((_, i) => !drop.includes(i + 1)).join('\n');
const guard = {
  d03Sha256: sha(text.d03), d04Sha256: sha(text.d04), d03Lines: lines.d03.length, d04Lines: lines.d04.length,
  restIdentical: without(lines.d03, D03_REPLACED) === without(lines.d04, D04_CHANGED),
  d03Replaced: D03_REPLACED.map((n) => lines.d03[n - 1]),
  oldStartBodyInD03: lines.d03[1072].includes("`/loops/${loopId}/runs`, { allowDraft: true })"),
  newStartBodyInD04: lines.d04[1115].includes('`/loops/${loopId}/runs`, start.body)'),
};

// ---------------------------------------------------------------- exact-declaration extraction
function extract(source, names) {
  const parts = [];
  for (const name of names) {
    const start = new RegExp(`^(?:async function|function|const|class) ${name}\\b`, 'mu').exec(source);
    if (!start) throw new Error('declaration not found: ' + name);
    let end;
    if (/^class /u.test(start[0])) end = source.indexOf('\n', start.index);
    else if (/^const /u.test(start[0])) {
      // A const runs to the first line that ends its statement with ';'.
      let at = start.index;
      for (;;) { const nl = source.indexOf('\n', at); if (source.slice(at, nl).trimEnd().endsWith(';')) { end = nl; break; } at = nl + 1; }
    } else end = source.indexOf('\n}\n', start.index) + 2;
    parts.push(source.slice(start.index, end));
  }
  return parts.join('\n');
}
const COMMON = ['Stop', 'sha256', 'hex', 'now', 'iso', 'replacer', 'json', 'stopMessage', 'ULID', 'WAIT_SECONDS', 'BOUND', 'CAP', 'FORBIDDEN_PORTS',
  'EXIT', 'INSTALLED_TEXT', 'LEASES', 'stage', 'check', 'must', 'want', 'note', 'clean', 'envelope', 'qaPort', 'http', 'headerValues', 'health',
  'api', 'pollRun', 'leasesFree', 'sameOwner', 'sameIdent', 'drainVerified', 'waitLoop', 'stageWaitRunDrain', 'checkInstalled', 'strip',
  'stageSecondInstallConcurrent'];
const NEW_IN_04 = ['acceptedDrainFields', 'ulidOrNull', 'draftStart', 'draftRunPin', 'sameConfiguration'];
// Native probes and filesystem effects are controlled stubs that delegate to the current scenario.
const seam = {};
const STUBBED = ['witness', 'psOne', 'leaseState', 'helperLine', 'portState', 'gatewayChildren', 'headless', 'save', 'symlink', 'realpath', 'install',
  'readInstalled', 'gatewayRows', 'processRows', 'logDirState', 'foreignConnections', 'isHelper', 'isLauncher', 'isGateway'];
const stubs = Object.fromEntries(STUBBED.map((name) => [name, (...args) => {
  if (!seam[name]) throw new Error('control seam reached unstubbed ' + name);
  return seam[name](...args);
}]));
function load(source, names) {
  const code = extract(source, names);
  const deps = { request, createHash, isDeepStrictEqual, pause, join, basename, ...stubs };
  const optional = NEW_IN_04.map((n) => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(', ');
  // eslint-disable-next-line no-new-func
  return new Function('deps', `const { ${Object.keys(deps).join(', ')} } = deps;\n${code}\nreturn { Stop, ULID, waitLoop, stageWaitRunDrain, ` +
    `stageSecondInstallConcurrent, drainVerified, checkInstalled, strip, ${optional} };`)(deps);
}
const d03 = load(text.d03, COMMON);
const d04 = load(text.d04, [...COMMON, ...NEW_IN_04]);

// ---------------------------------------------------------------- controlled fake API (documented route contracts)
const ID = { loop: '01KA00000000000000000000A1', draft: '01KA00000000000000000000D1', run: '01KA00000000000000000000R1',
  snap: '01KA00000000000000000000S1', other: '01KA00000000000000000000X1', foreign: '01KA00000000000000000000F1', inv: '01KA00000000000000000000V1' };
if (!Object.values(ID).every((v) => d04.ULID.test(v))) throw new Error('control IDs are not ULIDs');
const INSTANCE = 'e'.repeat(64);
const T0 = '2026-11-16T22:15:08.156Z';
const S = {};
const tokens = [];
const newToken = () => { const t = 'qa-control-token-' + randomBytes(8).toString('hex'); tokens.push(t); return t; };
function reset(scenario) {
  Object.assign(S, { sc: { create: 'correct', start: 'product', pin: 'correct', retain: 'same', getUnconfirmed: [], postUnconfirmed: [], omitPostUnconfirmed: false,
    ...scenario }, live: true, phase: 'running', incarnation: 1, pid: 50001, birth: 'Mon Nov 16 16:14:03 2026', token: newToken(), afterReads: 0,
  startRequests: [], shutdownPosts: [], definitionName: null });
}
function ownerOf() {
  return { port, pid: S.pid, birth: S.birth, instance: INSTANCE, phase: 'running', ppid: 1, pgid: S.pid, stat: 'Ss', tty: '??', command: 'node main.js',
    leases: { 'graphgoblin.lock': 'a'.repeat(64) + S.incarnation, 'graphgoblin.db.graphgoblin.lock': 'b'.repeat(64) + S.incarnation } };
}
function createBody(definition) {
  const loop = { id: ID.loop, ownerId: 'local', name: definition.name, draftVersionId: ID.draft, createdAt: T0, updatedAt: T0 };
  const draft = { id: ID.draft, loopId: ID.loop, version: 1, status: 'draft', definition, createdAt: T0 };
  const m = S.sc.create;
  if (m === 'missing-draft') return { loop, issues: [] };
  if (m === 'foreign-draft') draft.loopId = ID.foreign;
  if (m === 'non-ulid-draft') { draft.id = 'draft-1'; loop.draftVersionId = 'draft-1'; }
  if (m === 'loop-draft-mismatch') loop.draftVersionId = ID.other;
  if (m === 'loop-draft-absent') delete loop.draftVersionId;
  if (m === 'published-draft') draft.status = 'published';
  if (m === 'draft-id-equals-loop') { draft.id = ID.loop; loop.draftVersionId = ID.loop; }
  return { loop, draft, issues: [] };
}
function runRecord(status) {
  const after = S.incarnation > 1;
  let versionId = { 'version-equals-draft': ID.draft, 'version-equals-run': ID.run }[S.sc.pin] ?? ID.snap;
  let source = S.sc.pin === 'source-published' ? 'published' : 'draft';
  if (after && S.sc.retain === 'different-version') versionId = ID.other;
  if (after && S.sc.retain === 'source-published') source = 'published';
  const name = S.definitionName;
  return { id: ID.run, ownerId: 'local', loopId: S.sc.pin === 'foreign-loop' ? ID.foreign : ID.loop, versionId,
    pinned: { source, version: 1, name, label: `${name} ${source === 'draft' ? 'draft ' : ''}v1`, defaults: { owner: { byHarness: {} }, process: { byHarness: {} } },
      limits: { structuredTimeoutMs: null, maxNodeVisits: null, runDeadlineSeconds: null }, classifiers: {} },
    invocationId: ID.inv, status, iteration: 1, createdAt: T0, lastEventSeq: 3 };
}
const RECOVERY = { observedSeq: 3, resume: { available: false, code: 'RUN_ACTIVE' }, replayDefault: { available: false, code: 'RUN_ACTIVE' }, replay: [] };
async function handle(req, res) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  const send = (status, value, headers = {}) => {
    const body = typeof value === 'string' ? value : JSON.stringify(value);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), ...headers });
    res.end(body);
  };
  const { method, url } = req;
  if (method === 'GET' && url === '/healthz') return send(200, '{"status":"ok"}', { 'x-graphgoblin-instance': INSTANCE, 'x-graphgoblin-pid': String(S.pid), 'x-graphgoblin-phase': S.phase });
  if (method === 'POST' && url === '/loops') {
    const definition = JSON.parse(raw).definition;
    S.definitionName = definition.name;
    return send(201, createBody(definition));
  }
  if (method === 'POST' && url === `/loops/${ID.loop}/runs`) {
    const body = raw === '' ? {} : JSON.parse(raw);
    S.startRequests.push({ url, rawBody: raw });
    // runs.ts: versionId = body.versionId || loop.currentVersionId; a draft-only loop has no currentVersionId, and
    // RunManager.resolveVersion then looks for the latest published version (run-manager.ts:3362-3371).
    const versionId = body.versionId || undefined;
    if (!versionId && S.sc.start === 'product') return send(404, { code: 'LOOP_NOT_FOUND', detail: `loop ${ID.loop} has no published version` });
    if (versionId && versionId !== ID.draft) return send(404, { code: 'LOOP_NOT_FOUND', detail: `loop ${ID.loop} has no version ${versionId}` });
    if (body.allowDraft !== true) return send(409, { code: 'VERSION_NOT_PUBLISHED' });
    return send(202, { run: runRecord('queued') });
  }
  if (method === 'GET' && url === `/runs/${ID.run}`) {
    if (S.incarnation === 1) return send(200, { ...runRecord('waiting'), currentNodeId: 'pause',
      waiting: { waitId: 'w1', nodeId: 'pause', kind: 'timer', until: '2026-11-16T22:15:53.156Z', startedSeq: 3 }, recovery: RECOVERY });
    S.afterReads += 1;
    return send(200, { ...runRecord(S.afterReads === 1 ? 'waiting' : 'succeeded'), recovery: RECOVERY });
  }
  if (method === 'GET' && url === '/system/shutdown') {
    return send(200, { phase: 'running', graceMs: 300000, activeRunIds: [], unconfirmedRunIds: S.sc.getUnconfirmed, choices: [], controlToken: S.token });
  }
  if (method === 'POST' && url === '/system/shutdown') {
    const matched = req.headers['x-graphgoblin-shutdown-token'] === S.token;
    S.shutdownPosts.push({ matched, action: JSON.parse(raw).action });
    if (!matched) return send(409, { phase: 'running', graceMs: 300000, activeRunIds: [], unconfirmedRunIds: [], choices: [], controlToken: S.token });
    const snapshot = { phase: 'draining', graceMs: 300000, startedAt: T0, activeRunIds: [], choices: [], controlToken: newToken() };
    if (!S.sc.omitPostUnconfirmed) snapshot.unconfirmedRunIds = S.sc.postUnconfirmed;
    S.live = false;
    S.phase = 'stopped';
    return send(202, snapshot);
  }
  if (method === 'GET' && url === '/loops') {
    return send(200, { items: [{ id: ID.loop, ownerId: 'local', name: S.definitionName, createdAt: T0, updatedAt: T0, draftVersionId: ID.draft,
      latestRun: { id: ID.run, status: 'succeeded', createdAt: T0 }, runCount: 1 }] });
  }
  return send(404, { code: 'NOT_FOUND' });
}
const server = createServer((req, res) => { handle(req, res).catch((error) => { res.writeHead(500).end(String(error)); }); });
let port = null;
for (let attempt = 0; attempt < 20 && port === null; attempt++) {
  const candidate = 49152 + randomInt(65536 - 49152);
  if (candidate === 4747 || candidate === 4748) continue;
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen({ host: '127.0.0.1', port: candidate, exclusive: true }, resolve); });
    port = candidate;
  } catch (error) { if (error?.code !== 'EADDRINUSE' && error?.code !== 'EACCES') throw error; }
}
if (port === null) throw new Error('no loopback control port');

// Native-probe seam for S4: the registered gateway is the fake API's current incarnation; after an accepted drain the
// port is refused, the process row is gone and the leases are free, as in the QA05 recovery drain.
const FREE_LEASES = { 'graphgoblin.lock': null, 'graphgoblin.lock.reclaim': null, 'graphgoblin.db.graphgoblin.lock': null, 'graphgoblin.db.graphgoblin.lock.reclaim': null };
const launched = (p) => ({ exit: { code: 0, signal: null, ms: 5 }, timedOut: false, spawnError: null, eof: { stdout: true, stderr: true },
  overflow: { stdout: false, stderr: false }, stdout: Buffer.from(JSON.stringify({ version: 1, code: 'open-management-running', port: p }) + '\n'), stderr: Buffer.alloc(0), elapsedMs: 5 });
function s4Seam() {
  for (const name of STUBBED) delete seam[name];
  Object.assign(seam, {
    witness: async () => ownerOf(),
    psOne: async () => null,
    leaseState: async () => ({ ...FREE_LEASES }),
    helperLine: async () => ({ ok: true, text: '{"state":"free"}\n' }),
    portState: async () => (S.live ? { state: 'answered', pid: S.pid, phase: S.phase, instance: INSTANCE } : { state: 'refused', code: 'ECONNREFUSED' }),
    gatewayChildren: async () => [],
    headless: async () => { S.incarnation += 1; S.pid += 1; S.birth = 'Mon Nov 16 16:16:0' + S.incarnation + ' 2026'; S.live = true; S.phase = 'running'; S.token = newToken(); return launched(port); },
  });
}
async function runS4(driver, scenario) {
  reset(scenario);
  s4Seam();
  const ctx = { ports: { p: port }, instance: INSTANCE, runId: '7c5ae3c2', app: { a: { path: '/qa/GraphGoblin QA.app' } }, stages: [], current: null, evidence: null, tick() {} };
  ctx.owner = ownerOf();
  let thrown = null;
  try { await driver.stageWaitRunDrain(ctx); } catch (error) { thrown = { stop: error instanceof driver.Stop, message: String(error?.message ?? error) }; }
  const record = ctx.stages[0];
  const serialized = JSON.stringify({ stages: ctx.stages, data: ctx.data ?? null }, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  const byId = Object.fromEntries(record.checks.map((c) => [c.id, c]));
  return { status: record.status, thrown, checks: record.checks.map((c) => `${c.ok ? 'met' : 'UNMET'}:${c.hard ? 'must' : 'want'}:${c.id}`), byId,
    startRequests: S.startRequests.map((r) => ({ url: r.url.replace(ID.loop, '<loop>'), rawBody: r.rawBody })), shutdownPosts: S.shutdownPosts,
    data: ctx.data ?? null, notesDrain: record.notes.drain ?? null, tokenLeak: tokens.some((t) => serialized.includes(t)) };
}

// ---------------------------------------------------------------- QA05 configuration records (actual raw evidence)
const qa05 = {};
for (const tag of ['a', 'a-nfd', 'a-case']) {
  const file = join(evidenceDir, `installed-${tag}.json`);
  const bytes = await readFile(file);
  qa05[tag] = { file: basename(file), fileSha256: sha(bytes), record: JSON.parse(bytes.toString('utf8')) };
}
const admission = JSON.parse(await readFile(join(evidenceDir, 'admission.json'), 'utf8'));
const CFG = 'Contents/Resources/launcher.json';
// The stripped records omit configText. JSON.stringify of each parsed config in its recorded member order reproduces the
// recorded byte length and SHA-256, so the reconstructed text is the actual saved bytes.
const reconstruction = Object.fromEntries(Object.entries(qa05).map(([tag, { record }]) => {
  const textValue = JSON.stringify(record.config);
  return [tag, { keys: Object.keys(record.config), recordedSha256: record.files[CFG].sha256, recordedSize: record.files[CFG].size,
    reconstructedSha256: sha(Buffer.from(textValue, 'utf8')), reconstructedSize: Buffer.byteLength(textValue), receiptConfiguration: record.receipt.object.installed.configuration,
    matches: sha(Buffer.from(textValue, 'utf8')) === record.files[CFG].sha256 && Buffer.byteLength(textValue) === record.files[CFG].size }];
}));
const withText = (record) => ({ ...structuredClone(record), configText: JSON.stringify(record.config) });
const NAMES = { a: admission.names.a.value, b: admission.names.b.value };
const B_ID = 'b'.repeat(32);
function deriveB(record, { mutate, receiptConfiguration } = {}) {
  const b = withText(record);
  b.id = B_ID;
  b.name = NAMES.b;
  b.path = record.path.replace(record.name, NAMES.b);
  b.plist.CFBundleIdentifier = 'com.graphgoblin.launcher.instance.' + B_ID;
  b.plist.GraphGoblinInstallationID = B_ID;
  if (mutate) mutate(b.config);
  b.configText = JSON.stringify(b.config);
  const own = sha(Buffer.from(b.configText, 'utf8'));
  b.files[CFG] = { ...b.files[CFG], size: Buffer.byteLength(b.configText), sha256: own };
  b.receipt.object = { ...b.receipt.object, id: B_ID, name: NAMES.b, installed: { ...b.receipt.object.installed, configuration: receiptConfiguration ?? own } };
  return b;
}
function installCtx(appA) {
  // Expected values come from the QA05 admission and binding, never from the record under test.
  return { uid: admission.binding.owner.uid, checkout: admission.binding.checkout, node: admission.node, token: admission.canaryToken, ports: { p: admission.ports.p },
    names: NAMES, dataInput: admission.dataInput.value, dataDir: appA.config.dataDirectory, dataAlias: '/qa/links/data alias ü',
    canonicalScript: '/qa/scripts/install-macos-launcher.sh', app: { a: appA }, stages: [], current: null, evidence: null, tick() {} };
}
async function runS5(driver, b) {
  for (const name of STUBBED) delete seam[name];
  const saved = [];
  Object.assign(seam, {
    symlink: async () => undefined,
    realpath: async () => '/qa/store',
    install: async () => ({ ...launched(0), stdout: Buffer.from('GraphGoblin was installed in Applications.\n') }),
    readInstalled: async () => structuredClone(b),
    save: async (_ctx, name) => { saved.push(name); return { file: name }; },
    // Controlled stop: the first post-configuration precondition reports the port answered, so S5 stops right after
    // the configuration assertions under test and launches nothing.
    portState: async () => ({ state: 'answered', pid: 1, phase: 'running', instance: INSTANCE }),
  });
  const ctx = installCtx(withText(qa05['a-case'].record));
  let thrown = null;
  try { await driver.stageSecondInstallConcurrent(ctx); } catch (error) { thrown = { stop: error instanceof driver.Stop, message: String(error?.message ?? error) }; }
  const record = ctx.stages[0];
  const byId = Object.fromEntries(record.checks.map((c) => [c.id, c]));
  return { status: record.status, thrown, checks: record.checks.map((c) => `${c.ok ? 'met' : 'UNMET'}:${c.hard ? 'must' : 'want'}:${c.id}`), byId, saved };
}
function runCheckInstalled(driver, inst, exp, tag) {
  const ctx = { ...installCtx(inst), stages: [], current: { id: 'control', checks: [], notes: {} } };
  let thrown = null;
  try { driver.checkInstalled(ctx, inst, exp, tag); } catch (error) { thrown = { stop: error instanceof driver.Stop, message: String(error?.message ?? error) }; }
  return { thrown, checks: ctx.current.checks.map((c) => `${c.ok ? 'met' : 'UNMET'}:${c.hard ? 'must' : 'want'}:${c.id}`), byId: Object.fromEntries(ctx.current.checks.map((c) => [c.id, c])) };
}

// ---------------------------------------------------------------- cases
const cases = [];
const expect = (id, meaning, ok, observed) => cases.push({ id, ok: Boolean(ok), meaning, observed });
const met = (r, id) => r.byId[id]?.ok === true;
const unmet = (r, id) => r.byId[id] !== undefined && r.byId[id].ok === false;
const stoppedAt = (r, id) => r.status === 'stopped' && r.thrown?.stop === true && r.thrown.message.endsWith(': ' + id) && unmet(r, id);
const EXPLICIT = JSON.stringify({ versionId: ID.draft, allowDraft: true });
const s4Summary = (r) => ({ status: r.status, thrown: r.thrown, checks: r.checks, startRequests: r.startRequests, tokenLeak: r.tokenLeak });

// Reproductions with the unchanged driver 03 bytes.
{
  const r = await runS4(d03, {});
  expect('R1-d03-S4-omitted-version-404', 'driver 03 sends {allowDraft:true} only and stops at run-admitted with 404 LOOP_NOT_FOUND, exactly as QA05',
    stoppedAt(r, 'run-admitted') && r.byId['run-admitted'].detail.status === 404 && r.byId['run-admitted'].detail.code === 'LOOP_NOT_FOUND' &&
    r.startRequests.length === 1 && r.startRequests[0].rawBody === '{"allowDraft":true}' && met(r, 'loop-created'), s4Summary(r));
}
{
  const r = await runS4(d03, { start: 'lenient', getUnconfirmed: [], postUnconfirmed: [ID.run] });
  expect('R2-d03-S4-reads-GET-not-POST', 'reproduction-only lenient start: driver 03 passes waiting-run-not-unconfirmed although the accepted POST snapshot lists the timer run',
    met(r, 'waiting-run-not-unconfirmed') && r.status === 'criteria-met', { status: r.status, detail: r.byId['waiting-run-not-unconfirmed']?.detail });
}
{
  const r = await runS4(d03, { start: 'lenient', omitPostUnconfirmed: true });
  expect('R3-d03-S4-missing-POST-array-vacuous', 'reproduction-only lenient start: driver 03 passes waiting-run-not-unconfirmed with no unconfirmedRunIds in the POST snapshot',
    met(r, 'waiting-run-not-unconfirmed'), { status: r.status, detail: r.byId['waiting-run-not-unconfirmed']?.detail });
}

// Driver 04, defect 1: explicit draft selection and pinned snapshot identity.
{
  const r = await runS4(d04, {});
  const pin = r.byId['run-pins-new-draft-snapshot']?.detail?.pin;
  expect('A1-d04-S4-correct-explicit-draft', 'driver 04 validates the created draft, sends exactly {versionId:<draft>,allowDraft:true}, gets 202 and completes S4 with all criteria met',
    r.status === 'criteria-met' && r.thrown === null && r.startRequests.length === 1 && r.startRequests[0].rawBody === EXPLICIT &&
    r.startRequests[0].url === '/loops/<loop>/runs' && ['loop-created', 'draft-bound-to-loop', 'run-admitted', 'run-pins-new-draft-snapshot', 'run-active-waiting',
      'run-retained-across-restart', 'run-pin-retained-across-restart', 'run-completed-after-restart', 'loop-retained', 'waiting-run-not-unconfirmed'].every((id) => met(r, id)), s4Summary(r));
  expect('A1b-d04-S4-snapshot-distinct-and-recorded', 'the pinned versionId is a new snapshot ID distinct from the submitted draft, source draft, version 1, recorded in ctx.data beside the draft ID',
    pin?.versionId === ID.snap && pin.versionId !== ID.draft && pin.source === 'draft' && pin.version === 1 && pin.loopId === ID.loop && pin.runId === ID.run &&
    r.data?.draftVersionId === ID.draft && r.data?.runVersionId === ID.snap && r.data?.loopId === ID.loop && r.data?.runId === ID.run,
    { pin, data: { ...r.data, startedAt: undefined } });
  expect('A1c-d04-S4-retained-pin-compared', 'after the controlled restart the same run/loop/snapshot/source/version projection is read from GET /runs/{id}',
    isDeepStrictEqual(r.byId['run-pin-retained-across-restart']?.detail?.retained, pin), r.byId['run-pin-retained-across-restart']?.detail);
  expect('A1d-d04-S4-no-control-token-recorded', 'no control token issued by the fake API appears in the stage record or ctx.data; both drains sent the matching token',
    r.tokenLeak === false && r.shutdownPosts.length === 2 && r.shutdownPosts.every((p) => p.matched && p.action === 'drain'), { tokenLeak: r.tokenLeak, shutdownPosts: r.shutdownPosts });
}
for (const [id, create, meaning] of [
  ['A2-d04-S4-missing-draft', 'missing-draft', 'a 201 without a draft member refuses before any start request'],
  ['A3-d04-S4-foreign-draft', 'foreign-draft', 'a draft whose loopId names another loop refuses before any start request'],
  ['A4-d04-S4-non-ulid-draft', 'non-ulid-draft', 'a non-ULID draft ID refuses before any start request'],
  ['A5-d04-S4-loop-draft-mismatch', 'loop-draft-mismatch', 'loop.draftVersionId naming a different version refuses before any start request'],
  ['A6-d04-S4-loop-draft-absent', 'loop-draft-absent', 'a loop without draftVersionId refuses before any start request'],
  ['A7-d04-S4-draft-not-draft-status', 'published-draft', 'a draft member whose status is not draft refuses before any start request'],
  ['A8-d04-S4-draft-id-equals-loop', 'draft-id-equals-loop', 'a draft ID equal to the loop ID refuses before any start request'],
]) {
  const r = await runS4(d04, { create });
  expect(id, meaning, stoppedAt(r, 'draft-bound-to-loop') && r.startRequests.length === 0, { ...s4Summary(r), detail: r.byId['draft-bound-to-loop']?.detail });
}
for (const [id, pin, meaning] of [
  ['P1-d04-S4-run-version-equals-draft', 'version-equals-draft', 'run.versionId equal to the mutable submitted draft ID is refused'],
  ['P2-d04-S4-run-version-equals-run', 'version-equals-run', 'run.versionId equal to the run ID is refused'],
  ['P3-d04-S4-pinned-source-published', 'source-published', 'pinned.source other than draft is refused'],
  ['P4-d04-S4-run-foreign-loop', 'foreign-loop', 'a run bound to another loop is refused'],
]) {
  const r = await runS4(d04, { pin });
  expect(id, meaning, stoppedAt(r, 'run-pins-new-draft-snapshot') && met(r, 'run-admitted') && r.startRequests.length === 1,
    { ...s4Summary(r), detail: r.byId['run-pins-new-draft-snapshot']?.detail });
}
for (const [id, retain, meaning] of [
  ['P5-d04-S4-retained-version-differs', 'different-version', 'a different pinned versionId after restart is refused'],
  ['P6-d04-S4-retained-source-differs', 'source-published', 'a different pinned source after restart is refused'],
]) {
  const r = await runS4(d04, { retain });
  expect(id, meaning, stoppedAt(r, 'run-pin-retained-across-restart') && met(r, 'run-retained-across-restart'),
    { ...s4Summary(r), detail: r.byId['run-pin-retained-across-restart']?.detail });
}

// Driver 04, defect 2: the accepted POST snapshot is the source.
for (const [id, scenario, expectMet, meaning] of [
  ['D1-d04-S4-POST-empty-array', { postUnconfirmed: [] }, true, 'POST unconfirmedRunIds [] meets the criterion'],
  ['D2-d04-S4-POST-missing', { omitPostUnconfirmed: true }, false, 'a POST snapshot without unconfirmedRunIds is unmet, not vacuously met'],
  ['D3-d04-S4-POST-string', { postUnconfirmed: ID.run }, false, 'a string unconfirmedRunIds is unmet'],
  ['D4-d04-S4-POST-object', { postUnconfirmed: { 0: ID.run } }, false, 'an object unconfirmedRunIds is unmet'],
  ['D5-d04-S4-POST-null', { postUnconfirmed: null }, false, 'a null unconfirmedRunIds is unmet'],
  ['D6-d04-S4-POST-contains-timer-run', { postUnconfirmed: [ID.run] }, false, 'the timer run reported unconfirmed is unmet'],
  ['D7-d04-S4-GET-clean-POST-flags-run', { getUnconfirmed: [], postUnconfirmed: [ID.run] }, false, 'a clean GET with a POST flagging the run is unmet: the POST is the source'],
  ['D8-d04-S4-GET-flags-run-POST-clean', { getUnconfirmed: [ID.run], postUnconfirmed: [] }, true, 'a GET flagging the run with a clean POST is met: the GET is not the source'],
  ['D9-d04-S4-POST-other-run-only', { postUnconfirmed: [ID.other] }, true, 'another run listed unconfirmed does not affect this timer run'],
  ['D10-d04-S4-POST-non-ulid-entry', { postUnconfirmed: [ID.run.toLowerCase()] }, false, 'an array holding a non-ULID entry is not a valid run-ID list and is unmet'],
]) {
  const r = await runS4(d04, scenario);
  const detail = r.byId['waiting-run-not-unconfirmed']?.detail;
  const rest = r.checks.filter((c) => !c.endsWith(':waiting-run-not-unconfirmed')).every((c) => c.startsWith('met:'));
  expect(id, meaning, (expectMet ? met(r, 'waiting-run-not-unconfirmed') && r.status === 'criteria-met'
    : unmet(r, 'waiting-run-not-unconfirmed') && r.status === 'criteria-not-met' && r.byId['waiting-run-not-unconfirmed'].hard === false) &&
    rest && r.thrown === null && r.tokenLeak === false && detail?.runId === ID.run && !('controlToken' in (detail?.accepted ?? {})),
    { status: r.status, detail, getUnconfirmedSent: scenario.getUnconfirmed ?? [], restOfStageMet: rest, drainNoteShutdownGET: r.notesDrain?.shutdown?.unconfirmedRunIds });
}
{
  const fields = d04.acceptedDrainFields({ phase: 'draining', graceMs: 300000, startedAt: T0, activeRunIds: [ID.run], unconfirmedRunIds: [], choices: [], controlToken: 'qa-secret-token', error: 'x', extra: { big: 'y' } });
  expect('D11-d04-acceptedDrainFields-allowlist', 'only phase, run-ID lists, their shapes, choices and graceMs are kept; controlToken, error and other members are dropped',
    isDeepStrictEqual(Object.keys(fields), ['phase', 'activeRunIds', 'unconfirmedRunIds', 'shapes', 'choices', 'graceMs']) && !JSON.stringify(fields).includes('qa-secret-token') &&
    isDeepStrictEqual(fields.activeRunIds, [ID.run]) && isDeepStrictEqual(fields.unconfirmedRunIds, []), fields);
  const big = d04.acceptedDrainFields({ unconfirmedRunIds: Array.from({ length: 257 }, () => ID.other) });
  expect('D12-d04-acceptedDrainFields-bounded', 'a run-ID list above 256 entries is not retained (null, shape array)', big.unconfirmedRunIds === null && big.shapes.unconfirmedRunIds === 'array', big.shapes);
}

// Driver 04, defect 1 helpers directly (exact extracted bytes).
{
  const good = { loop: { id: ID.loop, draftVersionId: ID.draft }, draft: { id: ID.draft, loopId: ID.loop, status: 'draft', version: 1 } };
  const ok = d04.draftStart(good);
  const variants = {
    missingLoop: { draft: good.draft }, missingDraft: { loop: good.loop }, nullBody: null,
    versionZero: { ...good, draft: { ...good.draft, version: 0 } }, versionString: { ...good, draft: { ...good.draft, version: '1' } },
    snapshotStatus: { ...good, draft: { ...good.draft, status: 'snapshot' } }, lowercaseId: { loop: { ...good.loop, draftVersionId: ID.draft.toLowerCase() }, draft: { ...good.draft, id: ID.draft.toLowerCase() } },
  };
  const refused = Object.fromEntries(Object.entries(variants).map(([k, v]) => { const s = d04.draftStart(v); return [k, s.ok === false && s.body === null]; }));
  expect('H1-d04-draftStart-direct', 'the exact body for a valid create response; every malformed variant refuses with no body',
    ok.ok && JSON.stringify(ok.body) === EXPLICIT && Object.values(refused).every(Boolean), { ok: ok.ok, body: ok.body, refused });
  const run = { id: ID.run, loopId: ID.loop, versionId: ID.snap, pinned: { source: 'draft', version: 1 } };
  const pinOk = d04.draftRunPin(run, ok);
  const pinBad = {
    equalsDraft: d04.draftRunPin({ ...run, versionId: ID.draft }, ok).ok, equalsLoop: d04.draftRunPin({ ...run, versionId: ID.loop }, ok).ok,
    nonUlid: d04.draftRunPin({ ...run, versionId: 'snap' }, ok).ok, version2: d04.draftRunPin({ ...run, pinned: { source: 'draft', version: 2 } }, ok).ok,
    missingPinned: d04.draftRunPin({ ...run, pinned: undefined }, ok).ok, refusedStart: d04.draftRunPin(run, d04.draftStart(null)).ok,
  };
  expect('H2-d04-draftRunPin-direct', 'a new snapshot ID with source draft and the draft version is accepted; equal-to-draft/loop, non-ULID, other version, missing pin or refused start are not',
    pinOk.ok && Object.values(pinBad).every((v) => v === false), { pin: pinOk.pin, rejected: pinBad });
}

// Driver 04, defect 3: S5 configuration oracle over the actual QA05 records.
const allRebuilt = Object.values(reconstruction).every((r) => r.matches && r.receiptConfiguration === r.recordedSha256);
const hashes = Object.values(reconstruction).map((r) => r.recordedSha256);
expect('C0-qa05-records-reconstructed', 'each recorded config SHA-256 equals its own receipt configuration and the SHA of JSON.stringify(parsed) in its recorded member order; three orders, three distinct hashes',
  allRebuilt && new Set(hashes).size === 3 && new Set(Object.values(reconstruction).map((r) => r.keys.join(','))).size === 3, reconstruction);
{
  const configs = Object.fromEntries(Object.entries(qa05).map(([tag, { record }]) => [tag, record.config]));
  const pairs = [['a', 'a-nfd'], ['a', 'a-case'], ['a-nfd', 'a-case']];
  const base = configs.a;
  const variant = (f) => { const c = structuredClone(base); f(c); return c; };
  const changed = {
    port: variant((c) => { c.port = 62242; }), portAsString: variant((c) => { c.port = '62241'; }), checkout: variant((c) => { c.checkout += '-x'; }),
    node: variant((c) => { c.node = '/usr/local/bin/node'; }), dataDirectoryNfc: variant((c) => { c.dataDirectory = c.dataDirectory.normalize('NFC'); }),
    dataDirectoryCase: variant((c) => { c.dataDirectory = c.dataDirectory.replace('QA data', 'qa data'); }), requireAPIKey: variant((c) => { c.requireAPIKey = true; }),
    ollamaEnabled: variant((c) => { c.ollamaEnabled = true; }), version: variant((c) => { c.version = 2; }), extraField: variant((c) => { c.extra = 1; }),
    extraNullField: variant((c) => { c.extra = null; }), missingField: variant((c) => { delete c.ollamaEnabled; }),
  };
  const dataDirectoryWasNfd = base.dataDirectory !== base.dataDirectory.normalize('NFC');
  expect('C1-d04-sameConfiguration-direct', 'the three QA05 configs are pairwise equal in every order; each changed port/path/option/version or extra/missing member is not; null/array inputs are not',
    pairs.every(([x, y]) => d04.sameConfiguration(configs[x], configs[y]) && d04.sameConfiguration(configs[y], configs[x])) &&
    Object.values(changed).every((c) => !d04.sameConfiguration(base, c) && !d04.sameConfiguration(c, base)) && dataDirectoryWasNfd &&
    !d04.sameConfiguration(null, null) && !d04.sameConfiguration([], []) && d04.sameConfiguration(base, base),
    { pairsEqual: pairs.map(([x, y]) => `${x}=${y}:${d04.sameConfiguration(configs[x], configs[y])}`), changedRejected: Object.fromEntries(Object.entries(changed).map(([k, c]) => [k, !d04.sameConfiguration(base, c)])),
      savedDataDirectoryIsNfd: dataDirectoryWasNfd });
}
for (const [tag, { record }] of Object.entries(qa05)) {
  const inst = withText(record);
  const exp = { name: NAMES.a, port: admission.ports.p, dataDir: admission.dataInput.value, node: admission.node, id: qa05.a.record.id };
  const r = runCheckInstalled(d04, inst, exp, tag);
  expect(`B1-d04-checkInstalled-actual-${tag}`, `the unchanged checkInstalled meets every check on the actual QA05 ${tag} record, including receipt-binding to its own configuration bytes`,
    r.thrown === null && r.checks.every((c) => c.startsWith('met:')) && met(r, `${tag}:receipt-binding`) && met(r, `${tag}:config-closed-keys`), { checks: r.checks });
}
{
  const inst = withText(qa05.a.record);
  inst.files[CFG] = { ...inst.files[CFG], sha256: qa05['a-nfd'].record.files[CFG].sha256 };
  const r = runCheckInstalled(d04, inst, { name: NAMES.a, port: admission.ports.p, dataDir: admission.dataInput.value, node: admission.node, id: qa05.a.record.id }, 'a');
  expect('B2-d04-checkInstalled-foreign-config-hash', 'a record whose configuration bytes hash differs from its own receipt (another install\'s hash) stops at receipt-binding',
    r.thrown?.stop === true && r.thrown.message === 'control: a:receipt-binding' && unmet(r, 'a:receipt-binding'), { thrown: r.thrown });
}
for (const [id, source, options, predicate, meaning] of [
  ['S1-d04-S5-reordered-original', 'a', {}, (r) => met(r, 'identical-saved-configuration') && met(r, 'b:receipt-binding') && met(r, 'b:config-closed-keys') && met(r, 'store-spelling-bytes-identical'),
    'B with A\'s original member order (7479f6e8) against the final A (case update, 4f08dab9) meets identical-saved-configuration; receipt and closed-key checks met'],
  ['S2-d04-S5-reordered-nfd', 'a-nfd', {}, (r) => met(r, 'identical-saved-configuration') && met(r, 'b:receipt-binding'), 'B with the NFD-update member order (52909c11) also meets it'],
  ['S3-d04-S5-option-changed', 'a', { mutate: (c) => { c.requireAPIKey = true; } }, (r) => unmet(r, 'identical-saved-configuration') && unmet(r, 'b:config-options'),
    'a changed option is unmet (and config-options unmet)'],
  ['S4-d04-S5-extra-field', 'a', { mutate: (c) => { c.extra = 1; } }, (r) => unmet(r, 'identical-saved-configuration') && unmet(r, 'b:config-closed-keys'),
    'an extra member is unmet (and config-closed-keys unmet)'],
  ['S5-d04-S5-data-path-other-spelling', 'a', { mutate: (c) => { c.dataDirectory = c.dataDirectory.normalize('NFC'); } },
    (r) => unmet(r, 'identical-saved-configuration') && unmet(r, 'store-spelling-bytes-identical') && met(r, 'b:config-values') && met(r, 'alias-saved-as-canonical-store'),
    'the same store under another Unicode spelling passes the NFC value check but is unmet for byte-identical store spelling and identical configuration'],
  ['S6-d04-S5-port-changed', 'a', { mutate: (c) => { c.port = 62242; } }, (r) => r.status === 'stopped' && r.thrown?.message.endsWith(': b:config-values'),
    'a changed port stops at the unchanged hard b:config-values check'],
  ['S7-d04-S5-checkout-path-changed', 'a', { mutate: (c) => { c.checkout += '-x'; } }, (r) => r.status === 'stopped' && r.thrown?.message.endsWith(': b:config-values'),
    'a changed checkout path stops at the unchanged hard b:config-values check'],
  ['S8-d04-S5-receipt-bound-to-other-bytes', 'a', { receiptConfiguration: qa05['a-case'].record.files[CFG].sha256 },
    (r) => r.status === 'stopped' && r.thrown?.message.endsWith(': b:receipt-binding'), 'a receipt naming another install\'s configuration hash stops at the hard b:receipt-binding check'],
]) {
  const b = deriveB(qa05[source].record, options);
  const r = await runS5(d04, b);
  const reachedControlledStop = r.status === 'stopped' && r.thrown?.message.endsWith(': precondition-port-refused');
  const expectsControlledStop = !['S6', 'S7', 'S8'].some((p) => id.startsWith(p));
  expect(id, meaning, predicate(r) && (!expectsControlledStop || reachedControlledStop),
    { status: r.status, thrown: r.thrown, checks: r.checks, identical: r.byId['identical-saved-configuration']?.detail ?? null });
}
{
  const r = await runS5(d03, deriveB(qa05.a.record));
  expect('R4-d03-S5-reordered-unmet', 'driver 03 reports identical-saved-configuration unmet for the same reordered, value-identical B (the oracle defect)',
    unmet(r, 'identical-saved-configuration') && met(r, 'b:receipt-binding'), { checks: r.checks });
}

await new Promise((resolve) => { server.close(resolve); server.closeAllConnections?.(); });
const pass = guard.restIdentical && guard.oldStartBodyInD03 && guard.newStartBodyInD04 && cases.every((c) => c.ok);
const summary = { schema: 'gg456-prep04-offline-oracle-controls/1', controlled: true, nativeAcceptance: false, node: process.version, platform: `${process.platform}-${process.arch}`,
  inputs: { driver03: basename(driver03Path), driver04: basename(driver04Path), qa05Records: Object.fromEntries(Object.entries(qa05).map(([t, v]) => [v.file, v.fileSha256])) },
  guard, reconstruction, cases, counts: { total: cases.length, ok: cases.filter((c) => c.ok).length }, pass };
process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
process.exitCode = pass ? 0 : 1;
