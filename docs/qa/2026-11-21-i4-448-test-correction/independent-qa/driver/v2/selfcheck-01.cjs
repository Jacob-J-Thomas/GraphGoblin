'use strict';
// QA448 run 01: deliberate controlled outbound attempts under the guard. Every target is an in-process
// loopback honeypot (ephemeral port) or `localhost`; if the guard failed, the honeypot would record
// the access instead of any host service. Forwarding checks: data: fetch, named-pipe IPC, child fork.
const net = require('node:net');
const http = require('node:http');
const tls = require('node:tls');
const dns = require('node:dns');
const dgram = require('node:dgram');
const { fork } = require('node:child_process');

const settle = (p, ms = 3000) =>
  Promise.race([
    p.then((v) => ({ outcome: 'resolved', value: v }), (e) => ({ outcome: 'rejected', code: e?.code ?? e?.cause?.code, message: String(e?.message ?? e).slice(0, 200), cause: e?.cause ? String(e.cause.message ?? e.cause).slice(0, 200) : undefined })),
    new Promise((r) => setTimeout(() => r({ outcome: 'timeout' }), ms)),
  ]);
const errorOf = (emitter) => new Promise((resolve, reject) => {
  emitter.once('error', reject);
  emitter.once('connect', () => resolve('CONNECTED'));
  emitter.once('secureConnect', () => resolve('CONNECTED'));
  emitter.once('response', () => resolve('RESPONSE'));
});

async function attempts(port, udpPort) {
  const r = {};
  r.fetch = await settle(fetch(`http://127.0.0.1:${port}/qa448-control`));
  r.httpGet = await settle(errorOf(http.get(`http://127.0.0.1:${port}/qa448-control`)));
  r.netConnect = await settle(errorOf(net.connect({ host: '127.0.0.1', port })));
  r.tlsConnect = await settle(errorOf(tls.connect({ host: '127.0.0.1', port, rejectUnauthorized: false })));
  r.dnsLookup = await settle(new Promise((res, rej) => dns.lookup('localhost', (e, a) => (e ? rej(e) : res(a)))));
  r.dnsPromisesLookup = await settle(dns.promises.lookup('localhost'));
  const udp = dgram.createSocket('udp4');
  r.udpSend = await settle(new Promise((res, rej) => udp.send(Buffer.from('qa448'), udpPort, '127.0.0.1', (e) => (e ? rej(e) : res('SENT')))));
  udp.close();
  return r;
}

async function main() {
  if (process.argv[2] === 'child') {
    const [port, udpPort] = process.argv.slice(3).map(Number);
    const r = await attempts(port, udpPort);
    process.send({ child: r, guard: globalThis.__qa448Guard?.counts }, () => process.exit(0));
    return;
  }
  let tcpAccepted = 0;
  let udpReceived = 0;
  const honeypot = net.createServer((s) => {
    tcpAccepted++;
    s.destroy();
  });
  await new Promise((r) => honeypot.listen(0, '127.0.0.1', r));
  const port = honeypot.address().port;
  const udpHoneypot = dgram.createSocket('udp4');
  udpHoneypot.on('message', () => udpReceived++);
  await new Promise((r) => udpHoneypot.bind(0, '127.0.0.1', r));
  const udpPort = udpHoneypot.address().port;

  const result = { layers: globalThis.__qa448Guard?.layers ?? 'NOT INSTALLED', honeypotPort: port, udpHoneypotPort: udpPort };
  result.parent = await attempts(port, udpPort);

  // Forwarded, non-network behaviour.
  result.dataFetch = await settle(fetch('data:text/plain,qa448-ok').then((r) => r.text()));
  const pipeName = `\\\\.\\pipe\\qa448-selfcheck-${process.pid}`;
  const pipeServer = net.createServer((s) => s.end('pipe-ok'));
  await new Promise((r) => pipeServer.listen(pipeName, r));
  result.pipeConnect = await settle(
    new Promise((resolve, reject) => {
      const c = net.connect(pipeName);
      let data = '';
      c.on('data', (d) => (data += d));
      c.on('end', () => resolve(data));
      c.on('error', reject);
    }),
  );
  pipeServer.close();

  const child = fork(__filename, ['child', String(port), String(udpPort)], { stdio: 'inherit' });
  result.child = await settle(new Promise((resolve) => child.once('message', resolve)), 15000);
  await new Promise((r) => child.once('exit', r));
  await new Promise((r) => setTimeout(r, 500));
  result.honeypotTcpAccepted = tcpAccepted;
  result.honeypotUdpReceived = udpReceived;
  honeypot.close();
  udpHoneypot.close();
  result.guardCounts = globalThis.__qa448Guard?.counts;

  const attemptNames = ['fetch', 'httpGet', 'netConnect', 'tlsConnect', 'dnsLookup', 'dnsPromisesLookup', 'udpSend'];
  const allBlocked = (r) => attemptNames.every((n) => r && r[n] && r[n].outcome === 'rejected');
  result.expectations = {
    parentAllRejected: allBlocked(result.parent),
    childAllRejected: allBlocked(result.child?.value?.child),
    honeypotsUntouched: tcpAccepted === 0 && udpReceived === 0,
    dataFetchForwarded: result.dataFetch.outcome === 'resolved' && result.dataFetch.value === 'qa448-ok',
    pipeForwarded: result.pipeConnect.outcome === 'resolved' && result.pipeConnect.value === 'pipe-ok',
  };
  result.pass = Object.values(result.expectations).every(Boolean);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.pass ? 0 : 1;
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 2;
});
