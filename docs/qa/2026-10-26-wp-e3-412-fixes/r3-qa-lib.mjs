// Shared helpers for the PR #412 QA scripts. Talks to real processes over HTTP only.
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir, homedir, hostname } from 'node:os';
import { fileURLToPath } from 'node:url';

export const here = dirname(fileURLToPath(import.meta.url));
export const root = resolve(here, '..', '..', '..');
export const temp = tmpdir();

/** Redact the profile path and machine name before anything reaches evidence. */
export function redact(text) {
  const home = homedir();
  const variants = [home, home.replaceAll('\\', '/'), home.replaceAll('\\', '\\\\')];
  let out = String(text);
  for (const v of variants) out = out.split(v).join('%USERPROFILE%');
  out = out.split(hostname()).join('%COMPUTERNAME%');
  return out.replace(/S-1-5-21-[\d-]+/g, '<SID>');
}

export class Evidence {
  constructor(name) {
    this.file = join(here, `${name}.log.txt`);
    writeFileSync(this.file, '', 'utf8');
  }
  log(...parts) {
    const line = parts
      .map((p) => (typeof p === 'string' ? p : JSON.stringify(p, null, 0)))
      .join(' ');
    appendFileSync(this.file, redact(line) + '\n', 'utf8');
    console.log(redact(line));
  }
  check(label, ok, detail) {
    this.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail === undefined ? '' : ' :: ' + JSON.stringify(detail)}`);
    if (!ok) { this.failures = (this.failures ?? 0) + 1; process.exitCode = 1; }
    return ok;
  }
}

export function setCapacity(file, value) {
  writeFileSync(file, JSON.stringify(value), 'utf8');
}
export const GiB = 1024 ** 3;
export const ADEQUATE = { mode: 'fixed', totalBytes: 100 * GiB, availableBytes: 50 * GiB };
export const PRESSURE = { mode: 'fixed', totalBytes: 100 * GiB, availableBytes: Math.floor(0.5 * GiB) };

/** Spawn the QA composition; resolves once it listens. Server logs go to <logName>.log.txt (redacted on finish). */
export async function startServer({ dataDir, port, capacityFile, logFile, env = {} }) {
  mkdirSync(dataDir, { recursive: true });
  const child = spawn(process.execPath, [join(here, 'r3-qa-server.mjs'), dataDir, String(port), capacityFile], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    env: { ...process.env, ...env },
  });
  const out = createWriteStream(logFile, { flags: 'a' });
  let ready;
  const readyPromise = new Promise((res, rej) => {
    ready = res;
    child.once('exit', (code) => rej(new Error(`server exited early with ${code}`)));
  });
  let buffer = '';
  const passTimes = [];
  const onData = (chunk) => {
    const text = String(chunk);
    out.write(redact(text));
    buffer += text;
    for (const m of text.matchAll(/QA_CAPACITY_READ (\d+)/g)) passTimes.push(Number(m[1]));
    const m = /QA_READY (\S+)/.exec(buffer);
    if (m) ready(m[1]);
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  const exited = new Promise((res) => child.once('exit', (code, signal) => res({ code, signal })));
  const url = await readyPromise;
  return {
    child,
    url,
    exited,
    passTimes,
    pid: child.pid,
    async stop() {
      child.stdin.write('stop\n');
      const r = await exited;
      out.end();
      return r;
    },
    async kill() {
      // TerminateProcess on Windows: no handlers, no cleanup, like a crash or power loss.
      child.kill('SIGKILL');
      const r = await exited;
      out.end();
      return r;
    },
  };
}

export function client(base) {
  async function call(method, path, body, headers = {}) {
    const response = await fetch(base + path, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    let json;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = text;
    }
    return { status: response.status, json, text };
  }
  const api = {
    call,
    get: (p) => call('GET', p),
    post: (p, b) => call('POST', p, b ?? {}),
    async createLoop(definition) {
      const created = await call('POST', '/loops', { definition });
      if (created.status !== 201) throw new Error('create loop ' + created.text);
      const id = created.json.loop.id;
      const published = await call('POST', `/loops/${id}/publish`, {});
      if (published.status !== 200) throw new Error('publish ' + published.text);
      return id;
    },
    async startRun(loopId, input = {}, extra = {}) {
      const r = await call('POST', `/loops/${loopId}/runs`, { input, ...extra });
      if (r.status !== 202) throw new Error('start run ' + r.status + ' ' + r.text);
      return r.json.run;
    },
    async run(id) {
      return (await call('GET', `/runs/${id}`)).json;
    },
    async waitFor(id, predicate, timeoutMs = 60_000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const r = await call('GET', `/runs/${id}`);
        const run = r.json?.run ?? r.json;
        if (r.status === 200 && predicate(run)) return run;
        if (Date.now() > deadline) throw new Error(`timeout waiting for ${id}: ${r.text.slice(0, 400)}`);
        await new Promise((res) => setTimeout(res, 150));
      }
    },
    waitFinal(id, timeoutMs) {
      return api.waitFor(
        id,
        (run) => ['succeeded', 'failed', 'cancelled', 'exhausted'].includes(run.status) && Boolean(run.finalizedAt),
        timeoutMs,
      );
    },
    async preview(runIds) {
      return call('POST', '/runs/deletion-eligibility/preview', { runIds });
    },
    async confirm(runIds, token, action = 'mark') {
      return call('POST', '/runs/deletion-eligibility', { runIds, token, action, confirmed: true });
    },
    async mark(runIds, action = 'mark') {
      const p = await api.preview(runIds);
      if (p.status !== 200) return p;
      return api.confirm(runIds, p.json.token, action);
    },
    async listAll(limit = 7, query = '') {
      const pages = [];
      let cursor;
      for (let i = 0; i < 500; i++) {
        const q = new URLSearchParams(query);
        q.set('limit', String(limit));
        if (cursor) q.set('cursor', cursor);
        const r = await call('GET', `/runs?${q}`);
        if (r.status !== 200) throw new Error('list ' + r.text);
        pages.push(r.json.items.map((x) => x.id));
        cursor = r.json.nextCursor;
        if (!cursor) break;
      }
      return pages;
    },
    storage: async () => (await call('GET', '/system/storage')).json,
  };
  return api;
}

export const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

/** Inference (artifact transcript) then a script that writes files into the run workspace. */
export function workLoop(name, settings = {}) {
  return {
    schemaVersion: 4,
    name,
    settings: { workingDirectory: { kind: 'temp' }, ...settings },
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual', exposeTo: ['ui', 'api', 'mcp'] } },
      {
        id: 'infer',
        kind: 'inference',
        label: 'Infer',
        config: {
          harness: 'codex',
          session: { policy: 'fresh' },
          prompt: { template: '{{ trigger.payload.text }}' },
          output: { captureTranscript: 'artifact', toMessages: 'final' },
        },
      },
      {
        id: 'files',
        kind: 'script',
        label: 'Write files',
        config: {
          command: process.execPath,
          args: [
            '-e',
            "const fs=require('fs');const n=Number(process.argv[1]||0),b=Number(process.argv[2]||0),m=process.argv[3]||'',t=process.argv[4]||'';for(let i=0;i<n;i++)fs.writeFileSync('f'+i+'.bin',Buffer.alloc(b,120));if(m==='junction')fs.symlinkSync(t,'linked','junction');if(m==='hardlink')fs.linkSync(t,'hard.bin');console.log(JSON.stringify({files:n,bytes:b,mode:m}))",
            '{{ trigger.payload.files | default: 0 }}',
            '{{ trigger.payload.bytes | default: 0 }}',
            '{{ trigger.payload.mode | default: "" }}',
            '{{ trigger.payload.target | default: "" }}',
          ],
          cwd: 'workspace',
          stdin: 'none',
        },
      },
      { id: 'done', kind: 'exit', label: 'Done', config: { outcome: 'success' } },
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'infer', port: 'in' } },
      { id: 'e2', from: { node: 'infer', port: 'out' }, to: { node: 'files', port: 'in' } },
      { id: 'e3', from: { node: 'files', port: 'out' }, to: { node: 'done', port: 'in' } },
    ],
  };
}

/** Parent loop calling a child loop through a Subloop node. */
export function parentLoop(name, childLoopId) {
  return {
    schemaVersion: 4,
    name,
    settings: { workingDirectory: { kind: 'temp' } },
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      { id: 'call', kind: 'subloop', label: 'Call child', config: { loopRef: { loopId: childLoopId } } },
      { id: 'done', kind: 'exit', label: 'Done', config: { outcome: 'success' } },
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'call', port: 'in' } },
      { id: 'e2', from: { node: 'call', port: 'out' }, to: { node: 'done', port: 'in' } },
    ],
  };
}

export { join, mkdirSync, writeFileSync };
