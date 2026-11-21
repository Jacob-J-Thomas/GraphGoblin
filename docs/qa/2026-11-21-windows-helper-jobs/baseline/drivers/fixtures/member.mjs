// GraphGoblin #459 independent QA fixture: an ordinary long-lived descendant (not product code).
// It ignores parent exit and broken pipes, never writes to its standard handles, and exits only
// at its own bounded natural lifetime (41, or `naturalCode`) or on a driver release request (47).
import { fstatSync } from 'node:fs';
import process from 'node:process';
import { CODES, handshake, markReady, stdioKinds } from './handshake.mjs';

const spec = JSON.parse(Buffer.from(process.argv[2], 'base64url').toString('utf8'));
const natural = spec.naturalCode ?? CODES.member;
// Ignore console control and broken-pipe style signals; the lifetime timer is authoritative.
for (const signal of ['SIGINT', 'SIGBREAK', 'SIGHUP', 'SIGTERM']) process.on(signal, () => {});
setTimeout(() => process.exit(natural), spec.lifetimeMs);
try {
  await handshake(spec.role, { stdio: stdioKinds(fstatSync), lifetimeMs: spec.lifetimeMs }, (message) => {
    if (message.cmd === 'release') process.exit(CODES.released);
  });
  markReady(spec.caseDir, spec.role);
} catch {
  process.exit(CODES.setupFault);
}
