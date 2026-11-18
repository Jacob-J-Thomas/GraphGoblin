import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const port = 63650;
const rows = [
  { host: '127.0.0.1' },
  { host: '0.0.0.0' },
  { host: '::' },
  { host: '::', ipv6Only: true },
  { host: '::1', ipv6Only: true },
];
const foreign = fileURLToPath(new URL('./bind-listener.mjs', import.meta.url));
const probe = async (options) => {
  const server = createServer((socket) => socket.destroy());
  server.listen({ port, ...options });
  try {
    await once(server, 'listening');
  } catch (error) {
    return error.code;
  }
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return 'ok';
};
const results = [];
const allFree = async () => {
  for (const options of rows) {
    const result = await probe(options);
    if (result !== 'ok') throw new Error(`Expected verified free ${JSON.stringify(options)}:${port}: ${result}`);
  }
};
await allFree();
for (const occupied of rows) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  const child = spawn(
    process.execPath,
    [foreign, String(port), JSON.stringify(occupied)],
    { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true, signal: controller.signal },
  );
  const exit = once(child, 'close');
  try {
    await once(child.stdout, 'data');
    const got = [];
    for (const options of rows) got.push({ options, bind: await probe(options) });
    const clients = occupied.host.includes(':')
      ? occupied.ipv6Only ? ['[::1]'] : ['127.0.0.1', '[::1]']
      : ['127.0.0.1'];
    const answers = [];
    for (const host of clients) {
      const response = await fetch(`http://${host}:${port}`, { signal: AbortSignal.timeout(2000) });
      answers.push({ host, sentinel: await response.text() });
    }
    results.push({ occupied, ownedListenerPid: child.pid, probes: got, answers });
  } finally {
    clearTimeout(timeout);
    child.stdin.end();
    const [code] = await exit;
    if (code !== 0) throw new Error(`Owned foreign child closed with ${code}`);
  }
  await allFree();
}
console.log(JSON.stringify({ node: process.version, platform: process.platform, port, results }, null, 2));
