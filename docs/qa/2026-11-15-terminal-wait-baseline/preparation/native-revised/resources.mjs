import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { setTimeout as pause } from 'node:timers/promises';

export async function bounded(label, promise, ms = 8_000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label + ' exceeded ' + ms + ' ms')), ms);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

export async function observe(label, read, ms = 12_000) {
  const until = performance.now() + ms;
  while (performance.now() < until) {
    const value = await read();
    if (value !== undefined && value !== false) return value;
    await pause(50);
  }
  throw new Error('Did not observe ' + label);
}

export function windowsEnv(extra = {}) {
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
  return { SystemRoot: systemRoot, WINDIR: systemRoot,
    ...(process.env.TEMP ? { TEMP: process.env.TEMP, TMP: process.env.TEMP } : {}), ...extra };
}

export function spawnOwned(role, args, options, report) {
  const identity = { role, executable: process.execPath, argv: args, cwd: options.cwd,
    requestedAt: new Date().toISOString(), messages: [], stdout: '', stderr: '' };
  report.push(identity);
  const child = spawn(process.execPath, args, { ...options, windowsHide: true, shell: false });
  const closed = Promise.withResolvers();
  identity.pid = child.pid;
  child.stdout.setEncoding('utf8').on('data', (chunk) => {
    identity.stdout = (identity.stdout + chunk).slice(0, 256 * 1024);
  });
  child.stderr.setEncoding('utf8').on('data', (chunk) => {
    identity.stderr = (identity.stderr + chunk).slice(0, 96 * 1024);
  });
  child.on('message', (message) => { identity.messages.push(message); });
  child.on('error', (error) => { identity.error = error; });
  child.once('exit', (code, signal) => { identity.exit = { code, signal }; });
  child.once('close', (code, signal) => {
    identity.close = { code, signal };
    closed.resolve(identity.close);
  });
  child.stdin?.on('error', (error) => { identity.stdinError = error; });
  return {
    child, identity, closed: closed.promise,
    waitMessage(type, predicate = () => true, ms) {
      return observe(role + ' IPC ' + type, () => {
        const received = identity.messages.find((m) => m.type === type && predicate(m));
        if (received) return received;
        if (identity.exit || identity.error || identity.messages.some((m) => m.type === 'fatal'))
          throw new Error(role + ' exited or refused before IPC ' + type);
        return undefined;
      }, ms);
    },
    async send(message) {
      assert.ok(child.connected && !identity.exit);
      await bounded(role + ' IPC send', new Promise((resolve, reject) => {
        child.send(message, (error) => error ? reject(error) : resolve());
      }));
    },
  };
}

export function api(origin, capture) {
  const url = new URL(origin);
  assert.equal(url.protocol, 'http:');
  assert.equal(url.hostname, '127.0.0.1');
  assert.ok(url.port && !['4747', '4748'].includes(url.port));
  return async (path, { body, method = body === undefined ? 'GET' : 'POST',
    record = false, shutdownToken } = {}) => {
    assert.ok(path.startsWith('/') && !path.startsWith('//'));
    const response = await fetch(origin + path, {
      method, redirect: 'error', signal: AbortSignal.timeout(6500),
      headers: { connection: 'close', ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(shutdownToken ? { 'x-graphgoblin-shutdown-token': shutdownToken } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const raw = await response.text();
    assert.ok(Buffer.byteLength(raw) <= 2 * 1024 * 1024);
    const data = JSON.parse(raw);
    const headers = {
      pid: response.headers.get('x-graphgoblin-pid'),
      instance: response.headers.get('x-graphgoblin-instance'),
      contentType: response.headers.get('content-type'),
    };
    if (record || method !== 'GET') capture.push({ origin, method, path, body, status: response.status, raw, headers });
    return { status: response.status, data, raw, headers };
  };
}

export async function refusedLocalPort(origin) {
  const { port } = new URL(origin);
  await bounded('owned listener absence', new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port: Number(port) });
    socket.once('connect', () => {
      socket.destroy();
      reject(new Error('Expected the exact former listener port to refuse TCP'));
    });
    socket.once('error', (error) => {
      socket.destroy();
      if (error.code === 'ECONNREFUSED') resolve();
      else reject(error);
    });
    socket.setTimeout(3000, () => {
      socket.destroy();
      reject(new Error('The former port did not provide a definite TCP result'));
    });
  }), 4000);
}

export function assertHealth(processHandle, response) {
  assert.equal(response.status, 200);
  assert.deepEqual(response.data, { status: 'ok' });
  assert.equal(response.headers.pid, String(processHandle.child.pid));
  assert.ok(response.headers.instance);
  if (processHandle.identity.instance) assert.equal(response.headers.instance, processHandle.identity.instance);
}

export async function stopGateway(handle) {
  if (handle.identity.exit) {
    await bounded(handle.identity.role + ' pipes closed', handle.closed);
    if (handle.identity.origin) await refusedLocalPort(handle.identity.origin);
    return;
  }
  assertHealth(handle, await handle.request('/healthz', { record: true }));
  const live = await handle.request('/runs?status=queued,running,waiting,paused&limit=1', { record: true });
  assert.equal(live.status, 200);
  assert.deepEqual(live.data.items, []);
  const read = await handle.request('/system/shutdown', { record: true });
  assert.equal(read.status, 200);
  assert.ok(read.data.controlToken);
  assert.deepEqual(read.data.activeRunIds, []);
  const reply = await handle.request('/system/shutdown', {
    body: { action: 'drain' }, shutdownToken: read.data.controlToken,
  });
  assert.equal(reply.status, 202);
  const actual = await bounded(handle.identity.role + ' clean exit', handle.closed, 15_000);
  assert.deepEqual(actual, { code: 0, signal: null });
  await refusedLocalPort(handle.identity.origin);
}

export async function mcpSession(checkout, main, origin, processes) {
  const handle = spawnOwned('stdio-mcp', [main, '--api-url', origin], {
    cwd: checkout, stdio: ['pipe', 'pipe', 'pipe'], env: windowsEnv(),
  }, processes);
  const pending = new Map();
  let nextId = 1;
  let buffer = '';
  let protocolError;
  handle.child.stdout.on('data', (chunk) => {
    try {
      buffer += chunk;
      assert.ok(buffer.length < 512 * 1024, 'unbounded MCP message');
      for (let index = buffer.indexOf('\n'); index >= 0; index = buffer.indexOf('\n')) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        const message = JSON.parse(line);
        const gate = pending.get(message.id);
        if (gate) {
          pending.delete(message.id);
          gate.resolve(message);
        }
      }
    } catch (error) {
      protocolError = error;
      handle.identity.protocolError = error;
      for (const gate of pending.values()) gate.reject(error);
      pending.clear();
    }
  });
  function write(json) {
    assert.ok(!protocolError && !handle.identity.exit);
    return new Promise((resolve, reject) => {
      handle.child.stdin.write(JSON.stringify(json) + '\n', (error) => error ? reject(error) : resolve());
    });
  }
  async function call(method, params) {
    const id = nextId++;
    const gate = Promise.withResolvers();
    pending.set(id, gate);
    try {
      const message = await bounded('MCP ' + method, Promise.all([
        write({ jsonrpc: '2.0', id, method, params }),
        Promise.race([gate.promise, handle.closed.then(() => { throw new Error('MCP child closed'); })]),
      ]));
      assert.equal(message[1].error, undefined);
      return message[1].result;
    } finally {
      pending.delete(id);
    }
  }
  async function close() {
    if (!handle.identity.exit && !handle.child.stdin.writableEnded) handle.child.stdin.end();
    const result = await bounded('MCP EOF exit', handle.closed);
    assert.deepEqual(result, { code: 0, signal: null });
  }
  try {
    const initialized = await call('initialize', {
      protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'qa410', version: '1' },
    });
    assert.ok(initialized.protocolVersion);
    await write({ jsonrpc: '2.0', method: 'notifications/initialized' });
    return {
      handle, close,
      async tool(name, args) {
        const response = await call('tools/call', { name, arguments: args });
        assert.ok(response && !response.isError && response.structuredContent);
        return response;
      },
    };
  } catch (error) {
    try {
      await close();
    } catch (cleanupError) {
      handle.identity.cleanupError = cleanupError;
    }
    throw error;
  }
}
