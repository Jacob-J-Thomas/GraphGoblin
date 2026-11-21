// Capability probe 00. No external network: the only connect target is an in-process loopback
// honeypot on an ephemeral port, used to detect whether a handle-level patch is actually effective.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import net from 'node:net';
import dns from 'node:dns';

const REPO_API = process.argv[2];
if (!REPO_API) throw new Error('usage: probe-00.mjs <apps/api dir>');
const out = { node: process.version, execPath: process.execPath, platform: process.platform };

// 1. process.binding availability.
for (const name of ['tcp_wrap', 'udp_wrap', 'cares_wrap', 'pipe_wrap', 'uv']) {
  try {
    const b = process.binding(name);
    out[`binding.${name}`] = Object.keys(b).slice(0, 20);
  } catch (e) {
    out[`binding.${name}`] = `ERROR ${e.code ?? ''} ${e.message}`;
  }
}
try {
  const uv = process.binding('uv');
  out.UV_EACCES = uv.UV_EACCES;
  out.UV_ECONNREFUSED = uv.UV_ECONNREFUSED;
} catch (e) {
  out.uvErr = e.message;
}

// 2. Is the tcp_wrap binding object the one net uses? Patch TCP.prototype.connect and connect to
// an in-process honeypot. If the patch is effective the honeypot sees zero connections.
const honeypot = net.createServer((s) => {
  out.honeypotConnections = (out.honeypotConnections ?? 0) + 1;
  s.destroy();
});
await new Promise((r) => honeypot.listen(0, '127.0.0.1', r));
const port = honeypot.address().port;
out.honeypotPort = port;
let l2Hits = 0;
try {
  const { TCP } = process.binding('tcp_wrap');
  const uv = process.binding('uv');
  const orig = TCP.prototype.connect;
  TCP.prototype.connect = function probeConnect(req, address, p) {
    l2Hits++;
    return uv.UV_EACCES;
  };
  const err = await new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port });
    s.on('error', (e) => resolve(`${e.code} ${e.message}`));
    s.on('connect', () => {
      s.destroy();
      resolve('CONNECTED');
    });
  });
  TCP.prototype.connect = orig;
  out.tcpWrapPatchResult = err;
} catch (e) {
  out.tcpWrapPatchError = e.message;
}
out.tcpWrapPatchHits = l2Hits;

// 3. cares_wrap getaddrinfo patch effectiveness (localhost only; never an external name).
let caresHits = 0;
try {
  const cares = process.binding('cares_wrap');
  const uv = process.binding('uv');
  const orig = cares.getaddrinfo;
  cares.getaddrinfo = function probeGai() {
    caresHits++;
    return uv.UV_EACCES;
  };
  out.caresPatchResult = await new Promise((resolve) =>
    dns.lookup('localhost', (e, a) => resolve(e ? `${e.code} ${e.message}` : `RESOLVED ${a}`)),
  );
  cares.getaddrinfo = orig;
} catch (e) {
  out.caresPatchError = e.message;
}
out.caresPatchHits = caresHits;
await new Promise((r) => setTimeout(r, 200));
await new Promise((r) => honeypot.close(r));
out.honeypotConnections ??= 0;

// 4. node:sqlite.
try {
  const sqlite = await import('node:sqlite');
  const db = new sqlite.DatabaseSync(':memory:');
  out.nodeSqliteVersion = db.prepare('select sqlite_version() v').get().v;
  db.close();
} catch (e) {
  out.nodeSqliteError = e.message;
}

// 5. Standalone Vitest expect outside a runner, resolved from apps/api.
try {
  const req = createRequire(`${REPO_API}/package.json`);
  const vitestPath = req.resolve('vitest');
  out.vitestResolved = vitestPath;
  const { expect } = await import(pathToFileURL(vitestPath).href);
  expect(1).toBe(1);
  let threw = false;
  try {
    expect(Buffer.from([1])).toEqual(Buffer.from([2]));
  } catch {
    threw = true;
  }
  let mapThrew = false;
  try {
    expect({ a: Buffer.alloc(0) }).toEqual({});
  } catch {
    mapThrew = true;
  }
  out.vitestExpect = { okPass: true, bufferMismatchThrew: threw, extraKeyThrew: mapThrew };
} catch (e) {
  out.vitestExpectError = `${e.name}: ${e.message}`;
}

console.log(JSON.stringify(out, null, 2));
