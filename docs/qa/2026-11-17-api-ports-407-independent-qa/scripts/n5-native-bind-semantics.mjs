// N5 preliminary: with a foreign listener in a separate process on <host>:63813, can this process bind 127.0.0.1:63813
// (the helper's probe and the API child's bind)? And where do loopback requests go while both are bound?
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
const PORT = 63813;
const foreignScript = fileURLToPath(new URL('./foreign-listener.mjs', import.meta.url));
const results = [];
for (const host of ['127.0.0.1', '0.0.0.0', '::', '::1']) {
  const child = spawn(process.execPath, [foreignScript, String(PORT), host], { stdio: ['pipe', 'pipe', 'pipe'] });
  await new Promise((res, rej) => { child.stdout.once('data', res); child.once('exit', (c) => rej(new Error('foreign exited ' + c))); });
  const mine = createServer((_q, r) => r.end('fixture:127.0.0.1'));
  const bind = await new Promise((res) => { mine.once('error', (e) => res(e.code)); mine.listen(PORT, '127.0.0.1', () => res('ok')); });
  let loopbackAnswer = null, foreignV6Answer = null;
  try { loopbackAnswer = await (await fetch(`http://127.0.0.1:${PORT}/`)).text(); } catch (e) { loopbackAnswer = 'ERR ' + e.cause?.code; }
  if (host === '::' || host === '::1') { try { foreignV6Answer = await (await fetch(`http://[::1]:${PORT}/`)).text(); } catch (e) { foreignV6Answer = 'ERR ' + e.cause?.code; } }
  if (bind === 'ok') await new Promise((r) => { mine.closeAllConnections(); mine.close(() => r()); });
  let afterAnswer = null;
  try { afterAnswer = await (await fetch(`http://${host.includes(':') ? '[::1]' : '127.0.0.1'}:${PORT}/`)).text(); } catch (e) { afterAnswer = 'ERR ' + e.cause?.code; }
  child.stdin.end();
  const exit = await new Promise((r) => child.once('exit', (c) => r(c)));
  results.push({ foreignHost: host, probeBind127: bind, loopbackAnswerWhileBoth: loopbackAnswer, foreignV6Answer, foreignAnswerAfterFixtureClosed: afterAnswer, foreignExit: exit });
}
console.log(JSON.stringify({ at: new Date().toISOString(), node: process.version, port: PORT, results }, null, 1));
