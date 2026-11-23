// 02-owned disposable API boot through the existing exported composition only:
// loadConfig(env) -> createApiKey(config) -> createContainer(config, ContainerOverrides) -> start()
// -> buildApp(container) -> listen(127.0.0.1). Real SQLite file, real ProcessScripts, real HttpProbes,
// real FsWorkspace/OwnedRunResources. Scripted harness/structured/decider/classifier ports via the
// existing override fields; optional delegating probe/script injection, clock fault and event-store
// fault wrappers are armed only by named rows and counted separately.
import { createServer } from 'node:http';
import net from 'node:net';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CHECKOUT, WORK, imp } from './rec.mjs';
import { ScriptedHarness } from './harness.mjs';

export const api = await imp('apps/api/dist/index.js');
const { createApiKey } = await imp('apps/api/dist/create-api-key.js');
const { HttpProbes } = await imp('packages/infrastructure/dist/http/index.js');
const { ProcessScripts } = await imp('packages/infrastructure/dist/process/index.js');
export const testing = await imp('packages/engine/dist/testing/index.js');
export const domain = await imp('packages/domain/dist/index.js');
export const contracts = await imp('packages/contracts/dist/index.js');

export const FIXTURE_APPEND = 'C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i4-486-independent-02/fixtures/append.mjs';
export const NODE_EXE = process.execPath;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Loopback HTTP listener owned by the driver; counts every request with full bytes. */
export async function startListener(respond = () => ({ status: 200, body: '{"ok":true}' })) {
  const requests = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const entry = { method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString('utf8'), t: Date.now() };
      requests.push(entry);
      const out = respond(entry);
      res.writeHead(out.status ?? 200, { 'content-type': 'application/json' });
      res.end(out.body ?? '');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return {
    port,
    url: `http://127.0.0.1:${port}`,
    requests,
    count: () => requests.length,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

export async function portRefuses(port) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: '127.0.0.1' });
    s.once('connect', () => { s.destroy(); resolve(false); });
    s.once('error', (e) => resolve(e.code === 'ECONNREFUSED' ? true : e.code));
  });
}

export function counterLines(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

class CountingStructured {
  constructor() { this.calls = []; this.responder = () => ({}); this.failNext = []; }
  complete(request) {
    this.calls.push({ prompt: request.prompt });
    if (this.failNext.length) return Promise.reject(this.failNext.shift());
    return Promise.resolve({ value: this.responder(request.prompt, request.schema) });
  }
}

class CountingDecider {
  constructor() { this.id = 'codex'; this.calls = []; this.failNext = []; }
  available() { return true; }
  route(request) {
    this.calls.push({ routes: request.routes?.map((r) => r.id) });
    if (this.failNext.length) return Promise.reject(this.failNext.shift());
    return Promise.resolve({ route: request.routes[0]?.id ?? '', confidence: 1, reasoning: 'QA scripted' });
  }
}

class CountingClassifier {
  constructor() { this.calls = []; this.failNext = []; this.inner = new testing.FakeClassifier('jev'); }
  available() { return true; }
  choose(req, s) { this.calls.push('choose'); if (this.failNext.length) return Promise.reject(this.failNext.shift()); return this.inner.choose(req, s); }
  classifyNoul(req, s) { this.calls.push('noul'); if (this.failNext.length) return Promise.reject(this.failNext.shift()); return this.inner.classifyNoul(req, s); }
  score(req, s) { this.calls.push('score'); if (this.failNext.length) return Promise.reject(this.failNext.shift()); return this.inner.score(req, s); }
}

/**
 * Boot a disposable API. Returns handles for REST, scripted counters, injections and shutdown.
 * opts: { name, port, dataDir?, web?: boolean, existingKeys?: {admin, reader} }
 */
export async function boot(opts) {
  const dataDir = opts.dataDir ?? join(WORK, 'data', opts.name);
  mkdirSync(dataDir, { recursive: true });
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(GG_|JEV_)/i.test(k)));
  Object.assign(env, {
    GG_DATA_DIR: dataDir,
    GG_HOST: '127.0.0.1',
    GG_PORT: String(opts.port),
    GG_REQUIRE_API_KEY: 'true',
    GG_WEB_DIST: opts.web ? join(CHECKOUT, 'apps/web/dist') : '',
    GG_GOBLIN_DIST: '',
    GG_LOG_LEVEL: 'silent',
    GG_TIMER_POLL_MS: '100',
    GG_SHUTDOWN_GRACE_MS: '30000',
    GG_OLLAMA_ENABLED: 'false',
    GG_OLLAMA_URL: 'http://127.0.0.1:5879',
    GG_SWAGGER_UI: 'false',
  });
  const config = api.loadConfig(env);
  if (config.port === 4747 || config.port === 4748 || config.port === 11434) throw new Error('forbidden port');
  const keys = opts.existingKeys ?? {
    admin: (await createApiKey(config, { label: 'qa486-admin', scopes: ['*'] })).token,
    reader: (await createApiKey(config, { label: 'qa486-reader', scopes: ['runs:read', 'loops:read'] })).token,
  };

  const logger = new testing.CapturingLogger();
  const harness = { codex: new ScriptedHarness('codex'), claude: new ScriptedHarness('claude') };
  const structured = new CountingStructured();
  const decider = new CountingDecider();
  const classifier = new CountingClassifier();
  const registry = new testing.FakeClassifierRegistry(classifier);
  const realProbes = new HttpProbes();
  const realScripts = new ProcessScripts();
  const inject = { probe: [], script: [], probeCalls: 0, scriptCalls: 0, probeInjected: 0, scriptInjected: 0 };
  const probes = {
    fetch(request, signal) {
      inject.probeCalls += 1;
      if (inject.probe.length) { inject.probeInjected += 1; return Promise.reject(inject.probe.shift()); }
      return realProbes.fetch(request, signal);
    },
  };
  const scripts = {
    run(request) {
      inject.scriptCalls += 1;
      if (inject.script.length) { inject.scriptInjected += 1; return Promise.reject(inject.script.shift()); }
      return realScripts.run(request);
    },
  };
  const clockFault = { match: undefined, fired: 0 };
  const clock = {
    now() {
      if (clockFault.match && new Error().stack.includes(clockFault.match)) {
        clockFault.match = undefined;
        clockFault.fired += 1;
        throw new Error('QA486-EXT-CLOCK transient mapping clock fault');
      }
      return new Date();
    },
  };
  const container = await api.createContainer(config, {
    logger,
    clock,
    harnesses: harness,
    structured,
    deciders: [decider],
    classifiers: registry,
    probes,
    scripts,
  });
  // Event-store fault wrapper (SCRIPTED-STORAGE), inert unless `eventFault.match` is set.
  const eventStore = container.ports.events;
  const eventFault = { match: undefined, afterCommit: true, times: 1, fired: 0, log: [] };
  container.ports.events = new Proxy(eventStore, {
    get(target, prop) {
      if (prop === 'append')
        return async (runId, drafts, options) => {
          if (eventFault.match && eventFault.match(runId, drafts)) {
            // D4 attempt-2 fix: synchronous multi-shot count (timer re-arm never ran between SQLite appends).
            eventFault.times = (eventFault.times ?? 1) - 1;
            if (eventFault.times <= 0) eventFault.match = undefined;
            eventFault.fired += 1;
            eventFault.log.push({ runId, types: drafts.map((d) => d.type), afterCommit: eventFault.afterCommit });
            if (eventFault.afterCommit) await target.append(runId, drafts, options);
            throw new Error('QA486-EXT-STORE controlled append fault');
          }
          return target.append(runId, drafts, options);
        };
      const v = target[prop];
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
  await container.start();
  const app = await api.buildApp(container);
  await app.listen({ host: '127.0.0.1', port: opts.port });
  const base = `http://127.0.0.1:${opts.port}`;

  async function rest(method, path, body, key = keys.admin) {
    const headers = {};
    if (key) headers.authorization = `Bearer ${key}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(base + path, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = undefined; }
    return { status: res.status, json, text };
  }

  let loopSeq = 0;
  async function publish(definition) {
    const def = { schemaVersion: contracts.CURRENT_DEFINITION_FORMAT, ...definition, name: `${definition.name} ${process.pid}-${++loopSeq}` };
    const created = await rest('POST', '/loops', { definition: def });
    if (created.status !== 201) return { ok: false, stage: 'create', created };
    const loopId = created.json.loop.id;
    const published = await rest('POST', `/loops/${loopId}/publish`);
    return { ok: published.status === 200, loopId, created, published };
  }

  async function run(loopId, input, { waitFor = ['succeeded', 'failed', 'cancelled', 'exhausted', 'waiting'], timeoutMs = 30000 } = {}) {
    const started = await rest('POST', `/loops/${loopId}/runs`, input === undefined ? {} : { input });
    if (started.status !== 202) return { started, snapshot: undefined };
    const id = started.json.run.id;
    const snapshot = await settle(id, waitFor, timeoutMs);
    return { started, id, snapshot };
  }

  async function settle(id, waitFor = ['succeeded', 'failed', 'cancelled', 'exhausted', 'waiting'], timeoutMs = 30000) {
    const until = Date.now() + timeoutMs;
    let last;
    while (Date.now() < until) {
      last = await rest('GET', `/runs/${id}`);
      if (last.json && waitFor.includes(last.json.status)) {
        await container.manager.waitForIdle?.();
        return (await rest('GET', `/runs/${id}`)).json;
      }
      await sleep(50);
    }
    return { timeout: true, last: last?.json };
  }

  async function events(id) {
    const items = [];
    let after = 0;
    for (;;) {
      const page = await rest('GET', `/runs/${id}/events?after=${after}&limit=500`);
      if (page.status !== 200) return { error: page };
      const got = page.json.items ?? [];
      items.push(...got);
      if (!page.json.hasMore || !got.length) break;
      after = page.json.nextAfter;
      if (items.length > 20000) break;
    }
    return items;
  }

  async function shutdown() {
    const res = await rest('POST', '/system/shutdown', { action: 'drain' });
    const drained = await Promise.race([container.waitForShutdown().then(() => 'ready'), sleep(35000).then(() => 'timeout')]);
    await app.close();
    await container.dispose();
    const refused = await portRefuses(opts.port);
    return { drainStatus: res.status, drainBody: res.json, drained, portRefused: refused };
  }

  return { config, dataDir, keys, container, app, base, rest, publish, run, settle, events, shutdown, logger, harness, structured, decider, classifier, registry, inject, clockFault, eventFault, pid: process.pid, port: opts.port };
}

// Small definition builders ------------------------------------------------------------
export function chain(name, works, exit = { returns: 'lastOutput.value' }, settings) {
  const nodes = [{ id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } }, ...works, { id: 'done', kind: 'exit', label: 'Done', config: exit }];
  const edges = [];
  for (let i = 0; i < nodes.length - 1; i++) edges.push({ id: `e${i}`, from: { node: nodes[i].id, port: 'out' }, to: { node: nodes[i + 1].id } });
  return { name, nodes, edges, ...(settings ? { settings } : {}) };
}

export const failureOf = (snap) => snap?.failure;
export const typesOf = (events) => events.map((e) => e.type);
export const countType = (events, type) => events.filter((e) => e.type === type).length;
