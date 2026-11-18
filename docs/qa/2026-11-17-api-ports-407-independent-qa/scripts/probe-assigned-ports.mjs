// Probes ONLY 63800-63819 (QA assignment). Binds each port briefly on 127.0.0.1, 0.0.0.0 and ::, then closes.
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
const hits = netstat.split(/\r?\n/).filter((l) => /:638(0\d|1\d)\s/.test(l));
const ok = rows.every((r) => r.v4loop === 'ok' && r.v4any === 'ok' && r.v6any === 'ok') && hits.length === 0;
console.log(JSON.stringify({ at: new Date().toISOString(), label: process.argv[2] ?? '', ok, rows, netstatHits: hits }, null, 1));
process.exitCode = ok ? 0 : 3;
