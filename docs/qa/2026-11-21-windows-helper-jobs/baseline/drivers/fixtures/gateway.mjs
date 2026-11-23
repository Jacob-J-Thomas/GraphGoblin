export const WINDOWS_LAUNCHER_LOG_PROTOCOL = 1;
// GraphGoblin #459 independent QA fixture: a minimal fake gateway, installed only as
// apps/api/dist/main.js inside a disposable fixture repository copy (not product code). It answers
// the launcher's readiness probe with the fixture identity, drains on POST /system/shutdown (44),
// exits on a driver release (47) and has a bounded natural lifetime (45).
import { appendFileSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import process from 'node:process';
import { CODES, handshake } from '../../../qa/handshake.mjs';

const scenario = JSON.parse(readFileSync(process.env.QA459_SCENARIO, 'utf8'));
const eventsFile = join(scenario.caseDir, 'events.ndjson');
const log = (record) =>
  appendFileSync(eventsFile, JSON.stringify({ at: Date.now(), pid: process.pid, kind: 'gateway', ...record }) + '\n');
const index =
  readFileSync(eventsFile, { encoding: 'utf8', flag: 'a+' })
    .split('\n')
    .filter(Boolean)
    .filter((line) => JSON.parse(line).event === 'gateway-start').length + 1;
log({ event: 'gateway-start', index, logDirectoryProvided: Boolean(process.env.GG_WINDOWS_LAUNCHER_LOG_DIR) });
process.on('exit', (code) => log({ event: 'gateway-exit', index, code }));
setTimeout(() => process.exit(CODES.gatewayMaxLife), 180_000).unref();
let socket;
try {
  socket = await handshake(`gateway-${index}`, {}, (message) => {
    if (message.cmd === 'release') process.exit(CODES.released);
  });
} catch {
  process.exit(CODES.setupFault);
}
const server = createServer((request, response) => {
  response.setHeader('X-GraphGoblin-Instance', scenario.identityValue);
  response.setHeader('X-GraphGoblin-Pid', String(process.pid));
  response.setHeader('X-GraphGoblin-Phase', 'running');
  if (request.method === 'POST' && request.url === '/system/shutdown') {
    response.statusCode = 202;
    response.end('{"phase":"draining"}');
    log({ event: 'gateway-drain', index });
    server.close(() => {
      process.exitCode = CODES.gatewayDrained;
      socket.destroy();
      process.exit(CODES.gatewayDrained);
    });
    server.closeAllConnections?.();
    return;
  }
  response.statusCode = request.url === '/healthz' || request.url.startsWith('/app/') ? 200 : 404;
  response.end('ok');
});
server.listen(Number(process.env.GG_PORT), '127.0.0.1', () => log({ event: 'gateway-listening', index }));
