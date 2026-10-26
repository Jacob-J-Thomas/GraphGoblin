// Shared replay support. All product paths are computed from <repo>.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, relative, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
export { assert, delay };
export const repo = fileURLToPath(new URL('../../../../', import.meta.url));
export const evidence = fileURLToPath(new URL('./', import.meta.url));
// Keep fresh round-4 observations separate from the historical round-3 JSON.
const round4 = process.env.GG_QA_ROUND === 'round-4';
const outputEvidence = round4 ? fileURLToPath(new URL('../round-4/', import.meta.url)) : evidence;
const storeProcesses = new Map();
export const head = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: repo,
  encoding: 'utf8',
}).trim();
export function sanitize(value) {
  let s = typeof value === 'string' ? value : JSON.stringify(value);
  for (const [raw, label] of [
    [repo.replace(/[\\/]$/, ''), '<repo>'],
    [process.env.TEMP, '<temp>'],
    [process.env.USERPROFILE, '<user>'],
  ]) {
    if (!raw) continue;
    for (const variant of [raw.replaceAll('\\', '\\\\'), raw.replaceAll('\\', '/'), raw])
      s = s.replaceAll(variant, label);
  }
  return s
    .replace(/[A-Z]:[\\/]+Users[\\/]+[^\\/\s",>]+/g, '<user>')
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/DESKTOP-[A-Z0-9]+/g, '<host>');
}
export async function save(name, value) {
  await writeFile(join(outputEvidence, name), sanitize(JSON.stringify(value, null, 2)) + '\n');
}
export function report(name) {
  const data = { head, results: [], lifecycle: [] };
  return {
    data,
    async check(name, fn) {
      try {
        const actual = await fn();
        data.results.push({ name, status: 'PASS', actual });
        console.log('PASS ' + name);
        return actual;
      } catch (e) {
        data.results.push({ name, status: 'FAIL', actual: sanitize(e.message) });
        console.log('FAIL ' + name + ' ' + sanitize(e.message));
        process.exitCode = 1;
      } finally {
        await save(nameOfReport(), data);
      }
    },
    async finish() {
      await save(nameOfReport(), data);
    },
  };
  function nameOfReport() {
    return name + '-results.json';
  }
}
export async function until(check, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const result = await check();
    if (result) return result;
    await delay(60);
  }
  throw Error('QA observation deadline exceeded');
}
export async function raw(method, path, body, port = 5905) {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    signal: AbortSignal.timeout(10000),
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  return { status: r.status, body: await r.json() };
}
export async function api(method, path, body, port = 5905) {
  const r = await raw(method, path, body, port);
  assert(r.status < 300, `${method} ${path}: ${JSON.stringify(r)}`);
  return r.body;
}
export const state = (id, status, port = 5905) =>
  until(async () => {
    const r = await api('GET', '/runs/' + id, undefined, port);
    return r.status === status && r;
  });
export async function create(definition, port = 5905, publish = true) {
  const c = await api('POST', '/loops', { definition }, port);
  if (publish) await api('POST', `/loops/${c.loop.id}/publish`, {}, port);
  return c;
}
export async function startRun(created, port = 5905, published = true) {
  return (
    await api(
      'POST',
      `/loops/${created.loop.id}/runs`,
      published ? {} : { allowDraft: true, versionId: created.draft.id },
      port,
    )
  ).run;
}
export function waitDefinition(name = 'QA input wait', settings = {}) {
  return {
    schemaVersion: 4,
    name,
    settings,
    nodes: [
      {
        id: 'start',
        kind: 'trigger',
        label: 'Start',
        config: { type: 'manual' },
        ui: { x: 0, y: 80 },
      },
      {
        id: 'ask',
        kind: 'wait',
        label: 'Ask',
        config: { mode: 'input', prompt: 'Continue?' },
        ui: { x: 260, y: 80 },
      },
      {
        id: 'done',
        kind: 'exit',
        label: 'Done',
        config: { returns: '"ok"' },
        ui: { x: 520, y: 80 },
      },
    ],
    edges: [
      { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'ask' } },
      { id: 'b', from: { node: 'ask', port: 'out' }, to: { node: 'done' } },
    ],
  };
}
export function cycleDefinition(settings = { maxNodeVisits: null }) {
  return {
    schemaVersion: 4,
    name: 'QA unlimited gate',
    settings,
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      {
        id: 'work',
        kind: 'inference',
        label: 'Work',
        config: {
          prompt: { template: 'QA fake turn only' },
          output: { captureTranscript: 'none', toMessages: 'none' },
        },
      },
      {
        id: 'gate',
        kind: 'decision',
        label: 'Gate',
        config: {
          kind: 'expression',
          jsonata: '"again"',
          maxPasses: null,
          routes: [
            { id: 'again', label: 'Again', repeat: true },
            { id: 'done', label: 'Done' },
          ],
        },
      },
      { id: 'done', kind: 'exit', label: 'Done', config: {} },
    ],
    edges: [
      { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'work' } },
      { id: 'b', from: { node: 'work', port: 'out' }, to: { node: 'gate' } },
      { id: 'c', from: { node: 'gate', port: 'again' }, to: { node: 'work' } },
      { id: 'd', from: { node: 'gate', port: 'done' }, to: { node: 'done' } },
      { id: 'e', from: { node: 'gate', port: 'limit-reached' }, to: { node: 'done' } },
    ],
  };
}
export const newStore = (label) =>
  mkdtemp(join(tmpdir(), (round4 ? 'gg-qa-f3-r4-' : 'gg-qa-243-r3-') + label + '-'));
export async function removeStore(dir) {
  // Derive permission to remove from every owned child's observed exit event.
  // Callers cannot replace process evidence with a literal boolean.
  const processes = (storeProcesses.get(resolve(dir)) ?? []).map((server) => ({
    pid: server.child.pid,
    ...server.termination,
    confirmedExited: server.termination.exitObserved,
  }));
  assert(
    processes.every((p) => p.confirmedExited),
    'Refuse cleanup before owned process exits',
  );
  const r = relative(tmpdir(), dir);
  assert(/^gg-qa-(?:243|f3)-[A-Za-z0-9-]+$/.test(r) && !isAbsolute(r));
  try {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
    return { store: basename(dir), processConfirmedExited: true, processes, removed: true };
  } catch (e) {
    return {
      store: basename(dir),
      processConfirmedExited: true,
      processes,
      removed: false,
      code: e.code,
    };
  }
}
export async function launch(dir, mode = 'candidate', port = 5905) {
  let output = '';
  const child = spawn(
    process.execPath,
    [join(evidence, 'server.mjs'), basename(dir), mode, String(port)],
    { cwd: repo, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
  );
  const server = {
    child,
    port,
    termination: { exitObserved: false, exitCode: null, signalCode: null },
  };
  server.exited = new Promise((done) => {
    child.once('exit', (exitCode, signalCode) => {
      Object.assign(server.termination, { exitObserved: true, exitCode, signalCode });
      done();
    });
  });
  const key = resolve(dir);
  storeProcesses.set(key, [...(storeProcesses.get(key) ?? []), server]);
  child.stdout.on('data', (x) => (output += x));
  child.stderr.on('data', (x) => (output += x));
  try {
    await until(() => {
      if (server.termination.exitObserved)
        throw Error(
          'QA server exited ' + JSON.stringify(server.termination) + ' ' + sanitize(output),
        );
      return output.includes('QA_READY');
    }, 30000);
  } catch (e) {
    if (!server.termination.exitObserved) {
      child.kill();
      await server.exited;
    }
    throw e;
  }
  return server;
}
export async function stop(server, kill = false) {
  if (!server.termination.exitObserved) {
    if (kill) server.child.kill();
    else await api('POST', '/qa/stop', {}, server.port);
    let timer;
    try {
      await Promise.race([
        server.exited,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(Error('QA server exit not confirmed')), 10000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    pid: server.child.pid,
    ...server.termination,
    confirmedExited: server.termination.exitObserved,
    forced: kill,
  };
}
export async function command(command, env = {}) {
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    cwd: repo,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let output = '';
  child.stdout.on('data', (x) => (output += x));
  child.stderr.on('data', (x) => (output += x));
  const [code] = await once(child, 'exit');
  return { command, exitCode: code, output: sanitize(output) };
}
