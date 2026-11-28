// Shared helpers for the RQ-inspector QA (independent, not part of the branch under test).
import { readFileSync, mkdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PW = 'file:///G:/ggq/gg-qa-inspector-combined/GraphGoblin/node_modules/.pnpm/@playwright+test@1.63.0/node_modules/@playwright/test/index.mjs';
export const { chromium, expect } = await import(PW);

export const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
export const BASE = process.env.QA_BASE ?? 'http://127.0.0.1:4811';
export const EV =
  'G:/ggq/delivery-evidence/2026-11-24-followups/inspector-561-562-563-556/claude-window-rq-01';
export const KEY_STORAGE = 'graphgoblin-api-key';

const token = (file) =>
  /gg_[A-Za-z0-9_-]+/.exec(readFileSync(`G:/ggq/tmp/rq-inspector-qa/${file}`, 'utf8'))[0];
const KEYS = process.env.QA_KEYS ?? 'key';
export const TOKENS = { A: token(`${KEYS}-a.private.txt`), B: token(`${KEYS}-b.private.txt`) };
/** Never write a token anywhere: map an authorization header to a label. */
export function label(authorization) {
  if (!authorization) return 'none';
  const t = /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim();
  if (t === TOKENS.A) return 'A';
  if (t === TOKENS.B) return 'B';
  return 'unrecognised';
}

export async function api(method, path, body, key = 'A') {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      authorization: `Bearer ${TOKENS[key]}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function poll(fn, until, { timeout = 30_000, every = 250 } = {}) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (until(last)) return last;
    await sleep(every);
  }
  throw new Error(`poll timed out; last=${JSON.stringify(last)?.slice(0, 400)}`);
}

let n = 0;
export const uniq = (name) => `${name} ${Date.now().toString(36)}-${++n}`;

export async function publish(definition) {
  const created = await api('POST', '/loops', { definition });
  if (created.status !== 201) throw new Error('create loop ' + JSON.stringify(created));
  const id = created.json.loop.id;
  const published = await api('POST', `/loops/${id}/publish`);
  if (published.status !== 200) throw new Error('publish ' + JSON.stringify(published));
  return id;
}

export async function startRun(loopId, data, status) {
  const started = await api('POST', `/loops/${loopId}/runs`, data);
  if (started.status !== 202) throw new Error('start ' + JSON.stringify(started));
  const id = started.json.run.id;
  if (status)
    await poll(
      async () => (await api('GET', `/runs/${id}`)).json,
      (run) => run?.status === status && (status !== 'succeeded' || Boolean(run.finalizedAt)),
    );
  return id;
}

export const minimalLoop = (name) => ({
  schemaVersion: 4,
  name,
  nodes: [
    { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
    { id: 'done', kind: 'exit', label: 'Done', config: {} },
  ],
  edges: [{ id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'done' } }],
});

export const waitLoop = (name, wait) => ({
  schemaVersion: 4,
  name,
  nodes: [
    { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' }, ui: { x: 0, y: 80 } },
    { id: 'approve', kind: 'wait', label: 'Approve', config: wait, ui: { x: 260, y: 80 } },
    { id: 'done', kind: 'exit', label: 'Done', config: {}, ui: { x: 520, y: 80 } },
  ],
  edges: [
    { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'approve' } },
    { id: 'e2', from: { node: 'approve', port: 'out' }, to: { node: 'done' } },
  ],
});

export async function events(runId) {
  const res = await api('GET', `/runs/${runId}/events?limit=500`);
  return res.json?.items ?? [];
}

export function keyIds() {
  const id = (file) =>
    /\(id ([0-9A-Z]{26})/.exec(readFileSync(`G:/ggq/tmp/rq-inspector-qa/${file}`, 'utf8'))[1];
  return { A: id(`${KEYS}-a.private.txt`), B: id(`${KEYS}-b.private.txt`) };
}

export function caseDir(name) {
  const dir = join(EV, 'qa', name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function record(dir, file, value) {
  writeFileSync(join(dir, file), JSON.stringify(value, null, 2));
}

export async function launch(extra = {}) {
  return chromium.launch({ executablePath: EDGE, headless: true, ...extra });
}

/**
 * A fresh context with one inspector tab and one real second tab on the same origin. Every request
 * each page sends is logged by method, path and key label (from the header the browser sent).
 */
export async function signIn(browser, path, key = 'A', options = {}) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    serviceWorkers: 'block',
    ...options,
  });
  const log = [];
  // In-page record of every fetch the app makes, in order, with the key label of the header it
  // carries at the call (after the app's API-key fetch set it), and of each in-page key switch.
  await context.addInitScript(({ a, b }) => {
    const marks = [];
    let seq = 0;
    Object.defineProperty(window, '__qaMarks', { value: marks });
    window.__qaMark = (kind, extra) => marks.push({ seq: ++seq, kind, ...extra });
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const auth = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') ?? '')?.[1]?.trim();
      const key = auth === undefined ? 'none' : auth === a ? 'A' : auth === b ? 'B' : 'unrecognised';
      const url = new URL(request.url);
      if (!url.pathname.startsWith('/app'))
        marks.push({ seq: ++seq, kind: 'fetch', method: request.method, path: url.pathname, key });
      return original(input, init);
    };
  }, { a: TOKENS.A, b: TOKENS.B });
  const watch = (page, tab) =>
    page.on('request', (req) => {
      const url = new URL(req.url());
      if (!url.pathname.startsWith('/app'))
        log.push({
          t: Date.now(),
          tab,
          method: req.method(),
          path: url.pathname,
          key: label(req.headers()['authorization']),
        });
    });
  const page = await context.newPage();
  watch(page, 'inspector');
  await page.goto(`${BASE}/app${path}`);
  const field = page.getByLabel('API key', { exact: true });
  await field.waitFor({ state: 'visible', timeout: 20_000 });
  await field.fill(TOKENS[key]);
  await page.getByRole('button', { name: 'Use key' }).click();
  await page.getByRole('heading', { name: 'API key required' }).waitFor({ state: 'detached' });
  const other = await context.newPage();
  watch(other, 'other');
  await other.goto(`${BASE}/app/settings`);
  await page.bringToFront();
  const writes = () =>
    log.filter((e) => e.method !== 'GET' && e.tab === 'inspector').map(({ method, path, key }) => ({ method, path, key }));
  return { context, page, other, log, writes };
}

/** The real second tab stores `key`; the inspector tab receives a real `storage` event. */
export async function storeInOtherTab(other, page, key) {
  const before = Date.now();
  await other.evaluate(
    ({ name, value }) => localStorage.setItem(name, value),
    { name: KEY_STORAGE, value: TOKENS[key] },
  );
  await page.bringToFront();
  return before;
}

export const COPY = {
  closed: (trigger) =>
    `Review closed: this browser's API key changed. Nothing was sent. Open ${trigger} again to choose with the current key.`,
  notSent: (action) =>
    `Not sent: this browser's API key changed before ${action} was sent. Choose it again to send with the current key.`,
  requested: (action) =>
    `${action} was requested before this browser's API key changed. Its outcome isn't shown under the current key; check Runs before trying again.`,
};

export function appendJsonl(file, value) {
  appendFileSync(file, JSON.stringify(value) + '\n');
}
