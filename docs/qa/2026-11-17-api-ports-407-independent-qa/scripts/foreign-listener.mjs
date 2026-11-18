// Foreign (non-fixture) HTTP listener in its own process. Args: <port> <host> [readyFile]. Answers "foreign:<host>".
// Assigned range only: refuses ports outside 63800-63819.
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
const [port, host, readyFile] = [Number(process.argv[2]), process.argv[3], process.argv[4]];
if (!(port >= 63800 && port <= 63819)) { console.error('port outside QA assignment'); process.exit(9); }
const server = createServer((_q, r) => r.end(`foreign:${host}`));
server.listen({ port, host, ipv6Only: host === '::1' }, () => {
  console.log(`listening ${host}:${port} pid=${process.pid}`);
  if (readyFile) writeFileSync(readyFile, String(process.pid));
});
server.on('error', (e) => { console.error('foreign error', e.code); process.exit(2); });
process.stdin.on('data', () => server.close(() => process.exit(0)));
process.stdin.on('end', () => server.close(() => process.exit(0)));
