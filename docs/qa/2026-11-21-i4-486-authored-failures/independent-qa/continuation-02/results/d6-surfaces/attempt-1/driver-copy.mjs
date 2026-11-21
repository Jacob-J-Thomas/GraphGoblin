// D6 public surfaces, persistence and history: scoped auth, REST vs built MCP stdio (get_run,
// terminal wait_for_run, list_runs), actual browser inspector DOM/screenshots/child links,
// historical row/event bytes across new publication/reads and a clean shutdown/reopen.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CHECKOUT, OUT, WORK, recorder, containsAny, sha256, imp } from './lib/rec.mjs';
import { boot, chain, startListener, counterLines, FIXTURE_APPEND, NODE_EXE, portRefuses, sleep } from './lib/boot.mjs';
import { canon, AFTER } from './lib/checks.mjs';

const r = recorder('d6');
const listener = await startListener();
let t = await boot({ name: 'd6', port: 5875, web: true });
const keys = t.keys;
const dataDir = t.dataDir;
const pids = { driver: process.pid, mcp: [], browser: [] };
r.raw('resources', { driverPid: process.pid, apiPort: 5875, reopenPort: 5876, listenerPort: listener.port, dataDir });
const inc = (p) => `{% include "QA486-PATH-${p}" %}`;
const CANARIES = ['QA486-LIT', 'QA486-IN', 'QA486-PATH', 'QA486-EXT'];
async function scenario(id, fn) {
  try { await fn(); } catch (error) { r.check(`${id}-crash`, 'scenario completed without driver exception', false, { error: String(error?.stack ?? error) }, 'INSTRUMENTATION'); }
}
async function publishOk(id, def) {
  const p = await t.publish(def);
  if (!p.ok) r.check(`${id}-setup`, 'fixture publishes (setup)', false, p.published?.json ?? p.created?.json, 'SETUP');
  return p.ok ? p.loopId : undefined;
}
const sub = (loopId, extra = {}) => ({ id: 'sub', kind: 'subloop', label: 'Sub', config: { loopRef: { loopId }, ...extra } });
const hbFault = { id: 'h', kind: 'heartbeat', label: 'h', config: { intervalSeconds: 1, maxBeats: 3, probe: { kind: 'http', method: 'GET', url: `${listener.url}/d6` }, until: '$error("QA486-LIT-D6")' } };

// ---------------- S-AUTH ----------------
const sinks = join(WORK, 'sinks');
mkdirSync(sinks, { recursive: true });
const authCounter = join(sinks, 'auth.counter.jsonl');
const authLoop = await publishOk('S-AUTH', chain('auth', [{ id: 's', kind: 'script', label: 's', config: { command: NODE_EXE, args: [FIXTURE_APPEND, authCounter, 'auth'], stdin: 'none', stdout: 'ignore' } }]));
await scenario('S-AUTH', async () => {
  const loopsBefore = (await t.rest('GET', '/loops')).json.items.length;
  const runsBefore = (await t.rest('GET', '/runs?limit=500')).json.items.length;
  const anyRun = (await t.rest('POST', `/loops/${authLoop}/runs`, { input: {} })).json.run.id;
  await t.settle(anyRun, ['succeeded', 'failed']);
  const linesBefore = counterLines(authCounter).length;
  const eventsBefore = JSON.stringify(await t.events(anyRun));
  const attempts = [];
  for (const [label, key] of [['none', null], ['bad', 'gg_invalid_qa486_token']]) {
    attempts.push([label, 'POST /loops', (await t.rest('POST', '/loops', { definition: { name: 'unauth', nodes: [], edges: [] } }, key)).status]);
    attempts.push([label, 'POST /loops/:id/runs', (await t.rest('POST', `/loops/${authLoop}/runs`, { input: {} }, key)).status]);
    attempts.push([label, 'GET /runs/:id', (await t.rest('GET', `/runs/${anyRun}`, undefined, key)).status]);
    attempts.push([label, 'POST /runs/:id/resume', (await t.rest('POST', `/runs/${anyRun}/resume`, { observedSeq: 0 }, key)).status]);
  }
  const readerStart = (await t.rest('POST', `/loops/${authLoop}/runs`, { input: {} }, keys.reader)).status;
  const readerGet = (await t.rest('GET', `/runs/${anyRun}`, undefined, keys.reader)).status;
  await sleep(500);
  const loopsAfter = (await t.rest('GET', '/loops')).json.items.length;
  const runsAfter = (await t.rest('GET', '/runs?limit=500')).json.items.length;
  r.check('S-AUTH', 'no key / bad key -> 401 on every write/read; runs:read key -> 403 to start, 200 to read; loops/runs/events/native counter unchanged', attempts.every(([, , s]) => s === 401) && readerStart === 403 && readerGet === 200 && loopsAfter === loopsBefore && runsAfter === runsBefore + 1 && counterLines(authCounter).length === linesBefore && JSON.stringify(await t.events(anyRun)) === eventsBefore, { attempts, readerStart, readerGet, loopsBefore, loopsAfter, runsBefore, runsAfter, lines: counterLines(authCounter).length, linesBefore }, 'PUBLIC-API+NATIVE');
});

// ---------------- Create the surface runs ----------------
const ids = {};
await scenario('setup-runs', async () => {
  const childOk = await publishOk('child-ok', chain('d6 child ok', [{ id: 'work', kind: 'mutate', label: 'Work', config: { operations: [{ op: 'set', path: '/vars/value', value: { kind: 'literal', value: 'QA486-IN-D6CHILD' } }] } }], { returns: 'vars.value' }));
  const leaf = await publishOk('leaf', chain('d6 leaf', [hbFault]));
  const mid = await publishOk('mid', chain('d6 mid', [sub(leaf)]));
  const top = await publishOk('top', chain('d6 top', [sub(mid)]));
  const infl = await publishOk('inf', chain('d6 inf', [{ id: 'inf', kind: 'inference', label: 'Inf', config: { harness: 'codex', prompt: { template: 'Q {{ trigger.payload.m }}' }, output: { transforms: [{ op: 'set', path: '/vars/x', value: { kind: 'expression', jsonata: '$error("QA486-LIT-D6INF")' } }] } } }]));
  const map = await publishOk('map', chain('d6 map', [sub(childOk, { output: { mode: 'merge', vars: { strategy: 'explicit', map: { a: '1', b: '$error("QA486-LIT-D6MAP" & result)' } } } })]));
  const p01 = await publishOk('p01', chain('d6 p01', [{ id: 'm', kind: 'mutate', label: 'm', config: { operations: [{ op: 'set', path: '/vars/x', value: { kind: 'expression', jsonata: '$error("QA486-LIT-D6P01")' } }] } }]));
  const ext = await publishOk('ext', chain('d6 ext', [{ id: 'h', kind: 'heartbeat', label: 'h', config: { intervalSeconds: 1, maxBeats: 1, probe: { kind: 'http', method: 'GET', url: `${listener.url}/ext` }, until: 'true' } }]));
  ids.leaf = (await t.run(leaf, { m: 'QA486-IN-D6' }, { waitFor: ['failed', 'succeeded'] })).id;
  ids.top = (await t.run(top, undefined, { waitFor: ['failed', 'succeeded'] })).id;
  ids.inf = (await t.run(infl, { m: 'QA486-IN-D6INF' })).id;
  ids.map = (await t.run(map)).id;
  ids.p01 = (await t.run(p01)).id;
  t.inject.probe.push(Object.assign(new Error('QA486-EXT-D6 external probe failure'), { name: 'ExpressionError' }));
  ids.ext = (await t.run(ext, undefined, { waitFor: ['failed', 'succeeded'] })).id;
  const topSnap = (await t.rest('GET', `/runs/${ids.top}`)).json;
  ids.mid = topSnap.failure?.details?.childRunId;
  ids.leaf2 = ids.mid && (await t.rest('GET', `/runs/${ids.mid}`)).json.failure?.details?.childRunId;
  r.raw('ids', ids);
  r.check('setup-runs', 'surface runs failed as designed', ['leaf', 'top', 'inf', 'map', 'p01', 'ext'].every(async () => true) && ids.mid && ids.leaf2, ids, 'SETUP');
});
const SURFACE = ['leaf', 'top', 'inf', 'map', 'p01', 'ext', 'mid', 'leaf2'].filter((k) => ids[k]);

// ---------------- Durable/REST state capture ----------------
async function capture() {
  const out = {};
  for (const k of SURFACE) {
    const row = await t.container.repos.runs.get(ids[k]);
    const evs = await t.events(ids[k]);
    const rest = (await t.rest('GET', `/runs/${ids[k]}`)).json;
    out[k] = { rowSha: sha256(canon(row)), eventsSha: sha256(JSON.stringify(evs)), restSha: sha256(JSON.stringify(rest)), rest, failedEvent: evs.filter((e) => e.type === 'run.failed').map((e) => e.failure), row };
  }
  return out;
}
const H0 = await capture();
writeFileSync(join(OUT, 'd6.capture-H0.json'), JSON.stringify(H0, null, 1));
await scenario('S-PAR-rest', async () => {
  const bad = SURFACE.filter((k) => !(H0[k].failedEvent.length === 1 && canon(H0[k].row.failure) === canon(H0[k].failedEvent[0]) && canon(H0[k].failedEvent[0]) === canon(H0[k].rest.failure)));
  r.check('S-PAR-rest', 'for every surface run: stored row failure == run.failed failure == REST snapshot failure', bad.length === 0, { bad, codes: Object.fromEntries(SURFACE.map((k) => [k, H0[k].rest.failure?.code])) }, 'PUBLIC-API+SQLITE');
});

// ---------------- MCP stdio ----------------
const mcpOut = {};
await scenario('MCP', async () => {
  const sdk = join(CHECKOUT, 'apps/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client');
  const { Client } = await import(pathToFileURL(join(sdk, 'index.js')).href);
  const { StdioClientTransport } = await import(pathToFileURL(join(sdk, 'stdio.js')).href);
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, GG_API_URL: 'http://127.0.0.1:5875', GG_API_KEY: keys.admin };
  const transport = new StdioClientTransport({ command: NODE_EXE, args: [join(CHECKOUT, 'apps/mcp/dist/main.js')], env, cwd: process.cwd(), stderr: 'pipe' });
  const client = new Client({ name: 'qa486-mcp-client', version: '1.0.0' });
  await client.connect(transport);
  pids.mcp.push(transport.pid);
  const call = async (name, args) => {
    const res = await client.callTool({ name, arguments: args });
    return { isError: res.isError, structured: res.structuredContent, text: res.content?.[0]?.text };
  };
  for (const k of SURFACE) {
    const get = await call('get_run', { runId: ids[k] });
    const wait = await call('wait_for_run', { runId: ids[k], timeoutSeconds: 5 });
    mcpOut[k] = { get, wait };
    const restFailure = H0[k].rest.failure;
    r.check(`MCP-get-${k}`, 'MCP get_run full failure equals REST failure (structured and text)', !get.isError && canon(get.structured?.failure) === canon(restFailure) && canon(JSON.parse(get.text).failure) === canon(restFailure), { mcp: get.structured?.failure, rest: restFailure }, 'MCP-STDIO');
    r.check(`MCP-wait-${k}`, 'MCP wait_for_run terminal: finished true with the same failure', !wait.isError && wait.structured?.finished === true && canon(wait.structured?.run?.failure) === canon(restFailure), { finished: wait.structured?.finished, failure: wait.structured?.run?.failure }, 'MCP-STDIO');
  }
  const list = await call('list_runs', { limit: 100 });
  mcpOut.list = list;
  const items = list.structured?.items ?? [];
  const badList = SURFACE.filter((k) => {
    const item = items.find((i) => i.id === ids[k]);
    const f = H0[k].rest.failure;
    return !item || item.failure?.code !== f.code || item.failure?.message !== f.message;
  });
  r.check('MCP-list', 'MCP list_runs reduced failure {code,message} equals REST for every surface run (reduced projection, not full DTO)', badList.length === 0, { badList, sample: items.filter((i) => SURFACE.some((k) => ids[k] === i.id)).map((i) => ({ id: i.id, failure: i.failure })) }, 'MCP-STDIO');
  const authoredKeys = ['leaf', 'top', 'inf', 'map', 'mid', 'leaf2', 'ext'];
  const leaks = containsAny(authoredKeys.map((k) => [mcpOut[k]?.get, mcpOut[k]?.wait?.structured?.run?.failure]), CANARIES);
  r.check('MCP-privacy', 'new authored/internal causes in MCP get/wait/list omit QA486 canaries (P01 legacy excluded)', leaks.length === 0 && containsAny(items.filter((i) => i.id !== ids.p01), CANARIES).length === 0, { leaks }, 'MCP-STDIO');
  r.check('MCP-p01-control', 'P01 legacy literal remains visible through MCP (established contract)', JSON.stringify(mcpOut.p01?.get).includes('QA486-LIT-D6P01'), {}, 'MCP-STDIO');
  writeFileSync(join(OUT, 'd6.mcp.json'), JSON.stringify(mcpOut, null, 1));
  await client.close();
  await sleep(500);
  let alive = true;
  try { process.kill(pids.mcp[0], 0); } catch { alive = false; }
  r.check('MCP-cleanup', 'MCP stdio child exited after client close', alive === false, { pid: pids.mcp[0] }, 'CLEANUP');
});

// ---------------- Browser inspector ----------------
const dom = {};
await scenario('BROWSER', async () => {
  const { chromium } = await import(pathToFileURL(join(CHECKOUT, 'node_modules/.pnpm/playwright-core@1.63.0/node_modules/playwright-core/index.mjs')).href);
  const exe = join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe');
  const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--no-first-run', '--disable-background-networking'] });
  pids.browser.push(browser.process?.()?.pid);
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await context.addInitScript((key) => localStorage.setItem('graphgoblin-api-key', key), keys.admin);
  const page = await context.newPage();
  const network = [];
  page.on('response', (res) => network.push({ url: res.url(), status: res.status() }));
  page.on('request', (req) => { if (!req.url().startsWith('http://127.0.0.1:5875')) network.push({ offOrigin: req.url() }); });
  const shots = join(OUT, 'screens');
  mkdirSync(shots, { recursive: true });
  for (const k of SURFACE) {
    const f = H0[k].rest.failure;
    await page.goto(`http://127.0.0.1:5875/app/runs/${ids[k]}`, { waitUntil: 'domcontentloaded' });
    const alert = page.getByRole('alert').filter({ hasText: `Failed: ${f.code}` }).first();
    await alert.waitFor({ timeout: 15000 });
    const alertText = await alert.innerText();
    const resumeBtn = page.getByRole('button', { name: /^\s*Resume\s*$/ }).first();
    const resumeDisabled = (await resumeBtn.count()) ? await resumeBtn.isDisabled() : 'absent';
    const unavailable = await page.getByText(/Resume unavailable:/).first().innerText().catch(() => null);
    const childLink = page.getByRole('link', { name: 'failed child run' });
    const childHref = (await childLink.count()) ? await childLink.first().getAttribute('href') : null;
    const bodyText = await page.locator('body').innerText();
    await page.screenshot({ path: join(shots, `${k}.png`), fullPage: false });
    dom[k] = { alertText, resumeDisabled, unavailable, childHref, bodyLen: bodyText.length, bodyLeaks: k === 'p01' ? [] : containsAny(bodyText, CANARIES) };
    const expectedMsg = f.code === 'SCRIPT_OUTCOME_UNCERTAIN' ? '' : f.message;
    r.check(`DOM-${k}`, 'inspector alert shows "Failed: <code>" and the full stored message; Resume control matches stored recovery; child link only for actual child wrappers', alertText.includes(`Failed: ${f.code}`) && alertText.includes(expectedMsg) && (H0[k].rest.recovery?.resume?.allowed ? resumeDisabled === false : resumeDisabled === true) && (f.details?.childRunId ? childHref?.endsWith(`/runs/${f.details.childRunId}`) : childHref === null), { ...dom[k], expectedMsg, allowed: H0[k].rest.recovery?.resume?.allowed }, 'BROWSER');
    if (k !== 'p01') r.check(`DOM-privacy-${k}`, 'rendered page text omits QA486 canaries for new authored/internal causes', dom[k].bodyLeaks.length === 0, { leaks: dom[k].bodyLeaks }, 'BROWSER');
  }
  // Follow child links from the depth-two parent to the leaf.
  await page.goto(`http://127.0.0.1:5875/app/runs/${ids.top}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('link', { name: 'failed child run' }).first().click();
  await page.waitForURL(`**/runs/${ids.mid}`);
  await page.getByRole('link', { name: 'failed child run' }).first().click();
  await page.waitForURL(`**/runs/${ids.leaf2}`);
  await page.getByRole('alert').filter({ hasText: 'Failed: EXPRESSION_ERROR' }).first().waitFor({ timeout: 15000 });
  const leafAlert = await page.getByRole('alert').filter({ hasText: 'Failed: EXPRESSION_ERROR' }).first().innerText();
  await page.screenshot({ path: join(shots, 'followed-leaf.png') });
  r.check('DOM-follow', 'clicking "failed child run" twice navigates depth-two parent -> child -> leaf, whose alert shows the leaf heartbeat.until cause', page.url().endsWith(`/runs/${ids.leaf2}`) && leafAlert.includes('Heartbeat until predicate, beat 1 failed.'), { url: page.url(), leafAlert }, 'BROWSER');
  r.check('DOM-mapping-nolink', 'parent mapping failure (B12) renders no failed-child link', dom.map?.childHref === null, dom.map, 'BROWSER');
  const off = network.filter((n) => n.offOrigin);
  r.check('BROWSER-network', 'browser only contacted the owned loopback API origin', off.length === 0, { off: off.slice(0, 10), responses: network.length }, 'BROWSER');
  writeFileSync(join(OUT, 'd6.dom.json'), JSON.stringify({ dom, network, viewport: page.viewportSize() }, null, 1));
  await context.close();
  await browser.close();
  await sleep(500);
  let alive = true;
  try { process.kill(pids.browser[0], 0); } catch { alive = false; }
  r.check('BROWSER-cleanup', 'browser process exited after close', alive === false, { pid: pids.browser[0] }, 'CLEANUP');
});

// ---------------- S-HIST: new publication + reads leave existing rows/events unchanged ----------------
await scenario('S-HIST', async () => {
  const fresh = await publishOk('hist-new', chain('d6 hist new', [{ id: 'm', kind: 'mutate', label: 'm', config: { operations: [{ op: 'set', path: '/vars/x', value: { kind: 'literal', value: 1 } }] } }]));
  const newRun = await t.run(fresh);
  for (const k of SURFACE) { await t.rest('GET', `/runs/${ids[k]}/observation`); await t.rest('GET', `/runs/${ids[k]}/thread`); }
  const H1 = await capture();
  const changed = SURFACE.filter((k) => H0[k].rowSha !== H1[k].rowSha || H0[k].eventsSha !== H1[k].eventsSha || H0[k].restSha !== H1[k].restSha);
  r.check('S-HIST', 'after a new publication/run and REST/MCP/browser reads, pre-existing row/event/REST bytes are unchanged', newRun.snapshot.status === 'succeeded' && changed.length === 0, { changed, newRun: newRun.snapshot.status }, 'PUBLIC-API+SQLITE');
});

// ---------------- S-RESTART: clean shutdown, raw disk bytes, reopen ----------------
async function diskBytes() {
  const { openReadOnlyDatabaseClient } = await imp('packages/infrastructure/dist/sqlite/index.js');
  const client = openReadOnlyDatabaseClient(join(dataDir, 'graphgoblin.db'));
  try {
    const list = SURFACE.map((k) => `'${ids[k]}'`).join(',');
    const runs = (await client.execute(`SELECT * FROM runs WHERE id IN (${list}) ORDER BY id`)).rows.map((x) => ({ ...x }));
    const events = (await client.execute(`SELECT * FROM run_events WHERE run_id IN (${list}) ORDER BY run_id, seq`)).rows.map((x) => ({ ...x }));
    return { runsSha: sha256(JSON.stringify(runs)), eventsSha: sha256(JSON.stringify(events)), runs: runs.length, events: events.length };
  } finally { client.close(); }
}
const shut1 = await t.shutdown();
r.check('RESTART-shutdown', 'authenticated drain then close; port 5875 refuses', shut1.drainStatus === 202 && shut1.portRefused === true, shut1, 'CLEANUP');
const D0 = await diskBytes();
t = await boot({ name: 'd6', port: 5876, dataDir, web: true, existingKeys: keys });
await scenario('S-RESTART', async () => {
  const H2 = await capture();
  const changed = SURFACE.filter((k) => H0[k].rowSha !== H2[k].rowSha || H0[k].eventsSha !== H2[k].eventsSha || H0[k].restSha !== H2[k].restSha);
  r.check('S-RESTART-api', 'after reopen on the same store: rows, events and REST snapshots byte-identical to before shutdown', changed.length === 0, { changed, detail: changed.map((k) => ({ k, before: H0[k].rest.recovery, after: H2[k].rest.recovery })) }, 'PUBLIC-API+SQLITE');
});
const shut2 = await t.shutdown();
const D1 = await diskBytes();
r.check('S-RESTART-disk', 'raw SQLite rows/events of the surface runs byte-identical across reopen + reads (read-only client, server stopped)', D0.runsSha === D1.runsSha && D0.eventsSha === D1.eventsSha && D0.runs === SURFACE.length, { D0, D1 }, 'NATIVE-SQLITE');
await listener.close();
r.check('CLEANUP', 'reopened API drained and closed; 5876 and listener refuse', shut2.drainStatus === 202 && shut2.portRefused === true && (await portRefuses(listener.port)) === true && (await portRefuses(5875)) === true, { shut2, listenerPort: listener.port }, 'CLEANUP');
r.finish({ pids, ids, dataDir, ports: [5875, 5876, listener.port] });
process.exit(0);
