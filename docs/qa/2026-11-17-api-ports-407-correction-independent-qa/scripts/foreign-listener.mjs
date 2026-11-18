// Foreign (non-fixture) HTTP sentinel in its own process. Args: <port> <mode> <readyFile>
// mode: 0.0.0.0 | 127.0.0.1 | default (listen(port), Node default) | dual (:: ipv6Only=false) | v6only (:: ipv6Only=true) | ::1
// Answers "foreign:<mode>:<pid>" with Connection: close. Exits when stdin ends. Refuses ports outside 63800-63819.
import { createServer } from 'node:http';
import { writeFileSync, renameSync } from 'node:fs';
const [port, mode, readyFile] = [Number(process.argv[2]), process.argv[3], process.argv[4]];
if (!(Number.isInteger(port) && port >= 63800 && port <= 63819)) {
  console.error('port outside QA assignment');
  process.exit(9);
}
const server = createServer((_q, r) => {
  r.setHeader('connection', 'close');
  r.end(`foreign:${mode}:${process.pid}`);
});
server.on('error', (e) => {
  console.error(`foreign error ${e.code}`);
  process.exit(2);
});
const done = () => {
  const addr = server.address();
  if (readyFile) {
    writeFileSync(`${readyFile}.tmp`, JSON.stringify({ pid: process.pid, mode, address: addr }));
    renameSync(`${readyFile}.tmp`, readyFile);
  }
  console.log(`listening ${JSON.stringify(addr)} pid=${process.pid}`);
};
if (mode === 'default') server.listen(port, done);
else if (mode === 'dual') server.listen({ port, host: '::', ipv6Only: false }, done);
else if (mode === 'v6only') server.listen({ port, host: '::', ipv6Only: true }, done);
else server.listen({ port, host: mode }, done);
const stop = () => {
  server.closeAllConnections?.();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
};
process.stdin.on('data', stop);
process.stdin.on('end', stop);
