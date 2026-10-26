// Shared harness for the acceptance group B probes (#116, #185, #186, #240, #255).
// Everything here drives the BUILT product through public interfaces: the API process
// (apps/api/dist/main.js) with a disposable data directory, its HTTP/SSE surface, the MCP
// server over stdio (apps/mcp/dist/main.js), the published api-client package and Edge.
// No live provider is ever invoked: inference uses the repository's fake Codex fixture
// (tooling/fixtures/unlimited-codex.cs) compiled into the disposable directory.
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, mkdir, appendFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import http from 'node:http';
import assert from 'node:assert/strict';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '../../..');
export const OUT = HERE;
export { delay, assert };

const PREFIX = 'gg-acc-b-';

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
  const path = join(OUT, file);
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

export async function until(check, { timeout = 30_000, interval = 50, what = 'condition' } = {}) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await check();
    if (last) return last;
    await delay(interval);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

/** Compile the repository's fake Codex CLI fixture into the disposable directory. */
export async function compileFakeCodex(dir) {
  const cli = join(dir, 'cli');
  await mkdir(cli, { recursive: true });
  const binary = join(cli, 'codex.exe');
  const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
  const command = `Add-Type -Path ${quote(join(ROOT, 'tooling/fixtures/unlimited-codex.cs'))} -OutputAssembly ${quote(binary)} -OutputType ConsoleApplication`;
  await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    windowsHide: true,
  });
  return binary;
}

/**
 * Start the built API. Returns helpers. `scenario` sets the fake Codex behaviour inherited by
 * its child processes (success | stall | quota | transport | unknown).
 */
export async function startApi({ port, dataDir, codex, scenario = 'success', env = {}, log = () => {}, root = ROOT }) {
  const child = spawn(process.execPath, ['apps/api/dist/main.js'], {
    cwd: root,
    env: {
      ...process.env,
      GG_DATA_DIR: dataDir,
      GG_PORT: String(port),
      GG_HOST: '127.0.0.1',
      GG_REQUIRE_API_KEY: 'false',
      GG_WEB_DIST: join(root, 'apps/web/dist'),
      GG_SWAGGER_UI: 'false',
      GG_LOG_LEVEL: 'warn',
      // Never reach a real Claude installation from these probes.
      GG_CLAUDE_BINARY: join(dataDir, 'no-claude', 'claude.exe'),
      ...(codex ? { GG_CODEX_BINARY: codex } : {}),
      GG_WP_F3_SCENARIO: scenario,
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
  log(`API started pid=${child.pid} port=${port} scenario=${scenario}${root === ROOT ? '' : ' (baseline build)'}`);
  return {
    url,
    child,
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

/** JSON REST helper. Throws on non-2xx unless `allow` lists the status. */
export function restClient(url) {
  async function call(method, path, body, { headers = {}, allow = [] } = {}) {
    const response = await fetch(url + path, {
      method,
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    let json;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = text;
    }
    if (!response.ok && !allow.includes(response.status)) {
      throw new Error(`${method} ${path} -> ${response.status} ${text.slice(0, 2000)}`);
    }
    return method === 'RAW' ? { status: response.status, json, text } : json;
  }
  const api = (method, path, body, opts) => call(method, path, body, opts);
  api.status = async (method, path, body) => {
    const response = await fetch(url + path, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: response.status, json, text };
  };
  /** Every event of a run through forward JSON pages (the public paging contract). */
  api.allEvents = async (runId, { limit = 500 } = {}) => {
    const items = [];
    let after = 0;
    for (;;) {
      const page = await api('GET', `/runs/${runId}/events?after=${after}&limit=${limit}`);
      items.push(...page.items);
      if (!page.hasMore) return items;
      after = page.nextAfter;
    }
  };
  api.createLoop = async (definition, { publish = true } = {}) => {
    const created = await api('POST', '/loops', { definition });
    if (publish) await api('POST', `/loops/${created.loop.id}/publish`);
    return created;
  };
  api.start = async (loopId, body = {}) => (await api('POST', `/loops/${loopId}/runs`, body)).run;
  api.waitStatus = async (runId, statuses, opts = {}) =>
    until(
      async () => {
        const run = await api('GET', `/runs/${runId}`);
        return statuses.includes(run.status) ? run : false;
      },
      { what: `run ${runId} in ${statuses}`, ...opts },
    );
  return api;
}

/** A parsed SSE frame list from a raw `text/event-stream` response body. */
export class SseCollector {
  constructor() {
    this.frames = [];
    this.buffer = '';
    this.comments = 0;
  }
  push(text) {
    this.buffer += text;
    let index;
    while ((index = this.buffer.search(/\r?\n\r?\n/)) >= 0) {
      const block = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(this.buffer.slice(index).startsWith('\r\n\r\n') ? index + 4 : index + 2);
      const frame = { id: undefined, event: 'message', data: '' };
      let any = false;
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith(':')) {
          this.comments += 1;
          continue;
        }
        const colon = line.indexOf(':');
        const field = colon < 0 ? line : line.slice(0, colon);
        const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
        any = true;
        if (field === 'id') frame.id = value;
        else if (field === 'event') frame.event = value;
        else if (field === 'data') frame.data += (frame.data ? '\n' : '') + value;
      }
      if (any) this.frames.push(frame);
    }
  }
}

/**
 * Open a raw SSE stream with fetch. Resolves `done` with {frames, eof, completed, error}.
 * `onFrame` sees each parsed frame as it arrives.
 */
export function openSse(url, runId, { after, lastEventId, onFrame, signal } = {}) {
  const collector = new SseCollector();
  const controller = new AbortController();
  signal?.addEventListener('abort', () => controller.abort(), { once: true });
  const target = `${url}/runs/${runId}/events${after === undefined ? '' : `?after=${after}`}`;
  const state = { status: undefined, headersAt: undefined, eof: false, completed: false, error: undefined };
  const done = (async () => {
    try {
      const response = await fetch(target, {
        headers: {
          accept: 'text/event-stream',
          ...(lastEventId === undefined ? {} : { 'last-event-id': String(lastEventId) }),
        },
        signal: controller.signal,
      });
      state.status = response.status;
      state.headersAt = Date.now();
      if (!response.ok) {
        state.body = await response.text();
        return { ...state, frames: collector.frames };
      }
      const decoder = new TextDecoder();
      let seen = 0;
      for await (const chunk of response.body) {
        collector.push(decoder.decode(chunk, { stream: true }));
        while (seen < collector.frames.length) {
          const frame = collector.frames[seen++];
          if (frame.event === 'stream.complete') state.completed = true;
          onFrame?.(frame);
        }
      }
      state.eof = true;
    } catch (error) {
      state.error = error?.name === 'AbortError' ? 'aborted' : String(error?.cause?.code ?? error);
    }
    return { ...state, frames: collector.frames };
  })();
  return { done, close: () => controller.abort(), frames: collector.frames, state };
}

/** Event frames (with ids) parsed into run events. */
export function eventFrames(frames) {
  return frames.filter((f) => f.id !== undefined).map((f) => JSON.parse(f.data));
}

export function assertContiguous(events, from = 1, label = 'events') {
  for (let i = 0; i < events.length; i++) {
    assert.equal(events[i].seq, from + i, `${label}: expected seq ${from + i} at index ${i}, got ${events[i].seq}`);
  }
}

/** The MCP server over stdio, through the MCP SDK client. */
export async function mcpClient(apiUrl) {
  const require = createRequire(join(ROOT, 'apps/mcp/package.json'));
  const { Client } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/index.js')).href);
  const { StdioClientTransport } = await import(
    pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/stdio.js')).href
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(ROOT, 'apps/mcp/dist/main.js'), '--api-url', apiUrl],
    env: { ...process.env, GG_API_URL: apiUrl },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'acceptance-b', version: '1.0.0' });
  await client.connect(transport);
  return {
    async call(name, args, { timeoutMs = 120_000 } = {}) {
      const result = await client.callTool({ name, arguments: args }, undefined, { timeout: timeoutMs });
      if (result.isError) return { isError: true, text: result.content?.[0]?.text };
      return result.structuredContent ?? JSON.parse(result.content[0].text);
    },
    close: () => client.close(),
  };
}

/** The published api-client package (built dist), as the web app and MCP use it. */
export async function apiClientPackage() {
  return import(pathToFileURL(join(ROOT, 'packages/api-client/dist/index.js')).href);
}

/** Playwright from apps/web, driving the installed Microsoft Edge. */
export async function edge({ headless = true } = {}) {
  const require = createRequire(join(ROOT, 'apps/web/package.json'));
  const { chromium } = require('@playwright/test');
  return chromium.launch({ channel: process.env.GG_E2E_BROWSER_CHANNEL ?? 'msedge', headless });
}

/** A loopback HTTP server whose responses a scenario scripts per request. */
export async function startReceiver(port, handler) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const entry = { at: Date.now(), method: req.method, url: req.url, headers: req.headers, body };
    requests.push(entry);
    try {
      const { status = 200, delayMs = 0, json = { ok: true }, hold } = (await handler(entry, requests.length)) ?? {};
      if (hold) await hold;
      if (delayMs) await delay(delayMs);
      if (res.destroyed) return;
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(json));
    } catch {
      res.destroy();
    }
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}

/** Private bytes and working set of a process (Windows), in MiB. */
export async function processMemory(pid) {
  const { stdout } = await promisify(execFile)(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `$p = Get-Process -Id ${pid}; "$($p.PrivateMemorySize64) $($p.WorkingSet64)"`,
    ],
    { windowsHide: true },
  );
  const [privateBytes, workingSet] = stdout.trim().split(/\s+/).map(Number);
  return { privateMiB: +(privateBytes / 1048576).toFixed(1), workingSetMiB: +(workingSet / 1048576).toFixed(1) };
}

export const edge_ = (from, port, to) => ({ id: `${from}-${port}-${to}`, from: { node: from, port }, to: { node: to } });
