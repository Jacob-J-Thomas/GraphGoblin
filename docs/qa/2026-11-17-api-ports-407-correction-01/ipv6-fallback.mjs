import { registerHooks } from 'node:module';
import { mkdtemp, readdir, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const port = 63652;
const helper = pathToFileURL(resolve(process.argv[2])).href;
const controlledNet = new URL('./controlled-net.mjs', import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'node:net' && context.parentURL === helper) return { url: controlledNet, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
const { setApiPortRoot, reserveApiPort } = await import(helper);
const root = await mkdtemp(join(tmpdir(), 'gg-407-ipv6-control-'));
setApiPortRoot(root);
const results = [];
try {
  for (const [host, code, expected] of [
    ['::', 'EAFNOSUPPORT', 'reserved'],
    ['::', 'EPROTONOSUPPORT', 'reserved'],
    ['::', 'EADDRNOTAVAIL', 'reserved'],
    ['::', 'EACCES', 'EACCES'],
    ['::', 'EINVAL', 'EINVAL'],
    ['0.0.0.0', 'EADDRNOTAVAIL', 'EADDRNOTAVAIL'],
  ]) {
    globalThis.failHost = host;
    globalThis.failCode = code;
    globalThis.probedHosts = [];
    let reservation;
    let result;
    try {
      reservation = await reserveApiPort(port, 1);
      result = 'reserved';
    } catch (error) {
      result = error.code ?? error.message;
    } finally {
      await reservation?.release();
    }
    results.push({ host, code, expected, result, reached: globalThis.probedHosts, remainingClaims: await readdir(root) });
  }
} finally {
  await rmdir(root);
}
console.log(JSON.stringify({ node: process.version, port, results }, null, 2));
if (results.some(({ result, expected, host, reached, remainingClaims }) =>
  result !== expected || !reached.includes(host) || remainingClaims.length)) process.exitCode = 1;
