import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { request } from 'node:http';
import { performance } from 'node:perf_hooks';

const threadRoute = '/runs/:id/thread';
const responseEvents = ['close', 'finish', 'error'];
const requestEvents = ['close', 'aborted', 'end', 'error'];

export async function bounded(label, work, ms = 8_000) {
  let timer;
  try {
    return await Promise.race([work, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label + ' exceeded ' + ms + ' ms')), ms);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

export function createTransport() {
  const context = new AsyncLocalStorage();
  const byName = new Map();
  const clientRequests = new Set();
  const serverSockets = new Set();
  const logs = [];
  let port;

  function controlFor(request) {
    return byName.get(request.headers['x-gg-qa-case']);
  }

  function note(control, event, details = {}) {
    control.trace.push({ step: control.trace.length + 1, event, ...details });
  }

  function monitor(name, plan = {}) {
    assert.match(name, /^[a-z0-9-]+$/);
    assert.equal(byName.has(name), false);
    const control = {
      name, plan, trace: [], operations: [], listeners: [], pageCount: 0,
      writes: [], errors: [], onSendAfterClose: [], active: new Set(),
      reached: Promise.withResolvers(), release: Promise.withResolvers(),
      closed: Promise.withResolvers(), handlerSettled: Promise.withResolvers(),
      inputEnd: Promise.withResolvers(),
    };
    byName.set(name, control);
    return control;
  }

  function listenerSet(request, reply) {
    return [
      ['request', request.raw, requestEvents],
      ['response', reply.raw, responseEvents],
      ['socket', reply.raw.socket ?? request.raw.socket, ['close', 'error']],
    ].flatMap(([target, emitter, events]) =>
      events.map((event) => ({ target, event, values: emitter?.rawListeners(event) ?? [] })));
  }

  function captureListeners(control, at, request, reply) {
    const observed = listenerSet(request, reply);
    control.initialListeners ??= observed;
    control.listeners.push({
      at,
      observed: observed.map(({ target, event, values }, index) => ({
        target, event, count: values.length,
        added: values.filter((fn) => !control.initialListeners[index].values.includes(fn)).length,
      })),
    });
  }

  function flags(request, reply) {
    return {
      inputComplete: request.raw.complete,
      inputEnded: request.raw.readableEnded,
      inputAborted: request.raw.aborted,
      responseFinished: reply.raw.writableFinished,
      responseDestroyed: reply.raw.destroyed,
      socketDestroyed: (reply.raw.socket ?? request.raw.socket)?.destroyed,
    };
  }

  function attach(app) {
    app.server.on('connection', (socket) => {
      serverSockets.add(socket);
      socket.once('close', () => serverSockets.delete(socket));
    });
    app.addHook('onRequest', async (request, reply) => {
      const control = controlFor(request);
      if (!control || request.routeOptions.url !== threadRoute) return;
      control.requestId = request.id;
      note(control, 'request-start', flags(request, reply));
      request.raw.once('end', () => {
        const observed = flags(request, reply);
        note(control, 'input-end', observed);
        control.inputEnd.resolve(observed);
      });
      request.raw.once('close', () => note(control, 'input-close', flags(request, reply)));
      reply.raw.once('finish', () => note(control, 'response-finish', flags(request, reply)));
      reply.raw.once('close', () => {
        const observed = { ...flags(request, reply), active: [...control.active] };
        control.closeFlags = observed;
        note(control, 'response-close', observed);
        control.closed.resolve(observed);
      });
      for (const method of ['writeHead', 'write', 'end']) {
        const delegate = reply.raw[method];
        reply.raw[method] = function (...args) {
          if (control.closeFlags && !control.closeFlags.responseFinished)
            control.writes.push(method);
          return delegate.apply(this, args);
        };
      }
    });
    app.addHook('onError', async (request, _reply, error) => {
      const control = controlFor(request);
      if (control) control.errors.push({ name: error.name, code: error.code, message: error.message,
        afterClose: Boolean(control.closeFlags) });
    });
    app.addHook('onSend', async (request, reply, payload) => {
      const control = controlFor(request);
      if (control?.closeFlags && !control.closeFlags.responseFinished)
        control.onSendAfterClose.push(reply.statusCode);
      return payload;
    });
    app.addHook('onRoute', (route) => {
      if (route.method !== 'GET' || route.url !== threadRoute) return;
      const delegate = route.handler;
      route.handler = function (request, reply) {
        const control = controlFor(request);
        if (!control) return delegate.call(this, request, reply);
        return context.run(control, async () => {
          control.request = request;
          control.reply = reply;
          captureListeners(control, 'handler-entry', request, reply);
          note(control, 'handler-entry', flags(request, reply));
          try {
            if (control.plan.stage === 'before-handler') await barrier(control, 'before-handler');
            if (control.plan.drainInput) {
              request.raw.resume();
              const completed = await bounded('normal incoming GET completion', control.inputEnd.promise);
              assert.equal(completed.inputComplete, true);
              assert.equal(completed.inputAborted, false);
              assert.equal(completed.socketDestroyed, false);
            }
            note(control, 'product-handler-entry', flags(request, reply));
            return await delegate.call(this, request, reply);
          } finally {
            captureListeners(control, 'handler-settled', request, reply);
            note(control, 'handler-settled', flags(request, reply));
            control.handlerSettled.resolve();
            delete control.request;
            delete control.reply;
            delete control.initialListeners;
          }
        });
      };
    });
  }

  function barrier(control, stage) {
    assert.equal(control.barrier, undefined, 'one barrier per request');
    control.barrier = stage;
    captureListeners(control, 'held-' + stage, control.request, control.reply);
    note(control, 'barrier-entered', { stage, ...flags(control.request, control.reply) });
    control.reached.resolve();
    return control.release.promise.then((reason) => {
      note(control, 'barrier-released', { stage, reason });
    });
  }

  function proxy(port, methods) {
    return new Proxy(port, {
      get(target, prop) {
        const value = Reflect.get(target, prop, target);
        if (typeof value !== 'function') return value;
        if (!Object.hasOwn(methods, prop)) return value.bind(target);
        return (...args) => observe(methods[prop], value.bind(target), args);
      },
    });
  }

  async function observe(operation, delegate, args) {
    const control = context.getStore();
    if (!control) return delegate(...args);
    const stage = operation === 'read' ? (args[2] === 1 && control.plan.checkpoint &&
      args[1] === control.plan.checkpoint - 1 ? 'boundary' : 'page-' + (++control.pageCount))
      : operation;
    const record = { stage, args, afterClose: Boolean(control.closeFlags) };
    control.operations.push(record);
    control.active.add(stage);
    note(control, 'operation-entered', { stage, afterClose: record.afterClose });
    try {
      const value = await delegate(...args);
      note(control, 'sqlite-returned', {
        stage, ...(Array.isArray(value) ? { rows: value.length, first: value[0]?.seq,
          last: value.at(-1)?.seq } : {}),
      });
      if (Array.isArray(value)) Object.assign(record, { rows: value.length, last: value.at(-1)?.seq });
      if (control.plan.stage === stage) await barrier(control, stage);
      if (control.plan.rejectAt === stage) throw new Error('qa419-synthetic-repository-error');
      return value;
    } catch (error) {
      record.error = { name: error.name, code: error.code, message: error.message };
      throw error;
    } finally {
      control.active.delete(stage);
      control.lastReturned = stage;
      note(control, 'operation-settled', { stage });
    }
  }

  function instrument(container) {
    return {
      ...container,
      manager: proxy(container.manager, { getThread: 'current' }),
      repos: {
        ...container.repos,
        runs: proxy(container.repos.runs, {
          get: 'ownership', getInitialThread: 'initial', getThreadCheckpoint: 'checkpoint',
        }),
        events: proxy(container.repos.events, { read: 'read' }),
      },
    };
  }

  function installYieldBarrier() {
    const original = globalThis.setImmediate;
    function scopedImmediate(callback, ...args) {
      const control = context.getStore();
      if (control?.plan.stage === 'yield-1' && !control.barrier &&
          control.lastReturned === 'page-1' && control.active.size === 0) {
        const source = new Error().stack?.split('\n').find((frame) =>
          frame.includes('historicalThread') && frame.includes('run-history.js'));
        if (source) {
          note(control, 'replay-yield-scheduled', { source });
          return original((...nativeArgs) => {
            note(control, 'replay-yield-callback');
            void barrier(control, 'yield-1').then(() => callback(...nativeArgs));
          }, ...args);
        }
      }
      return original(callback, ...args);
    }
    for (const symbol of Object.getOwnPropertySymbols(original))
      Object.defineProperty(scopedImmediate, symbol, Object.getOwnPropertyDescriptor(original, symbol));
    globalThis.setImmediate = scopedImmediate;
    return () => { globalThis.setImmediate = original; };
  }

  function connect(path, token, control) {
    assert.ok(port);
    const done = Promise.withResolvers();
    const socketClosed = Promise.withResolvers();
    const startedAt = performance.now();
    const req = request({
      host: '127.0.0.1', port, method: 'GET', path, agent: false,
      headers: {
        Connection: 'keep-alive',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(control ? { 'X-GG-QA-Case': control.name } : {}),
      },
    });
    clientRequests.add(req);
    req.once('socket', (socket) => {
      socket.once('close', () => {
        socketClosed.resolve();
        clientRequests.delete(req);
      });
    });
    req.once('error', (error) => {
      done.resolve({ error: { code: error.code, message: error.message } });
      if (!req.socket) {
        socketClosed.resolve();
        clientRequests.delete(req);
      }
    });
    req.once('response', (incoming) => {
      const chunks = [];
      let bytes = 0;
      incoming.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > 128 * 1024) {
          req.destroy(new Error('QA response body exceeded its bounded capture'));
          return;
        }
        chunks.push(chunk);
      });
      incoming.once('end', () => done.resolve({
        status: incoming.statusCode, contentType: incoming.headers['content-type'],
        serverPid: incoming.headers['x-graphgoblin-pid'],
        body: Buffer.concat(chunks), elapsedMs: performance.now() - startedAt,
      }));
      incoming.once('error', (error) => done.resolve({ error: { code: error.code, message: error.message } }));
    });
    req.end();
    return {
      response: done.promise, socketClosed: socketClosed.promise,
      destroy() {
        if (control) note(control, 'client-destroy');
        req.destroy();
      },
    };
  }

  function receipt(control) {
    return {
      requestId: control.requestId,
      stageReached: control.barrier,
      trace: control.trace,
      operations: control.operations,
      listenerSnapshots: control.listeners,
      writesAfterClose: control.writes,
      attemptedSendsAfterClose: control.onSendAfterClose,
      errors: control.errors,
      logs: control.requestId === undefined ? [] : logs.filter((line) => line.reqId === control.requestId),
    };
  }

  return {
    monitor, attach, instrument, installYieldBarrier, connect, receipt,
    setPort(value) { port = value; },
    recordLog(line) {
      const r = JSON.parse(line);
      logs.push({
        reqId: r.reqId, level: r.level, msg: r.msg, statusCode: r.res?.statusCode,
        ...(r.err ? { error: { type: r.err.type, code: r.err.code, message: r.err.message } } : {}),
      });
    },
    activeSockets: () => ({ clients: clientRequests.size, server: serverSockets.size }),
    releaseAll() {
      for (const control of byName.values()) control.release.resolve('fixture cleanup');
      for (const client of clientRequests) client.destroy();
    },
    destroyOwnedServerSockets() {
      for (const socket of serverSockets) socket.destroy();
    },
  };
}
