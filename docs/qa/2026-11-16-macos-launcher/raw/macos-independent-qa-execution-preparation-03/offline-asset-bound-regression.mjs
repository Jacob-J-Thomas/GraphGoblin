#!/usr/bin/env node
// Offline regression for the preparation 03 built-asset response bound. Node 22 built-ins only.
// It evaluates the exact shells()/http() source bytes of driver 02 and driver 03 against an in-process
// loopback test server. No product, gateway, installer, SSH, remote host or network beyond 127.0.0.1.
//
//   node offline-asset-bound-regression.mjs <driver02.mjs> <driver03.mjs> [<real web dist> <real goblin dist>]
//
// Exit 0 only when every expectation holds. The real dist pair is used only when its bytes match the
// build04 hashes recorded in correction-handoff.md; otherwise that case is reported as not run.

import { createHash, randomInt } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const [driver02, driver03, realWeb, realGoblin] = process.argv.slice(2);
if (!driver02 || !driver03) { process.stderr.write('usage: driver02 driver03 [realWeb realGoblin]\n'); process.exit(64); }
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const MiB = 1024 * 1024;
const LEGIT_APP_ASSET = 2_132_126; // exact /app/ entry asset size at 4341d1f8 (build04 log: 2,132.12 kB)
const BUILD04 = { webIndex: 'c606991f0f8e9b819297f5ee88f712c819bbf239ed98ca7814dd1f2b554e2fef',
  goblinIndex: 'f74c415b93fa0f89dca358ea10ce819e29245fd70f00d68dc962f331592610af',
  appAsset: 'a01db82b12c21679cf83221adf7b448e0d46bb8de2ecc3c99bb2bb6744b4cc63', goblinAsset: 'edb51c3421e40dc7cc9ed4e81c5f8ba44ed8e8bb5a54b8864aae1af1418177a6' };

// ---------------------------------------------------------------- source guard and extraction
const text = { d02: await readFile(driver02, 'utf8'), d03: await readFile(driver03, 'utf8') };
const lines = { d02: text.d02.split('\n'), d03: text.d03.split('\n') };
const without = (list, drop) => list.filter((_, i) => !drop.includes(i)).join('\n');
// Driver 02 lines 7, 36, 513 are replaced by driver 03 lines 7, 36, 513-515; every other byte must be identical.
const guard = {
  d02Sha256: sha(text.d02), d03Sha256: sha(text.d03),
  restIdentical: without(lines.d02, [6, 35, 512]) === without(lines.d03, [6, 35, 512, 513, 514]),
  replaced: { d02: [7, 36, 513].map((n) => lines.d02[n - 1]), d03: [7, 36, 513, 514, 515].map((n) => lines.d03[n - 1]) },
  healthCapUnchanged: text.d03.includes("const r = await http(port, '/healthz', { cap: 4096 });"),
  shellFetchUnchanged: text.d03.includes('    const served = await http(port, route);\n'),
};

function extract(source, names) {
  const parts = [];
  for (const name of names) {
    const start = new RegExp(`^(?:async function|function|const|class) ${name}\\b`, 'mu').exec(source);
    if (!start) throw new Error('declaration not found: ' + name);
    const single = /^(?:const|class) /u.test(start[0]);
    const end = single ? source.indexOf('\n', start.index) : source.indexOf('\n}\n', start.index) + 2;
    parts.push(source.slice(start.index, end));
  }
  return parts.join('\n');
}
function load(source) {
  const code = extract(source, ['Stop', 'sha256', 'FORBIDDEN_PORTS', 'BOUND', 'CAP', 'qaPort', 'http', 'headerValues', 'shells']);
  // eslint-disable-next-line no-new-func
  return new Function('deps', 'const { request, createHash, readFile, join, basename } = deps;\n' + code + '\nreturn { shells, CAP, Stop };')(
    { request, createHash, readFile, join, basename });
}
const d02 = load(text.d02);
const d03 = load(text.d03);

// ---------------------------------------------------------------- fixtures
const root = await mkdtemp(join(tmpdir(), 'gg456-asset-bound-'));
const filler = (size, seed) => { const b = Buffer.alloc(size); for (let i = 0; i < size; i++) b[i] = (i * 31 + seed) & 0x7f || 0x20; return b; };
async function builtSite(name, appAssetSize) {
  const site = { name, web: join(root, name, 'web'), goblin: join(root, name, 'goblin') };
  for (const [dir, route, jsSize] of [[site.web, '/app/', appAssetSize], [site.goblin, '/goblin/', 446_180]]) {
    await mkdir(join(dir, 'assets'), { recursive: true });
    const html = `<!doctype html><link rel="icon" href="${route}favicon.svg" /><script type="module" crossorigin src="${route}assets/index-QA.js"></script>` +
      `<link rel="stylesheet" crossorigin href="${route}assets/index-QA.css">\n`;
    await writeFile(join(dir, 'index.html'), html);
    await writeFile(join(dir, 'assets', 'index-QA.js'), filler(jsSize, route.length));
    await writeFile(join(dir, 'assets', 'index-QA.css'), filler(1000, 7));
  }
  return site;
}
const synthetic = await builtSite('legit', LEGIT_APP_ASSET);
const tooLarge = await builtSite('over-bound', 4 * MiB + 1);

let real = null;
if (realWeb && realGoblin) {
  const webIndex = await readFile(join(realWeb, 'index.html')).catch(() => null);
  const goblinIndex = await readFile(join(realGoblin, 'index.html')).catch(() => null);
  const appAsset = await readFile(join(realWeb, 'assets', 'index-C5U89dQm.js')).catch(() => null);
  const goblinAsset = await readFile(join(realGoblin, 'assets', 'index-DWjcCYh1.js')).catch(() => null);
  const ok = webIndex && goblinIndex && appAsset && goblinAsset && sha(webIndex) === BUILD04.webIndex && sha(goblinIndex) === BUILD04.goblinIndex &&
    sha(appAsset) === BUILD04.appAsset && sha(goblinAsset) === BUILD04.goblinAsset;
  real = { matchedBuild04: Boolean(ok), appAssetBytes: appAsset?.length ?? null, site: ok ? { name: 'real-build04-bytes', web: realWeb, goblin: realGoblin } : null };
}

// ---------------------------------------------------------------- loopback test server
const state = { site: null, mutate: 'exact', shellOverlong: false, hits: {} };
const server = createServer(async (req, res) => {
  const url = req.url ?? '';
  state.hits[url] = (state.hits[url] ?? 0) + 1;
  const site = state.site;
  const [, route, rest] = /^\/(app|goblin)\/(.*)$/u.exec(url) ?? [];
  if (!route) { res.writeHead(404).end(); return; }
  const dir = route === 'app' ? site.web : site.goblin;
  let body;
  try { body = await readFile(rest === '' ? join(dir, 'index.html') : join(dir, ...rest.split('/'))); } catch { res.writeHead(404).end(); return; }
  let status = 200;
  if (route === 'app' && rest === '' && state.shellOverlong) body = Buffer.concat([body, Buffer.alloc(2 * MiB + 1 - body.length, 0x20)]);
  if (route === 'app' && rest.startsWith('assets/') && rest.endsWith('.js')) {
    if (state.mutate === 'flip') { body = Buffer.from(body); body[body.length >> 1] ^= 0x01; }
    else if (state.mutate === 'extra') body = Buffer.concat([body, Buffer.from('X')]);
    else if (state.mutate === 'short') body = body.subarray(0, body.length - 1);
    else if (state.mutate === 'status') status = 404;
  }
  res.writeHead(status, { 'content-type': 'text/plain', 'content-length': body.length });
  res.end(body);
});
let port = null;
for (let attempt = 0; attempt < 20 && port === null; attempt++) {
  const candidate = 49152 + randomInt(65536 - 49152);
  if (candidate === 4747 || candidate === 4748) continue;
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen({ host: '127.0.0.1', port: candidate, exclusive: true }, resolve); });
    port = candidate;
  } catch (error) { if (error?.code !== 'EADDRINUSE' && error?.code !== 'EACCES') throw error; }
}
if (port === null) throw new Error('no loopback test port');

// ---------------------------------------------------------------- cases
async function attempt(driver, site, mutate = 'exact', shellOverlong = false) {
  Object.assign(state, { site, mutate, shellOverlong, hits: {} });
  try {
    const served = await driver.shells({ webDist: site.web, goblinDist: site.goblin }, port);
    return { outcome: 'returned', served: served.map(({ route, status, shellMatch, asset, assetMatch }) => ({ route, status, shellMatch, asset, assetMatch })), hits: state.hits };
  } catch (error) {
    return { outcome: 'threw', stop: error instanceof driver.Stop, message: String(error?.message ?? error), hits: state.hits };
  }
}
const allMatch = (r) => r.outcome === 'returned' && r.served.length === 2 && r.served.every((s) => s.status === 200 && s.shellMatch && s.assetMatch === true);
const appAssetFalse = (r) => r.outcome === 'returned' && r.served[0].assetMatch === false && r.served[0].shellMatch === true && r.served[1].assetMatch === true;
const capError = (r) => r.outcome === 'threw' && !r.stop && r.message === 'response exceeded the QA cap';

const cases = [];
async function expect(id, driver, site, mutate, shellOverlong, predicate, meaning) {
  const result = await attempt(driver, site, mutate, shellOverlong);
  cases.push({ id, meaning, ok: Boolean(predicate(result)), result });
}
await expect('R1-driver02-legit-oversized-asset', d02, synthetic, 'exact', false, capError,
  'driver 02 reproduces the QA03 stop on a legitimate 2,132,126-byte built asset');
await expect('R2-driver03-legit-oversized-asset', d03, synthetic, 'exact', false, allMatch,
  'driver 03 accepts the same legitimate asset: HTTP 200 and exact bytes for both shells and both assets');
if (real?.site) {
  await expect('R3-driver02-real-build04-bytes', d02, real.site, 'exact', false, capError, 'driver 02 stops on the actual build04 /app/ entry bytes');
  await expect('R4-driver03-real-build04-bytes', d03, real.site, 'exact', false, allMatch, 'driver 03 accepts the actual build04 shells and assets');
}
await expect('N1-driver03-same-length-one-byte-differs', d03, synthetic, 'flip', false, appAssetFalse, 'a mismatching asset of the expected length is not a match');
await expect('N2-driver03-overlong-by-one-byte', d03, synthetic, 'extra', false, capError, 'one byte beyond the exact built length exceeds the cap');
await expect('N3-driver03-short-by-one-byte', d03, synthetic, 'short', false, appAssetFalse, 'a truncated asset is not a match');
await expect('N4-driver03-exact-bytes-non-200', d03, synthetic, 'status', false, appAssetFalse, 'exact bytes with HTTP 404 are not a match (HTTP 200 retained)');
await expect('N5-driver03-built-asset-above-fixed-bound', d03, tooLarge, 'exact', false,
  (r) => r.outcome === 'threw' && r.stop && r.message === `built asset /app/assets/index-QA.js has ${4 * MiB + 1} bytes, above the ${4 * MiB}-byte QA asset bound` && !r.hits['/app/assets/index-QA.js'],
  'a built asset above the fixed 4 MiB bound stops before it is fetched');
await expect('N6-driver03-shell-above-unchanged-http-cap', d03, synthetic, 'exact', true, capError, 'the shell response keeps the unchanged 2 MiB CAP.http');

await new Promise((resolve) => { server.close(resolve); server.closeAllConnections?.(); });
await rm(root, { recursive: true, force: true });

const constants = { d02: { http: d02.CAP.http, asset: d02.CAP.asset ?? null }, d03: { http: d03.CAP.http, asset: d03.CAP.asset } };
const constantsOk = constants.d02.http === 2 * MiB && constants.d02.asset === null && constants.d03.http === 2 * MiB && constants.d03.asset === 4 * MiB;
const guardOk = guard.restIdentical && guard.healthCapUnchanged && guard.shellFetchUnchanged;
const pass = guardOk && constantsOk && cases.every((c) => c.ok) && (real === null || real.matchedBuild04);
const summary = { schema: 'gg456-asset-bound-offline-regression/1', node: process.version, platform: `${process.platform}-${process.arch}`, guard, constants,
  real: real && { matchedBuild04: real.matchedBuild04, appAssetBytes: real.appAssetBytes, used: Boolean(real.site) },
  cases: cases.map(({ id, meaning, ok, result }) => ({ id, ok, meaning, ...result })), pass };
process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
process.exitCode = pass ? 0 : 1;
