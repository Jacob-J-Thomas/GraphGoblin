'use strict';
// QA448 independent outbound guard and passive fixture observers. Loaded with
// NODE_OPTIONS=--require=<this file> so every Node process in the command tree, including Vitest's
// forked workers, installs it before user code. Each event is appended synchronously: Vitest may
// terminate its fork without running exit hooks.
//
// L1 (API layer): fetch/WebSocket/EventSource, net.Socket#connect, dns, dgram are rejected before the
//   original implementation is called; http/https/tls creation is recorded as an attempt and its socket
//   is then rejected by the net layer. Path-based (IPC/named pipe) connects, data:/blob: fetches,
//   listen, filesystem and child processes are forwarded and counted.
// L2 (handle layer): libuv/c-ares entry points below L1 (tcp_wrap connect/connect6, udp_wrap send/connect,
//   cares getaddrinfo and resolver queries) return UV_EACCES before any socket or resolver traffic.
//   pipe_wrap connect is forwarded and counted.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const LOG = process.env.QA448_GUARD_LOG;
if (!LOG) throw new Error('QA448_GUARD_LOG is required');
const LAYERS = new Set(
  (process.env.QA448_GUARD_LAYERS || 'L1,L2')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);
const appendFileSync = fs.appendFileSync;
let seq = 0;
const counts = { blocked: 0, attemptObserved: 0, forwarded: 0, byKind: {} };
globalThis.__qa448Guard = { counts, layers: [...LAYERS] };

function safe(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function') return '[function]';
  if (Buffer.isBuffer(value)) return `[Buffer ${value.length}]`;
  if (typeof value !== 'object') return value;
  if (depth > 2) return '[object]';
  if (Array.isArray(value)) return value.slice(0, 12).map((v) => safe(v, depth + 1));
  const out = {};
  for (const key of ['href', 'url', 'protocol', 'host', 'hostname', 'port', 'path', 'socketPath', 'method', 'family', 'address', 'localAddress', 'servername']) {
    if (key in value) {
      try {
        out[key] = safe(value[key], depth + 1);
      } catch {}
    }
  }
  return out;
}

function record(event) {
  let line;
  try {
    line = JSON.stringify({ seq: ++seq, utc: new Date().toISOString(), pid: process.pid, ppid: process.ppid, ...event });
  } catch (error) {
    line = JSON.stringify({ seq, utc: new Date().toISOString(), pid: process.pid, event: 'record-error', message: String(error) });
  }
  appendFileSync(LOG, line + '\n');
}

function stack() {
  return (new Error().stack || '').split('\n').slice(2, 45).map((s) => s.trim());
}

function bump(kind, category) {
  counts.byKind[kind] = (counts.byKind[kind] || 0) + 1;
  counts[category]++;
}

function blocked(kind, target) {
  bump(kind, 'blocked');
  record({ event: 'blocked', layer: kind.slice(0, 2), kind, target: safe(target), stack: stack() });
}

function attempt(kind, target) {
  bump(kind, 'attemptObserved');
  record({ event: 'attempt-observed', layer: 'L1', kind, target: safe(target), stack: stack() });
}

function forwarded(kind, target) {
  bump(kind, 'forwarded');
  record({ event: 'forwarded', kind, target: safe(target) });
}

function blockedError(what) {
  return Object.assign(new Error(`QA448 guard blocked ${what} before network access`), { code: 'QA448_BLOCKED' });
}

record({
  event: 'installed',
  layers: [...LAYERS],
  argv: process.argv.slice(0, 8),
  execArgv: process.execArgv,
  cwd: process.cwd(),
  node: process.version,
  nodeOptions: process.env.NODE_OPTIONS,
  label: process.env.QA448_LABEL,
});

if (LAYERS.has('L1')) {
  const net = require('node:net');
  const dns = require('node:dns');
  const dgram = require('node:dgram');

  const originalFetch = globalThis.fetch;
  if (typeof originalFetch === 'function') {
    globalThis.fetch = function qa448Fetch(input, init) {
      let url;
      try {
        url = typeof input === 'string' ? input : input instanceof URL ? input.href : input && input.url;
      } catch {
        url = String(input);
      }
      let scheme = '';
      try {
        scheme = new URL(url).protocol;
      } catch {}
      if (scheme === 'data:' || scheme === 'blob:') {
        forwarded('L1-fetch-local-scheme', { url: String(url).slice(0, 60) });
        return originalFetch.call(this, input, init);
      }
      blocked('L1-fetch', { url, method: init && init.method });
      return Promise.reject(new TypeError('fetch failed', { cause: blockedError(`fetch ${url}`) }));
    };
  }
  for (const name of ['WebSocket', 'EventSource']) {
    if (typeof globalThis[name] === 'function') {
      const Original = globalThis[name];
      globalThis[name] = function qa448BlockedClient(url) {
        blocked(`L1-${name}`, { url: String(url) });
        throw blockedError(`${name} ${url}`);
      };
      globalThis[name].prototype = Original.prototype;
    }
  }

  const originalConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function qa448SocketConnect(...args) {
    let options;
    if (Array.isArray(args[0])) options = args[0][0];
    else if (args[0] !== null && typeof args[0] === 'object') options = args[0];
    else if (typeof args[0] === 'string' && Number.isNaN(Number(args[0]))) options = { path: args[0] };
    else options = { port: args[0], host: typeof args[1] === 'string' ? args[1] : undefined };
    if (options && options.path !== undefined && options.path !== null) {
      forwarded('L1-socket-ipc', { path: options.path });
      return originalConnect.apply(this, args);
    }
    blocked('L1-socket', options);
    const error = blockedError(`socket ${options && options.host}:${options && options.port}`);
    process.nextTick(() => this.destroy(error));
    return this;
  };

  for (const modName of ['node:http', 'node:https']) {
    const mod = require(modName);
    for (const fn of ['request', 'get']) {
      const original = mod[fn];
      mod[fn] = function qa448HttpRequest(...args) {
        const options = typeof args[0] === 'string' || args[0] instanceof URL ? { url: String(args[0]), ...(typeof args[1] === 'object' && !(typeof args[1] === 'function') ? args[1] : {}) } : args[0] || {};
        if (options.socketPath) forwarded(`L1-${modName.slice(5)}-${fn}-ipc`, options);
        else attempt(`L1-${modName.slice(5)}-${fn}`, options);
        return original.apply(this, args);
      };
    }
  }
  const tls = require('node:tls');
  const originalTls = tls.connect;
  tls.connect = function qa448TlsConnect(...args) {
    attempt('L1-tls-connect', typeof args[0] === 'object' ? args[0] : { port: args[0], host: args[1] });
    return originalTls.apply(this, args);
  };

  const dnsCallbackNames = ['lookup', 'lookupService', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCaa', 'resolveCname', 'resolveMx', 'resolveNaptr', 'resolveNs', 'resolvePtr', 'resolveSoa', 'resolveSrv', 'resolveTxt', 'reverse'];
  for (const name of dnsCallbackNames) {
    if (typeof dns[name] !== 'function') continue;
    dns[name] = function qa448Dns(...args) {
      blocked(`L1-dns-${name}`, { name: args[0] });
      const callback = args.findLast((a) => typeof a === 'function');
      const error = Object.assign(blockedError(`dns.${name} ${args[0]}`), { code: 'ENOTFOUND', hostname: args[0] });
      if (callback) process.nextTick(callback, error);
      return {};
    };
    const proto = dns.Resolver && dns.Resolver.prototype;
    if (proto && typeof proto[name] === 'function') {
      proto[name] = function qa448DnsResolver(...args) {
        blocked(`L1-dns-resolver-${name}`, { name: args[0] });
        const callback = args.findLast((a) => typeof a === 'function');
        if (callback) process.nextTick(callback, blockedError(`resolver.${name}`));
        return {};
      };
    }
  }
  const dnsPromises = dns.promises;
  for (const name of dnsCallbackNames) {
    if (typeof dnsPromises[name] === 'function') {
      dnsPromises[name] = function qa448DnsPromise(...args) {
        blocked(`L1-dns-promises-${name}`, { name: args[0] });
        return Promise.reject(Object.assign(blockedError(`dns.promises.${name} ${args[0]}`), { code: 'ENOTFOUND' }));
      };
    }
    const proto = dnsPromises.Resolver && dnsPromises.Resolver.prototype;
    if (proto && typeof proto[name] === 'function') {
      proto[name] = function qa448DnsPromiseResolver(...args) {
        blocked(`L1-dns-promises-resolver-${name}`, { name: args[0] });
        return Promise.reject(blockedError(`resolver.${name}`));
      };
    }
  }

  for (const name of ['send', 'connect']) {
    dgram.Socket.prototype[name] = function qa448Dgram(...args) {
      blocked(`L1-dgram-${name}`, { args: args.filter((a) => typeof a !== 'object' || a === null).slice(0, 4) });
      const callback = args.findLast((a) => typeof a === 'function');
      const error = blockedError(`dgram ${name}`);
      if (callback) process.nextTick(callback, error);
      else process.nextTick(() => this.emit('error', error));
    };
  }

  const originalListen = net.Server.prototype.listen;
  net.Server.prototype.listen = function qa448Listen(...args) {
    forwarded('L1-server-listen', { args: args.filter((a) => typeof a !== 'function').slice(0, 3) });
    return originalListen.apply(this, args);
  };

  const childProcess = require('node:child_process');
  const originalSpawn = childProcess.ChildProcess.prototype.spawn;
  childProcess.ChildProcess.prototype.spawn = function qa448Spawn(options) {
    const guardInEnv = Array.isArray(options && options.envPairs)
      ? options.envPairs.some((pair) => pair.startsWith('NODE_OPTIONS=') && pair.includes('guard.cjs'))
      : undefined;
    forwarded('L1-child-spawn', { path: options && options.file });
    record({ event: 'child-spawn', file: options && options.file, args: options && options.args && options.args.slice(0, 10), guardInChildEnv: guardInEnv });
    return originalSpawn.call(this, options);
  };
}

if (LAYERS.has('L2')) {
  const uv = process.binding('uv');
  const { TCP } = process.binding('tcp_wrap');
  for (const method of ['connect', 'connect6']) {
    if (typeof TCP.prototype[method] !== 'function') continue;
    TCP.prototype[method] = function qa448TcpConnect(req, address, port) {
      blocked(`L2-tcp-${method}`, { address, port });
      return uv.UV_EACCES;
    };
  }
  const { UDP } = process.binding('udp_wrap');
  for (const method of ['send', 'send6', 'connect', 'connect6']) {
    if (typeof UDP.prototype[method] !== 'function') continue;
    UDP.prototype[method] = function qa448Udp(...args) {
      blocked(`L2-udp-${method}`, { args: args.filter((a) => typeof a === 'string' || typeof a === 'number').slice(0, 4) });
      return uv.UV_EACCES;
    };
  }
  const cares = process.binding('cares_wrap');
  cares.getaddrinfo = function qa448Getaddrinfo(req, hostname) {
    blocked('L2-getaddrinfo', { hostname });
    return uv.UV_EACCES;
  };
  for (const method of Object.getOwnPropertyNames(cares.ChannelWrap.prototype)) {
    if (!/^(query|getHostByAddr)/.test(method)) continue;
    cares.ChannelWrap.prototype[method] = function qa448Query(req, name) {
      blocked(`L2-cares-${method}`, { name });
      return uv.UV_EACCES;
    };
  }
  const { Pipe } = process.binding('pipe_wrap');
  const originalPipeConnect = Pipe.prototype.connect;
  Pipe.prototype.connect = function qa448PipeConnect(req, address, ...rest) {
    forwarded('L2-pipe-connect', { address });
    return originalPipeConnect.call(this, req, address, ...rest);
  };
}

if (process.env.QA448_OBSERVE === '1') {
  const { snapshotDir, sha256 } = require('./snapshot.cjs');
  const blobDir = process.env.QA448_BLOB_DIR;
  const FIXTURE = /[\\/]gg-preflight-catalog-[^\\/]+/;
  const FIXTURE_ROOT = /[\\/]gg-preflight-catalog-[^\\/]+[\\/]?$/;
  const asPath = (p) => (typeof p === 'string' ? p : p instanceof URL ? p.pathname : Buffer.isBuffer(p) ? p.toString() : undefined);
  const promises = fs.promises;
  const original = { readdir: promises.readdir, readFile: promises.readFile, lstat: promises.lstat, rm: promises.rm, mkdtemp: promises.mkdtemp };
  promises.readdir = async function qa448Readdir(target, ...args) {
    const p = asPath(target);
    if (p && FIXTURE.test(p)) record({ event: 'snapshot', reason: 'at-readdir', snapshot: snapshotDir(p, { blobDir }) });
    return original.readdir.call(this, target, ...args);
  };
  promises.readFile = async function qa448ReadFile(target, ...args) {
    const result = await original.readFile.call(this, target, ...args);
    const p = asPath(target);
    if (p && FIXTURE.test(p) && /\.db(?:-wal)?$/.test(p) && Buffer.isBuffer(result)) {
      record({ event: 'helper-read', path: p, size: result.length, sha256: sha256(result) });
    }
    return result;
  };
  promises.lstat = async function qa448Lstat(target, ...args) {
    const p = asPath(target);
    if (p && FIXTURE.test(p) && /[\\/]data[\\/]chat-audio$/.test(p)) {
      record({ event: 'startup-chat-audio-probe', path: p, stack: stack() });
    }
    return original.lstat.call(this, target, ...args);
  };
  promises.rm = async function qa448Rm(target, ...args) {
    const p = asPath(target);
    if (p && FIXTURE_ROOT.test(p)) {
      record({ event: 'snapshot', reason: 'before-fixture-rm', snapshot: snapshotDir(p, { blobDir, recursive: true }) });
    }
    return original.rm.call(this, target, ...args);
  };
  promises.mkdtemp = async function qa448Mkdtemp(prefix, ...args) {
    const created = await original.mkdtemp.call(this, prefix, ...args);
    if (typeof created === 'string' && /gg-/.test(path.basename(created))) record({ event: 'mkdtemp', path: created });
    return created;
  };
  require('node:module').syncBuiltinESMExports();
  record({ event: 'observers-installed', blobDir });
}

// Propagate the patched builtin properties to ESM named imports (e.g. `import { lookup } from 'node:dns'`).
require('node:module').syncBuiltinESMExports();

process.on('exit', (code) => {
  try {
    record({ event: 'exit', code, counts });
  } catch {}
});
