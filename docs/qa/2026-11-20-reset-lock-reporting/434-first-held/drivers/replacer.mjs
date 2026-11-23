// QA helper for GraphGoblin #434 targeted control T08 (disposable fixtures only).
// Simulates another process replacing a lock file's record while the reset holds that lock: polls
// until <file> holds a complete owner record that is not its own, then overwrites it once with its
// own record (record shape from apps/api/src/data-dir-lock.ts, identity from the checkout's built
// windows-process-identity.js). Prints {"ready":true} first and {"replaced":true,...} after the
// overwrite, then waits until killed (its record then turns stale).
// Usage: node replacer.mjs <checkout> <file>
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [checkout, file] = process.argv.slice(2);
if (!checkout || !file) {
  process.stderr.write('usage: replacer.mjs <checkout> <file>\n');
  process.exit(2);
}
const say = (obj) => process.stdout.write(JSON.stringify({ pid: process.pid, ...obj }) + '\n');
const { ownWindowsProcessIdentity } = await import(
  pathToFileURL(join(checkout, 'apps', 'api', 'dist', 'windows-process-identity.js')).href
);
const token = randomUUID();
const record = JSON.stringify({
  pid: process.pid,
  startedAt: new Date().toISOString(),
  windowsCreationTime: await ownWindowsProcessIdentity(),
  token,
});
say({ ready: true, waiting: true });
const deadline = Date.now() + 120_000;
const poll = () => {
  let replacedToken;
  try {
    const owner = JSON.parse(readFileSync(file, 'utf8'));
    if (owner && typeof owner.token === 'string' && owner.token !== token) replacedToken = owner.token;
  } catch {
    /* absent, empty or partly written: keep polling */
  }
  if (replacedToken) {
    writeFileSync(file, record);
    say({ replaced: true, replacedToken, sha: createHash('sha256').update(record).digest('hex').slice(0, 16), at: Date.now() });
    setInterval(() => undefined, 1 << 30);
    return;
  }
  if (Date.now() > deadline) {
    say({ replaced: false, timeout: true });
    process.exit(3);
  }
  setTimeout(poll, 1);
};
poll();
