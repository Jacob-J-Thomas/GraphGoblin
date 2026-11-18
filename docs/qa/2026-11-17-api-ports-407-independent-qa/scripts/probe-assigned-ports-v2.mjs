// v2 (harness correction after r1): Probes ONLY 63800-63819. ok = every port binds on 127.0.0.1, 0.0.0.0 and ::
// AND no netstat row has a LOCAL address in range in LISTENING state. All rows touching the range are still recorded.
import { createServer } from 'node:net';
import { execFileSync } from 'node:child_process';
const START = 63800, COUNT = 20;
const bind = (port, host) => new Promise((resolve) => {
  const s = createServer();
  s.once('error', (e) => resolve(e.code));
  s.listen({ port, host, ipv6Only: false }, () => s.close(() => resolve('ok')));
});
const rows = [];
for (let p = START; p < START + COUNT; p++) {
  rows.push({ port: p, v4loop: await bind(p, '127.0.0.1'), v4any: await bind(p, '0.0.0.0'), v6any: await bind(p, '::') });
}
const netstat = execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8' }) + execFileSync('netstat', ['-ano', '-p', 'TCPv6'], { encoding: 'utf8' });
const touching = netstat.split(/\r?\n/).filter((l) => /:638(0\d|1\d)\s/.test(l)).map((l) => l.trim());
const localInRange = (l) => { const local = l.split(/\s+/)[1] ?? ''; return /:638(0\d|1\d)$/.test(local); };
const listeners = touching.filter((l) => localInRange(l) && /LISTENING/.test(l));
const localNonListen = touching.filter((l) => localInRange(l) && !/LISTENING/.test(l));
const ok = rows.every((r) => r.v4loop === 'ok' && r.v4any === 'ok' && r.v6any === 'ok') && listeners.length === 0;
console.log(JSON.stringify({ at: new Date().toISOString(), label: process.argv[2] ?? '', ok, rows, listeners, localNonListen, allTouchingRows: touching }, null, 1));
process.exitCode = ok ? 0 : 3;
