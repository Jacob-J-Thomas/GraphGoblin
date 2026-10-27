// Shared harness for the independent behaviour QA of PR #418 (#186 acceptance fix).
// Drives the BUILT product only through public interfaces: the API process
// (apps/api/dist/main.js) with a disposable data directory under the system temp directory,
// its HTTP and SSE surface, and the built web app in Microsoft Edge through Playwright.
// No provider is ever invoked: the loops contain no inference node and both harness binaries
// point at files that do not exist. Only processes this harness spawned are ever terminated.
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, appendFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '../../..');
export { delay, assert };

const PREFIX = 'gg-qa-418-';

export async function makeTemp(tag) {
  return mkdtemp(join(tmpdir(), `${PREFIX}${tag}-`));
}

/** Remove only a disposable directory this harness created under the system temp directory. */
export async function removeTemp(dir) {
  const rel = relative(tmpdir(), dir);
  assert(rel.startsWith(PREFIX) && !rel.includes('..') && !isAbsolute(rel), `refuse to remove ${dir}`);
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

export function logger(file) {
  const path = join(HERE, file);
  let chain = writeFile(path, '');
  const log = (...parts) => {
    const line =
      `[${new Date().toISOString()}] ` +
      parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
    console.log(line);
    chain = chain.then(() => appendFile(path, line + '\n'));
    return chain;
  };
  log.flush = () => chain;
  return log;
}

export async function until(check, { timeout = 30_000, interval = 100, what = 'condition' } = {}) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await check();
    if (last) return last;
    await delay(interval);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

/** Start the built API with a disposable data directory. Only this PID is ever terminated. */
export async function startApi({ port, dataDir, log = () => {}, env = {} }) {
  const child = spawn(process.execPath, ['apps/api/dist/main.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      GG_DATA_DIR: dataDir,
      GG_PORT: String(port),
      GG_HOST: '127.0.0.1',
      GG_REQUIRE_API_KEY: 'false',
      GG_WEB_DIST: join(ROOT, 'apps/web/dist'),
      GG_SWAGGER_UI: 'false',
      GG_LOG_LEVEL: 'warn',
      // No provider is reachable from these probes.
      GG_CLAUDE_BINARY: join(dataDir, 'no-claude', 'claude.exe'),
      GG_CODEX_BINARY: join(dataDir, 'no-codex', 'codex.exe'),
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const exited = once(child, 'exit');
  let stderr = '';
  child.stdout.on('data', () => {});
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk.toString()).slice(-8192);
  });
  const url = `http://127.0.0.1:${port}`;
  try {
    await until(
      async () => {
        if (child.exitCode !== null) throw new Error(`API exited during startup: ${stderr}`);
        try {
          const r = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(2000) });
          return r.ok;
        } catch {
          return false;
        }
      },
      { timeout: 60_000, what: `API health on ${port}` },
    );
  } catch (error) {
    // Never leave the spawned API behind (it holds the disposable store open).
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exited;
    throw new Error(`${error.message}; stderr: ${stderr.slice(-2000)}`);
  }
  log(`API started pid=${child.pid} port=${port}`);
  return {
    url,
    pid: child.pid,
    stderr: () => stderr,
    /** Hard stop (TerminateProcess on Windows): a crash from the gateway's point of view. */
    async kill() {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await exited;
      log(`API pid=${child.pid} terminated`);
    },
  };
}

/** JSON REST helper. Throws on non-2xx. */
export function restClient(url) {
  const api = async (method, path, body) => {
    const response = await fetch(url + path, {
      method,
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(120_000),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${method} ${path} -> ${response.status} ${text.slice(0, 2000)}`);
    return text ? JSON.parse(text) : undefined;
  };
  api.createLoop = async (definition) => {
    const created = await api('POST', '/loops', { definition });
    await api('POST', `/loops/${created.loop.id}/publish`);
    return created;
  };
  api.start = async (loopId, body = {}) => (await api('POST', `/loops/${loopId}/runs`, body)).run;
  api.run = (runId) => api('GET', `/runs/${runId}`);
  api.waitStatus = (runId, statuses, opts = {}) =>
    until(
      async () => {
        const run = await api('GET', `/runs/${runId}`);
        return statuses.includes(run.status) ? run : false;
      },
      { what: `run ${runId} in ${statuses}`, interval: 250, ...opts },
    );
  api.allEvents = async (runId) => {
    const items = [];
    let after = 0;
    for (;;) {
      const page = await api('GET', `/runs/${runId}/events?after=${after}&limit=500`);
      items.push(...page.items);
      if (!page.hasMore) return items;
      after = page.nextAfter;
    }
  };
  return api;
}

/** Playwright from apps/web, driving the installed Microsoft Edge. */
export async function edge() {
  const require = createRequire(join(ROOT, 'apps/web/package.json'));
  const { chromium } = require('@playwright/test');
  return chromium.launch({ channel: process.env.GG_E2E_BROWSER_CHANNEL ?? 'msedge', headless: true });
}

/** Private bytes and working set of a process (Windows), in MiB. */
export async function processMemory(pid) {
  const { stdout } = await promisify(execFile)(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', `$p = Get-Process -Id ${pid}; "$($p.PrivateMemorySize64) $($p.WorkingSet64)"`],
    { windowsHide: true },
  );
  const [privateBytes, workingSet] = stdout.trim().split(/\s+/).map(Number);
  return { privateMiB: +(privateBytes / 1048576).toFixed(1), workingSetMiB: +(workingSet / 1048576).toFixed(1) };
}

export const edge_ = (from, port, to) => ({ id: `${from}-${port}-${to}`, from: { node: from, port }, to: { node: to } });

/**
 * The acceptance probes' cyclic loop: `grow` increments vars.n; a gate repeats until vars.n
 * reaches `passes` (endless with a huge `passes`). Options vary the ending for the live-state
 * scenarios: `gateJsonata` replaces the gate expression, `maxPasses` caps the gate, `outcome`
 * sets the exit outcome, `blobChars` adds a large string per pass.
 */
export function cycle({ name, passes = 1_000_000, gateJsonata, maxPasses = null, outcome = 'success', blobChars = 0 }) {
  const operations = [
    { op: 'set', path: '/vars/n', value: { kind: 'expression', jsonata: '($exists(vars.n) ? vars.n : 0) + 1' } },
  ];
  if (blobChars > 0)
    operations.push({ op: 'set', path: '/vars/blob', value: { kind: 'expression', jsonata: `$pad("", ${blobChars}, "x")` } });
  return {
    schemaVersion: 4,
    name,
    settings: { maxNodeVisits: null },
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      { id: 'grow', kind: 'mutate', label: 'Grow', config: { operations } },
      {
        id: 'gate',
        kind: 'decision',
        label: 'Gate',
        config: {
          kind: 'expression',
          jsonata: gateJsonata ?? `vars.n < ${passes} ? "again" : "done"`,
          maxPasses,
          routes: [
            { id: 'again', label: 'Again', repeat: true },
            { id: 'done', label: 'Done' },
          ],
        },
      },
      { id: 'finish', kind: 'exit', label: 'Finish', config: { outcome, returns: 'vars.n' } },
    ],
    edges: [
      edge_('start', 'out', 'grow'),
      edge_('grow', 'out', 'gate'),
      edge_('gate', 'again', 'grow'),
      edge_('gate', 'done', 'finish'),
      edge_('gate', 'limit-reached', 'finish'),
    ],
  };
}

const ULID = /[0-9A-HJKMNP-TV-Z]{26}/g;

/**
 * Classify a request the inspector page issued. Kinds: run, observation, thread, thread?at,
 * events-sse, events-page, version, loop, other. `runId` names the run the request targets.
 */
export function classify(req) {
  const u = new URL(req.url());
  if (u.pathname.startsWith('/app') || u.pathname === '/' || /\.(js|css|png|svg|webmanifest|ico|woff2?)$/.test(u.pathname))
    return { kind: 'asset' };
  const runMatch = /^\/runs\/([0-9A-HJKMNP-TV-Z]{26})(\/[a-z-]+)?$/.exec(u.pathname);
  if (runMatch) {
    const [, runId, sub = ''] = runMatch;
    if (sub === '') return { kind: 'run', runId };
    if (sub === '/observation') return { kind: 'observation', runId };
    if (sub === '/thread') return u.searchParams.has('at') ? { kind: 'thread?at', runId, at: Number(u.searchParams.get('at')) } : { kind: 'thread', runId };
    if (sub === '/events') {
      const sse = (req.headers()['accept'] ?? '').includes('text/event-stream');
      return { kind: sse ? 'events-sse' : 'events-page', runId, search: u.search };
    }
    return { kind: `run${sub}`, runId };
  }
  if (/^\/loops\/[^/]+\/versions\//.test(u.pathname)) return { kind: 'version' };
  if (u.pathname.startsWith('/system/')) return { kind: 'system' };
  return { kind: `other ${req.method()} ${u.pathname.replace(ULID, ':id')}` };
}

/**
 * Record every API request a browser context issues, with its kind, start time and (when it
 * finishes) its duration in ms from the browser's resource timing.
 */
export function recordRequests(context) {
  const all = [];
  const byRequest = new Map();
  context.on('request', (req) => {
    const c = classify(req);
    if (c.kind === 'asset') return;
    const entry = { t: Date.now(), ...c, method: req.method(), url: new URL(req.url()).pathname + new URL(req.url()).search };
    all.push(entry);
    byRequest.set(req, entry);
  });
  context.on('requestfinished', async (req) => {
    const entry = byRequest.get(req);
    if (!entry) return;
    byRequest.delete(req);
    const timing = req.timing();
    entry.ms = timing.responseEnd >= 0 ? +timing.responseEnd.toFixed(1) : undefined;
    try {
      const sizes = await req.sizes();
      entry.bytes = sizes.responseBodySize;
    } catch {
      /* the page may be gone */
    }
  });
  context.on('requestfailed', (req) => {
    const entry = byRequest.get(req);
    if (!entry) return;
    byRequest.delete(req);
    entry.failed = req.failure()?.errorText ?? 'failed';
  });
  return {
    all,
    since(t, runId) {
      return all.filter((r) => r.t >= t && (runId === undefined || r.runId === undefined || r.runId === runId));
    },
  };
}

export function countByKind(requests) {
  const counts = {};
  for (const r of requests) counts[r.kind] = (counts[r.kind] ?? 0) + 1;
  return counts;
}

export function latencyByKind(requests) {
  const out = {};
  for (const r of requests) {
    if (r.ms === undefined) continue;
    (out[r.kind] ??= []).push(r.ms);
  }
  return Object.fromEntries(
    Object.entries(out).map(([kind, values]) => {
      values.sort((a, b) => a - b);
      const q = (p) => values[Math.min(values.length - 1, Math.floor(p * values.length))];
      return [kind, { n: values.length, medianMs: q(0.5), p95Ms: q(0.95), maxMs: values.at(-1) }];
    }),
  );
}

/** The inspector's visible state, read from the DOM by role, label and data attributes. */
export async function inspectorState(page) {
  return page.evaluate(() => {
    const text = (el) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const headings = [...document.querySelectorAll('h1,h2,h3')].map(text);
    const timelineHeading = headings.find((h) => h.startsWith('Timeline ('));
    const m = /Timeline \((\d+) events, ([^)]+)\)/.exec(timelineHeading ?? '');
    const threadHeading = headings.find((h) => h === 'Current thread' || h.startsWith('Thread at event'));
    const varsEl = document.querySelector('pre[aria-label="Variables"]');
    let vars;
    try {
      vars = varsEl ? JSON.parse(varsEl.textContent ?? '') : undefined;
    } catch {
      vars = text(varsEl);
    }
    const rows = [...document.querySelectorAll('ol[aria-label="Timeline"] button[data-seq]')].map((b) => Number(b.dataset.seq));
    const current = document.querySelector('ol[aria-label="Timeline"] button[aria-current="true"]');
    const alerts = [...document.querySelectorAll('[role="alert"]')].map(text).filter(Boolean);
    const cardText = (title) => {
      const h = [...document.querySelectorAll('h2,h3')].find((x) => text(x) === title);
      return h ? text(h.closest('section') ?? h.parentElement?.parentElement) : undefined;
    };
    const followButton = [...document.querySelectorAll('button')].find((b) => text(b) === 'Follow live');
    const patch = document.querySelector('ul[aria-label="Patch diff"]');
    return {
      status: document.querySelector('header [data-status]')?.getAttribute('data-status') ?? undefined,
      timeline: m ? { total: Number(m[1]), stream: m[2] } : { raw: timelineHeading },
      threadHeading,
      vars,
      rowsMounted: rows.length,
      firstRow: rows[0],
      lastRow: rows.at(-1),
      contiguous: rows.every((s, i) => i === 0 || s === rows[i - 1] + 1),
      currentRow: current ? Number(current.dataset.seq) : undefined,
      followLiveEnabled: followButton ? !followButton.disabled : undefined,
      result: text(document.querySelector('[data-testid="run-result"]')) || undefined,
      exitCard: cardText('Exit evaluation'),
      patchDiff: patch ? text(patch) : undefined,
      patchTitle: headings.find((h) => h.startsWith('Patch from')),
      reading: [...document.querySelectorAll('p[aria-live="polite"]')].map(text).filter(Boolean),
      alerts,
      bodyHasFellBehind: (document.body.innerText ?? '').includes('fell behind'),
      executionContext: cardText('Execution context'),
    };
  });
}

/** JS heap after a forced GC, through CDP. */
export async function heapMiB(page) {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Performance.enable');
    await cdp.send('HeapProfiler.collectGarbage');
    const { metrics } = await cdp.send('Performance.getMetrics');
    return +(metrics.find((m) => m.name === 'JSHeapUsedSize').value / 1048576).toFixed(2);
  } finally {
    await cdp.detach().catch(() => {});
  }
}

/** Session storage held by the page, in UTF-16 bytes (the per-run event cache lives there). */
export async function sessionStorageBytes(page) {
  return page.evaluate(() => {
    let bytes = 0;
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      bytes += (k.length + (sessionStorage.getItem(k)?.length ?? 0)) * 2;
    }
    return bytes;
  });
}
